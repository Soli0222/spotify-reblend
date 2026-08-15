import { context, Span, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';

const tracer = trace.getTracer('spotify-reblend-backend');

function isTracingEnabled(): boolean {
    return process.env.OTEL_SDK_DISABLED?.toLowerCase() !== 'true'
        && Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is T & PromiseLike<Awaited<T>> {
    return typeof (value as PromiseLike<T>)?.then === 'function';
}

function asException(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export function recordSpanError(error: unknown, span: Span | undefined = trace.getActiveSpan()): void {
    if (!span?.isRecording()) {
        return;
    }

    span.recordException(asException(error));
    span.setStatus({ code: SpanStatusCode.ERROR });
}

/**
 * Runs work in a recording span when an OpenTelemetry provider is configured.
 * With the default no-op provider, work runs directly without creating context.
 */
export function withSpan<T>(
    name: string,
    attributes: Attributes,
    fn: (span: Span | undefined) => T
): T {
    if (!isTracingEnabled()) {
        return fn(undefined);
    }

    const span = tracer.startSpan(name, { attributes });
    if (!span.isRecording()) {
        span.end();
        return fn(undefined);
    }

    try {
        const result = context.with(trace.setSpan(context.active(), span), () => fn(span));
        if (isPromiseLike(result)) {
            return result.then(
                value => {
                    span.end();
                    return value;
                },
                error => {
                    recordSpanError(error, span);
                    span.end();
                    throw error;
                },
            ) as T;
        }
        span.end();
        return result;
    } catch (error) {
        recordSpanError(error, span);
        span.end();
        throw error;
    }
}
