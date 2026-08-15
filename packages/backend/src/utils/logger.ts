import { isSpanContextValid, trace } from '@opentelemetry/api';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

export function traceContextMixin() {
    const span = trace.getActiveSpan();
    if (!span) {
        return {};
    }

    const spanContext = span.spanContext();
    if (!isSpanContextValid(spanContext)) {
        return {};
    }

    return {
        trace_id: spanContext.traceId,
        span_id: spanContext.spanId,
        trace_flags: spanContext.traceFlags.toString(16).padStart(2, '0'),
    };
}

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
    mixin: traceContextMixin,
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
            remoteAddress: req.socket?.remoteAddress,
            headers: {
                'user-agent': req.headers['user-agent'],
                'content-type': req.headers['content-type'],
                origin: req.headers.origin,
                referer: req.headers.referer,
                'x-forwarded-for': req.headers['x-forwarded-for'],
            },
        }),
        res: (res) => ({
            statusCode: res.statusCode,
        }),
    },
});
