"use client";

import { Activity, Clock3, FileCheck2, LoaderCircle, MessageSquareText, Search, ShieldCheck, Sparkles, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AuditEventItem } from "@/lib/auth/types";

function eventIcon(type: string) {
  if (type === "research_evidence") return FileCheck2;
  if (type === "comparison_memo") return Sparkles;
  if (type.includes("assistant")) return MessageSquareText;
  if (type === "research_claim") return Target;
  return Activity;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function AuditWorkspace() {
  const [events, setEvents] = useState<AuditEventItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => fetch("/api/audit", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json() as { events?: AuditEventItem[]; error?: string };
      if (!response.ok || !result.events) throw new Error(result.error ?? "Unable to load the audit trail.");
      setEvents(result.events); setStatus("ready");
    }).catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setStatus("error"); }));
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return events.filter((event) => !value || `${event.summary} ${event.action} ${event.actor?.name ?? "system"}`.toLowerCase().includes(value));
  }, [events, query]);

  return <div className="research-workspace audit-workspace">
    <header className="workspace-title-row"><div><p className="breadcrumb">Workspace governance / Provenance</p><h1>Audit Trail</h1><p className="workspace-subtitle">Immutable analyst decisions and generated research activity for the active workspace.</p></div><span className="audit-policy"><ShieldCheck size={14} /> Attributed actions</span></header>
    <section className="audit-summary"><article><Activity size={16} /><span>Recorded actions</span><strong>{events.length}</strong></article><article><FileCheck2 size={16} /><span>Evidence decisions</span><strong>{events.filter((item) => item.entityType === "research_evidence").length}</strong></article><article><Sparkles size={16} /><span>Generated research</span><strong>{events.filter((item) => item.action.endsWith(".created") || item.action.endsWith(".completed")).length}</strong></article></section>
    <label className="workspace-search audit-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actors, decisions, and research artifacts..." /></label>
    <section className="audit-timeline panel"><div className="catalog-heading"><div><h2>Workspace activity</h2><span>{filtered.length} attributable events</span></div><Clock3 size={16} /></div>
      {status === "loading" && <div className="workspace-state"><LoaderCircle className="drawer-spinner" size={23} /><strong>Loading audit history</strong></div>}
      {status === "error" && <div className="workspace-state error"><strong>Audit trail unavailable</strong></div>}
      {status === "ready" && <div className="audit-event-list">{filtered.map((event) => { const Icon = eventIcon(event.entityType); return <article key={event.id}><span className="audit-event-icon"><Icon size={15} /></span><div><strong>{event.summary}</strong><p><span>{event.actor?.name ?? "System"}</span><span>{event.action.replaceAll(".", " ")}</span><code>{event.entityId}</code></p></div><time>{formatDate(event.createdAt)}</time></article>; })}{!filtered.length && <div className="workspace-state"><Activity size={22} /><strong>No matching audit events</strong><span>Analyst decisions and generated artifacts will appear here.</span></div>}</div>}
    </section>
  </div>;
}
