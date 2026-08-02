"use client";

import { Bell, Building2, ChevronRight, Database, ExternalLink, FileText, Gauge, Network, ShieldCheck } from "lucide-react";
import { TRACKED_COMPANIES, themeGroups } from "@/app/terminal-navigation";

type RecentEvidence = { title: string; source: string; age: string; sourceUrl?: string };

type Props = {
  secCount: number;
  irCount: number;
  coveredCompanyCount: number;
  unreadAlertCount: number;
  coverageCompleteness: number;
  catalogSourceRating: number;
  recent: RecentEvidence[];
  sourceStatus: { tone: string; label: string };
  onNavigate: (path: string) => void;
};

function MethodGauge({ score, label, method }: { score: number; label: string; method: string }) {
  return <div className="method-gauge">
    <div className="gauge" style={{ "--score": `${score * 1.8}deg` } as React.CSSProperties}><div><strong>{score}</strong><span>/100</span></div></div>
    <div><strong>{label}</strong><p>{method}</p></div>
  </div>;
}

export function NeocloudOverview(props: Props) {
  const totalDocuments = props.secCount + props.irCount;
  const plannedThemes = themeGroups.flatMap((group) => group.items).filter((theme) => theme !== "Neoclouds");
  const metrics = [
    { label: "Official documents", value: totalDocuments, detail: `${props.secCount} SEC · ${props.irCount} IR`, icon: FileText },
    { label: "Covered companies", value: `${props.coveredCompanyCount} / ${TRACKED_COMPANIES.length}`, detail: "Required source presence", icon: Building2 },
    { label: "Research alerts", value: props.unreadAlertCount, detail: "Awaiting analyst review", icon: Bell },
    { label: "Primary theme", value: "Neoclouds", detail: "Focused live coverage", icon: Network },
  ];

  return <div className="dashboard neocloud-overview">
    <header className="title-row neocloud-title-row">
      <div><p className="breadcrumb">Research workspace / Neoclouds</p><h1>Neocloud Research Overview</h1><span>Official-source coverage, analyst decisions, and evidence-backed outputs for four public AI cloud operators.</span></div>
      <div className={`live-status ${props.sourceStatus.tone}`}><span />{props.sourceStatus.label}</div>
    </header>

    <section className="metrics-grid" aria-label="Neocloud research metrics">
      {metrics.map((metric) => { const Icon = metric.icon; return <article className="metric-card" key={metric.label}><div className="metric-icon"><Icon size={22} strokeWidth={1.7} /></div><div><p>{metric.label}</p><strong>{metric.value}</strong><span>{metric.detail}</span></div></article>; })}
    </section>

    <section className="neocloud-workbench">
      <article className="panel coverage-companies-panel">
        <header className="panel-heading"><div><span className="section-kicker">Coverage universe</span><h2>Tracked Neoclouds</h2></div><button className="text-link" onClick={() => props.onNavigate("/companies")}>Open company research <ChevronRight size={14} /></button></header>
        <div className="coverage-company-list">
          {TRACKED_COMPANIES.map((company) => <button key={company.id} onClick={() => props.onNavigate(`/companies/${company.id}`)}><span className="company-monogram">{company.ticker.slice(0, 2)}</span><span><strong>{company.name}</strong><small>{company.ticker} · SEC and official IR policy</small></span><ShieldCheck size={15} /><ChevronRight size={14} /></button>)}
        </div>
      </article>

      <article className="panel overview-evidence-panel">
        <header className="panel-heading"><div><span className="section-kicker">Latest persisted inputs</span><h2>Recent Official Evidence</h2></div><button className="text-link" onClick={() => props.onNavigate("/evidence")}>Review evidence <ChevronRight size={14} /></button></header>
        <div className="overview-evidence-list">
          {props.recent.slice(0, 5).map((item, index) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={`${item.title}-${index}`}><FileText size={16} /><span><strong>{item.title}</strong><small>{item.source}</small></span><time>{item.age}</time><ExternalLink size={13} /></a>)}
          {!props.recent.length && <div className="workspace-state compact"><Database size={20} /><strong>No persisted evidence is available</strong><span>Run ingestion before evaluating coverage.</span></div>}
        </div>
      </article>

      <aside className="panel coverage-method-panel">
        <header><Gauge size={17} /><div><span className="section-kicker">Method, not conviction</span><h2>Coverage Diagnostics</h2></div></header>
        <MethodGauge score={props.coverageCompleteness} label="Coverage completeness" method="70% configured source rating plus 30% covered-company presence." />
        <MethodGauge score={props.catalogSourceRating} label="Catalog source rating" method="Average configured quality rating across current SEC and IR catalog records." />
        <p><ShieldCheck size={13} />These values measure research input coverage. They are not investment scores, price signals, or generated theses.</p>
      </aside>
    </section>

    <details className="coverage-roadmap">
      <summary><span><Network size={15} /><strong>Infrastructure coverage roadmap</strong><small>{plannedThemes.length} themes intentionally not yet live</small></span><ChevronRight size={15} /></summary>
      <div>{themeGroups.map((group) => <section key={group.title}><h3>{group.title}</h3><p>{group.items.filter((theme) => theme !== "Neoclouds").join(" · ") || "Neoclouds is live"}</p></section>)}</div>
    </details>
  </div>;
}
