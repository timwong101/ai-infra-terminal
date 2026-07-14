import { processIrExtractionQueue } from "@/lib/ir/pipeline";

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required to process the IR extraction queue.");
  const all = process.argv.includes("--all");
  const result = await processIrExtractionQueue(all ? 25 : 1);
  console.log(`IR queue run: ${result.completed} completed, ${result.failed} failed, ${result.summary.pending} pending.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
