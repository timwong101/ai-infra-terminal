import { authenticateRequest, authorizeApi, createWorkspace, switchWorkspace } from "@/lib/auth/session";
import { boundedText, entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const createWorkspaceSchema = z.object({ name: boundedText(120).min(2) });
const switchWorkspaceSchema = z.object({ workspaceId: entityId });

export async function POST(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, createWorkspaceSchema);
    if ("response" in parsed) return parsed.response;
    const workspace = await createWorkspace(authorized.auth, parsed.data.name);
    return Response.json({ workspace, auth: await authenticateRequest(request) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create a workspace." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, switchWorkspaceSchema);
    if ("response" in parsed) return parsed.response;
    await switchWorkspace(authorized.auth, parsed.data.workspaceId);
    return Response.json({ switched: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to switch workspaces." }, { status: 403 });
  }
}
