"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Clock3, FileText, History, LoaderCircle, Play, ShieldCheck } from "lucide-react";
import type { ReplayMode, ResearchReplayCatalog, ResearchReplayRun } from "@/lib/replay/types";

function defaultAsOf() {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - 90);
  return value.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function ResearchReplayWorkspace() {
  const [catalog, setCatalog] = useState<ResearchReplayCatalog | null>(null);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [asOfDate, setAsOfDate] = useState(defaultAsOf);
  const [mode, setMode] = useState<ReplayMode>("system-known");
  const [topic, setTopic] = useState("All topics");
  const [question, setQuestion] = useState("What did the available evidence support then, and what changed afterward?");
  const [maxDate] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  const [status, setStatus] = useState<"loading" | "ready" | "running" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/research-replay", { cache: "no-store", signal });
    const result = await response.json() as ResearchReplayCatalog | { error: string };
    if (!response.ok || !("runs" in result)) throw new Error("error" in result ? result.error : "Unable to load replay history.");
    setCatalog(result);
    setCompanyIds((current) => current.length ? current : result.companies.slice(0, 2).map((item) => item.id));
    setSelectedRunId((current) => current || result.runs[0]?.id || "");
    setStatus("ready");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void load(controller.signal).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Unable to load replay history.");
      }
    }));
    return () => controller.abort();
  }, [load]);

  const runReplay = async () => {
    setStatus("running");
    setError("");
    try {
      const response = await fetch("/api/research-replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds, asOfDate, mode, topic, question }),
      });
      const result = await response.json() as { run?: ResearchReplayRun; error?: string };
      if (!response.ok || !result.run) throw new Error(result.error || "Research replay failed.");
      setCatalog((current) => current ? { ...current, runs: [result.run!, ...current.runs] } : current);
      setSelectedRunId(result.run.id);
      setStatus("ready");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Research replay failed.");
    }
  };

  const activeRun = useMemo(() => catalog?.runs.find((item) => item.id === selectedRunId) ?? catalog?.runs[0] ?? null, [catalog?.runs, selectedRunId]);
  const toggleCompany = (id: string) => setCompanyIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 4));
  if (!catalog && status === "loading") return <div className="research-workspace"><div className="workspace-state full"><LoaderCircle className="drawer-spinner" size={26} /><strong>Loading research replay</strong></div></div>;

  return <div className="research-workspace replay-workspace">
    <header className="workspace-title-row"><div><p className="breadcrumb">Research workspace / Temporal integrity</p><h1>Point-in-Time Research Replay</h1><p className="workspace-subtitle">Reconstruct the approved evidence packet as of a prior date, then compare it with what the terminal knows today.</p></div></header>
    {error && <div className="builder-error"><AlertTriangle size={15} />{error}</div>}

    <section className="replay-builder">
      <div className="replay-builder-row">
        <div className="filter-block companies replay-companies"><span>Companies</span><div>{catalog?.companies.map((company) => <label key={company.id}><input type="checkbox" checked={companyIds.includes(company.id)} onChange={() => toggleCompany(company.id)} /><i>{companyIds.includes(company.id) && <CheckCircle2 size={10} />}</i>{company.ticker}</label>)}</div></div>
        <label><span>As of</span><input type="date" max={maxDate} value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} /></label>
        <label><span>Topic</span><select value={topic} onChange={(event) => setTopic(event.target.value)}><option>All topics</option>{catalog?.topics.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="replay-mode"><span>Availability policy</span><div><button className={mode === "system-known" ? "active" : ""} onClick={() => setMode("system-known")}>System known</button><button className={mode === "publication-time" ? "active" : ""} onClick={() => setMode("publication-time")}>Publication time</button></div></div>
      </div>
      <div className="replay-question"><input value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Replay research question" /><button className="primary-button" disabled={status === "running" || !companyIds.length} onClick={() => void runReplay()}>{status === "running" ? <LoaderCircle className="drawer-spinner" size={15} /> : <Play size={15} />} Run replay</button></div>
      <p className="replay-policy"><ShieldCheck size={13} />System-known mode requires both ingestion and analyst acceptance by the cutoff. Publication-time mode reconstructs what had been published, using today&apos;s review policy.</p>
    </section>

    <section className="replay-layout">
      <div className="replay-main">
        {activeRun ? <>
          <div className="replay-run-heading">
            <div><span className={`replay-integrity ${activeRun.metrics.leakageViolations === 0 ? "passed" : "failed"}`}><ShieldCheck size={13} />Leakage check {activeRun.metrics.leakageViolations === 0 ? "passed" : "failed"}</span><h2>Research state as of {activeRun.asOfDate}</h2><p>{activeRun.summary}</p></div>
            <span>{activeRun.mode.replace("-", " ")}</span>
          </div>
          <section className="replay-metrics">
            <article><Clock3 size={16} /><span>Then</span><strong>{activeRun.metrics.historicalEvidence}</strong><small>approved passages</small></article>
            <article><FileText size={16} /><span>Today</span><strong>{activeRun.metrics.currentEvidence}</strong><small>approved passages</small></article>
            <article><History size={16} /><span>Added later</span><strong>{activeRun.metrics.addedEvidence}</strong><small>changed the packet</small></article>
            <article><ShieldCheck size={16} /><span>Historical confidence</span><strong>{activeRun.metrics.confidence}</strong><small>quality and coverage</small></article>
          </section>
          <div className="replay-claim-compare">
            <section className="panel"><div className="catalog-heading"><div><h2>Then</h2><span>{activeRun.historicalClaims.length} grounded claims</span></div><CalendarClock size={16} /></div><div>{activeRun.historicalClaims.map((claim) => <article key={claim.id}><span>{claim.companyName} · {claim.topic}</span><p>{claim.text}</p><small>{claim.citationIds.length} citation</small></article>)}{!activeRun.historicalClaims.length && <div className="workspace-state"><Clock3 size={22} /><strong>No supported claims</strong><span>The selected availability policy produced an empty historical packet.</span></div>}</div></section>
            <section className="panel"><div className="catalog-heading"><div><h2>Today</h2><span>{activeRun.currentClaims.length} grounded claims</span></div><History size={16} /></div><div>{activeRun.currentClaims.map((claim) => <article key={claim.id}><span>{claim.companyName} · {claim.topic}</span><p>{claim.text}</p><small>{claim.citationIds.length} citation</small></article>)}</div></section>
          </div>
          <section className="panel replay-added-evidence"><div className="catalog-heading"><div><h2>What changed the packet</h2><span>Evidence available after the replay boundary</span></div><FileText size={16} /></div>{activeRun.addedEvidence.map((item) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.id}><span><b>{item.ticker}</b>{item.topic}</span><strong>{item.documentTitle}</strong><p>{item.excerpt}</p><em>{item.documentDate}</em></a>)}{!activeRun.addedEvidence.length && <div className="workspace-state"><CheckCircle2 size={22} /><strong>No later evidence in the current packet</strong></div>}</section>
        </> : <div className="workspace-state full replay-empty"><History size={28} /><strong>Run the first replay</strong><span>The exact historical and current packets will be saved for later inspection.</span></div>}
      </div>

      <aside className="panel replay-history">
        <div className="catalog-heading"><div><h2>Replay history</h2><span>Durable snapshots</span></div><History size={16} /></div>
        {catalog?.runs.map((run) => <button className={activeRun?.id === run.id ? "active" : ""} onClick={() => setSelectedRunId(run.id)} key={run.id}><CalendarClock size={14} /><span><strong>{run.asOfDate}</strong><small>{run.companyIds.length} companies · {run.metrics.historicalEvidence} then / {run.metrics.currentEvidence} now</small></span><ChevronRight size={13} /></button>)}
        {!catalog?.runs.length && <p>No saved replays yet.</p>}
        {activeRun && <footer>Generated {formatDate(activeRun.createdAt)}<br />Mode: {activeRun.mode.replace("-", " ")}</footer>}
      </aside>
    </section>
  </div>;
}
