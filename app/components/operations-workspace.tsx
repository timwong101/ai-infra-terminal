"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BookOpenText, CalendarClock, CheckCircle2, ChevronRight, Clock3, Copy, Database, ExternalLink, FileSearch, LoaderCircle, Play, RefreshCw, ServerCog, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import type { ResearchBriefing, ResearchCycleEventItem } from "@/lib/operations/types";

type ResearchRun = {
  id: string;
  trigger: string;
  status: string;
  stage: string;
  metrics: Record<string, unknown>;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

type Operations = {
  runs: ResearchRun[];
  events: ResearchCycleEventItem[];
  briefings: ResearchBriefing[];
  queue: { pending: number; processing: number; completed: number; failed: number } | null;
  schedule: { cadence: string; cron: string; source: string; nextAction: string };
  aiEnabled: boolean;
  coverage: Array<{
    company: { id: string; name: string; ticker: string };
    counts: { accepted: number };
    flows: Record<string, boolean>;
    ready: boolean;
    gaps: string[];
  }>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function duration(run: ResearchRun) {
  if (!run.completedAt) return "Running";
  const seconds = Math.max(1, Math.round((new Date(run.completedAt).valueOf() - new Date(run.startedAt).valueOf()) / 1_000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function stageLabel(value: string) {
  return value.replaceAll("-", " ");
}

function eventDetail(event: ResearchCycleEventItem) {
  const durationMs = typeof event.metrics.durationMs === "number" ? event.metrics.durationMs : null;
  const counts = Object.entries(event.metrics).filter(([key, value]) => key !== "durationMs" && ["string", "number", "boolean"].includes(typeof value)).slice(0, 2);
  const parts = [durationMs === null ? null : `${Math.max(1, Math.round(durationMs / 1_000))}s`, ...counts.map(([key, value]) => `${stageLabel(key)} ${value}`)].filter(Boolean);
  return `${formatDate(event.startedAt)}${parts.length ? ` · ${parts.join(" · ")}` : event.completedAt ? "" : " · running"}`;
}

export function OperationsWorkspace() {
  const [data, setData] = useState<Operations | null>(null);
  const [action, setAction] = useState<"cycle" | "briefing" | null>(null);
  const [error, setError] = useState("");
  const [selectedBriefingId, setSelectedBriefingId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [copiedTrace, setCopiedTrace] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/research-cycle", { cache: "no-store", signal });
    const result = await response.json() as Operations | { error: string };
    if (!response.ok || !("runs" in result)) throw new Error("error" in result ? result.error : "Unable to load research activity.");
    setData(result);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void load(controller.signal).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Unable to load research activity.");
    }));
    return () => controller.abort();
  }, [load]);

  const runCycle = async () => {
    setAction("cycle");
    setError("");
    try {
      const response = await fetch("/api/research-cycle", { method: "POST", headers: { "x-research-trigger": "dashboard" } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Research cycle failed.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Research cycle failed.");
    } finally {
      setAction(null);
    }
  };

  const buildBriefing = async () => {
    setAction("briefing");
    setError("");
    try {
      const response = await fetch("/api/research-briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hours: 24 }) });
      const result = await response.json() as { briefing?: ResearchBriefing; error?: string };
      if (!response.ok || !result.briefing) throw new Error(result.error || "Unable to build briefing.");
      setSelectedBriefingId(result.briefing.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to build briefing.");
    } finally {
      setAction(null);
    }
  };

  const briefing = useMemo(() => data?.briefings.find((item) => item.id === selectedBriefingId) ?? data?.briefings[0] ?? null, [data?.briefings, selectedBriefingId]);
  const selectedRun = useMemo(() => data?.runs.find((item) => item.id === selectedRunId) ?? data?.runs[0] ?? null, [data?.runs, selectedRunId]);
  const runEvents = useMemo(() => selectedRun ? (data?.events ?? []).filter((item) => item.runId === selectedRun.id).sort((left, right) => left.startedAt.localeCompare(right.startedAt)) : [], [data?.events, selectedRun]);

  const copyTrace = async () => {
    if (!selectedRun) return;
    await navigator.clipboard.writeText(selectedRun.id);
    setCopiedTrace(true);
    window.setTimeout(() => setCopiedTrace(false), 1_500);
  };

  if (!data && !error) return <div className="research-workspace"><div className="workspace-state full"><LoaderCircle className="drawer-spinner" size={26} /><strong>Loading research activity</strong></div></div>;

  const stats = briefing?.stats;
  return (
    <div className="research-workspace activity-workspace">
      <header className="workspace-title-row">
        <div><p className="breadcrumb">Watchlist / Research activity</p><h1>Activity & Briefings</h1><p className="workspace-subtitle">New evidence, analyst decisions, and scheduled pipeline health in one operating view.</p></div>
        <div className="activity-header-actions"><button className="command-button" disabled={Boolean(action)} onClick={() => void buildBriefing()}>{action === "briefing" ? <LoaderCircle className="drawer-spinner" size={15} /> : <RefreshCw size={15} />}<span>Build briefing</span></button><button className="primary-button" disabled={Boolean(action)} onClick={() => void runCycle()}>{action === "cycle" ? <LoaderCircle className="drawer-spinner" size={15} /> : <Play size={15} />}<span>Run cycle</span></button></div>
      </header>
      {error && <div className="builder-error"><AlertTriangle size={15} />{error}</div>}

      <section className="activity-metrics" aria-label="Latest research briefing metrics">
        <article><FileSearch size={17} /><div><span>New documents</span><strong>{stats?.newDocuments ?? 0}</strong><small>SEC and IR in window</small></div></article>
        <article><Sparkles size={17} /><div><span>High-value evidence</span><strong>{stats?.highValueEvidence ?? 0}</strong><small>Quality score 70+</small></div></article>
        <article><BookOpenText size={17} /><div><span>Decisions pending</span><strong>{stats?.proposedThesisImpacts ?? 0}</strong><small>Claim links need review</small></div></article>
        <article className={(stats?.staleMemos ?? 0) > 0 ? "warning" : ""}><AlertTriangle size={17} /><div><span>Stale research</span><strong>{(stats?.staleMemos ?? 0) + (stats?.staleClaims ?? 0)}</strong><small>Memos and theses</small></div></article>
      </section>

      <div className="activity-layout">
        <section className="panel briefing-panel">
          <div className="briefing-header">
            <div><span className="section-kicker">Latest watchlist briefing</span><h2>{briefing?.title ?? "No briefing generated"}</h2>{briefing && <p>{briefing.summary}</p>}</div>
            {briefing && <div className="briefing-window"><CalendarClock size={14} /><span>{formatDate(briefing.windowStartedAt)}<b>to</b>{formatDate(briefing.windowEndedAt)}</span></div>}
          </div>
          {briefing?.sections.length ? <div className="briefing-company-list">{briefing.sections.map((section) => <article key={section.companyId}>
            <header><div className="company-monogram">{section.ticker.slice(0, 2)}</div><div><h3>{section.companyName}</h3><span>{section.ticker} · {section.newEvidence} new · {section.highValueEvidence} high value</span></div>{section.pendingReview > 0 && <b>{section.pendingReview} pending</b>}</header>
            <div className="briefing-evidence-list">{section.topEvidence.map((item) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.id}><div><span>{item.sourceType} · {item.topic}</span><strong>{item.documentTitle}</strong><p>{item.excerpt}</p></div><em>{item.evidenceQualityScore}</em><ExternalLink size={13} /></a>)}</div>
          </article>)}</div> : <div className="workspace-state briefing-empty"><ShieldCheck size={25} /><strong>The watchlist was quiet</strong><span>{briefing?.summary ?? "Build a briefing to summarize the last 24 hours of research activity."}</span><button className="command-button" disabled={Boolean(action)} onClick={() => void buildBriefing()}><RefreshCw size={14} /> Build 24-hour briefing</button></div>}
        </section>

        <aside className="activity-rail">
          <section className="panel schedule-card"><div className="catalog-heading"><div><h2>Automation</h2><span>Scheduled research loop</span></div><CalendarClock size={16} /></div><div className="schedule-body"><strong>{data?.schedule.cadence}</strong><span>{data?.schedule.source}</span><code>{data?.schedule.cron}</code><p>{data?.coverage.length ?? 0} companies monitored · {data?.coverage.filter((item) => item.ready).length ?? 0} fully covered</p></div></section>
          <section className="panel briefing-history"><div className="catalog-heading"><div><h2>Briefing history</h2><span>Immutable snapshots</span></div><span>{data?.briefings.length ?? 0}</span></div>{data?.briefings.map((item) => <button className={briefing?.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedBriefingId(item.id)}><BookOpenText size={14} /><span><strong>{item.title}</strong><small>{item.stats.newEvidence} evidence · {item.stats.proposedThesisImpacts} decisions</small></span><ChevronRight size={13} /></button>)}{!data?.briefings.length && <p>No snapshots yet.</p>}</section>
          <section className="panel watchlist-coverage"><div className="catalog-heading"><div><h2>Watchlist coverage</h2><span>End-to-end readiness</span></div><Database size={16} /></div>{data?.coverage.map((item) => <div key={item.company.id}><span><strong>{item.company.ticker}</strong><small>{item.counts.accepted} approved evidence</small></span>{item.ready ? <CheckCircle2 size={15} /> : <span className="coverage-gap" title={item.gaps.join(", ")}><XCircle size={15} /> {item.gaps.length}</span>}</div>)}</section>
        </aside>
      </div>

      <section className="panel run-monitor">
        <div className="catalog-heading"><div><h2>Pipeline monitor</h2><span>Stage-level execution history and failures</span></div><Activity size={17} /></div>
        <div className="run-monitor-layout"><div className="run-history">{data?.runs.map((run) => <button className={selectedRun?.id === run.id ? "active" : ""} key={run.id} onClick={() => setSelectedRunId(run.id)}><span className={`run-dot ${run.status}`} /> <span><strong>{run.trigger}</strong><small>{formatDate(run.startedAt)} · {duration(run)}</small></span><em>{run.status}</em></button>)}{!data?.runs.length && <div className="workspace-state"><ServerCog size={22} /><strong>No pipeline runs yet</strong></div>}</div>
        <div className="stage-timeline">{selectedRun ? <><header><div><span>Trace ID</span><code>{selectedRun.id}</code></div><button className="icon-button" onClick={() => void copyTrace()} aria-label="Copy trace ID" title="Copy trace ID">{copiedTrace ? <CheckCircle2 size={14} /> : <Copy size={14} />}</button></header>{runEvents.map((event) => <div className="stage-event" key={event.id}><span className={`run-dot ${event.status}`} /><div><strong>{stageLabel(event.stage)}</strong><small>{event.message ?? eventDetail(event)}</small></div><em>{event.status}</em></div>)}{!runEvents.length && <div className="workspace-state"><Clock3 size={21} /><strong>Legacy run</strong><span>Stage events will appear after the next cycle.</span></div>}{selectedRun.error && <p className="run-error"><XCircle size={13} />{selectedRun.error}</p>}</> : <div className="workspace-state"><Clock3 size={22} /><strong>Select a run</strong></div>}</div></div>
      </section>
    </div>
  );
}
