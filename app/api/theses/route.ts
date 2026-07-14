import { createThesis, listTheses, updateThesis } from "@/lib/theses/repository";

export async function GET() {
  try { return Response.json({ claims: await listTheses() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load theses." }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { companyId?: string; title?: string; statement?: string };
    if (!body.companyId || !body.title?.trim() || !body.statement?.trim()) return Response.json({ error: "Company, title, and statement are required." }, { status: 400 });
    return Response.json({ claim: await createThesis({ companyId: body.companyId, title: body.title, statement: body.statement }) }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create thesis." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; title?: string; statement?: string; status?: string };
    if (!body.id) return Response.json({ error: "Thesis id is required." }, { status: 400 });
    return Response.json({ claim: await updateThesis(body.id, { title: body.title, statement: body.statement, status: body.status }) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to update thesis." }, { status: 500 }); }
}
