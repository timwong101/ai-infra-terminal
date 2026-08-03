import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TerminalApplication } from "@/app/components/terminal-application";
import type { AuthSession } from "@/app/components/auth-controls";
import type { TerminalRoute } from "@/app/terminal-navigation";
import { authenticateRequest, isDemoAuthEnabled } from "@/lib/auth/session";

export async function ProtectedTerminalPage({ route, returnTo }: { route: TerminalRoute; returnTo: string }) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const request = new Request(`${protocol}://${host}${returnTo}`, { headers: requestHeaders });

  let auth;
  try {
    auth = await authenticateRequest(request);
  } catch {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  const session: AuthSession = {
    authenticated: true,
    ...auth,
    demoAvailable: isDemoAuthEnabled(),
    githubAvailable: Boolean(process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim()),
  };
  return <TerminalApplication initialAuth={session} initialRoute={route} />;
}
