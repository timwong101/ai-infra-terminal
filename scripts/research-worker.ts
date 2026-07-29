import { createServer } from "node:http";
import { startOperationTelemetry, stopOperationTelemetry } from "@/lib/operations/telemetry";
import { startResearchWorkers } from "@/lib/operations/worker";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const healthPortValue = argument("--health-port") || process.env.WORKER_HEALTH_PORT;
const healthPort = healthPortValue ? Number(healthPortValue) : null;

await startOperationTelemetry("ai-infra-research-worker");
const runtime = startResearchWorkers();
await runtime.ready;

const healthServer = healthPort ? createServer((request, response) => {
  if (request.url !== "/healthz") {
    response.writeHead(404).end();
    return;
  }
  const health = runtime.health();
  response.writeHead(health.ready ? 200 : 503, { "Content-Type": "application/json" });
  response.end(JSON.stringify(health));
}).listen(healthPort, "127.0.0.1") : null;

console.log(`Research worker ${runtime.workerId} is ready${healthPort ? ` · health http://localhost:${healthPort}/healthz` : ""}.`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (healthServer) await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  await runtime.close();
  await stopOperationTelemetry();
}

process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
