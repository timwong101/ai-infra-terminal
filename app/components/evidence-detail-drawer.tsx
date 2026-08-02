"use client";

import {
  AlertTriangle,
  BookOpenText,
  CircleHelp,
  Copy,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import { getFilingComparisonMode } from "@/lib/evidence/compare";
import type { EvidenceSignal, FilingComparison, SecFilingDetail } from "@/lib/evidence/types";
import type { IrDocumentDetail } from "@/lib/ir/types";

export type EvidenceDocument = {
  source: string;
  company: string;
  claim: string;
  age: string;
  score: number;
  signal: EvidenceSignal;
  sourceUrl?: string;
  accessionNumber?: string;
  cik?: string;
  primaryDocument?: string;
  formType?: string;
  filedAt?: string;
  isLive?: boolean;
  canExtract?: boolean;
  detailKind?: "sec" | "ir";
  documentId?: string;
};

type EvidenceDetailDrawerProps = {
  evidence: EvidenceDocument;
  filingDetail: SecFilingDetail | null;
  irDocumentDetail: IrDocumentDetail | null;
  comparison: FilingComparison | null;
  persistence: "postgres" | "memory";
  tab: "evidence" | "changes";
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  copiedPassage: string | null;
  onClose: () => void;
  onRetry: () => void;
  onTabChange: (tab: "evidence" | "changes") => void;
  onCopyPassage: (passageId: string, text: string) => void;
};

function formatDocumentDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function EvidenceDetailDrawer({
  evidence,
  filingDetail,
  irDocumentDetail,
  comparison,
  persistence,
  tab,
  status,
  error,
  copiedPassage,
  onClose,
  onRetry,
  onTabChange,
  onCopyPassage,
}: EvidenceDetailDrawerProps) {
  const documentDetail = filingDetail ?? irDocumentDetail;
  const documentDate = filingDetail?.filedAt ?? irDocumentDetail?.publishedAt;
  const documentType = filingDetail?.formType ?? irDocumentDetail?.documentType;

  return (
    <div className="evidence-drawer-layer" role="presentation" onMouseDown={onClose}>
      <aside className="evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="evidence-detail-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="section-kicker">Source document</span>
            <h2 id="evidence-detail-title">{evidence.company}</h2>
            <p>{evidence.source} · {evidence.age}</p>
          </div>
          <button className="icon-button drawer-close" onClick={onClose} aria-label="Close evidence detail" title="Close evidence detail"><X size={18} /></button>
        </header>

        {status === "loading" && <div className="drawer-state"><LoaderCircle className="drawer-spinner" size={25} /><strong>Extracting source evidence</strong><p>Reading the source document and identifying citation-ready research passages.</p></div>}
        {status === "error" && <div className="drawer-state error"><AlertTriangle size={24} /><strong>Extraction unavailable</strong><p>{error}</p><button className="command-button" onClick={onRetry}>Try again</button></div>}

        {status === "ready" && documentDetail && documentDate && documentType && (
          <div className="drawer-body">
            <section className="filing-summary">
              <div><span>{irDocumentDetail ? "Published" : "Filed"}</span><strong>{formatDocumentDate(documentDate)}</strong></div>
              <div><span>{irDocumentDetail ? "Document" : "Form"}</span><strong>{documentType}</strong></div>
              <div><span>{irDocumentDetail?.pageCount ? "Pages / words" : "Words scanned"}</span><strong>{irDocumentDetail?.pageCount ? `${irDocumentDetail.pageCount} / ${documentDetail.wordCount.toLocaleString()}` : documentDetail.wordCount.toLocaleString()}</strong></div>
              <div><span>Extraction</span><strong className={`quality-${documentDetail.extraction.quality}`}>{documentDetail.extraction.quality}</strong></div>
            </section>
            <div className="extraction-note"><ShieldCheck size={15} /><span>{documentDetail.extraction.message} {persistence === "postgres" ? "Saved to Postgres." : "Using the session cache."}</span></div>

            {filingDetail && <div className="drawer-tabs" role="tablist" aria-label="Filing detail views">
              <button role="tab" aria-selected={tab === "evidence"} className={tab === "evidence" ? "active" : ""} onClick={() => onTabChange("evidence")}>Evidence <span>{filingDetail.sections.reduce((total, section) => total + section.passages.length, 0)}</span></button>
              <button role="tab" aria-selected={tab === "changes"} className={tab === "changes" ? "active" : ""} onClick={() => onTabChange("changes")}>
                {getFilingComparisonMode(filingDetail.formType) === "event" ? "Event signals" : getFilingComparisonMode(filingDetail.formType) === "amendment" ? "Changes from base filing" : "Changes since prior period"} <span>{comparison ? Object.values(comparison.counts).reduce((total, count) => total + count, 0) : 0}</span>
              </button>
            </div>}

            {(irDocumentDetail || tab === "evidence") && documentDetail.sections.length > 0 ? (
              <div className="filing-sections">
                {documentDetail.sections.map((section) => <section className="filing-section" key={section.id}>
                  <div className="filing-section-heading"><span>{section.category}</span><h3>{section.title}</h3></div>
                  {section.passages.map((passage) => <article className="evidence-passage" key={passage.id}>
                    <BookOpenText size={16} />
                    <p>{passage.text}</p>
                    <div>
                      <span className="passage-meta">{passage.pageNumber && <a href={`${evidence.sourceUrl}#page=${passage.pageNumber}`} target="_blank" rel="noreferrer">Page {passage.pageNumber} <ExternalLink size={10} /></a>}<span>{passage.wordCount} words</span></span>
                      <button className="icon-button" onClick={() => onCopyPassage(passage.id, passage.text)} aria-label="Copy evidence passage" title="Copy evidence passage">{copiedPassage === passage.id ? <ShieldCheck size={15} /> : <Copy size={15} />}</button>
                    </div>
                  </article>)}
                </section>)}
              </div>
            ) : irDocumentDetail || tab === "evidence" ? (
              <div className="drawer-state compact"><CircleHelp size={22} /><strong>No narrative sections found</strong><p>This document may primarily contain exhibits or structured tables.</p></div>
            ) : comparison ? <FilingChanges comparison={comparison} /> : (
              <div className="drawer-state compact"><CircleHelp size={22} /><strong>No comparable prior filing</strong><p>Recurring-section comparison begins after an earlier base filing is available.</p></div>
            )}
          </div>
        )}

        <footer className="drawer-footer">
          <span>{evidence.documentId ?? evidence.accessionNumber}</span>
          <a href={irDocumentDetail?.extraction.quality === "limited" && irDocumentDetail.sections.length === 0 ? irDocumentDetail.sourcePageUrl : irDocumentDetail?.sourceUrl ?? evidence.sourceUrl} target="_blank" rel="noreferrer">Open official source <ExternalLink size={14} /></a>
        </footer>
      </aside>
    </div>
  );
}

function FilingChanges({ comparison }: { comparison: FilingComparison }) {
  return <div className="filing-changes">
    <div className="comparison-summary">
      <div><span>{comparison.previousFiling ? "Compared with" : "Comparison policy"}</span><strong>{comparison.previousFiling ? `${comparison.previousFiling.formType} · ${formatDocumentDate(comparison.previousFiling.filedAt)}` : comparison.policyLabel}</strong></div>
      <div className="change-counts">
        {comparison.mode === "event" ? <span className="new-event">{comparison.counts.new_event} new event</span> : <><span className="added">+{comparison.counts.added} added</span><span className="modified">{comparison.counts.modified} changed</span><span className="not-repeated">{comparison.counts.not_repeated} not repeated</span>{comparison.counts.explicitly_removed > 0 && <span className="explicitly-removed">{comparison.counts.explicitly_removed} explicit removal</span>}</>}
      </div>
      {comparison.previousFiling ? <a href={comparison.previousFiling.sourceUrl} target="_blank" rel="noreferrer" title="Open prior filing"><ExternalLink size={14} /></a> : <span aria-hidden="true" />}
    </div>
    {comparison.changes.length > 0 ? comparison.changes.map((change) => <article className="filing-change" key={change.id}>
      <div className="change-heading"><span className={`change-type ${change.type}`}>{change.type.replaceAll("_", " ")}</span><span className={`change-significance ${change.significance}`}>{change.significance}</span>{change.relevanceScore !== null && <span className="change-relevance">R {change.relevanceScore}</span>}{change.similarity !== null && <span className="change-similarity">{change.similarity}% overlap</span>}</div>
      <span className="change-category">{change.category}{change.eventCode ? ` · Item ${change.eventCode}` : ""}</span>
      <h3>{change.eventType ?? change.sectionTitle}</h3>
      <p>{change.relevanceReason ?? change.summary}</p>
      <details><summary>Review source excerpts</summary>{change.currentText && <div><strong>Current filing</strong><p>{change.currentText}</p></div>}{change.previousText && <div><strong>Prior filing</strong><p>{change.previousText}</p></div>}</details>
    </article>) : <div className="drawer-state compact"><ShieldCheck size={22} /><strong>No material language changes</strong><p>The extracted passages closely match the prior filing.</p></div>}
  </div>;
}
