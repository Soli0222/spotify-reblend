import cron, { ScheduledTask } from 'node-cron';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/database';
import { SortMode } from './blend';
import { generatePlaylist } from './playlist-generation';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';

const DEFAULT_CRON = '0 5 * * *';
const DEFAULT_TIMEZONE = 'Asia/Tokyo';
const DEFAULT_CONCURRENCY = 1;
const PLAYLIST_DELAY_MS = 250;
const AUTO_UPDATE_LOCK_KEY = 8_682_203;

export type AutoUpdateConfig = {
    enabled: boolean;
    cronExpression: string;
    timezone: string;
    concurrency: number;
};

type AutoUpdatePlaylist = {
    id: number;
    auto_update_sort_mode: string | null;
};

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidTimezone(timezone: string): boolean {
    try {
        Intl.DateTimeFormat('en-US', { timeZone: timezone });
        return true;
    } catch {
        return false;
    }
}

export function getAutoUpdateConfig(env: NodeJS.ProcessEnv = process.env): AutoUpdateConfig {
    let enabled = false;
    if (env.AUTO_UPDATE_ENABLED !== undefined) {
        if (env.AUTO_UPDATE_ENABLED === 'true') {
            enabled = true;
        } else if (env.AUTO_UPDATE_ENABLED !== 'false') {
            logger.warn({ value: env.AUTO_UPDATE_ENABLED }, 'Invalid AUTO_UPDATE_ENABLED; using false');
        }
    }

    let cronExpression = DEFAULT_CRON;
    if (env.AUTO_UPDATE_CRON !== undefined) {
        cronExpression = env.AUTO_UPDATE_CRON;
        if (!cron.validate(cronExpression)) {
            logger.warn({ value: cronExpression }, 'Invalid AUTO_UPDATE_CRON; using default');
            cronExpression = DEFAULT_CRON;
        }
    }

    let timezone = DEFAULT_TIMEZONE;
    if (env.AUTO_UPDATE_TZ !== undefined) {
        timezone = env.AUTO_UPDATE_TZ;
        if (!isValidTimezone(timezone)) {
            logger.warn({ value: timezone }, 'Invalid AUTO_UPDATE_TZ; using default');
            timezone = DEFAULT_TIMEZONE;
        }
    }

    let concurrency = DEFAULT_CONCURRENCY;
    if (env.AUTO_UPDATE_CONCURRENCY !== undefined) {
        const parsed = Number(env.AUTO_UPDATE_CONCURRENCY);
        if (Number.isInteger(parsed) && parsed > 0) {
            concurrency = parsed;
        } else {
            logger.warn({ value: env.AUTO_UPDATE_CONCURRENCY }, 'Invalid AUTO_UPDATE_CONCURRENCY; using default');
        }
    }

    return { enabled, cronExpression, timezone, concurrency };
}

function sortModeFor(playlist: AutoUpdatePlaylist): SortMode {
    return playlist.auto_update_sort_mode === 'smart' ? 'smart' : 'shuffle';
}

async function recordResult(
    playlistId: number,
    status: 'success' | 'partial' | 'failed',
    error: string | null
): Promise<void> {
    await pool.query(
        `UPDATE playlists
         SET last_auto_updated_at = CURRENT_TIMESTAMP,
             last_auto_update_status = $1,
             last_auto_update_error = $2
         WHERE id = $3`,
        [status, error, playlistId]
    );
}

