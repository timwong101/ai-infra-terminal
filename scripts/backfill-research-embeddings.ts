import { backfillResearchEmbeddings } from "@/lib/research/search";

backfillResearchEmbeddings(Number(process.argv[2] ?? 100))
  .then((result) => console.log(result.skipped
    ? "OPENAI_API_KEY is not configured; embedding backfill was skipped."
    : `Embedded ${result.embedded} accepted evidence passages.`))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
