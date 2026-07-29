import { authorizeApi } from "@/lib/auth/session";
import { acceptWorkspaceInvitation, previewWorkspaceInvitation } from "@/lib/reviews/service";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const { token } = await context.params;
    return Response.json({ invitation: await previewWorkspaceInvitation(decodeURIComponent(token), authorized.auth) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load this invitation." }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const { token } = await context.params;
    return Response.json({ workspace: await acceptWorkspaceInvitation(decodeURIComponent(token), authorized.auth) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to accept this invitation." }, { status: 400 });
  }
}
