import { authorizeApi } from "@/lib/auth/session";
import { createWorkspaceInvitation, listWorkspaceTeam, removeWorkspaceMember, revokeWorkspaceInvitation, updateWorkspaceMemberRole } from "@/lib/reviews/service";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    return Response.json(await listWorkspaceTeam(authorized.auth), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load workspace members." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "admin");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { email?: string; role?: string };
    return Response.json({ invitation: await createWorkspaceInvitation(body.email ?? "", body.role ?? "analyst", authorized.auth) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create an invitation." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "admin");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { memberId?: string; role?: string };
    if (!body.memberId) return Response.json({ error: "A member ID is required." }, { status: 400 });
    await updateWorkspaceMemberRole(body.memberId, body.role ?? "", authorized.auth);
    return Response.json({ updated: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update this member." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const authorized = await authorizeApi(request, "admin");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { memberId?: string; invitationId?: string };
    if (body.invitationId) await revokeWorkspaceInvitation(body.invitationId, authorized.auth);
    else if (body.memberId) await removeWorkspaceMember(body.memberId, authorized.auth);
    else return Response.json({ error: "A member or invitation ID is required." }, { status: 400 });
    return Response.json({ removed: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to remove this workspace access." }, { status: 400 });
  }
}
