"use client";

import { Ban, Check, Copy, LoaderCircle, MailPlus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AuthSession } from "@/app/components/auth-controls";
import type { WorkspaceInvitation, WorkspaceMember } from "@/lib/reviews/types";

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((item) => item[0]?.toUpperCase()).join("") || "AI";
}

export function TeamManagementDialog({ auth, onClose }: { auth: AuthSession; onClose: () => void }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "analyst" | "admin">("analyst");
  const [status, setStatus] = useState<"loading" | "ready" | "saving">("loading");
  const [error, setError] = useState("");
  const [newInvitationPath, setNewInvitationPath] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/auth/members", { cache: "no-store" });
    const result = await response.json() as {
      members?: WorkspaceMember[];
      invitations?: WorkspaceInvitation[];
      error?: string;
    };
    if (!response.ok) throw new Error(result.error || "Unable to load workspace members.");
    setMembers(result.members ?? []);
    setInvitations(result.invitations ?? []);
    setStatus("ready");
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load().catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Unable to load workspace members.");
        setStatus("ready");
      });
    });
  }, [load]);

  const invite = async () => {
    setStatus("saving");
    setError("");
    setNewInvitationPath("");
    const response = await fetch("/api/auth/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const result = await response.json() as { invitation?: WorkspaceInvitation; error?: string };
    if (!response.ok || !result.invitation) {
      setError(result.error || "Unable to create an invitation.");
      setStatus("ready");
      return;
    }
    setEmail("");
    setNewInvitationPath(result.invitation.invitationPath ?? "");
    await load();
  };

  const updateRole = async (memberId: string, nextRole: string) => {
    setStatus("saving");
    setError("");
    const response = await fetch("/api/auth/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, role: nextRole }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error || "Unable to update this member.");
      setStatus("ready");
      return;
    }
    await load();
  };

  const remove = async (payload: { memberId?: string; invitationId?: string }) => {
    setStatus("saving");
    setError("");
    const response = await fetch("/api/auth/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error || "Unable to remove this access.");
      setStatus("ready");
      return;
    }
    await load();
  };

  const copyInvitation = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${newInvitationPath}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const pending = invitations.filter((item) => item.status === "pending");

  return createPortal(<div
    className="modal-backdrop"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <section className="modal team-management-modal" role="dialog" aria-modal="true" aria-labelledby="team-title">
      <header className="modal-heading">
        <div><span className="section-kicker">{auth.workspace.name}</span><h2 id="team-title">Workspace team</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close team management"><X size={16} /></button>
      </header>

      {auth.workspace.role === "admin" && <section className="team-invite-form">
        <div><MailPlus size={16} /><span><strong>Invite a collaborator</strong><small>Links expire after seven days.</small></span></div>
        <div>
          <input
            aria-label="Invite email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="analyst@company.com"
          />
          <select
            aria-label="Invitation role"
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
          >
            <option value="viewer">Viewer</option><option value="analyst">Analyst</option><option value="admin">Admin</option>
          </select>
          <button className="primary-button" disabled={status !== "ready" || !email.trim()} onClick={() => void invite()}>
            <MailPlus size={14} />Invite
          </button>
        </div>
      </section>}

      {newInvitationPath && <div className="invitation-link-result">
        <span><strong>Invitation ready</strong><small>{window.location.origin}{newInvitationPath}</small></span>
        <button className="icon-button" aria-label="Copy invitation link" onClick={() => void copyInvitation()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>}

      <section className="team-list">
        <header><span>Members</span><strong>{members.length}</strong></header>
        {status === "loading" ? <div className="workspace-state">
          <LoaderCircle className="drawer-spinner" size={20} /><span>Loading team</span>
        </div> : members.map((member) => <article key={member.id}>
          <span className="profile-avatar small">{initials(member.name)}</span>
          <span><strong>{member.name}{member.userId === auth.user.id ? " (you)" : ""}</strong><small>{member.email}</small></span>
          {auth.workspace.role === "admin" ? <select
            aria-label={`Role for ${member.name}`}
            value={member.role}
            disabled={status === "saving"}
            onChange={(event) => void updateRole(member.id, event.target.value)}
          >
            <option value="viewer">Viewer</option><option value="analyst">Analyst</option><option value="admin">Admin</option>
          </select> : <em>{member.role}</em>}
          {auth.workspace.role === "admin" && member.userId !== auth.user.id && <button
            className="icon-button danger"
            aria-label={`Remove ${member.name}`}
            onClick={() => void remove({ memberId: member.id })}
          ><Trash2 size={13} /></button>}
        </article>)}
      </section>

      {auth.workspace.role === "admin" && pending.length > 0 && <section className="team-list pending-invitations">
        <header><span>Pending invitations</span><strong>{pending.length}</strong></header>
        {pending.map((item) => <article key={item.id}>
          <span className="profile-avatar small"><MailPlus size={13} /></span>
          <span><strong>{item.email}</strong><small>{item.role} · expires {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(item.expiresAt))}</small></span>
          <button
            className="icon-button danger"
            aria-label={`Revoke invitation for ${item.email}`}
            onClick={() => void remove({ invitationId: item.id })}
          ><Ban size={13} /></button>
        </article>)}
      </section>}

      {error && <p className="user-menu-error team-error">{error}</p>}
    </section>
  </div>, document.body);
}
