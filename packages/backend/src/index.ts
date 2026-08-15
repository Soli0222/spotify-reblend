import './telemetry';

import express from 'express';
import { Server } from 'http';
import path from 'path';
import dotenv from 'dotenv';
import { initDatabase, pool } from './config/database';
import { refreshTokenInvalidUsersGauge } from './services/spotify-token';
import { logger, requestLogger } from './utils/logger';
import { startMetricsServer, metrics } from './utils/metrics';
import { blockSensitivePaths, createCorsMiddleware, rateLimit, securityHeaders } from './utils/http';
import { shutdownTelemetry } from './telemetry';
import authRoutes from './routes/auth';
import playlistRoutes from './routes/playlists';
import invitationRoutes from './routes/invitations';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const METRICS_PORT = parseInt(process.env.METRICS_PORT || '9464', 10);
const SHUTDOWN_TIMEOUT_MS = 10_000;
let server: Server | undefined;
let metricsServer: Server | undefined;
let isShuttingDown = false;

// Middleware
app.use((req, res, next) => {
    const start = process.hrtime();

    res.on('finish', () => {
        const duration = process.hrtime(start);
        const durationInSeconds = duration[0] + duration[1] / 1e9;

        // Try to reconstruct the route path to avoid high cardinality
        // req.route is set if a route matched. req.baseUrl is the router mount point.
        let route = 'unknown';
        if (req.route && req.route.path) {
            route = (req.baseUrl || '') + req.route.path;
        } else if (req.route) {
            // Sometimes req.route is present but path is elsewhere or regex
            route = (req.baseUrl || '') + (req.route.path || req.path);
        }

        // If 'route' is still unknown or purely dynamic (e.g. 404), keep it as 'unknown' or use a safe fallback
        // We avoid logging raw req.path which includes IDs.

        // For /api/playlists/123 -> baseUrl=/api/playlists, route.path=/:id -> route=/api/playlists/:id

        // Note: In 404 cases, req.route is typically undefined.

        metrics.httpRequestDuration.observe(
            {
                method: req.method,
                route: route !== 'unknown' ? route : 'other',
                status: res.statusCode
            },
            durationInSeconds
        );

        metrics.httpRequests.inc({
            method: req.method,
            route: route !== 'unknown' ? route : 'other',
            status: res.statusCode
        });
    });

    next();
});

app.use(securityHeaders);
app.use(requestLogger); // Structural logging
app.use(createCorsMiddleware());
app.use(express.json({ limit: '32kb' }));
app.use(blockSensitivePaths);
app.use('/api', rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'api' }));

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api', invitationRoutes);

app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Serve static files from frontend build
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// SPA fallback - serve index.html for all non-API routes
app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
    try {
        await initDatabase();
        await refreshTokenInvalidUsersGauge();

        // Start Metrics Server
        metricsServer = startMetricsServer(METRICS_PORT);

        server = app.listen(PORT, () => {
            logger.info({ port: PORT, env: process.env.NODE_ENV }, 'Server running');
        });
    } catch (error) {
        logger.fatal({ err: error }, 'Failed to start server');
        process.exit(1);
    }
}

function closeServer(serverToClose: Server | undefined): Promise<void> {
    if (!serverToClose) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        serverToClose.close(error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

async function shutdown(signal: NodeJS.Signals) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');

    const forceShutdownTimer = setTimeout(() => {
        logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Graceful shutdown timed out, forcing exit');
        server?.closeAllConnections();
        metricsServer?.closeAllConnections();
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
        const closeServers = Promise.all([closeServer(server), closeServer(metricsServer)]);
        server?.closeIdleConnections();
        metricsServer?.closeIdleConnections();
        await closeServers;
        await pool.end();
        await shutdownTelemetry();
        clearTimeout(forceShutdownTimer);
        process.exit(0);
    } catch (error) {
        clearTimeout(forceShutdownTimer);
        logger.error({ err: error }, 'Graceful shutdown failed');
        process.exit(1);
    }
}

process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
});

process.once('SIGINT', () => {
    void shutdown('SIGINT');
});

start();
