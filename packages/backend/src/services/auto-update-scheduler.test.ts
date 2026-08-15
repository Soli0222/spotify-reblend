import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    poolQuery: vi.fn(),
    lockQuery: vi.fn(),
    release: vi.fn(),
    generatePlaylist: vi.fn(),
    autoUpdateRuns: vi.fn(),
    autoUpdateDuration: vi.fn(),
    autoUpdateLastSuccessTimestamp: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    cronValidate: vi.fn(),
    cronSchedule: vi.fn(),
}));

vi.mock('../config/database', () => ({
    pool: {
        connect: mocks.connect,
        query: mocks.poolQuery,
    },
}));

vi.mock('./playlist-generation', () => ({
    generatePlaylist: mocks.generatePlaylist,
}));

vi.mock('../utils/metrics', () => ({
    metrics: {
        autoUpdateRuns: { inc: mocks.autoUpdateRuns },
        autoUpdateDuration: { observe: mocks.autoUpdateDuration },
        autoUpdateLastSuccessTimestamp: { set: mocks.autoUpdateLastSuccessTimestamp },
    },
}));

vi.mock('../utils/logger', () => ({
    logger: {
        info: mocks.info,
        warn: mocks.warn,
        error: mocks.error,
        debug: mocks.debug,
    },
}));

vi.mock('node-cron', () => ({
    default: {
        validate: mocks.cronValidate,
        schedule: mocks.cronSchedule,
    },
}));

import { getAutoUpdateConfig, runAutoUpdateJob, startAutoUpdateScheduler } from './auto-update-scheduler';

const enabledConfig = {
    enabled: true,
    cronExpression: '0 5 * * *',
    timezone: 'Asia/Tokyo',
    concurrency: 1,
};

function successfulOutcome(skippedMembers: unknown[] = []) {
    return {
        ok: true as const,
        spotifyPlaylistId: 'spotify-playlist',
        spotifyUrl: 'https://open.spotify.com/playlist/spotify-playlist',
        trackCount: 12,
        created: false,
        memberCount: 2,
        skippedMembers,
    };
}

describe('automatic update scheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('AUTO_UPDATE_ENABLED', 'false');
        mocks.cronValidate.mockReturnValue(true);
        mocks.connect.mockResolvedValue({ query: mocks.lockQuery, release: mocks.release });
        mocks.poolQuery.mockResolvedValue({ rows: [] });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('does not start when automatic updates are disabled by default', () => {
        expect(startAutoUpdateScheduler()).toBeUndefined();
        expect(mocks.cronSchedule).not.toHaveBeenCalled();
    });

    it('schedules enabled updates with the configured cron expression and timezone', () => {
        const scheduledTask = { stop: vi.fn() };
        mocks.cronSchedule.mockReturnValue(scheduledTask);
        vi.stubEnv('AUTO_UPDATE_ENABLED', 'true');
        vi.stubEnv('AUTO_UPDATE_CRON', '15 4 * * *');
        vi.stubEnv('AUTO_UPDATE_TZ', 'UTC');
        vi.stubEnv('AUTO_UPDATE_CONCURRENCY', '2');

        expect(startAutoUpdateScheduler()).toBe(scheduledTask);
        expect(mocks.cronSchedule).toHaveBeenCalledWith(
            '15 4 * * *',
            expect.any(Function),
            { timezone: 'UTC' }
        );
    });

    it('falls back to defaults and warns for invalid environment values', () => {
        mocks.cronValidate.mockReturnValue(false);

        expect(getAutoUpdateConfig({
            AUTO_UPDATE_ENABLED: 'yes',
            AUTO_UPDATE_CRON: 'invalid',
            AUTO_UPDATE_TZ: 'Not/A-Timezone',
            AUTO_UPDATE_CONCURRENCY: '0',
        })).toEqual({
            enabled: false,
            cronExpression: '0 5 * * *',
            timezone: 'Asia/Tokyo',
            concurrency: 1,
        });
        expect(mocks.warn).toHaveBeenCalledTimes(4);
    });

    it('does nothing when no playlists are eligible', async () => {
        mocks.lockQuery
            .mockResolvedValueOnce({ rows: [{ locked: true }] })
            .mockResolvedValueOnce({ rows: [] });

        await runAutoUpdateJob(enabledConfig);

        expect(mocks.generatePlaylist).not.toHaveBeenCalled();
        expect(mocks.autoUpdateRuns).toHaveBeenCalledWith({ result: 'skipped' });
        expect(mocks.lockQuery).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock($1)', [8_682_203]);
        expect(mocks.release).toHaveBeenCalledOnce();
    });

    it('records successful and failed updates without stopping later playlists', async () => {
        mocks.lockQuery
            .mockResolvedValueOnce({ rows: [{ locked: true }] })
            .mockResolvedValueOnce({
                rows: [
                    { id: 1, auto_update_sort_mode: 'shuffle' },
                    { id: 2, auto_update_sort_mode: 'smart' },
                ],
            });
        mocks.generatePlaylist
            .mockResolvedValueOnce(successfulOutcome())
            .mockRejectedValueOnce(new Error('Spotify unavailable'));

        await runAutoUpdateJob(enabledConfig);

        expect(mocks.generatePlaylist).toHaveBeenNthCalledWith(1, 1, { sortMode: 'shuffle' });
        expect(mocks.generatePlaylist).toHaveBeenNthCalledWith(2, 2, { sortMode: 'smart' });
        expect(mocks.poolQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('last_auto_update_status'), ['success', null, 1]);
        expect(mocks.poolQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('last_auto_update_status'), ['failed', 'Automatic update failed', 2]);
        expect(mocks.autoUpdateRuns).toHaveBeenCalledWith({ result: 'success' });
        expect(mocks.autoUpdateRuns).toHaveBeenCalledWith({ result: 'failed' });
    });

    it('records a partial result when members were skipped', async () => {
        mocks.lockQuery
            .mockResolvedValueOnce({ rows: [{ locked: true }] })
            .mockResolvedValueOnce({ rows: [{ id: 1, auto_update_sort_mode: 'shuffle' }] });
        mocks.generatePlaylist.mockResolvedValueOnce(successfulOutcome([
            { id: 2, displayName: 'Member', reason: 'token-invalid' },
        ]));

        await runAutoUpdateJob(enabledConfig);

        expect(mocks.poolQuery).toHaveBeenCalledWith(
            expect.stringContaining('last_auto_update_status'),
            ['partial', 'Skipped 1 member(s)', 1]
        );
        expect(mocks.autoUpdateRuns).toHaveBeenCalledWith({ result: 'partial' });
        expect(mocks.autoUpdateLastSuccessTimestamp).not.toHaveBeenCalled();
    });

    it('does not query playlists when the advisory lock is unavailable', async () => {
        mocks.lockQuery.mockResolvedValueOnce({ rows: [{ locked: false }] });

        await runAutoUpdateJob(enabledConfig);

        expect(mocks.generatePlaylist).not.toHaveBeenCalled();
        expect(mocks.lockQuery).toHaveBeenCalledTimes(1);
        expect(mocks.autoUpdateRuns).toHaveBeenCalledWith({ result: 'skipped' });
        expect(mocks.release).toHaveBeenCalledOnce();
    });
});
