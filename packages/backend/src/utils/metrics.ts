import express from 'express';
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
    activeUsers: new Gauge({
        name: 'reblend_active_users',
        help: 'Number of active users currently registered',
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
    })
};

// Start Metrics Server
export function startMetricsServer(port: number = 9464) {
    const app = express();

    app.get('/metrics', async (_req, res) => {
        try {
            res.set('Content-Type', registry.contentType);
            res.end(await registry.metrics());
        } catch (ex) {
            res.status(500).end(ex);
        }
    });

    app.listen(port, () => {
        logger.info({ port }, 'Metrics server started');
    });
}
