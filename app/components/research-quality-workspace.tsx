"use client";

import { BarChart3, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Database, FlaskConical, LoaderCircle, Play, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResearchQualityResult, ResearchQualityRun } from "@/lib/research/types";

type Catalog = {
  runs: ResearchQualityRun[];
  suite: { version: string; caseCount: number };
  aiAvailable: boolean;
};

type Props = {
  initialRunId?: string;
  onRunSelect: (id: string) => void;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (!value) return "--";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function scoreTone(value: number | null) {
  return (value ?? 0) >= 90 ? "high" : (value ?? 0) >= 75 ? "medium" : "low";
}

export function ResearchQualityWorkspace({ initialRunId = "", onRunSelect }: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [run, setRun] = useState<ResearchQualityRun | null>(null);
  const [selectedResultId, setSelectedResultId] = useState("");
  const [engine, setEngine] = useState<"deterministic" | "ai">("deterministic");
  const [status, setStatus] = useState<"loading" | "ready" | "running" | "error">("loading");
  const [notice, setNotice] = useState("");

  const loadCatalog = useCallback(async () => {
    const response = await fetch("/api/research-quality", { cache: "no-store" });
    const result = await response.json() as Catalog | { error: string };
    if (!response.ok || "error" in result) throw new Error("error" in result ? result.error : "Unable to load quality history.");
    setCatalog(result);
    return result;
  }, []);

  const loadRun = useCallback(async (id: string) => {
    const response = await fetch(`/api/research-quality/${encodeURIComponent(id)}`, { cache: "no-store" });
    const result = await response.json() as { run: ResearchQualityRun } | { error: string };
    if (!response.ok || "error" in result) throw new Error("error" in result ? result.error : "Unable to load this quality run.");
    setRun(result.run);
    setSelectedResultId((current) => result.run.results.some((item) => item.id === current) ? current : result.run.results.find((item) => item.status === "failed")?.id ?? result.run.results[0]?.id ?? "");
    return result.run;
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      loadCatalog().then(async (nextCatalog) => {
        if (cancelled) return;
        const target = initialRunId || nextCatalog.runs[0]?.id;
        if (target) {
          if (!initialRunId) onRunSelect(target);
          else await loadRun(target);
        }
        if (!cancelled) setStatus("ready");
      }).catch((error) => { if (!cancelled) { setNotice(error instanceof Error ? error.message : "Unable to load research quality."); setStatus("error"); } });
    });
    return () => { cancelled = true; };
  }, [initialRunId, loadCatalog, loadRun, onRunSelect]);

  const startRun = async () => {
    setStatus("running");
    setNotice("");
    try {
      const response = await fetch("/api/research-quality", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine }) });
      const result = await response.json() as { run: ResearchQualityRun } | { error: string };
      if (!response.ok || "error" in result) throw new Error("error" in result ? result.error : "Unable to complete the quality run.");
      setRun(result.run);
      setSelectedResultId(result.run.results.find((item) => item.status === "failed")?.id ?? result.run.results[0]?.id ?? "");
      await loadCatalog();
      onRunSelect(result.run.id);
      setStatus("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to complete the quality run.");
      setStatus("error");
    }
  };

  const selectedResult = useMemo(() => run?.results.find((item) => item.id === selectedResultId) ?? null, [run, selectedResultId]);
  const metrics = run?.metrics;
  const totalCost = run?.results.reduce((sum, item) => sum + item.estimatedCostMicros, 0) ?? 0;

  if (status === "loading" && !catalog) return <div className="workspace-state full-page"><LoaderCircle className="drawer-spinner" size={25} /><strong>Loading research quality</strong><span>Opening benchmark history and regression results.</span></div>;
  if (status === "error" && !catalog) return <div className="workspace-state full-page"><XCircle size={25} /><strong>Research quality unavailable</strong><span>{notice}</span></div>;

  return (
    <div className="research-quality-workspace">
      <header className="quality-title-row">
        <div><p className="breadcrumb">Research workspace / Reliability</p><h1>Research Quality</h1><span>Grounding, retrieval, citation, and refusal benchmarks for the Research Assistant.</span></div>
        <div className="quality-run-controls">
          <div className="quality-engine" aria-label="Evaluation engine">
            <button className={engine === "deterministic" ? "active" : ""} onClick={() => setEngine("deterministic")}>Deterministic</button>
            <button className={engine === "ai" ? "active" : ""} disabled={!catalog?.aiAvailable} title={!catalog?.aiAvailable ? "Configure OPENAI_API_KEY to evaluate the AI engine" : undefined} onClick={() => setEngine("ai")}>AI model</button>
          </div>
          <button className="primary-button" disabled={status === "running"} onClick={() => void startRun()}>{status === "running" ? <LoaderCircle className="drawer-spinner" size={15} /> : <Play size={15} />}<span>{status === "running" ? "Running 32 cases" : "Run benchmark"}</span></button>
        </div>
      </header>

      {(notice || status === "running") && <div className={`quality-notice ${status}`}><FlaskConical size={15} /><span>{notice || "Running the complete benchmark against accepted evidence. This view will update when all cases are persisted."}</span></div>}

      <section className="quality-metrics" aria-label="Quality metrics">
        <Metric label="Overall quality" value={run?.overallScore ?? null} icon={BarChart3} />
        <Metric label="Pass rate" value={run?.passRate ?? null} suffix="%" icon={CheckCircle2} />
        <Metric label="Retrieval coverage" value={metrics && "retrievalCoverage" in metrics ? metrics.retrievalCoverage : null} suffix="%" icon={Database} />
        <Metric label="Citation precision" value={metrics && "citationPrecision" in metrics ? metrics.citationPrecision : null} suffix="%" icon={ShieldCheck} />
        <Metric label="Groundedness" value={metrics && "groundedness" in metrics ? metrics.groundedness : null} suffix="%" icon={ShieldCheck} />
        <article><CircleDollarSign size={16} /><span><small>Estimated model cost</small><strong>${(totalCost / 1_000_000).toFixed(4)}</strong><em>{run?.engine ?? "No run"}</em></span></article>
      </section>

      <div className="quality-layout">
        <aside className="quality-history">
          <div className="quality-panel-heading"><div><span className="section-kicker">Saved runs</span><h2>Regression History</h2></div><span>{catalog?.runs.length ?? 0}</span></div>
          <div className="quality-history-list">
            {catalog?.runs.map((item) => <button key={item.id} className={item.id === run?.id ? "active" : ""} onClick={() => onRunSelect(item.id)}><span className={`quality-run-mark ${scoreTone(item.overallScore)}`} /> <span><strong>{item.overallScore ?? "--"} / 100</strong><small>{formatDate(item.startedAt)} · {item.engine}</small><em>{item.passedCount}/{item.caseCount} passed · {formatDuration(item.durationMs)}</em></span><ChevronRight size={13} /></button>)}
            {!catalog?.runs.length && <div className="quality-empty-history">Run the benchmark to establish the first quality baseline.</div>}
          </div>
        </aside>

        <section className="quality-results">
          <div className="quality-panel-heading"><div><span className="section-kicker">Benchmark suite</span><h2>{catalog?.suite.version ?? "Neocloud grounding"}</h2></div><span>{run ? `${run.passedCount} pass · ${run.failedCount} fail` : `${catalog?.suite.caseCount ?? 32} cases`}</span></div>
          {run ? <div className="quality-result-list" role="list">{run.results.map((result) => <ResultRow key={result.id} result={result} active={selectedResultId === result.id} onSelect={() => setSelectedResultId(result.id)} />)}</div> : <div className="quality-empty"><FlaskConical size={25} /><strong>No benchmark selected</strong><span>Run the deterministic suite to measure the current research pipeline.</span></div>}
        </section>

        <aside className="quality-detail">
          {selectedResult ? <QualityDetail result={selectedResult} /> : <div className="quality-empty"><ShieldCheck size={25} /><strong>Case inspection</strong><span>Select a benchmark result to inspect its scores, failures, and exact source packet.</span></div>}
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, suffix = "", icon: Icon }: { label: string; value: number | null; suffix?: string; icon: typeof BarChart3 }) {
  return <article><Icon size={16} /><span><small>{label}</small><strong className={scoreTone(value)}>{value ?? "--"}{value !== null ? suffix : ""}</strong><em>{value === null ? "Awaiting baseline" : value >= 90 ? "Healthy" : value >= 75 ? "Review" : "Below gate"}</em></span></article>;
}

