import { trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withSpan } from './tracing';

afterEach(() => {
    trace.disable();
    vi.unstubAllEnvs();
});

describe('withSpan', () => {
    it('runs work directly without a configured OpenTelemetry provider', () => {
        vi.stubEnv('OTEL_SDK_DISABLED', 'true');
        trace.disable();
        const work = () => 'completed';

        expect(withSpan('disabled.span', { 'safe.count': 1 }, span => {
            expect(span).toBeUndefined();
            return work();
        })).toBe('completed');
    });
});
