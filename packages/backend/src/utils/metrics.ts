import express from 'express';
import { Server } from 'http';
import { collectDefaultMetrics, Registry, Counter, Gauge, Histogram } from 'prom-client';
import { logger } from './logger';

// Create a Registry
const registry = new Registry();

// Collect default metrics (node process, etc.)
collectDefaultMetrics({ register: registry });

// Custom Metrics
export const metrics = {
    playlistCreated: new Counter({
        name: 'reblend_playlist_created_total',
        help: 'Total number of playlists created',
        registers: [registry],
    }),
    blendExecuted: new Counter({
        name: 'reblend_blend_executed_total',
        help: 'Total number of blends executed',
        labelNames: ['user_count'],
        registers: [registry],
    }),
    tracksFiltered: new Counter({
        name: 'reblend_tracks_filtered_total',
        help: 'Total number of tracks filtered from blends',
        labelNames: ['reason'],
        registers: [registry],
    }),
    activeUsers: new Gauge({
        name: 'reblend_active_users',
        help: 'Number of active users currently registered',
        registers: [registry],
    }),
    tokenInvalidated: new Counter({
        name: 'reblend_token_invalidated_total',
        help: 'Total number of users whose Spotify refresh token was permanently invalidated',
        registers: [registry],
    }),
    usersTokenInvalid: new Gauge({
        name: 'reblend_users_token_invalid',
        help: 'Number of users with a permanently invalid Spotify refresh token',
        registers: [registry],
    }),
    httpRequests: new Counter({
        name: 'reblend_http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'route', 'status'],
        registers: [registry],
    }),
    httpRequestDuration: new Histogram({
        name: 'http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status'],
        buckets: [0.1, 0.3, 0.5, 1, 2, 5],
        registers: [registry],
    }),
    autoUpdateRuns: new Counter({
        name: 'reblend_auto_update_runs_total',
        help: 'Total automatic playlist update attempts by result',
        labelNames: ['result'],
        registers: [registry],
    }),
    autoUpdateDuration: new Histogram({
        name: 'reblend_auto_update_duration_seconds',
        help: 'Duration of individual automatic playlist updates',
        buckets: [0.1, 0.3, 0.5, 1, 2, 5, 10, 30, 60],
        registers: [registry],
    }),
    autoUpdateLastSuccessTimestamp: new Gauge({
        name: 'reblend_auto_update_last_success_timestamp',
        help: 'Unix timestamp of the most recent successful automatic playlist update',
        registers: [registry],
    })
};

// Start Metrics Server
export function startMetricsServer(port: number = 9464): Server {
    const app = express();

    app.get('/metrics', async (_req, res) => {
        try {
            res.set('Content-Type', registry.contentType);
            res.end(await registry.metrics());
        } catch (ex) {
            res.status(500).end(ex);
        }
    });

    return app.listen(port, () => {
        logger.info({ port }, 'Metrics server started');
    });
}
