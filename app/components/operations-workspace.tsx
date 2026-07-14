"use client";

import { useEffect, useState } from "react";
import { Activity, CheckCircle2, Clock3, Database, LoaderCircle, Play, ServerCog, XCircle } from "lucide-react";

type Operations = {
  runs: Array<{ id: string; trigger: string; status: string; stage: string; metrics: Record<string, unknown>; error: string | null; startedAt: string; completedAt: string | null }>;
  queue: { pending: number; processing: number; completed: number; failed: number } | null;
  schedule: string;
  aiEnabled: boolean;
};

export function OperationsWorkspace() {
  const [data, setData] = useState<Operations | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const load = async () => { const response = await fetch("/api/research-cycle", { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setData(result); };
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research-cycle", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); setData(result); })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Unable to load operations."); });
    return () => controller.abort();
  }, []);
  const run = async () => { setRunning(true); setError(""); try { const response = await fetch("/api/research-cycle", { method: "POST", headers: { "x-research-trigger": "dashboard" } }); const result = await response.json(); if (!response.ok) throw new Error(result.error); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Research cycle failed."); } finally { setRunning(false); } };
  if (!data && !error) return <div className="research-workspace"><div className="workspace-state full"><LoaderCircle className="drawer-spinner" size={26} /><strong>Loading research operations</strong></div></div>;
  return <div className="research-workspace operations-workspace"><header className="workspace-title-row"><div><p className="breadcrumb">System / Evidence operations</p><h1>Research Operations</h1><p className="workspace-subtitle">Ingestion, extraction, embeddings, and thesis updates with durable run history.</p></div><button className="primary-button" disabled={running} onClick={() => void run()}>{running ? <LoaderCircle className="drawer-spinner" size={15} /> : <Play size={15} />} Run cycle</button></header>{error && <div className="builder-error">{error}</div>}<section className="operations-metrics"><article><Database size={18} /><span>IR pending</span><strong>{data?.queue?.pending ?? 0}</strong></article><article><Activity size={18} /><span>Processing</span><strong>{data?.queue?.processing ?? 0}</strong></article><article><XCircle size={18} /><span>Failed</span><strong>{data?.queue?.failed ?? 0}</strong></article><article><ServerCog size={18} /><span>AI retrieval</span><strong>{data?.aiEnabled ? "Enabled" : "Fallback"}</strong></article></section><section className="panel operations-panel"><div className="catalog-heading"><div><h2>Pipeline runs</h2><span>{data?.schedule}</span></div><Clock3 size={17} /></div><div className="operations-table"><div className="operations-row heading"><span>Status</span><span>Trigger</span><span>Stage</span><span>Started</span><span>Duration</span></div>{data?.runs.map((run) => { const duration = run.completedAt ? Math.max(1, Math.round((new Date(run.completedAt).valueOf() - new Date(run.startedAt).valueOf()) / 1000)) : null; return <div className="operations-row" key={run.id}><span className={`run-status ${run.status}`}>{run.status === "completed" ? <CheckCircle2 size={13} /> : run.status === "failed" ? <XCircle size={13} /> : <LoaderCircle size={13} />}{run.status}</span><span>{run.trigger}</span><span>{run.stage.replaceAll("-", " ")}</span><span>{new Date(run.startedAt).toLocaleString()}</span><span>{duration ? `${duration}s` : "Running"}</span>{run.error && <small>{run.error}</small>}</div>})}{!data?.runs.length && <div className="workspace-state"><ServerCog size={24} /><strong>No scheduled runs yet</strong><span>Run the cycle once to establish the operational baseline.</span></div>}</div></section></div>;
}
