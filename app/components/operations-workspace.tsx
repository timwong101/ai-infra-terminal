"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Archive, Ban, BookOpenText, CalendarClock, CheckCircle2, ChevronRight,
  Clock3, Copy, Database, ExternalLink, FileSearch, LoaderCircle, Play, RefreshCw,
  RotateCcw, ServerCog, ShieldCheck, Sparkles, TimerReset, Wifi, WifiOff, XCircle,
} from "lucide-react";
import { RESEARCH_STAGE_NAMES, type ResearchBriefing, type ResearchCycleEventItem, type ResearchCycleRunItem, type ResearchQueueStatus, type ResearchRuntimeSnapshot, type ResearchStageName, type ResearchWorkerItem } from "@/lib/operations/types";
import type { ArtifactIntegritySummary } from "@/lib/artifacts/types";

type Operations = ResearchRuntimeSnapshot & {
  briefings: ResearchBriefing[];
  ingestion: { pending: number; processing: number; completed: number; failed: number } | null;
  schedule: { cadence: string; cron: string; source: string; nextAction: string };
  aiEnabled: boolean;
  artifactIntegrity: ArtifactIntegritySummary;
  coverage: Array<{
    company: { id: string; name: string; ticker: string };
    counts: { accepted: number; latestAcceptedEvidence: number; latestGroundedComparisons: number };
    currentPeriod: { id: string; label: string } | null;
    flows: Record<string, boolean>;
    ready: boolean;
    gaps: string[];
  }>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function duration(run: ResearchCycleRunItem) {
  if (!run.completedAt) return run.status === "queued" ? "Waiting" : "Running";
  const seconds = Math.max(1, Math.round((new Date(run.completedAt).valueOf() - new Date(run.startedAt).valueOf()) / 1_000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function stageLabel(value: string) { return value.replaceAll("-", " "); }

function ageInDays(value: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).valueOf()) / 86_400_000));
}

function eventDetail(event: ResearchCycleEventItem) {
  const durationMs = typeof event.metrics.durationMs === "number" ? event.metrics.durationMs : null;
  const counts = Object.entries(event.metrics).filter(([key, value]) => key !== "durationMs" && ["string", "number", "boolean"].includes(typeof value)).slice(0, 2);
  const parts = [durationMs === null ? null : `${Math.max(1, Math.round(durationMs / 1_000))}s`, ...counts.map(([key, value]) => `${stageLabel(key)} ${value}`)].filter(Boolean);
  return `${formatDate(event.startedAt)}${parts.length ? ` · ${parts.join(" · ")}` : event.completedAt ? "" : " · running"}`;
}

