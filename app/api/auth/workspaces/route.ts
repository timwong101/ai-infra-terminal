import { authenticateRequest, authorizeApi, createWorkspace, switchWorkspace } from "@/lib/auth/session";

export async function POST(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { name?: string };
    const workspace = await createWorkspace(authorized.auth, body.name ?? "");
    return Response.json({ workspace, auth: await authenticateRequest(request) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create a workspace." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { workspaceId?: string };
    if (!body.workspaceId) return Response.json({ error: "Workspace id is required." }, { status: 400 });
    await switchWorkspace(authorized.auth, body.workspaceId);
    return Response.json({ switched: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to switch workspaces." }, { status: 403 });
  }
}
