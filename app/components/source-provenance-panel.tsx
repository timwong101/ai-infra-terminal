"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, CheckCircle2, Download, Fingerprint, GitCompareArrows, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ArtifactSourceKind, SourceArtifactProvenance } from "@/lib/artifacts/types";

type Props = {
  sourceKind: ArtifactSourceKind;
  sourceDocumentId: string;
  onPromoted?: () => void;
};

function bytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}
function dateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not recorded";
}

export function SourceProvenancePanel({ sourceKind, sourceDocumentId, onPromoted }: Props) {
  const [data, setData] = useState<SourceArtifactProvenance | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [action, setAction] = useState<"verify" | "reprocess" | "promote" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus("loading"); setError("");
    try {
      const query = new URLSearchParams({ source: sourceKind, document: sourceDocumentId });
      const response = await fetch(`/api/source-artifacts?${query}`, { cache: "no-store", signal });
      const result = await response.json() as SourceArtifactProvenance | { error: string };
      if (!response.ok || !("archived" in result)) throw new Error("error" in result ? result.error : "Unable to load source provenance.");
      setData(result); setStatus("ready");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Unable to load source provenance."); setStatus("error");
    }
  }, [sourceDocumentId, sourceKind]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const mutate = async (nextAction: "verify" | "reprocess" | "promote", runId?: string) => {
    setAction(nextAction); setError("");
    try {
      const response = await fetch("/api/source-artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: nextAction, sourceKind, sourceDocumentId, runId }),
      });
      const result = await response.json() as SourceArtifactProvenance | { error: string };
      if (!response.ok || !("archived" in result)) throw new Error("error" in result ? result.error : "Unable to update source provenance.");
      setData(result);
      if (nextAction === "promote") onPromoted?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update source provenance."); }
    finally { setAction(null); }
  };

  if (status === "loading") return <section className="source-provenance loading"><LoaderCircle className="drawer-spinner" size={16} /><span>Loading immutable source record</span></section>;
  if (!data?.archived || !data.artifact) return <section className="source-provenance legacy"><Archive size={17} /><div><strong>Legacy source not archived</strong><p>{data?.storageConfigured ? "The next extraction refresh will capture the exact source bytes." : "Configure artifact storage before the next extraction refresh."}</p>{error && <small>{error}</small>}</div></section>;

  const artifact = data.artifact;
  const preview = data.previews[0];
  return <section className="source-provenance" aria-label="Immutable source provenance" data-testid="source-provenance">
    <header><div><span>Immutable source</span><strong>Artifact provenance</strong></div><em className={artifact.storageStatus === "available" ? "verified" : "warning"}>{artifact.storageStatus === "available" ? <ShieldCheck size={12} /> : <TriangleAlert size={12} />}{artifact.storageStatus}</em></header>
    <div className="artifact-facts">
      <div><Fingerprint size={13} /><span>SHA-256</span><code title={artifact.contentHash}>{artifact.contentHash.slice(0, 12)}…</code></div>
      <div><span>Archived</span><strong>{dateTime(artifact.fetchedAt)}</strong></div>
      <div><span>Object</span><strong>{bytes(artifact.byteLength)} · {artifact.storageBackend}</strong></div>
      <div><span>Verified</span><strong>{artifact.verifiedAt ? dateTime(artifact.verifiedAt) : "Not checked"}</strong></div>
    </div>
    {data.currentExtraction && <div className="extraction-fingerprint"><div><span>Canonical extraction</span><strong>{data.currentExtraction.parserVersion}</strong><small>{data.currentExtraction.codeVersion} · {data.currentExtraction.passageCount} passages · {data.currentExtraction.durationMs} ms</small></div><CheckCircle2 size={15} /></div>}
    <div className="artifact-actions"><a className="command-button small" href={`/api/source-artifacts?source=${sourceKind}&document=${encodeURIComponent(sourceDocumentId)}&action=download`}><Download size={13} />Archive</a><button className="command-button small" disabled={Boolean(action)} onClick={() => void mutate("verify")}><ShieldCheck size={13} />Verify</button><button className="command-button small" disabled={Boolean(action)} onClick={() => void mutate("reprocess")}>{action === "reprocess" ? <LoaderCircle className="drawer-spinner" size={13} /> : <RefreshCw size={13} />}Reprocess</button></div>
    {preview && <div className="extraction-preview"><header><div><span>Isolated parser preview</span><strong>{preview.parserVersion}</strong></div><GitCompareArrows size={15} /></header><p>Canonical evidence is unchanged until this preview is promoted.</p><div><span>Added <b>{preview.diffSummary.addedPassages}</b></span><span>Changed <b>{preview.diffSummary.changedPassages}</b></span><span>Removed <b>{preview.diffSummary.removedPassages}</b></span><span>Words <b>{preview.diffSummary.wordCountDelta >= 0 ? "+" : ""}{preview.diffSummary.wordCountDelta}</b></span></div><button className="primary-button small" disabled={Boolean(action)} onClick={() => void mutate("promote", preview.id)}>{action === "promote" ? <LoaderCircle className="drawer-spinner" size={13} /> : <CheckCircle2 size={13} />}Promote reviewed extraction</button></div>}
    {error && <p className="artifact-error"><TriangleAlert size={13} />{error}</p>}
  </section>;
}
