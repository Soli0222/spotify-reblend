import pino from 'pino';
import { pinoHttp } from 'pino-http';

// Create logger instance
export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production' ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
        }
    } : undefined,
    base: {
        service: 'spotify-reblend-backend',
        env: process.env.NODE_ENV,
    },
});

// Middleware for HTTP request logging
export const requestLogger = pinoHttp({
    logger,
    customLogLevel: (req, res, err) => {
        if (res.statusCode >= 500 || err) {
            return 'error';
        }
        if (res.statusCode >= 400) {
            return 'warn';
        }
        return 'info';
    },
    serializers: {
        req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            query: req.query,
            params: req.params,
            headers: {
                'user-agent': req.headers['user-agent'],
                'content-type': req.headers['content-type'],
            },
        }),
        res: (res) => ({
            statusCode: res.statusCode,
        }),
    },
});
