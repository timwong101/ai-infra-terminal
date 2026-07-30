"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, CircleGauge, FlaskConical, LoaderCircle, Play, ShieldAlert, XCircle } from "lucide-react";
import type { MetricQualityRun } from "@/lib/company-intelligence/metric-quality";

type Catalog = { runs: MetricQualityRun[]; suite: { version: string; caseCount: number } };

function tone(value: number | null) { return (value ?? 0) >= 90 ? "high" : (value ?? 0) >= 75 ? "medium" : "low"; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }

export function MetricQualityWorkspace() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [run, setRun] = useState<MetricQualityRun | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "running" | "error">("loading");
  const [error, setError] = useState("");

  const loadRun = useCallback(async (id: string) => {
    const response = await fetch(`/api/metric-quality?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const result = await response.json() as { run: MetricQualityRun | null; error?: string };
    if (!response.ok || !result.run) throw new Error(result.error ?? "Unable to load metric quality run.");
    setRun(result.run); setSelectedId(result.run.results.find((item) => item.status === "failed")?.id ?? result.run.results[0]?.id ?? "");
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/metric-quality", { cache: "no-store" });
    const result = await response.json() as Catalog | { error: string };
    if (!response.ok || "error" in result) throw new Error("error" in result ? result.error : "Unable to load metric quality.");
    setCatalog(result);
    if (result.runs[0]?.id) await loadRun(result.runs[0].id);
    setStatus("ready");
  }, [loadRun]);

  useEffect(() => { queueMicrotask(() => void load().catch((cause) => { setError(cause instanceof Error ? cause.message : "Unable to load metric quality."); setStatus("error"); })); }, [load]);

  const start = async () => {
    setStatus("running"); setError("");
    try {
      const response = await fetch("/api/metric-quality", { method: "POST" });
      const result = await response.json() as { run?: MetricQualityRun; error?: string };
      if (!response.ok || !result.run) throw new Error(result.error ?? "Unable to run metric quality.");
      setRun(result.run); setSelectedId(result.run.results.find((item) => item.status === "failed")?.id ?? result.run.results[0]?.id ?? "");
      const nextCatalog = await fetch("/api/metric-quality", { cache: "no-store" }).then((item) => item.json()) as Catalog;
      setCatalog(nextCatalog); setStatus("ready");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to run metric quality."); setStatus("error"); }
  };

  const selected = useMemo(() => run?.results.find((item) => item.id === selectedId) ?? null, [run, selectedId]);
  if (status === "loading") return <div className="workspace-state full-page"><LoaderCircle className="drawer-spinner" size={24} /><strong>Loading metric quality</strong></div>;

  return <div className="metric-quality-workspace">
    <div className="metric-quality-command"><div><span className="section-kicker">Deterministic data contracts</span><h2>Metric Extraction & Reconciliation</h2><p>Golden extraction fixtures and live canonical-fact safety checks.</p></div><button className="primary-button" disabled={status === "running"} onClick={() => void start()}>{status === "running" ? <LoaderCircle className="drawer-spinner" size={15} /> : <Play size={15} />}{status === "running" ? "Running checks" : "Run metric benchmark"}</button></div>
    {error && <div className="quality-notice error"><ShieldAlert size={14} />{error}</div>}
    <section className="quality-metrics metric-quality-metrics" aria-label="Metric quality metrics">
      <Metric label="Overall quality" value={run?.overallScore ?? null} />
      <Metric label="Pass rate" value={run?.passRate ?? null} suffix="%" />
      <Metric label="Classification" value={run?.metrics.classificationAccuracy ?? null} suffix="%" />
      <Metric label="Value accuracy" value={run?.metrics.valueAccuracy ?? null} suffix="%" />
      <Metric label="Anomaly safety" value={run?.metrics.anomalySafety ?? null} suffix="%" />
      <Metric label="Live contracts" value={run?.metrics.contractHealth ?? null} suffix="%" />
    </section>
    <div className="metric-quality-layout">
      <aside className="quality-history"><div className="quality-panel-heading"><div><span className="section-kicker">Saved runs</span><h2>Metric regressions</h2></div><span>{catalog?.runs.length ?? 0}</span></div><div className="quality-history-list">{catalog?.runs.map((item) => <button className={item.id === run?.id ? "active" : ""} key={item.id} onClick={() => void loadRun(item.id)}><span className={`quality-run-mark ${tone(item.overallScore)}`} /><span><strong>{item.overallScore ?? "--"} / 100</strong><small>{formatDate(item.startedAt)}</small><em>{item.passedCount}/{item.caseCount} passed</em></span><ChevronRight size={13} /></button>)}{!catalog?.runs.length && <div className="quality-empty-history">Run the suite to establish the extraction baseline.</div>}</div></aside>
      <section className="quality-results"><div className="quality-panel-heading"><div><span className="section-kicker">Benchmark suite</span><h2>{catalog?.suite.version}</h2></div><span>{run ? `${run.passedCount} pass · ${run.failedCount} fail` : `${catalog?.suite.caseCount ?? 0} cases`}</span></div>{run ? <div className="quality-result-list">{run.results.map((item) => <button className={item.id === selectedId ? "active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}><span className={`quality-case-status ${item.status}`}>{item.status === "passed" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}</span><span><strong>{item.title}</strong><small>{item.category.replaceAll("-", " ")}</small></span><b className={item.status === "passed" ? "high" : "low"}>{item.status === "passed" ? "Pass" : "Fail"}</b><ChevronRight size={13} /></button>)}</div> : <div className="quality-empty"><FlaskConical size={24} /><strong>No metric benchmark selected</strong></div>}</section>
      <aside className="quality-detail">{selected ? <div className="metric-quality-detail"><header><span className={`quality-case-status ${selected.status}`}>{selected.status === "passed" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}</span><div><span className="section-kicker">{selected.category.replaceAll("-", " ")}</span><h2>{selected.title}</h2></div></header>{!!selected.failureReasons.length && <section className="quality-failures"><h3>Why this failed</h3>{selected.failureReasons.map((reason) => <p key={reason}><XCircle size={12} />{reason}</p>)}</section>}<dl><div><dt>Expected</dt><dd><code>{JSON.stringify(selected.expected)}</code></dd></div><div><dt>Actual</dt><dd><code>{JSON.stringify(selected.actual)}</code></dd></div></dl></div> : <div className="quality-empty"><CircleGauge size={24} /><strong>Case inspection</strong><span>Select a result to inspect expected and actual contracts.</span></div>}</aside>
    </div>
  </div>;
}

function Metric({ label, value, suffix = "" }: { label: string; value: number | null; suffix?: string }) {
  return <article><CircleGauge size={16} /><span><small>{label}</small><strong className={tone(value)}>{value ?? "--"}{value !== null ? suffix : ""}</strong><em>{value === null ? "Awaiting baseline" : value >= 90 ? "Healthy" : "Below gate"}</em></span></article>;
}
