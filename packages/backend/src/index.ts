import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { initDatabase } from './config/database';
import { logger, requestLogger } from './utils/logger';
import { startMetricsServer, metrics } from './utils/metrics';
import authRoutes from './routes/auth';
import playlistRoutes from './routes/playlists';
import invitationRoutes from './routes/invitations';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const METRICS_PORT = parseInt(process.env.METRICS_PORT || '9464', 10);

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

app.use(requestLogger); // Structural logging
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api', invitationRoutes);

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

        // Start Metrics Server
        startMetricsServer(METRICS_PORT);

        app.listen(PORT, () => {
            logger.info({ port: PORT, env: process.env.NODE_ENV }, 'Server running');
        });
    } catch (error) {
        logger.fatal({ err: error }, 'Failed to start server');
        process.exit(1);
    }
}

start();
