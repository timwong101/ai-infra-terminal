import { createThesis, listTheses, updateThesis } from "@/lib/theses/repository";
import { authorizeApi, recordAuditEvent } from "@/lib/auth/session";
import { boundedText, entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const thesisSchema = z.object({ companyId: entityId, title: boundedText(160).min(1), statement: boundedText(4_000).min(1) });
const thesisUpdateSchema = z.object({ id: entityId, title: boundedText(160).min(1).optional(), statement: boundedText(4_000).min(1).optional(), status: z.enum(["active", "watch", "retired"]).optional() });

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try { return Response.json({ claims: await listTheses(authorized.auth.workspace.id) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load theses." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, thesisSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const claim = await createThesis({ companyId: body.companyId, title: body.title, statement: body.statement }, authorized.auth);
    await recordAuditEvent(authorized.auth, { action: "thesis.created", entityType: "research_claim", entityId: claim.id, summary: `Created thesis ${claim.title}.`, metadata: { companyId: body.companyId } });
    return Response.json({ claim }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create thesis." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, thesisUpdateSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const claim = await updateThesis(body.id, { title: body.title, statement: body.statement, status: body.status }, authorized.auth);
    await recordAuditEvent(authorized.auth, { action: "thesis.updated", entityType: "research_claim", entityId: body.id, summary: `Updated thesis ${claim.title}.`, metadata: { status: body.status ?? claim.status } });
    return Response.json({ claim });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to update thesis." }, { status: 500 }); }
}
