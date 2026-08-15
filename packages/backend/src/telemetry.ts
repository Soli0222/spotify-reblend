import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { version } from '../package.json';

const isSdkDisabled = process.env.OTEL_SDK_DISABLED?.toLowerCase() === 'true';
const hasOtlpEndpoint = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

let sdk: NodeSDK | undefined;

if (!isSdkDisabled && hasOtlpEndpoint) {
    sdk = new NodeSDK({
        resource: defaultResource().merge(
            resourceFromAttributes({
                [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'spotify-reblend-backend',
                [ATTR_SERVICE_VERSION]: version,
                'deployment.environment': process.env.NODE_ENV || 'development',
            }),
        ),
        traceExporter: new OTLPTraceExporter(),
        logRecordProcessors: [],
        instrumentations: [
            getNodeAutoInstrumentations({
                '@opentelemetry/instrumentation-fs': {
                    enabled: false,
                },
                '@opentelemetry/instrumentation-http': {
                    ignoreIncomingRequestHook: request => {
                        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
                        return pathname === '/health' || pathname === '/metrics';
                    },
                },
            }),
        ],
    });

    sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
    await sdk?.shutdown();
}
