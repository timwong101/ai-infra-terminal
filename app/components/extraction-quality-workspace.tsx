"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle2, ChevronRight, CircleGauge, FileDiff, FlaskConical, Hash, LoaderCircle, Play, Rocket, ShieldAlert, XCircle } from "lucide-react";
import { secCompanies } from "@/data/companies";
import type { ExtractionBenchmarkCase, ExtractionQualityActual, ExtractionQualityRun, ParserRelease } from "@/lib/extraction-quality/types";

type Catalog = {
  runs: ExtractionQualityRun[];
  cases: ExtractionBenchmarkCase[];
  releases: ParserRelease[];
  suite: { version: string; parserVersion: string; caseCount: number };
};

function tone(value: number | null) { return (value ?? 0) >= 90 ? "high" : (value ?? 0) >= 75 ? "medium" : "low"; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function companyName(id: string) { return secCompanies.find((company) => company.id === id)?.ticker ?? id; }
function isActual(value: ExtractionQualityActual | { error: string }): value is ExtractionQualityActual { return "metrics" in value; }

export function ExtractionQualityWorkspace() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [run, setRun] = useState<ExtractionQualityRun | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "running" | "promoting" | "error">("loading");
  const [notice, setNotice] = useState("");

  const loadRun = useCallback(async (id: string) => {
    const response = await fetch(`/api/extraction-quality?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const result = await response.json() as { run?: ExtractionQualityRun; error?: string };
    if (!response.ok || !result.run) throw new Error(result.error ?? "Unable to load source benchmark.");
    setRun(result.run);
    setSelectedId(result.run.results.find((item) => item.status === "failed")?.id ?? result.run.results[0]?.id ?? "");
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/extraction-quality", { cache: "no-store" });
    const result = await response.json() as Catalog | { error: string };
    if (!response.ok || "error" in result) throw new Error("error" in result ? result.error : "Unable to load source extraction quality.");
    setCatalog(result);
    if (result.runs[0]?.id) await loadRun(result.runs[0].id);
    setStatus("ready");
  }, [loadRun]);

  useEffect(() => { queueMicrotask(() => void load().catch((cause) => { setNotice(cause instanceof Error ? cause.message : "Unable to load source extraction quality."); setStatus("error"); })); }, [load]);

  const start = async () => {
    setStatus("running"); setNotice("");
    try {
      const response = await fetch("/api/extraction-quality", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) });
      const result = await response.json() as { run?: ExtractionQualityRun; error?: string };
      if (!response.ok || !result.run) throw new Error(result.error ?? "Unable to run the source benchmark.");
      setRun(result.run); setSelectedId(result.run.results.find((item) => item.status === "failed")?.id ?? result.run.results[0]?.id ?? "");
      await load(); setStatus("ready");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Unable to run the source benchmark."); setStatus("error"); }
  };

  const promote = async () => {
    if (!run) return;
    setStatus("promoting"); setNotice("");
    try {
      const response = await fetch("/api/extraction-quality", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "promote", runId: run.id }) });
      const result = await response.json() as { release?: ParserRelease; error?: string };
      if (!response.ok || !result.release) throw new Error(result.error ?? "Parser promotion failed.");
      setNotice(`${result.release.parserVersion} promoted from the passing source benchmark.`); await load(); setStatus("ready");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Parser promotion failed."); setStatus("error"); }
  };

  const selected = useMemo(() => run?.results.find((item) => item.id === selectedId) ?? null, [run, selectedId]);
  const release = catalog?.releases.find((item) => item.benchmarkRunId === run?.id);
  const companies = useMemo(() => secCompanies.map((company) => {
    const results = run?.results.filter((item) => item.companyId === company.id) ?? [];
    return { ...company, passed: results.filter((item) => item.status === "passed").length, total: results.length };
  }), [run]);

  if (status === "loading") return <div className="workspace-state full-page"><LoaderCircle className="drawer-spinner" size={24} /><strong>Loading source quality</strong></div>;

  return <div className="extraction-quality-workspace">
    <div className="metric-quality-command"><div><span className="section-kicker">Immutable replay contracts</span><h2>Real-Document Extraction Lab</h2><p>Reparse archived SEC and IR documents, compare exact outputs, and gate parser releases.</p></div><div className="extraction-actions"><span className={`parser-release ${release?.status ?? "unreleased"}`}>{release?.status ?? "No candidate"}</span>{release?.status === "candidate" && <button className="command-button" disabled={status === "promoting"} onClick={() => void promote()}><Rocket size={14} />{status === "promoting" ? "Promoting" : "Promote parser"}</button>}<button className="primary-button" disabled={status === "running" || status === "promoting"} onClick={() => void start()}>{status === "running" ? <LoaderCircle className="drawer-spinner" size={15} /> : <Play size={15} />}{status === "running" ? "Replaying sources" : "Run source benchmark"}</button></div></div>
    {notice && <div className={`quality-notice ${status}`}><ShieldAlert size={14} />{notice}</div>}
    <section className="quality-metrics" aria-label="Source extraction metrics">
      <Metric label="Overall quality" value={run?.overallScore ?? null} />
      <Metric label="Pass rate" value={run?.passRate ?? null} suffix="%" />
      <Metric label="Metric recall" value={run?.metrics.metricRecall ?? null} suffix="%" />
      <Metric label="Metric precision" value={run?.metrics.metricPrecision ?? null} suffix="%" />
      <Metric label="False-positive safety" value={run?.metrics.forbiddenSafety ?? null} suffix="%" />
      <Metric label="Fiscal-period accuracy" value={run?.metrics.periodAccuracy ?? null} suffix="%" />
    </section>
    <section className="source-company-contracts" aria-label="Company source coverage">{companies.map((company) => <div key={company.id}><span>{company.ticker}</span><strong className={company.total > 0 && company.passed === company.total ? "high" : "low"}>{company.total ? `${company.passed}/${company.total}` : "--"}</strong><small>real documents passing</small></div>)}</section>
    <div className="metric-quality-layout extraction-quality-layout">
      <aside className="quality-history"><div className="quality-panel-heading"><div><span className="section-kicker">Saved runs</span><h2>Parser regressions</h2></div><span>{catalog?.runs.length ?? 0}</span></div><div className="quality-history-list">{catalog?.runs.map((item) => <button className={item.id === run?.id ? "active" : ""} key={item.id} onClick={() => void loadRun(item.id)}><span className={`quality-run-mark ${tone(item.overallScore)}`} /><span><strong>{item.overallScore ?? "--"} / 100</strong><small>{formatDate(item.startedAt)}</small><em>{item.passedCount}/{item.caseCount} passed</em></span><ChevronRight size={13} /></button>)}{!catalog?.runs.length && <div className="quality-empty-history">Run the suite to establish a real-document baseline.</div>}</div></aside>
      <section className="quality-results"><div className="quality-panel-heading"><div><span className="section-kicker">Archived corpus</span><h2>{catalog?.suite.version}</h2></div><span>{run ? `${run.passedCount} pass · ${run.failedCount} fail` : `${catalog?.suite.caseCount ?? 0} cases`}</span></div>{run ? <div className="quality-result-list">{run.results.map((item) => <button className={item.id === selectedId ? "active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}><span className={`quality-case-status ${item.status}`}>{item.status === "passed" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}</span><span><strong>{item.title}</strong><small>{companyName(item.companyId)} · {item.sourceKind.toUpperCase()}</small></span><b className={item.status === "passed" ? "high" : "low"}>{item.scores.overall}</b><ChevronRight size={13} /></button>)}</div> : <div className="quality-empty"><FlaskConical size={24} /><strong>No source benchmark selected</strong><span>The corpus covers all four tracked companies with archived official documents.</span></div>}</section>
      <aside className="quality-detail">{selected ? <ExtractionDetail result={selected} /> : <div className="quality-empty"><Archive size={24} /><strong>Source inspection</strong><span>Select a case to inspect its immutable input and exact extraction contract.</span></div>}</aside>
    </div>
  </div>;
}

function ExtractionDetail({ result }: { result: ExtractionQualityRun["results"][number] }) {
  const actual = isActual(result.actual) ? result.actual : null;
  return <div className="metric-quality-detail extraction-quality-detail"><header><span className={`quality-case-status ${result.status}`}>{result.status === "passed" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}</span><div><span className="section-kicker">{companyName(result.companyId)} · {result.sourceKind.toUpperCase()}</span><h2>{result.title}</h2></div></header>
    {!!result.failureReasons.length && <section className="quality-failures"><h3>Release blockers</h3>{result.failureReasons.map((reason) => <p key={reason}><XCircle size={12} />{reason}</p>)}</section>}
    <dl className="extraction-provenance"><div><dt><Hash size={11} /> Archived SHA-256</dt><dd><code>{result.artifactHash ?? "Artifact unavailable"}</code></dd></div><div><dt><FileDiff size={11} /> Parser replay</dt><dd><code>{actual ? `${actual.parserVersion}\n${actual.diff.beforePassages} -> ${actual.diff.afterPassages} passages · ${actual.diff.changedPassages} changed` : "error" in result.actual ? result.actual.error : "Replay unavailable"}</code></dd></div><div><dt>Expected contract</dt><dd><code>{JSON.stringify(result.expected, null, 2)}</code></dd></div><div><dt>Actual extraction</dt><dd><code>{JSON.stringify(result.actual, null, 2)}</code></dd></div></dl>
  </div>;
}

function Metric({ label, value, suffix = "" }: { label: string; value: number | null; suffix?: string }) {
  return <article><CircleGauge size={16} /><span><small>{label}</small><strong className={tone(value)}>{value ?? "--"}{value !== null ? suffix : ""}</strong><em>{value === null ? "Awaiting baseline" : value >= 90 ? "Release gate met" : "Below gate"}</em></span></article>;
}
