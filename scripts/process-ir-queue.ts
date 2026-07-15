import { processIrExtractionQueue } from "@/lib/ir/pipeline";

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required to process the IR extraction queue.");
  const all = process.argv.includes("--all");
  let completed = 0;
  let failed = 0;
  let result = await processIrExtractionQueue(all ? 25 : 1);
  completed += result.completed;
  failed += result.failed;
  while (all && result.processed > 0 && result.summary.pending > 0) {
    result = await processIrExtractionQueue(25);
    completed += result.completed;
    failed += result.failed;
  }
  console.log(`IR queue run: ${completed} completed, ${failed} failed, ${result.summary.pending} pending.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
