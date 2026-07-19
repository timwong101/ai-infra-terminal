import { createThesis, listTheses, updateThesis } from "@/lib/theses/repository";
import { authorizeApi, recordAuditEvent } from "@/lib/auth/session";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try { return Response.json({ claims: await listTheses() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load theses." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { companyId?: string; title?: string; statement?: string };
    if (!body.companyId || !body.title?.trim() || !body.statement?.trim()) return Response.json({ error: "Company, title, and statement are required." }, { status: 400 });
    const claim = await createThesis({ companyId: body.companyId, title: body.title, statement: body.statement });
    await recordAuditEvent(authorized.auth, { action: "thesis.created", entityType: "research_claim", entityId: claim.id, summary: `Created thesis ${claim.title}.`, metadata: { companyId: body.companyId } });
    return Response.json({ claim }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create thesis." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { id?: string; title?: string; statement?: string; status?: string };
    if (!body.id) return Response.json({ error: "Thesis id is required." }, { status: 400 });
    const claim = await updateThesis(body.id, { title: body.title, statement: body.statement, status: body.status });
    await recordAuditEvent(authorized.auth, { action: "thesis.updated", entityType: "research_claim", entityId: body.id, summary: `Updated thesis ${claim.title}.`, metadata: { status: body.status ?? claim.status } });
    return Response.json({ claim });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to update thesis." }, { status: 500 }); }
}
