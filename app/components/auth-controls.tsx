"use client";

import { Check, ChevronDown, Code2, LoaderCircle, LogOut, Plus, ShieldCheck, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AuthContext } from "@/lib/auth/types";

export type AuthSession = AuthContext & { authenticated: true; demoAvailable: boolean; githubAvailable: boolean };
export type PublicAuthState = { authenticated: false; demoAvailable: boolean; githubAvailable: boolean };

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]?.toUpperCase()).join("") || "AI";
}

export function SignInScreen({ state, onSignedIn }: { state: PublicAuthState; onSignedIn: () => Promise<void> }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState(new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("authError") ?? "");

  const demo = async () => {
    setStatus("loading"); setError("");
    const response = await fetch("/api/auth/demo", { method: "POST" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setStatus("error"); setError(result.error ?? "Unable to start the demo session."); return; }
    await onSignedIn();
  };

  return <main className="sign-in-shell">
    <section className="sign-in-panel">
      <div className="sign-in-brand"><span className="sign-in-mark"><i /><i /><i /></span><span>AI Infrastructure<br />Terminal</span></div>
      <div className="sign-in-content"><span className="section-kicker">Evidence-grounded research</span><h1>Analyst Workspace</h1><p>Sign in to keep research decisions, memos, watchlists, and question history attributable and isolated by workspace.</p>
        <div className="sign-in-policies"><span><ShieldCheck size={14} /> Durable analyst audit trail</span><span><Users size={14} /> Role-based workspaces</span></div>
        {state.githubAvailable && <button className="github-sign-in" onClick={() => window.location.assign("/api/auth/github")}><Code2 size={17} /> Continue with GitHub</button>}
        {state.demoAvailable && <button className="demo-sign-in" disabled={status === "loading"} onClick={() => void demo()}>{status === "loading" ? <LoaderCircle className="drawer-spinner" size={17} /> : <span className="demo-avatar">DA</span>}<span><strong>Open portfolio demo</strong><small>Seeded admin analyst · no setup required</small></span></button>}
        {!state.githubAvailable && <p className="auth-configuration">GitHub sign-in is not configured for this environment.</p>}
        {error && <p className="sign-in-error">{error}</p>}
      </div>
      <footer>Official SEC and investor-relations evidence · Unsupported AI claims are rejected</footer>
    </section>
  </main>;
}

export function UserMenu({ auth, onAuthChange }: { auth: AuthSession; onAuthChange: () => Promise<void> }) {
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const switchTo = async (workspaceId: string) => {
    if (workspaceId === auth.workspace.id) return;
    const response = await fetch("/api/auth/workspaces", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Unable to switch workspace."); return; }
    await onAuthChange();
    window.location.assign("/");
  };

  const create = async () => {
    const name = workspaceName.trim();
    if (!name) return;
    const response = await fetch("/api/auth/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Unable to create workspace."); return; }
    await onAuthChange();
    window.location.assign("/");
  };

  const signOut = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    await onAuthChange();
  };

  return <div className="user-menu" ref={container}>
    <button className="user-menu-trigger" aria-label="Open profile and workspace menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className="avatar">{initials(auth.user.name)}</span><span className="user-menu-label"><strong>{auth.workspace.name}</strong><small>{auth.workspace.role}</small></span><ChevronDown size={14} /></button>
    {open && <div className="user-menu-popover">
      <header><span className="profile-avatar">{initials(auth.user.name)}</span><span><strong>{auth.user.name}</strong><small>{auth.user.email}</small></span></header>
      <div className="workspace-menu-heading"><span>Workspaces</span><button className="icon-button" title="Create workspace" aria-label="Create workspace" onClick={() => setCreating((current) => !current)}><Plus size={13} /></button></div>
      <div className="workspace-menu-list">{auth.workspaces.map((workspace) => <button key={workspace.id} onClick={() => void switchTo(workspace.id)}><span><strong>{workspace.name}</strong><small>{workspace.role}</small></span>{workspace.id === auth.workspace.id && <Check size={13} />}</button>)}</div>
      {creating && <form className="workspace-create" onSubmit={(event) => { event.preventDefault(); void create(); }}><input aria-label="Workspace name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Workspace name" maxLength={80} /><button type="submit" aria-label="Save workspace"><Check size={13} /></button></form>}
      {error && <p className="user-menu-error">{error}</p>}
      <button className="sign-out-button" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button>
    </div>}
  </div>;
}
