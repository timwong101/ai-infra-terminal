"use client";

import {
  ArchiveX,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Eye,
  FileSearch,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AlertStatus, AlertsResponse, ResearchAlert } from "@/lib/alerts/types";

type AlertsWorkspaceProps = {
  onOpenFiling: (filingId: string) => void;
  onUnreadChange: (count: number) => void;
};

const EMPTY_RESPONSE: AlertsResponse = {
  alerts: [],
  claims: [],
  summary: { total: 0, unread: 0, high: 0, watching: 0, reviewed: 0 },
  filters: { companies: [], categories: [] },
};

export function AlertsWorkspace({ onOpenFiling, onUnreadChange }: AlertsWorkspaceProps) {
  const [data, setData] = useState<AlertsResponse>(EMPTY_RESPONSE);
  const [status, setStatus] = useState("unread");
  const [company, setCompany] = useState("all");
  const [category, setCategory] = useState("all");
  const [significance, setSignificance] = useState("high");
  const [selectedClaim, setSelectedClaim] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [updatingAlert, setUpdatingAlert] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ status, company, category, significance });
    fetch(`/api/alerts?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as AlertsResponse | { error: string };
        if (!response.ok || !("alerts" in result)) throw new Error("error" in result ? result.error : "Unable to load alerts");
        return result;
      })
      .then((result) => {
        setData(result);
        onUnreadChange(result.summary.unread);
        setSelectedClaim((current) => current ?? result.claims[0]?.id ?? null);
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : "Unable to load alerts");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [category, company, onUnreadChange, refreshKey, significance, status]);

  const visibleClaims = useMemo(
    () => data.claims.filter((claim) => company === "all" || claim.companyId === company),
    [company, data.claims],
  );
  const activeClaim = visibleClaims.find((claim) => claim.id === selectedClaim) ?? visibleClaims[0] ?? null;

  const updateStatus = async (alert: ResearchAlert, nextStatus: AlertStatus) => {
    setUpdatingAlert(alert.id);
    try {
      const response = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: alert.id, status: nextStatus }),
      });
      if (!response.ok) throw new Error("Unable to update alert");
      setRefreshKey((value) => value + 1);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update alert");
    } finally {
      setUpdatingAlert(null);
    }
  };

  return (
    <div className="alerts-workspace">
      <div className="alerts-title-row">
        <div><p className="breadcrumb">Research workspace / Evidence monitoring</p><h1>Thesis Alerts</h1></div>
        <button className="icon-button alerts-refresh" onClick={() => setRefreshKey((value) => value + 1)} title="Refresh alerts" aria-label="Refresh alerts"><RefreshCw size={17} /></button>
      </div>

      <section className="alert-metrics" aria-label="Alert metrics">
        <article><Bell size={18} /><span>Unread</span><strong>{data.summary.unread}</strong></article>
        <article><ShieldAlert size={18} /><span>High significance</span><strong>{data.summary.high}</strong></article>
        <article><Star size={18} /><span>Watching</span><strong>{data.summary.watching}</strong></article>
        <article><Check size={18} /><span>Reviewed</span><strong>{data.summary.reviewed}</strong></article>
      </section>

      <div className="alerts-toolbar">
        <select aria-label="Filter alert status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="unread">Unread</option><option value="all">All statuses</option><option value="watching">Watching</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option>
        </select>
        <select aria-label="Filter alert company" value={company} onChange={(event) => { setCompany(event.target.value); setSelectedClaim(null); }}>
          <option value="all">All companies</option>{data.filters.companies.map((item) => <option value={item.id} key={item.id}>{item.name} ({item.ticker})</option>)}
        </select>
        <select aria-label="Filter alert category" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="all">All categories</option>{data.filters.categories.map((item) => <option value={item} key={item}>{item}</option>)}
        </select>
        <select aria-label="Filter significance" value={significance} onChange={(event) => setSignificance(event.target.value)}>
          <option value="all">All significance</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <span>{data.alerts.length} results</span>
      </div>

      <section className="alerts-layout">
        <div className="alerts-list-panel">
          <div className="alerts-list-heading"><div><span className="section-kicker">Evidence changes</span><h2>Material alerts</h2></div><span>{status === "all" ? data.summary.total : data.alerts.length}</span></div>
          {loading ? (
            <div className="alerts-state"><LoaderCircle className="drawer-spinner" size={24} /><strong>Loading alerts</strong></div>
          ) : error ? (
            <div className="alerts-state error"><CircleHelp size={23} /><strong>{error}</strong><button onClick={() => setRefreshKey((value) => value + 1)}>Retry</button></div>
          ) : data.alerts.length === 0 ? (
            <div className="alerts-state"><Check size={24} /><strong>No alerts match these filters</strong></div>
          ) : data.alerts.map((alert) => (
            <article className={`research-alert ${alert.status}`} key={alert.id}>
              <div className="alert-status-rail"><span className={alert.significance} /></div>
              <div className="alert-main">
                <div className="alert-badges"><span className={`significance ${alert.significance}`}>{alert.significance}</span><span className={`impact ${alert.impact}`}>{alert.impact}</span><span>{alert.category}</span>{alert.relevanceScore !== null && <span className="relevance">R {alert.relevanceScore}</span>}</div>
                <h3>{alert.title}</h3>
                <p>{alert.summary}</p>
                <div className="alert-meta"><span>{alert.companyName} ({alert.ticker})</span><span>{alert.formType}</span><span>{alert.filedAt}</span>{alert.eventCode && <span>Item {alert.eventCode}</span>}<span>{alert.sectionTitle}</span>{alert.similarity !== null && <span>{alert.similarity}% overlap</span>}</div>
              </div>
              <div className="alert-actions">
                {alert.filingId ? <button onClick={() => onOpenFiling(alert.filingId!)} title="Review source evidence"><FileSearch size={15} /><span>Evidence</span></button> : alert.sourceUrl ? <a className="alert-source-button" href={alert.sourceUrl} target="_blank" rel="noreferrer" title="Open source evidence"><FileSearch size={15} /><span>Evidence</span></a> : null}
                <button className={alert.status === "watching" ? "selected" : ""} disabled={updatingAlert === alert.id} onClick={() => void updateStatus(alert, alert.status === "watching" ? "unread" : "watching")} title="Watch alert" aria-label="Watch alert"><Eye size={15} /></button>
                <button disabled={updatingAlert === alert.id} onClick={() => void updateStatus(alert, "reviewed")} title="Mark reviewed" aria-label="Mark reviewed"><Check size={15} /></button>
                <button disabled={updatingAlert === alert.id} onClick={() => void updateStatus(alert, "dismissed")} title="Dismiss alert" aria-label="Dismiss alert"><ArchiveX size={15} /></button>
              </div>
            </article>
          ))}
        </div>

        <aside className="claims-panel">
          <div className="claims-heading"><div><span className="section-kicker">Claim impact</span><h2>Thesis drift</h2></div><span>{visibleClaims.length}</span></div>
          <div className="claim-selector">
            {visibleClaims.map((claim) => (
              <button key={claim.id} className={activeClaim?.id === claim.id ? "active" : ""} onClick={() => setSelectedClaim(claim.id)}>
                <span>{claim.ticker}</span><strong>{claim.title}</strong><b>{claim.supportScore}</b><ChevronRight size={14} />
              </button>
            ))}
          </div>
          {activeClaim && (
            <div className="claim-detail">
              <div className="claim-score"><div><strong>{activeClaim.supportScore}</strong><span>/100 support</span></div>{activeClaim.supportScore >= 50 ? <TrendingUp size={22} /> : <TrendingDown size={22} />}</div>
              <h3>{activeClaim.title}</h3>
              <p>{activeClaim.statement}</p>
              <div className="claim-evidence-counts"><span><b>{activeClaim.supportingCount}</b> supporting</span><span><b>{activeClaim.weakeningCount}</b> weakening</span><span><b>{activeClaim.evidenceCount}</b> total</span></div>
              <div className="drift-chart" aria-label="Claim support score history">
                {activeClaim.snapshots.map((snapshot) => <span key={snapshot.date} style={{ height: `${Math.max(12, snapshot.supportScore)}%` }} title={`${snapshot.date}: ${snapshot.supportScore}`} />)}
              </div>
              <div className="drift-axis"><span>{activeClaim.snapshots[0]?.date ?? ""}</span><span>{activeClaim.snapshots.at(-1)?.date ?? ""}</span></div>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
