import { authorizeApi } from "@/lib/auth/session";
import { createWorkspaceInvitation, listWorkspaceTeam, removeWorkspaceMember, revokeWorkspaceInvitation, updateWorkspaceMemberRole } from "@/lib/reviews/service";
import { entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const inviteSchema = z.object({ email: z.email().max(254), role: z.enum(["viewer", "analyst", "admin"]).default("analyst") });
const memberRoleSchema = z.object({ memberId: entityId, role: z.enum(["viewer", "analyst", "admin"]) });
const removeAccessSchema = z.union([z.object({ memberId: entityId, invitationId: z.undefined().optional() }), z.object({ invitationId: entityId, memberId: z.undefined().optional() })]);

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
    const parsed = await parseJsonBody(request, inviteSchema);
    if ("response" in parsed) return parsed.response;
    return Response.json({ invitation: await createWorkspaceInvitation(parsed.data.email, parsed.data.role, authorized.auth) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create an invitation." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "admin");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, memberRoleSchema);
    if ("response" in parsed) return parsed.response;
    await updateWorkspaceMemberRole(parsed.data.memberId, parsed.data.role, authorized.auth);
    return Response.json({ updated: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update this member." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const authorized = await authorizeApi(request, "admin");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, removeAccessSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    if (body.invitationId) await revokeWorkspaceInvitation(body.invitationId, authorized.auth);
    else if (body.memberId) await removeWorkspaceMember(body.memberId, authorized.auth);
    return Response.json({ removed: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to remove this workspace access." }, { status: 400 });
  }
}
