"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ExternalLink,
  GitCommitHorizontal,
  History,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Target,
  X,
} from "lucide-react";
import type {
  CommitmentItem,
  CommitmentLedgerResponse,
  CommitmentOutcomeStatus,
  CommitmentReviewStatus,
} from "@/lib/company-intelligence/commitments/types";

type Props = {
  companyId: string;
  companies: Array<{ id: string; name: string; ticker: string }>;
  onCompanyChange: (companyId: string) => void;
};

function targetDate(item: CommitmentItem) {
  const end = item.currentRevision.targetPeriodEnd;
  return end ? `Target ${end}` : "Target date not disclosed";
}

function defaultOutcome(item: CommitmentItem): CommitmentOutcomeStatus {
  const actual = item.suggestedActual;
  if (!actual || actual.unit !== item.currentRevision.targetUnit) return "not-comparable";
  if (actual.normalizedValue >= item.currentRevision.targetValue) return "achieved";
  return actual.normalizedValue >= item.currentRevision.targetValue * 0.75 ? "partial" : "missed";
}

export function CommitmentsLedger({ companyId, companies, onCompanyChange }: Props) {
  const [data, setData] = useState<CommitmentLedgerResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [outcomeSelections, setOutcomeSelections] = useState<Record<string, CommitmentOutcomeStatus>>({});

  const applyData = useCallback((result: CommitmentLedgerResponse) => {
    setData(result);
    setSelectedId((current) => result.commitments.some((item) => item.id === current) ? current : result.commitments[0]?.id ?? "");
    setStatus("ready");
  }, []);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    setStatus("loading");
    setError("");
    try {
      const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
      const result = await response.json() as CommitmentLedgerResponse | { error: string };
      if (!response.ok || !("commitments" in result)) throw new Error("error" in result ? result.error : "Unable to load commitments.");
      applyData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load commitments.");
      setStatus("error");
    }
  }, [applyData]);

  useEffect(() => { queueMicrotask(() => void request(`/api/commitments?company=${encodeURIComponent(companyId)}`)); }, [companyId, request]);

  const selected = useMemo(() => data?.commitments.find((item) => item.id === selectedId) ?? data?.commitments[0] ?? null, [data, selectedId]);
  const outcomeStatus = selected ? outcomeSelections[selected.id] ?? defaultOutcome(selected) : "not-comparable";

  const sync = () => request("/api/commitments", { method: "POST", body: JSON.stringify({ action: "sync", companyId }) });
  const review = (entity: "commitment" | "revision", id: string, reviewStatus: CommitmentReviewStatus) => request("/api/commitments", {
    method: "PATCH",
    body: JSON.stringify({ entity, id, status: reviewStatus }),
  });
  const reconcile = (id: string) => request("/api/commitments", {
    method: "POST",
    body: JSON.stringify({ action: "reconcile", id, outcomeStatus }),
  });

  return <section className="commitments-ledger" aria-label="Guidance and commitments ledger">
    <header className="panel commitments-toolbar">
      <div>
        <p className="section-kicker">Temporal accountability</p>
        <h2>Guidance & Commitments</h2>
        <span>What management said, how it changed, and what the company ultimately delivered.</span>
      </div>
      <div>
        <label><span>Company</span><select value={companyId} onChange={(event) => onCompanyChange(event.target.value)}>{companies.map((company) => <option value={company.id} key={company.id}>{company.name} ({company.ticker})</option>)}</select></label>
        <button className="command-button" disabled={status === "loading"} onClick={sync}>{status === "loading" ? <LoaderCircle className="drawer-spinner" size={14} /> : <RefreshCw size={14} />} Scan accepted evidence</button>
      </div>
    </header>

    {error && <div className="builder-error"><ShieldAlert size={14} /> {error}</div>}
    <section className="commitment-summary-strip" aria-label="Commitment metrics">
      <article><Target size={16} /><span>Tracked</span><strong>{data?.summary.total ?? 0}</strong></article>
      <article><ShieldAlert size={16} /><span>Awaiting review</span><strong>{data?.summary.proposed ?? 0}</strong></article>
      <article><GitCommitHorizontal size={16} /><span>Changed</span><strong>{data?.summary.changed ?? 0}</strong></article>
      <article><CheckCircle2 size={16} /><span>Reconciled</span><strong>{data?.summary.reconciled ?? 0}</strong></article>
      <article className={(data?.summary.due ?? 0) > 0 ? "warning" : ""}><CalendarClock size={16} /><span>Due for outcome</span><strong>{data?.summary.due ?? 0}</strong></article>
    </section>

    {!data && status === "loading" ? <div className="panel workspace-state full"><LoaderCircle className="drawer-spinner" size={24} /><strong>Loading commitment history</strong></div> : data && !data.commitments.length ? <div className="panel commitment-empty"><Target size={28} /><strong>No commitment candidates yet</strong><p>Scan accepted evidence to identify explicit, numeric forward-looking statements. Nothing enters the ledger without a source passage and analyst review.</p><button className="command-button" onClick={sync}><RefreshCw size={14} /> Scan accepted evidence</button></div> : data && selected && <div className="commitment-ledger-layout">
      <aside className="panel commitment-list">
        <header><div><strong>{data.company.ticker} ledger</strong><span>{data.commitments.length} commitments</span></div><History size={15} /></header>
        {data.commitments.map((item) => <button className={item.id === selected.id ? "active" : ""} onClick={() => setSelectedId(item.id)} key={item.id}>
          <span className={`commitment-status ${item.reviewStatus}`}>{item.reviewStatus}</span>
          <strong>{item.label}</strong>
          <b>{item.currentRevision.targetDisplay}</b>
          <small>{targetDate(item)} · {item.revisions.length} {item.revisions.length === 1 ? "statement" : "statements"}</small>
        </button>)}
      </aside>

      <article className="panel commitment-detail">
        <header className="commitment-detail-heading">
          <div><span>{selected.category}</span><h2>{selected.label}</h2><p>{selected.scopeLabel}</p></div>
          <div><strong>{selected.currentRevision.targetDisplay}</strong><span>{targetDate(selected)}</span></div>
        </header>

        {selected.reviewStatus === "proposed" && <section className="commitment-review-banner"><ShieldAlert size={18} /><div><strong>Analyst confirmation required</strong><p>This candidate was extracted from accepted evidence, but it is not an approved research fact until an analyst verifies identity, scope, value, and target period.</p></div><button className="icon-button approve" title="Accept commitment" aria-label="Accept commitment" onClick={() => review("commitment", selected.id, "accepted")}><Check size={15} /></button><button className="icon-button danger" title="Reject commitment" aria-label="Reject commitment" onClick={() => review("commitment", selected.id, "rejected")}><X size={15} /></button></section>}

        <section className="commitment-timeline">
          <div className="catalog-heading"><div><h3>Statement history</h3><span>Valid time follows the source date; recorded time preserves when the terminal learned it.</span></div><GitCommitHorizontal size={16} /></div>
          {[...selected.revisions].reverse().map((revision) => <article key={revision.id} className={`commitment-revision ${revision.reviewStatus}`}>
            <i />
            <div className="commitment-revision-meta"><span className={`revision-kind ${revision.revisionKind}`}>{revision.revisionKind}</span><time>{revision.validFrom}</time><em>{revision.reviewStatus}</em></div>
            <div className="commitment-revision-value"><strong>{revision.targetDisplay}</strong><span>{revision.targetPeriodEnd ?? "No target date"}</span></div>
            <p>{revision.statement}</p>
            <footer><a href={revision.source.pageNumber ? `${revision.source.sourceUrl}#page=${revision.source.pageNumber}` : revision.source.sourceUrl} target="_blank" rel="noreferrer"><Link2 size={12} /> {revision.source.sourceType} · {revision.source.documentTitle}<ExternalLink size={11} /></a><span>{revision.confidence}% extraction confidence</span>{revision.sequence > 1 && revision.reviewStatus === "proposed" && <div><button className="icon-button approve" title="Accept revision" aria-label={`Accept ${revision.revisionKind} revision`} onClick={() => review("revision", revision.id, "accepted")}><Check size={13} /></button><button className="icon-button danger" title="Reject revision" aria-label={`Reject ${revision.revisionKind} revision`} onClick={() => review("revision", revision.id, "rejected")}><X size={13} /></button></div>}</footer>
          </article>)}
        </section>

        <section className="commitment-outcomes">
          <div className="catalog-heading"><div><h3>Outcome reconciliation</h3><span>Accepted commitments are matched only to analyst-approved canonical facts.</span></div><CheckCircle2 size={16} /></div>
          {selected.outcomes.map((outcome) => <article className={outcome.outcomeStatus} key={outcome.id}><CheckCircle2 size={16} /><div><strong>{outcome.outcomeStatus.replace("-", " ")} · {outcome.actualDisplay ?? "Not comparable"}</strong><p>{outcome.rationale}</p><small>{outcome.reviewerName} · {new Date(outcome.recordedAt).toLocaleDateString()} · {outcome.confidence}% confidence</small></div></article>)}
          {!selected.outcomes.length && selected.reviewStatus === "accepted" && selected.suggestedActual ? <div className="commitment-reconcile-control"><div><span>Latest compatible canonical actual</span><strong>{selected.suggestedActual.displayValue}</strong><small>{selected.suggestedActual.periodEnd} · {selected.suggestedActual.sourceLabel ?? "Reviewed metric ledger"}</small></div><select aria-label="Outcome status" value={outcomeStatus} onChange={(event) => setOutcomeSelections((current) => ({ ...current, [selected.id]: event.target.value as CommitmentOutcomeStatus }))}><option value="achieved">Achieved</option><option value="partial">Partially achieved</option><option value="missed">Missed</option><option value="not-comparable">Not comparable</option></select><button className="command-button" onClick={() => reconcile(selected.id)}><CheckCircle2 size={14} /> Reconcile actual</button></div> : !selected.outcomes.length && <p className="missing-evidence">{selected.reviewStatus === "accepted" ? "No compatible canonical actual is available yet." : "Accept this commitment before reconciling an outcome."}</p>}
        </section>
      </article>
    </div>}
  </section>;
}
