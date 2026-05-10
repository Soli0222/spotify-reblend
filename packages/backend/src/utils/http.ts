import { NextFunction, Request, Response } from 'express';
import cors from 'cors';

type RateLimitBucket = {
    count: number;
    resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

export function createCorsMiddleware() {
    const configuredOrigins = (process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);

    const developmentOrigins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
    ];

    const allowedOrigins = new Set([
        ...configuredOrigins,
        ...(process.env.NODE_ENV === 'production' ? [] : developmentOrigins),
    ]);

    return cors((req, callback) => {
        const origin = req.headers.origin;
        const host = req.headers.host;
        const isSameHost = origin && host && (() => {
            try {
                return new URL(origin).host === host;
            } catch {
                return false;
            }
        })();

        callback(null, {
            credentials: true,
            origin: !origin || isSameHost || allowedOrigins.has(origin),
        });
    });
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
}

export function blockSensitivePaths(req: Request, res: Response, next: NextFunction): void {
    if (/(^|\/)\.[^/]+/.test(req.path)) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    next();
}

export function rateLimit(options: {
    windowMs: number;
    max: number;
    keyPrefix: string;
}) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const now = Date.now();
        const forwardedFor = req.headers['x-forwarded-for'];
        const ip = Array.isArray(forwardedFor)
            ? forwardedFor[0]
            : forwardedFor?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
        const key = `${options.keyPrefix}:${ip}`;
        const bucket = buckets.get(key);

        if (!bucket || bucket.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + options.windowMs });
            next();
            return;
        }

        if (bucket.count >= options.max) {
            res.status(429).json({ error: 'Too many requests' });
            return;
        }

        bucket.count += 1;
        next();
    };
}