function ResultRow({ result, active, onSelect }: { result: ResearchQualityResult; active: boolean; onSelect: () => void }) {
  return <button className={active ? "active" : ""} onClick={onSelect} role="listitem"><span className={`quality-case-status ${result.status}`}>{result.status === "passed" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}</span><span><strong>{result.title}</strong><small>{result.category.replaceAll("-", " ")} · {result.citationCount} citations · {result.retrievalMode}</small></span><b className={scoreTone(result.scores.overall)}>{result.scores.overall}</b><ChevronRight size={13} /></button>;
}

function QualityDetail({ result }: { result: ResearchQualityResult }) {
  const scoreRows = [
    ["Retrieval", result.scores.retrievalCoverage], ["Citations", result.scores.citationPrecision], ["Groundedness", result.scores.groundedness],
    ["Company accuracy", result.scores.companyAccuracy], ["Completeness", result.scores.answerCompleteness],
  ] as const;
  return <div className="quality-detail-content">
    <header><span className={`quality-case-status ${result.status}`}>{result.status === "passed" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}</span><div><span className="section-kicker">{result.category.replaceAll("-", " ")}</span><h2>{result.title}</h2></div><strong className={scoreTone(result.scores.overall)}>{result.scores.overall}</strong></header>
    <div className="quality-question"><span>Benchmark question</span><p>{result.question}</p></div>
    <div className="quality-score-bars">{scoreRows.map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value}%</strong></div>)}</div>
    {!!result.failureReasons.length && <section className="quality-failures"><h3>Why this failed</h3>{result.failureReasons.map((reason) => <p key={reason}><XCircle size={12} />{reason}</p>)}</section>}
    <dl className="quality-case-meta"><div><dt><Clock3 size={12} /> Latency</dt><dd>{formatDuration(result.latencyMs)}</dd></div><div><dt>Expected behavior</dt><dd>{result.expectations.behavior}</dd></div><div><dt>Unsupported claims</dt><dd>{result.unsupportedClaimCount}</dd></div><div><dt>Tokens</dt><dd>{result.totalTokens ?? 0}</dd></div></dl>
    <details className="quality-packet" open={result.status === "failed"}><summary><Database size={13} />Evidence packet <span>{result.citations.length}</span><ChevronRight size={12} /></summary><div>{result.citations.map((item) => <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer"><strong>{item.companyName} · {item.topic}</strong><small>{item.documentDate} · Quality {item.evidenceQualityScore}</small><p>{item.excerpt}</p></a>)}{!result.citations.length && <p className="quality-no-evidence">No eligible evidence was retrieved. This is expected for refusal benchmarks.</p>}</div></details>
  </div>;
}
