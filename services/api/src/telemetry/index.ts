import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { trace, metrics, SpanStatusCode, context, propagation } from '@opentelemetry/api';
import crypto from 'node:crypto';

let sdk: NodeSDK | null = null;

export function initTelemetry(): NodeSDK {
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'the-clubs-api';
  const serviceVersion = process.env.OTEL_SERVICE_VERSION ?? '1.0.0';
  const environment = process.env.NODE_ENV ?? 'development';

  const resource = resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
  });

  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

  const traceExporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${otlpEndpoint}/v1/metrics`,
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations: [
      new HttpInstrumentation({
        requestHook: (span, request) => {
          if ('headers' in request) {
            const headers = request.headers as Record<string, string>;
            const correlationId = headers['x-correlation-id'];
            if (correlationId) {
              span.setAttribute('correlation.id', correlationId);
            }
            const traceId = span.spanContext().traceId;
            if (traceId) {
              span.setAttribute('trace.id', traceId);
            }
          }
        },
        responseHook: (span, response) => {
          if ('statusCode' in response && typeof response.statusCode === 'number') {
            span.setAttribute('http.status_code', response.statusCode);
          }
        },
      }),
      new FastifyInstrumentation(),
      new PgInstrumentation({
        enhancedDatabaseReporting: true,
      }),
    ],
  });

  sdk.start();

  console.log(`[Telemetry] Initialized - service: ${serviceName}, env: ${environment}`);

  return sdk;
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      console.log('[Telemetry] Shutdown complete');
    } catch (error) {
      console.error('[Telemetry] Error during shutdown:', error);
    }
  }
}

export const tracer = trace.getTracer('the-clubs-api');

export function getTracer() {
  return tracer;
}

export const meter = metrics.getMeter('the-clubs-api');

export function getMeter() {
  return meter;
}

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean> = {},
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

export function getCurrentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
}

export function getCurrentSpanId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().spanId;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export function extractTraceContext(): TraceContext | null {
  const span = trace.getActiveSpan();
  if (!span) return null;
  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  };
}

export function injectTraceContext(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function extractTraceContextFromCarrier(
  carrier: Record<string, string>
): ReturnType<typeof trace.getActiveSpan> | null {
  const ctx = propagation.extract(context.active(), carrier);
  return trace.getSpan(ctx);
}
