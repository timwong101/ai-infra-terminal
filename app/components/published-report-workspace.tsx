"use client";

import { Check, Copy, Download, ExternalLink, FileDown, LoaderCircle, Printer, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublishedReport } from "@/lib/reports/types";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function scoreTone(score: number) {
  return score >= 75 ? "high" : score >= 55 ? "medium" : "low";
}

export function PublishedReportWorkspace({ token }: { token: string }) {
  const [report, setReport] = useState<PublishedReport | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/reports/${encodeURIComponent(token)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { report?: PublishedReport; error?: string };
        if (!response.ok || !result.report) throw new Error(result.error || "This report is unavailable.");
        setReport(result.report);
        setStatus("ready");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [token]);

  const citationIndex = useMemo(() => new Map(report?.citations.map((citation, index) => [citation.id, index + 1]) ?? []), [report]);
  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (status === "loading") return <main className="published-report-state"><LoaderCircle className="drawer-spinner" size={26} /><strong>Opening published research</strong><span>Loading the immutable report snapshot.</span></main>;
  if (!report || status === "error") return <main className="published-report-state error"><FileDown size={28} /><strong>Report unavailable</strong><span>This link is invalid, expired, or has been revoked by its publisher.</span></main>;

  return (
    <div className="published-report-shell">
      <header className="published-report-toolbar">
        <Link
          className="published-report-brand"
          href="/"
          aria-label="Return to AI Infrastructure Terminal"
          onClick={(event) => {
            event.preventDefault();
            window.location.assign("/");
          }}
        >
          <span aria-hidden="true">×</span><strong>AI Infrastructure<br />Terminal</strong>
        </Link>
        <div className="published-report-actions">
          <button onClick={() => void copyLink()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</button>
          <a href={`/api/reports/${encodeURIComponent(token)}/markdown`}><Download size={15} />Markdown</a>
          <button onClick={() => window.print()}><Printer size={15} />Print / Save PDF</button>
        </div>
      </header>

      <main className="published-report-page">
        <header className="published-report-heading">
          <div className="published-report-kicker"><span>Published research</span><b>Version {report.version}</b></div>
          <h1>{report.title}</h1>
          <p>{report.question}</p>
          <div className="published-report-meta">
            <span><strong>Companies</strong>{report.companyA.name} ({report.companyA.ticker}) · {report.companyB.name} ({report.companyB.ticker})</span>
            <span><strong>Evidence as of</strong>{formatDate(report.asOfDate)}</span>
            <span><strong>Published</strong>{formatDate(report.publishedAt)}</span>
            <span><strong>Topic</strong>{report.topic}</span>
          </div>
        </header>

        <section className="published-report-assurance" aria-label="Report assurance">
          <div className={`published-compliance ${report.compliance.verificationPassed ? "passed" : "review"}`}>
            <ShieldCheck size={20} />
            <span><strong>{report.complianceMode ? "Compliance mode" : "Standard publication"}</strong>{report.compliance.note}</span>
          </div>
          <div><span>Confidence</span><strong className={scoreTone(report.confidenceScore)}>{report.confidenceScore}</strong><small>/100</small></div>
          <div><span>Evidence quality</span><strong>{report.evidenceQualityScore}</strong><small>/100</small></div>
          <div><span>Source diversity</span><strong>{report.sourceDiversityScore}</strong><small>/100</small></div>
          <div><span>Published claims</span><strong>{report.compliance.publishedClaims}</strong><small>{report.compliance.withheldClaims ? `${report.compliance.withheldClaims} withheld` : "all verified"}</small></div>
        </section>

        <article className="published-report-document">
          {report.sections.map((section) => (
            <section className={`published-report-section section-${section.key}`} key={section.key}>
              <header><span>{section.key.replaceAll("-", " ")}</span><h2>{section.title}</h2></header>
              {section.claims.length ? <div className="published-report-claims">{section.claims.map((claim, index) => {
                const company = claim.companyId === report.companyA.id ? report.companyA : report.companyB;
                return <div key={`${section.key}-${claim.companyId}-${index}`}><strong>{company.name}</strong><p>{claim.text} {claim.citationIds.map((id) => <a href={`#report-citation-${citationIndex.get(id)}`} key={id}>[{citationIndex.get(id)}]</a>)}</p></div>;
              })}</div> : <p className="published-report-gap">No publishable claims in this section.</p>}
            </section>
          ))}

          <section className="published-report-sources">
            <header><span>Provenance</span><h2>Source appendix</h2><p>{report.citations.length} frozen evidence passages</p></header>
            <div>{report.citations.map((citation, index) => (
              <article id={`report-citation-${index + 1}`} key={citation.id}>
                <b>{index + 1}</b>
                <div><strong>{citation.companyName} · {citation.sourceType}</strong><p>{citation.excerpt}</p><span>{citation.documentTitle} · {formatDate(citation.documentDate)}{citation.pageNumber ? ` · Page ${citation.pageNumber}` : ""}</span></div>
                <a href={citation.pageNumber ? `${citation.sourceUrl}#page=${citation.pageNumber}` : citation.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open report source ${index + 1}`}><ExternalLink size={14} /></a>
              </article>
            ))}</div>
          </section>
        </article>

        <footer className="published-report-footer">
          <span><strong>{report.publisher.name}</strong>{report.publisher.workspaceName}</span>
          <p>Research only. This report is an immutable evidence snapshot, not investment advice. Verify original sources before making a decision.</p>
          <a href={`/api/reports/${encodeURIComponent(token)}/markdown`}><FileDown size={14} /> Download source packet</a>
        </footer>
      </main>
    </div>
  );
}
