import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

export async function startOperationTelemetry(serviceName: string) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint || sdk || process.env.OTEL_SDK_DISABLED === "true") return;
  const url = `${endpoint.replace(/\/$/, "")}/v1/traces`;
  sdk = new NodeSDK({ serviceName, traceExporter: new OTLPTraceExporter({ url }) });
  await sdk.start();
}

export async function stopOperationTelemetry() {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}

export async function withOperationSpan<T>(name: string, attributes: Attributes, operation: () => Promise<T>) {
  const tracer = trace.getTracer("ai-infra-terminal-research");
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown operation failure";
      if (error instanceof Error) span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw error;
    } finally {
      span.end();
    }
  });
}
