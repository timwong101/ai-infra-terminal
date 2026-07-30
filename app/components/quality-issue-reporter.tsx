"use client";

import { AlertTriangle, CheckCircle2, Flag, LoaderCircle, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ResearchQualityFailureType, ResearchQualityFeedback } from "@/lib/research/types";

const FAILURE_OPTIONS: Array<{ value: ResearchQualityFailureType; label: string }> = [
  { value: "wrong-retrieval", label: "Wrong retrieval" },
  { value: "unsupported-claim", label: "Unsupported claim" },
  { value: "citation-mismatch", label: "Citation mismatch" },
  { value: "incorrect-metric", label: "Incorrect number or scope" },
  { value: "stale-source", label: "Stale source" },
  { value: "missing-evidence", label: "Missing evidence" },
  { value: "should-abstain", label: "Should have abstained" },
  { value: "incorrect-answer", label: "Incorrect answer" },
];

export function QualityIssueReporter({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const [failureType, setFailureType] = useState<ResearchQualityFailureType>("unsupported-claim");
  const [severity, setSeverity] = useState<ResearchQualityFeedback["severity"]>("medium");
  const [summary, setSummary] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [notice, setNotice] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!summary.trim()) return;
    setStatus("saving");
    setNotice("");
    const response = await fetch("/api/research-quality/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceMessageId: messageId, failureType, severity, summary, expectedBehavior }),
    });
    const result = await response.json() as { id?: string; error?: string };
    if (!response.ok || !result.id) {
      setStatus("error");
      setNotice(result.error ?? "Unable to report this issue.");
      return;
    }
    setStatus("saved");
    setNotice("Issue captured with the exact answer, evidence packet, model, and retrieval configuration.");
  };

  if (!open) {
    return <button className="quality-report-trigger" onClick={() => setOpen(true)}><Flag size={13} /> Report issue</button>;
  }

  return (
    <form className="quality-report-form" onSubmit={submit}>
      <header>
        <div><AlertTriangle size={14} /><span><strong>Report a quality issue</strong><small>The complete generation trace will be frozen for review.</small></span></div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close issue reporter" title="Close"><X size={14} /></button>
      </header>
      {status === "saved" ? <div className="quality-report-success"><CheckCircle2 size={15} /><span>{notice}</span></div> : <>
        <div className="quality-report-fields">
          <label><span>Failure type</span><select value={failureType} onChange={(event) => setFailureType(event.target.value as ResearchQualityFailureType)}>{FAILURE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value as ResearchQualityFeedback["severity"])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        </div>
        <label><span>What failed?</span><textarea required rows={2} maxLength={800} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Describe the incorrect or unsupported behavior." /></label>
        <label><span>Expected behavior <em>optional</em></span><textarea rows={2} maxLength={1200} value={expectedBehavior} onChange={(event) => setExpectedBehavior(event.target.value)} placeholder="What should the system have returned or refused to answer?" /></label>
        {notice && <p className="quality-report-error">{notice}</p>}
        <footer><button className="primary-button" disabled={status === "saving" || !summary.trim()}>{status === "saving" ? <LoaderCircle className="drawer-spinner" size={14} /> : <Flag size={13} />} Submit issue</button></footer>
      </>}
    </form>
  );
}