async function updatePlaylist(jobId: string, playlist: AutoUpdatePlaylist): Promise<void> {
    const startedAt = Date.now();
    let trackCount = 0;

    try {
        const outcome = await generatePlaylist(playlist.id, { sortMode: sortModeFor(playlist) });
        if (!outcome.ok) {
            await recordResult(playlist.id, 'failed', `Generation could not complete: ${outcome.reason}`);
            metrics.autoUpdateRuns.inc({ result: 'failed' });
            logger.warn({ jobId, playlistId: playlist.id, trackCount, durationMs: Date.now() - startedAt }, 'Automatic playlist update failed');
            return;
        }

        trackCount = outcome.trackCount;
        const status = outcome.skippedMembers.length > 0 ? 'partial' : 'success';
        const error = status === 'partial' ? `Skipped ${outcome.skippedMembers.length} member(s)` : null;
        await recordResult(playlist.id, status, error);
        metrics.autoUpdateRuns.inc({ result: status });
        if (status === 'success') {
            metrics.autoUpdateLastSuccessTimestamp.set(Date.now() / 1000);
        }
        logger.info({ jobId, playlistId: playlist.id, trackCount, durationMs: Date.now() - startedAt }, 'Automatic playlist update completed');
    } catch (error) {
        try {
            await recordResult(playlist.id, 'failed', 'Automatic update failed');
        } catch (recordError) {
            logger.error({ err: recordError, jobId, playlistId: playlist.id }, 'Failed to record automatic update result');
        }
        metrics.autoUpdateRuns.inc({ result: 'failed' });
        logger.error({ err: error, jobId, playlistId: playlist.id, trackCount, durationMs: Date.now() - startedAt }, 'Automatic playlist update failed');
    } finally {
        metrics.autoUpdateDuration.observe((Date.now() - startedAt) / 1000);
    }
}

export async function runAutoUpdateJob(config: AutoUpdateConfig = getAutoUpdateConfig()): Promise<void> {
    const jobId = randomUUID();
    const lockClient = await pool.connect();
    let lockAcquired = false;

    try {
        const lockResult = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [AUTO_UPDATE_LOCK_KEY]);
        lockAcquired = lockResult.rows[0]?.locked === true;
        if (!lockAcquired) {
            metrics.autoUpdateRuns.inc({ result: 'skipped' });
            logger.debug({ jobId }, 'Automatic update job skipped because another instance holds the lock');
            return;
        }

        const playlistsResult = await lockClient.query<AutoUpdatePlaylist>(
            `SELECT id, auto_update_sort_mode
             FROM playlists
             WHERE auto_update_enabled = true
               AND spotify_playlist_id IS NOT NULL
             ORDER BY id ASC`
        );
        const playlists = playlistsResult.rows;
        if (playlists.length === 0) {
            metrics.autoUpdateRuns.inc({ result: 'skipped' });
            logger.info({ jobId }, 'No playlists are eligible for automatic update');
            return;
        }

        let nextIndex = 0;
        const worker = async () => {
            let hasProcessedPlaylist = false;
            while (nextIndex < playlists.length) {
                const playlist = playlists[nextIndex++];
                if (hasProcessedPlaylist) {
                    await sleep(PLAYLIST_DELAY_MS);
                }
                hasProcessedPlaylist = true;
                await updatePlaylist(jobId, playlist);
            }
        };
        await Promise.all(Array.from({ length: Math.min(config.concurrency, playlists.length) }, worker));
    } finally {
        if (lockAcquired) {
            try {
                await lockClient.query('SELECT pg_advisory_unlock($1)', [AUTO_UPDATE_LOCK_KEY]);
            } catch (error) {
                logger.error({ err: error, jobId }, 'Failed to release automatic update advisory lock');
            }
        }
        lockClient.release();
    }
}

export function startAutoUpdateScheduler(): ScheduledTask | undefined {
    const config = getAutoUpdateConfig();
    if (!config.enabled) {
        logger.info('Automatic update scheduler is disabled');
        return undefined;
    }

    const task = cron.schedule(config.cronExpression, () => {
        void runAutoUpdateJob(config).catch(error => {
            logger.error({ err: error }, 'Automatic update job failed before processing playlists');
        });
    }, { timezone: config.timezone });
    logger.info({ cronExpression: config.cronExpression, timezone: config.timezone, concurrency: config.concurrency }, 'Automatic update scheduler started');
    return task;
}
