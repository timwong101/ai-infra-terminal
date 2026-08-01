"use client";

import { BarChart3, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Database, FlaskConical, GitBranch, LoaderCircle, Play, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResearchQualityCase, ResearchQualityFeedback, ResearchQualityResult, ResearchQualityRun } from "@/lib/research/types";
import { MetricQualityWorkspace } from "@/app/components/metric-quality-workspace";
import { ExtractionQualityWorkspace } from "@/app/components/extraction-quality-workspace";
import { ResearchQualityFeedbackWorkspace } from "@/app/components/research-quality-feedback-workspace";

type Catalog = {
  runs: ResearchQualityRun[];
  feedback: ResearchQualityFeedback[];
  cases: ResearchQualityCase[];
  suite: { version: string; caseCount: number; gates: { overall: number; passRate: number; citationPrecision: number; groundedness: number } };
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
  const [qualityDomain, setQualityDomain] = useState<"research" | "metrics" | "sources">("research");
  const [researchView, setResearchView] = useState<"runs" | "feedback">("runs");
  const [baselineRunId, setBaselineRunId] = useState("");
  const [baselineRun, setBaselineRun] = useState<ResearchQualityRun | null>(null);

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

  const selectBaseline = async (id: string) => {
    setBaselineRunId(id);
    if (!id || id === run?.id) {
      setBaselineRun(null);
      return;
    }
    try {
      const response = await fetch(`/api/research-quality/${encodeURIComponent(id)}`, { cache: "no-store" });
      const result = await response.json() as { run?: ResearchQualityRun };
      setBaselineRun(response.ok ? result.run ?? null : null);
    } catch {
      setBaselineRun(null);
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
        <div><p className="breadcrumb">Research workspace / Reliability</p><h1>Research Quality</h1><span>{qualityDomain === "research" ? "Grounding, retrieval, citation, and refusal benchmarks for the Research Assistant." : qualityDomain === "metrics" ? "Extraction correctness, anomaly safety, canonical facts, and live data contracts." : "Immutable source replay, real-document regression coverage, and controlled parser promotion."}</span></div>
        <div className="quality-run-controls">
          <div className="quality-engine quality-domain" aria-label="Quality domain"><button className={qualityDomain === "research" ? "active" : ""} onClick={() => setQualityDomain("research")}>Research answers</button><button className={qualityDomain === "metrics" ? "active" : ""} onClick={() => setQualityDomain("metrics")}>Metric contracts</button><button className={qualityDomain === "sources" ? "active" : ""} onClick={() => setQualityDomain("sources")}>Source extraction</button></div>
          {qualityDomain === "research" && <>
          <div className="quality-engine" aria-label="Research quality workflow">
            <button className={researchView === "runs" ? "active" : ""} onClick={() => setResearchView("runs")}>Runs</button>
            <button className={researchView === "feedback" ? "active" : ""} onClick={() => setResearchView("feedback")}>Failure queue{catalog?.feedback.some((item) => item.status === "open") ? ` · ${catalog.feedback.filter((item) => item.status === "open").length}` : ""}</button>
          </div>
          {researchView === "runs" && <>
          <div className="quality-engine" aria-label="Evaluation engine">
            <button className={engine === "deterministic" ? "active" : ""} onClick={() => setEngine("deterministic")}>Deterministic</button>
            <button className={engine === "ai" ? "active" : ""} disabled={!catalog?.aiAvailable} title={!catalog?.aiAvailable ? "Configure OPENAI_API_KEY to evaluate the AI engine" : undefined} onClick={() => setEngine("ai")}>AI model</button>
          </div>
          <button className="primary-button" disabled={status === "running"} onClick={() => void startRun()}>{status === "running" ? <LoaderCircle className="drawer-spinner" size={15} /> : <Play size={15} />}<span>{status === "running" ? `Running ${catalog?.suite.caseCount ?? 32} cases` : "Run benchmark"}</span></button>
          </>}
          </>}
        </div>
      </header>

      {qualityDomain === "metrics" ? <MetricQualityWorkspace /> : qualityDomain === "sources" ? <ExtractionQualityWorkspace /> : researchView === "feedback" ? <ResearchQualityFeedbackWorkspace feedback={catalog?.feedback ?? []} cases={catalog?.cases ?? []} onChanged={async () => { await loadCatalog(); }} /> : <>
      {(notice || status === "running") && <div className={`quality-notice ${status}`}><FlaskConical size={15} /><span>{notice || "Running the complete benchmark against accepted evidence. This view will update when all cases are persisted."}</span></div>}
      {!catalog?.runs.length && <div className="quality-notice ready"><ShieldCheck size={15} /><span>This workspace has no saved run yet. CI enforces the same {catalog?.suite.caseCount ?? 32}-case suite at ≥{catalog?.suite.gates.overall ?? 85} overall, ≥{catalog?.suite.gates.passRate ?? 85}% pass rate, and 100% citation precision and groundedness. Run it here to create a workspace-owned baseline.</span></div>}

      <section className="quality-metrics" aria-label="Quality metrics">
        <Metric label="Overall quality" value={run?.overallScore ?? null} gate={catalog?.suite.gates.overall} icon={BarChart3} />
        <Metric label="Pass rate" value={run?.passRate ?? null} gate={catalog?.suite.gates.passRate} suffix="%" icon={CheckCircle2} />
        <Metric label="Retrieval coverage" value={metrics && "retrievalCoverage" in metrics ? metrics.retrievalCoverage : null} suffix="%" icon={Database} />
        <Metric label="Citation precision" value={metrics && "citationPrecision" in metrics ? metrics.citationPrecision : null} gate={catalog?.suite.gates.citationPrecision} suffix="%" icon={ShieldCheck} />
        <Metric label="Groundedness" value={metrics && "groundedness" in metrics ? metrics.groundedness : null} gate={catalog?.suite.gates.groundedness} suffix="%" icon={ShieldCheck} />
        <article><CircleDollarSign size={16} /><span><small>Estimated model cost</small><strong>${(totalCost / 1_000_000).toFixed(4)}</strong><em>{run?.engine ?? "No run"}</em></span></article>
      </section>

      {!!run && (catalog?.runs.length ?? 0) > 1 && <section className="quality-comparison-bar">
        <GitBranch size={14} />
        <label><span>Compare against</span><select value={baselineRunId} onChange={(event) => void selectBaseline(event.target.value)}><option value="">No baseline</option>{catalog?.runs.filter((item) => item.id !== run.id).map((item) => <option key={item.id} value={item.id}>{formatDate(item.startedAt)} · {item.engine} · {item.overallScore ?? "--"}/100</option>)}</select></label>
        {baselineRun && <div><span>Overall <b className={(run.overallScore ?? 0) - (baselineRun.overallScore ?? 0) >= 0 ? "positive" : "negative"}>{formatDelta((run.overallScore ?? 0) - (baselineRun.overallScore ?? 0))}</b></span><span>Pass rate <b className={(run.passRate ?? 0) - (baselineRun.passRate ?? 0) >= 0 ? "positive" : "negative"}>{formatDelta((run.passRate ?? 0) - (baselineRun.passRate ?? 0))} pts</b></span><span>Regressions <b className="negative">{compareRuns(run, baselineRun).regressions}</b></span><span>Fixed <b className="positive">{compareRuns(run, baselineRun).fixed}</b></span></div>}
      </section>}

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
          {run ? <div className="quality-result-list" role="list">{run.results.map((result) => <ResultRow key={result.id} result={result} baseline={baselineRun?.results.find((item) => item.benchmarkId === result.benchmarkId) ?? null} active={selectedResultId === result.id} onSelect={() => setSelectedResultId(result.id)} />)}</div> : <div className="quality-empty"><FlaskConical size={25} /><strong>No benchmark selected</strong><span>Run the deterministic suite to measure the current research pipeline.</span></div>}
        </section>

        <aside className="quality-detail">
          {selectedResult ? <QualityDetail result={selectedResult} /> : <div className="quality-empty"><ShieldCheck size={25} /><strong>Case inspection</strong><span>Select a benchmark result to inspect its scores, failures, and exact source packet.</span></div>}
        </aside>
      </div>
      </>}
    </div>
  );
}

function formatDelta(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function compareRuns(current: ResearchQualityRun, baseline: ResearchQualityRun) {
  const baselineById = new Map(baseline.results.map((item) => [item.benchmarkId, item]));
  let regressions = 0;
  let fixed = 0;
  for (const result of current.results) {
    const previous = baselineById.get(result.benchmarkId);
    if (!previous) continue;
    if (previous.status === "passed" && result.status === "failed") regressions += 1;
    if (previous.status === "failed" && result.status === "passed") fixed += 1;
  }
  return { regressions, fixed };
}

function Metric({ label, value, suffix = "", gate, icon: Icon }: { label: string; value: number | null; suffix?: string; gate?: number; icon: typeof BarChart3 }) {
  return <article><Icon size={16} /><span><small>{label}</small><strong className={scoreTone(value)}>{value ?? "--"}{value !== null ? suffix : ""}</strong><em>{value === null ? gate ? `CI gate ≥${gate}${suffix}` : "Run to measure" : value >= (gate ?? 90) ? "Gate met" : value >= 75 ? "Review" : "Below gate"}</em></span></article>;
}

function ResultRow({ result, baseline, active, onSelect }: { result: ResearchQualityResult; baseline: ResearchQualityResult | null; active: boolean; onSelect: () => void }) {
  const delta = baseline ? result.scores.overall - baseline.scores.overall : null;
  return <button className={active ? "active" : ""} onClick={onSelect} role="listitem"><span className={`quality-case-status ${result.status}`}>{result.status === "passed" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}</span><span><strong>{result.title}{result.caseOrigin === "production" && <em className="production-case-label">Production v{result.caseVersion}</em>}</strong><small>{result.category.replaceAll("-", " ")} · {result.citationCount} citations · {result.retrievalMode}</small></span><b className={scoreTone(result.scores.overall)}>{result.scores.overall}{delta !== null && <small className={delta >= 0 ? "positive" : "negative"}>{formatDelta(delta)}</small>}</b><ChevronRight size={13} /></button>;
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
