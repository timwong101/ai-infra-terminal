"use client";

import { Ban, Check, LoaderCircle, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuthSession } from "@/app/components/auth-controls";
import type { InvitationPreview } from "@/lib/reviews/types";

export function InvitationAcceptance({ token, auth, onAccepted }: {
  token: string;
  auth: AuthSession;
  onAccepted: () => Promise<void>;
}) {
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "accepting" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/auth/invitations/${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      const result = await response.json() as { invitation?: InvitationPreview; error?: string };
      if (!response.ok || !result.invitation) {
        throw new Error(result.error || "This invitation is unavailable.");
      }
      setInvitation(result.invitation);
      setStatus("ready");
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "This invitation is unavailable.");
      setStatus("error");
    });
    return () => controller.abort();
  }, [token]);

  const accept = async () => {
    setStatus("accepting");
    setError("");
    const response = await fetch(`/api/auth/invitations/${encodeURIComponent(token)}`, { method: "POST" });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error || "Unable to accept this invitation.");
      setStatus("ready");
      return;
    }
    window.history.replaceState({}, "", "/home");
    await onAccepted();
  };

  return <main className="invitation-shell">
    <section className="invitation-panel">
      <span className="invitation-icon"><Users size={24} /></span>
      {status === "loading" ? <>
        <LoaderCircle className="drawer-spinner" size={23} />
        <h1>Opening invitation</h1>
      </> : invitation ? <>
        <span className="section-kicker">Workspace invitation</span>
        <h1>Join {invitation.workspaceName}</h1>
        <p>
          You were invited as <strong>{invitation.role}</strong>. Research, decisions, and review
          activity will be attributed to your signed-in account.
        </p>
        <div className="invitation-identity">
          <span>Signed in as</span><strong>{auth.user.email}</strong>
        </div>
        {!invitation.emailMatches && <p className="sign-in-error">
          This invitation belongs to {invitation.email}. Sign in with that GitHub email to continue.
        </p>}
        {invitation.status !== "pending" && <p className="sign-in-error">
          This invitation is {invitation.status}.
        </p>}
        {error && <p className="sign-in-error">{error}</p>}
        <div className="invitation-actions">
          <button className="command-button" onClick={() => window.location.assign("/home")}>Cancel</button>
          <button
            className="primary-button"
            disabled={status === "accepting" || !invitation.emailMatches || invitation.status !== "pending"}
            onClick={() => void accept()}
          >
            {status === "accepting" ? <LoaderCircle className="drawer-spinner" size={15} /> : <Check size={15} />}
            Accept invitation
          </button>
        </div>
      </> : <>
        <Ban size={24} /><h1>Invitation unavailable</h1><p>{error}</p>
        <button className="command-button" onClick={() => window.location.assign("/home")}>
          Return to workspace
        </button>
      </>}
    </section>
  </main>;
}