function latestStageEvents(events: ResearchCycleEventItem[], runId: string | undefined) {
  const result = new Map<string, ResearchCycleEventItem>();
  if (!runId) return result;
  for (const event of events.filter((item) => item.runId === runId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    if (!result.has(event.stage)) result.set(event.stage, event);
  }
  return result;
}

function QueueMetric({ label, value, tone, detail }: { label: string; value: number; tone?: string; detail: string }) {
  return <article className={tone || ""}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

export function OperationsWorkspace() {
  const [data, setData] = useState<Operations | null>(null);
  const [action, setAction] = useState<"cycle" | "briefing" | "control" | null>(null);
  const [error, setError] = useState("");
  const [selectedBriefingId, setSelectedBriefingId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [copiedTrace, setCopiedTrace] = useState(false);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "offline">("connecting");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/research-cycle", { cache: "no-store", signal });
    const result = await response.json() as Operations | { error: string };
    if (!response.ok || !("runs" in result)) throw new Error("error" in result ? result.error : "Unable to load research activity.");
    setData(result);
    setSelectedRunId((current) => current ?? result.runs[0]?.id ?? null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void load(controller.signal).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Unable to load research activity.");
    }));
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const source = new EventSource("/api/research-cycle/stream");
    source.addEventListener("open", () => setStreamStatus("live"));
    source.addEventListener("runtime", (event) => {
      const snapshot = JSON.parse((event as MessageEvent).data) as ResearchRuntimeSnapshot;
      setData((current) => current ? { ...current, ...snapshot } : current);
      setSelectedRunId((current) => current ?? snapshot.runs[0]?.id ?? null);
      setStreamStatus("live");
    });
    source.addEventListener("runtime-error", (event) => {
      const result = JSON.parse((event as MessageEvent).data) as { error?: string };
      setError(result.error || "Live pipeline updates are unavailable.");
    });
    source.onerror = () => setStreamStatus("offline");
    return () => source.close();
  }, []);

  const runCycle = async () => {
    setAction("cycle"); setError("");
    try {
      const response = await fetch("/api/research-cycle", { method: "POST", headers: { "x-research-trigger": "dashboard" } });
      const result = await response.json() as { run?: ResearchCycleRunItem; error?: string };
      if (!response.ok || !result.run?.id) throw new Error(result.error || "Research cycle could not be queued.");
      setSelectedRunId(result.run.id);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Research cycle could not be queued."); }
    finally { setAction(null); }
  };

  const controlRun = async (runId: string, controlAction: "cancel" | "retry_stage" | "replay", stage?: ResearchStageName) => {
    setAction("control"); setError("");
    try {
      const response = await fetch("/api/research-cycle", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, action: controlAction, stage }),
      });
      const result = await response.json() as { run?: ResearchCycleRunItem; error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to update this run.");
      if (controlAction === "replay" && result.run?.id) setSelectedRunId(result.run.id);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update this run."); }
    finally { setAction(null); }
  };

  const buildBriefing = async () => {
    setAction("briefing"); setError("");
    try {
      const response = await fetch("/api/research-briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hours: 24 }) });
      const result = await response.json() as { briefing?: ResearchBriefing; error?: string };
      if (!response.ok || !result.briefing) throw new Error(result.error || "Unable to build briefing.");
      setSelectedBriefingId(result.briefing.id);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to build briefing."); }
    finally { setAction(null); }
  };

  const briefing = useMemo(() => data?.briefings.find((item) => item.id === selectedBriefingId) ?? data?.briefings[0] ?? null, [data?.briefings, selectedBriefingId]);
  const selectedRun = useMemo(() => data?.runs.find((item) => item.id === selectedRunId) ?? data?.runs[0] ?? null, [data?.runs, selectedRunId]);
  const stageEvents = useMemo(() => latestStageEvents(data?.events ?? [], selectedRun?.id), [data?.events, selectedRun?.id]);
  const onlineWorkers = data?.workers.filter((worker) => worker.online) ?? [];
  const queue = data?.queue ?? { available: false, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, deadLetters: 0, error: null } satisfies ResearchQueueStatus;
  const canRun = queue.available && onlineWorkers.length > 0 && !data?.runs.some((run) => ["queued", "running", "cancelling"].includes(run.status));
  const runtimeState = !queue.available ? { label: "Queue unavailable", tone: "offline", detail: queue.error || "Redis is not connected." }
    : !onlineWorkers.length ? { label: "Worker offline", tone: "offline", detail: "Start pnpm worker:research before queueing a cycle." }
      : { label: "Pipeline ready", tone: "live", detail: streamStatus === "live" ? "Runtime updates connected." : "Runtime polling available; event stream disconnected." };
  const runDisabledReason = !queue.available ? "Redis queue is unavailable" : !onlineWorkers.length ? "Start pnpm worker:research first" : data?.runs.some((run) => ["queued", "running", "cancelling"].includes(run.status)) ? "A research cycle is already active" : undefined;
  const stats = briefing?.stats;
  const briefingAge = briefing ? ageInDays(briefing.windowEndedAt) : null;
  const selectedProgress = selectedRun?.status === "completed" ? 100 : selectedRun?.progress ?? 0;

  const copyTrace = async () => {
    if (!selectedRun?.traceId) return;
    await navigator.clipboard.writeText(selectedRun.traceId);
    setCopiedTrace(true);
    window.setTimeout(() => setCopiedTrace(false), 1_500);
  };

  if (!data && !error) return <div className="research-workspace"><div className="workspace-state full"><LoaderCircle className="drawer-spinner" size={26} /><strong>Loading pipeline operations</strong></div></div>;

  return <div className="research-workspace activity-workspace operations-console">
    <header className="workspace-title-row">
      <div><p className="breadcrumb">System / Durable research pipeline</p><h1>Activity & Briefings</h1><p className="workspace-subtitle">Queue-backed ingestion, live worker health, recoverable stages, and analyst-ready output.</p></div>
      <div className="activity-header-actions"><span className={`runtime-connection ${runtimeState.tone}`} title={`${runtimeState.detail} Event stream: ${streamStatus}.`}>{runtimeState.tone === "live" ? <Wifi size={13} /> : <WifiOff size={13} />}{runtimeState.label}</span><button className="command-button" disabled={Boolean(action)} onClick={() => void buildBriefing()}>{action === "briefing" ? <LoaderCircle className="drawer-spinner" size={15} /> : <RefreshCw size={15} />}<span>Build briefing</span></button><button className="primary-button" title={runDisabledReason} disabled={Boolean(action) || !canRun} onClick={() => void runCycle()}>{action === "cycle" ? <LoaderCircle className="drawer-spinner" size={15} /> : <Play size={15} />}<span>Run cycle</span></button></div>
    </header>
    {error && <div className="builder-error"><AlertTriangle size={15} />{error}</div>}
    {runtimeState.tone === "offline" && <div className="operations-status-notice"><WifiOff size={14} /><span><strong>{runtimeState.label}.</strong> {runtimeState.detail}</span></div>}

    <section className="runtime-metrics" aria-label="Research queue metrics">
      <QueueMetric label="Queued jobs" value={queue.waiting} detail="Awaiting workers" />
      <QueueMetric label="Active jobs" value={queue.active} tone="active" detail={`${onlineWorkers.length} workers online`} />
      <QueueMetric label="Retry delay" value={queue.delayed} tone={queue.delayed ? "warning" : ""} detail="Exponential backoff" />
      <QueueMetric label="Failed jobs" value={queue.failed} tone={queue.failed ? "danger" : ""} detail="Retained for diagnosis" />
      <QueueMetric label="Dead letters" value={queue.deadLetters} tone={queue.deadLetters ? "danger" : ""} detail="Attempts exhausted" />
    </section>

    <div className="operations-control-layout">
      <section className="panel run-monitor live-run-monitor">
        <div className="catalog-heading"><div><h2>Pipeline control plane</h2><span>Live stage execution, retries, and recovery</span></div><Activity size={17} /></div>
        <div className="run-monitor-layout">
          <div className="run-history">{data?.runs.map((run) => <button className={selectedRun?.id === run.id ? "active" : ""} key={run.id} onClick={() => setSelectedRunId(run.id)}><span className={`run-dot ${run.status}`} /><span><strong>{run.trigger}</strong><small>{formatDate(run.createdAt)} · {duration(run)}</small></span><em>{run.status}</em></button>)}{!data?.runs.length && <div className="workspace-state"><ServerCog size={22} /><strong>No pipeline runs yet</strong><span>Start a worker, then queue the first research cycle.</span></div>}</div>
          <div className="stage-timeline">{selectedRun ? <>
            <header className="run-trace-header"><div><span>Trace ID</span><code>{selectedRun.traceId ?? selectedRun.id}</code></div><button className="icon-button" onClick={() => void copyTrace()} aria-label="Copy trace ID" title="Copy trace ID">{copiedTrace ? <CheckCircle2 size={14} /> : <Copy size={14} />}</button></header>
            <div className="run-progress"><span style={{ width: `${selectedProgress}%` }} /><strong>{selectedProgress}%</strong></div>
            <div className="run-control-row"><span><b>{selectedRun.status}</b>{selectedRun.workerId ? ` · ${selectedRun.workerId.split(":").slice(-2).join(":")}` : ["queued", "running", "cancelling"].includes(selectedRun.status) ? " · waiting for worker" : " · finished"}</span><div>{["queued", "running", "cancelling"].includes(selectedRun.status) && <button className="command-button small danger" disabled={Boolean(action) || selectedRun.status === "cancelling"} onClick={() => void controlRun(selectedRun.id, "cancel")}><Ban size={13} />Cancel</button>}{["completed", "failed", "cancelled"].includes(selectedRun.status) && <button className="command-button small" disabled={Boolean(action)} onClick={() => void controlRun(selectedRun.id, "replay")}><RotateCcw size={13} />Replay</button>}</div></div>
            <div className="stage-graph">{RESEARCH_STAGE_NAMES.map((stage) => {
              const event = stageEvents.get(stage);
              const status = event?.status ?? (selectedRun.status === "completed" ? "completed" : "pending");
              const detail = event ? event.message ?? eventDetail(event) : selectedRun.status === "completed" ? "Completed before stage telemetry" : "Waiting on dependencies";
              return <article className={`stage-event ${status}`} key={stage}><span className={`run-dot ${status}`} /><div><strong>{stageLabel(stage)}</strong><small>{detail}</small>{event && event.attempt > 1 && <b>Attempt {event.attempt} of {event.maxAttempts}</b>}</div><em>{status}</em>{event?.status === "failed" && <button className="icon-button" disabled={Boolean(action)} onClick={() => void controlRun(selectedRun.id, "retry_stage", stage)} aria-label={`Retry ${stageLabel(stage)}`} title={`Retry ${stageLabel(stage)}`}><TimerReset size={13} /></button>}</article>;
            })}</div>
            {selectedRun.error && <p className="run-error"><XCircle size={13} />{selectedRun.error}</p>}
          </> : <div className="workspace-state"><Clock3 size={22} /><strong>Select a run</strong></div>}</div>
        </div>
      </section>

      <aside className="operations-runtime-rail">
        <section className="panel worker-health"><div className="catalog-heading"><div><h2>Workers</h2><span>Process heartbeats</span></div>{onlineWorkers.length ? <Wifi size={15} /> : <WifiOff size={15} />}</div>{data?.workers.slice(0, 6).map((worker: ResearchWorkerItem) => <article key={worker.id}><span className={`worker-state ${worker.online ? "online" : "offline"}`} /><div><strong>{worker.queueName.replace("research-", "")}</strong><small>{worker.online ? `Concurrency ${worker.concurrency}` : "Heartbeat expired"}</small></div><em>{worker.currentRunId ? "busy" : worker.status}</em></article>)}{!data?.workers.length && <div className="workspace-state compact"><ServerCog size={19} /><strong>No worker heartbeat</strong><span>Run `pnpm worker:research`.</span></div>}</section>
        <section className="panel schedule-card"><div className="catalog-heading"><div><h2>Automation</h2><span>Scheduled queue trigger</span></div><CalendarClock size={16} /></div><div className="schedule-body"><strong>{data?.schedule.cadence}</strong><span>{data?.schedule.source}</span><code>{data?.schedule.cron}</code><p>{data?.schedule.nextAction}</p></div></section>
        <section className={`panel queue-health ${queue.available ? "available" : "unavailable"}`}><div><Database size={16} /><span><strong>{queue.available ? "Redis connected" : "Queue unavailable"}</strong><small>{queue.error || `${queue.completed} retained completions`}</small></span></div></section>
        <section className="panel source-archive-health"><div className="catalog-heading"><div><h2>Source archive</h2><span>Immutable ingestion inputs</span></div><Archive size={16} /></div><div className="archive-coverage"><strong>{data?.artifactIntegrity.coveragePercent ?? 0}%</strong><span>document coverage</span><i><b style={{ width: `${data?.artifactIntegrity.coveragePercent ?? 0}%` }} /></i></div><dl><div><dt>Artifacts</dt><dd>{data?.artifactIntegrity.immutableArtifacts ?? 0}</dd></div><div><dt title="Hashes are verified when an artifact is replayed or explicitly checked">Verified on read</dt><dd>{data?.artifactIntegrity.verifiedArtifacts ?? 0} / {data?.artifactIntegrity.immutableArtifacts ?? 0}</dd></div><div><dt>Parser previews</dt><dd>{data?.artifactIntegrity.previewRuns ?? 0}</dd></div><div><dt>Storage</dt><dd>{data?.artifactIntegrity.storageBackend ?? "unconfigured"}</dd></div></dl></section>
      </aside>
    </div>

    <div className="research-output-heading"><div><span className="section-kicker">Research output</span><h2>Watchlist briefing</h2></div><span>Generated from completed pipeline evidence</span></div>
    <section className="activity-metrics" aria-label="Latest research briefing metrics">
      <article><FileSearch size={17} /><div><span>New documents</span><strong>{stats?.newDocuments ?? 0}</strong><small>SEC and IR in window</small></div></article>
      <article><Sparkles size={17} /><div><span>High-value evidence</span><strong>{stats?.highValueEvidence ?? 0}</strong><small>Quality score 70+</small></div></article>
      <article><BookOpenText size={17} /><div><span>Decisions pending</span><strong>{stats?.proposedThesisImpacts ?? 0}</strong><small>Claim links need review</small></div></article>
      <article className={(stats?.staleMemos ?? 0) > 0 ? "warning" : ""}><AlertTriangle size={17} /><div><span>Stale research</span><strong>{(stats?.staleMemos ?? 0) + (stats?.staleClaims ?? 0)}</strong><small>Memos and theses</small></div></article>
    </section>

    <div className="activity-layout">
      <section className="panel briefing-panel"><div className="briefing-header"><div><span className="section-kicker">Latest watchlist briefing {briefingAge !== null && <em className={briefingAge > 1 ? "stale" : "current"}>{briefingAge > 1 ? `Stale · ${briefingAge}d old` : "Current"}</em>}</span><h2>{briefing?.title ?? "No briefing generated"}</h2>{briefing && <p>{briefing.summary}</p>}</div>{briefing && <div className="briefing-window"><CalendarClock size={14} /><span>{formatDate(briefing.windowStartedAt)}<b>to</b>{formatDate(briefing.windowEndedAt)}</span></div>}</div>{briefing?.sections.length ? <div className="briefing-company-list">{briefing.sections.map((section) => <article key={section.companyId}><header><div className="company-monogram">{section.ticker.slice(0, 2)}</div><div><h3>{section.companyName}</h3><span>{section.ticker} · {section.newEvidence} new · {section.highValueEvidence} high value</span></div>{section.pendingReview > 0 && <b>{section.pendingReview} pending</b>}</header><div className="briefing-evidence-list">{section.topEvidence.map((item) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.id}><div><span>{item.sourceType} · {item.topic}</span><strong>{item.documentTitle}</strong><p>{item.excerpt}</p></div><em>{item.evidenceQualityScore}</em><ExternalLink size={13} /></a>)}</div></article>)}</div> : <div className="workspace-state briefing-empty"><ShieldCheck size={25} /><strong>The watchlist was quiet</strong><span>{briefing?.summary ?? "Build a briefing to summarize the last 24 hours of research activity."}</span></div>}</section>
      <aside className="activity-rail"><section className="panel briefing-history"><div className="catalog-heading"><div><h2>Briefing history</h2><span>Immutable snapshots</span></div><span>{data?.briefings.length ?? 0}</span></div>{data?.briefings.map((item) => <button className={briefing?.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedBriefingId(item.id)}><BookOpenText size={14} /><span><strong>{item.title}</strong><small>{item.stats.newEvidence} evidence · {item.stats.proposedThesisImpacts} decisions</small></span><ChevronRight size={13} /></button>)}</section><section className="panel watchlist-coverage"><div className="catalog-heading"><div><h2>Company flow presence</h2><span>Required workflow records</span></div><Database size={16} /></div>{data?.coverage.map((item) => <div key={item.company.id}><span><strong>{item.company.ticker}</strong><small>{item.currentPeriod ? `${item.currentPeriod.label} · ${item.counts.latestAcceptedEvidence} approved · ${item.counts.latestGroundedComparisons} grounded changes` : "No comparable quarter"}</small></span>{item.ready ? <span title="Every required flow has persisted records"><CheckCircle2 size={15} /></span> : <span className="coverage-gap" title={`Missing records: ${item.gaps.join(", ")}`}><XCircle size={15} /> {item.gaps.length}</span>}</div>)}</section></aside>
    </div>
  </div>;
}
