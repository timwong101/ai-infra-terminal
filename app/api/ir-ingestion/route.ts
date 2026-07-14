import { processIrExtractionQueue } from "@/lib/ir/pipeline";

export async function POST() {
  try {
    return Response.json(await processIrExtractionQueue(1), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to process the IR extraction queue." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
