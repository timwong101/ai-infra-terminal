import { generateComparisonMemo, listComparisonMemos } from "@/lib/research/memos";
import { authorizeApi } from "@/lib/auth/session";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    return Response.json({ memos: await listComparisonMemos(authorized.auth.workspace.id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load memos." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { companyAId?: string; companyBId?: string; topic?: string; question?: string };
    if (!body.companyAId || !body.companyBId) return Response.json({ error: "Two companies are required." }, { status: 400 });
    const memo = await generateComparisonMemo({
      companyAId: body.companyAId,
      companyBId: body.companyBId,
      topic: body.topic || "All topics",
      question: body.question || "",
    }, authorized.auth);
    return Response.json({ memo }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate the comparison memo.";
    return Response.json({ error: message }, { status: message.startsWith("Accept at least") || message.startsWith("Choose two") ? 400 : 500 });
  }
}
