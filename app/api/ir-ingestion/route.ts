import { processIrExtractionQueue } from "@/lib/ir/pipeline";
import { authorizeApi } from "@/lib/auth/session";

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  if (process.env.E2E_TEST === "1") {
    return Response.json({ processed: 0, completed: 0, failed: 0, summary: { pending: 0, processing: 0, completed: 0, failed: 0 } }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
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
