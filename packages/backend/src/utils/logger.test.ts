import { context, trace } from '@opentelemetry/api';
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import express from 'express';
import { once } from 'events';
import http from 'http';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { Writable } from 'stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { traceContextMixin } from './logger';

class LogSink extends Writable {
    public readonly entries: Record<string, unknown>[] = [];

    _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.entries.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        callback();
    }
}

let telemetry: NodeSDK;

beforeAll(() => {
    telemetry = new NodeSDK({
        instrumentations: [],
        traceExporter: new tracing.InMemorySpanExporter(),
    });
    telemetry.start();
});

afterAll(async () => {
    await telemetry.shutdown();
});

describe('traceContextMixin', () => {
    it('does not add fields without an active span', () => {
        expect(traceContextMixin()).toEqual({});
    });

    it('adds the active span identifiers', () => {
        const span = trace.getTracer('logger-test').startSpan('active-span');

        const fields = context.with(
            trace.setSpan(context.active(), span),
            traceContextMixin,
        );

        expect(fields).toEqual({
            trace_id: span.spanContext().traceId,
            span_id: span.spanContext().spanId,
            trace_flags: '01',
        });

        span.end();
    });

    it('adds identifiers to handler and completed request logs', async () => {
        const sink = new LogSink();
        const testLogger = pino({ mixin: traceContextMixin }, sink);
        const middleware = pinoHttp({ logger: testLogger });
        const app = express();

        app.use((req, res) => {
            const span = trace.getTracer('logger-test').startSpan('request-span');
            context.with(trace.setSpan(context.active(), span), () => {
                middleware(req, res, () => {
                    testLogger.info('Handler log');
                    res.status(204).end();
                    span.end();
                });
            });
        });

        const server = app.listen(0);
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Expected server to listen on a TCP port');
        }

        await new Promise<void>((resolve, reject) => {
            const request = http.get(`http://127.0.0.1:${address.port}/`, response => {
                response.resume();
                response.on('end', resolve);
            });
            request.on('error', reject);
        });
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });

        const handlerLog = sink.entries.find(entry => entry.msg === 'Handler log');
        const completionLog = sink.entries.find(entry => entry.msg === 'request completed');

        expect(handlerLog).toMatchObject({
            trace_id: expect.any(String),
            span_id: expect.any(String),
            trace_flags: '01',
        });
        expect(completionLog).toMatchObject({
            trace_id: handlerLog?.trace_id,
            span_id: handlerLog?.span_id,
            trace_flags: handlerLog?.trace_flags,
        });
    });
});
