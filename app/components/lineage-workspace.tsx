"use client";

import type { Core } from "cytoscape";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Filter, GitBranch, LoaderCircle, RefreshCw, Search, ShieldCheck, ShieldOff } from "lucide-react";
import type { LineageGraph, LineageNode, LineageNodeKind } from "@/lib/lineage/types";

const COLORS: Record<LineageNodeKind, string> = {
  company: "#62c6ff",
  source: "#95a8b4",
  evidence: "#55d6a3",
  claim: "#e4bd59",
  memo: "#bf8cff",
  event: "#f08772",
};

export function LineageWorkspace() {
  const [graph, setGraph] = useState<LineageGraph | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [complianceMode, setComplianceMode] = useState(false);
  const [companyRoot, setCompanyRoot] = useState("coreweave");
  const [kind, setKind] = useState<LineageNodeKind | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    const response = await fetch("/api/lineage", { cache: "no-store" });
    const result = await response.json() as LineageGraph | { error: string };
    if (!response.ok || !("nodes" in result)) throw new Error("error" in result ? result.error : "Unable to load evidence lineage.");
    setGraph(result);
    setSelectedId((current) => current || (result.nodes.some((item) => item.id === "company:coreweave") ? "company:coreweave" : result.nodes[0]?.id || ""));
    setStatus("ready");
  }, []);

  useEffect(() => { queueMicrotask(() => void load().catch((cause) => { setStatus("error"); setError(cause instanceof Error ? cause.message : "Unable to load evidence lineage."); })); }, [load]);

  const visibleGraph = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    const normalized = query.trim().toLowerCase();
    const reachable = new Set<string>();
    if (companyRoot !== "all") {
      const queue = [`company:${companyRoot}`];
      reachable.add(queue[0]);
      while (queue.length) {
        const current = queue.shift()!;
        for (const edge of graph.edges) {
          if (edge.source !== current || reachable.has(edge.target)) continue;
          reachable.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
    const nodes = graph.nodes.filter((node) =>
      (!complianceMode || node.compliant)
      && (companyRoot === "all" || reachable.has(node.id))
      && (kind === "all" || node.kind === kind)
      && (!normalized || `${node.label} ${node.subtitle} ${Object.values(node.details).join(" ")}`.toLowerCase().includes(normalized))
    );
    const ids = new Set(nodes.map((node) => node.id));
    return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && (!complianceMode || edge.compliant)) };
  }, [companyRoot, complianceMode, graph, kind, query]);

  useEffect(() => {
    if (!containerRef.current || !graph) return;
    cyRef.current?.destroy();
    let disposed = false;
    let instance: Core | null = null;
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (disposed || !containerRef.current) return;
      instance = cytoscape({
        container: containerRef.current,
        elements: [
          ...visibleGraph.nodes.map((node) => ({ data: { id: node.id, label: node.label, kind: node.kind, compliant: node.compliant } })),
          ...visibleGraph.edges.map((edge) => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.label, compliant: edge.compliant } })),
        ],
        style: [
          { selector: "node", style: { "background-color": (element) => COLORS[element.data("kind") as LineageNodeKind], label: "", color: "#d8e5e9", "font-size": 8, "text-wrap": "ellipsis", "text-max-width": "92px", "text-valign": "bottom", "text-margin-y": 6, width: 24, height: 24, "border-width": 1, "border-color": "#0b161c" } },
          { selector: 'node[kind = "company"]', style: { label: "data(label)", width: 34, height: 34, "font-size": 9, "font-weight": 700 } },
          { selector: 'node[kind = "claim"]', style: { label: "data(label)" } },
          { selector: 'node[kind = "memo"]', style: { label: "data(label)", shape: "round-rectangle", width: 34, height: 28 } },
          { selector: "edge", style: { width: 1, "line-color": "#304853", "target-arrow-color": "#4e6975", "target-arrow-shape": "triangle", "curve-style": "bezier", label: "data(label)", color: "#70858f", "font-size": 6, "text-background-color": "#071117", "text-background-opacity": .85, "text-background-padding": "2px" } },
          { selector: ":selected", style: { "border-width": 3, "border-color": "#ffffff", "line-color": "#85d8ff", "target-arrow-color": "#85d8ff" } },
        ],
        layout: { name: "breadthfirst", directed: true, padding: 28, spacingFactor: 1.25, animate: false },
        minZoom: .35,
        maxZoom: 2.2,
      });
      instance.on("tap", "node", (event) => setSelectedId(event.target.id()));
      cyRef.current = instance;
    });
    return () => {
      disposed = true;
      instance?.destroy();
      if (cyRef.current === instance) cyRef.current = null;
    };
  }, [graph, visibleGraph]);

  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null;
  const resetView = () => { cyRef.current?.fit(undefined, 28); cyRef.current?.center(); };

  if (!graph && status === "loading") return <div className="research-workspace"><div className="workspace-state full"><LoaderCircle className="drawer-spinner" size={26} /><strong>Building evidence lineage</strong></div></div>;

  return <div className="research-workspace lineage-workspace">
    <header className="workspace-title-row">
      <div><p className="breadcrumb">Research workspace / Explainability</p><h1>Claim-to-Evidence Lineage</h1><p className="workspace-subtitle">Trace every company, source, passage, claim, event signal, and memo through the terminal&apos;s provenance model.</p></div>
      <button className="command-button" onClick={() => void load()}><RefreshCw size={15} /> Rebuild graph</button>
    </header>
    {error && <div className="builder-error"><AlertTriangle size={15} />{error}</div>}

    <section className="lineage-metrics">
      {(["companies", "sources", "evidence", "claims", "memos", "events"] as const).map((key) => <article key={key}><span>{key}</span><strong>{graph?.summary[key] ?? 0}</strong></article>)}
      <article className={graph?.summary.unsupported ? "warning" : ""}><span>unsupported</span><strong>{graph?.summary.unsupported ?? 0}</strong></article>
    </section>

    <div className="lineage-toolbar">
      <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter graph..." /></label>
      <Filter size={14} />
      <select aria-label="Filter lineage company" value={companyRoot} onChange={(event) => { setCompanyRoot(event.target.value); setSelectedId(event.target.value === "all" ? graph?.nodes[0]?.id ?? "" : `company:${event.target.value}`); }}>
        <option value="all">All companies</option>{graph?.nodes.filter((item) => item.kind === "company").map((item) => <option value={item.id.replace("company:", "")} key={item.id}>{item.label}</option>)}
      </select>
      <select aria-label="Filter lineage node type" value={kind} onChange={(event) => setKind(event.target.value as LineageNodeKind | "all")}><option value="all">All node types</option>{Object.keys(COLORS).map((item) => <option value={item} key={item}>{item}</option>)}</select>
      <div className="lineage-compliance"><button className={!complianceMode ? "active" : ""} onClick={() => setComplianceMode(false)}><ShieldOff size={13} />All paths</button><button className={complianceMode ? "active" : ""} onClick={() => setComplianceMode(true)}><ShieldCheck size={13} />Compliance</button></div>
      <button className="icon-button" onClick={resetView} title="Fit graph" aria-label="Fit graph"><GitBranch size={15} /></button>
      <span>{visibleGraph.nodes.length} nodes · {visibleGraph.edges.length} links</span>
    </div>

    <section className="lineage-layout">
      <div className="lineage-canvas-wrap">
        <div className="lineage-legend">{Object.entries(COLORS).map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</div>
        <div className="lineage-canvas" ref={containerRef} aria-label="Interactive evidence lineage graph" />
        {!visibleGraph.nodes.length && <div className="workspace-state lineage-no-results"><GitBranch size={23} /><strong>No paths match the current policy</strong><span>Broaden the node filter or leave compliance mode.</span></div>}
      </div>
      <aside className="panel lineage-detail">
        {selected ? <LineageDetail node={selected} graph={graph!} onSelect={setSelectedId} /> : <div className="workspace-state full"><GitBranch size={24} /><strong>Select a graph node</strong></div>}
      </aside>
    </section>
  </div>;
}

function LineageDetail({ node, graph, onSelect }: { node: LineageNode; graph: LineageGraph; onSelect: (id: string) => void }) {
  const connected = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).slice(0, 12).map((edge) => {
    const otherId = edge.source === node.id ? edge.target : edge.source;
    return { edge, node: graph.nodes.find((item) => item.id === otherId) };
  }).filter((item): item is { edge: LineageGraph["edges"][number]; node: LineageNode } => Boolean(item.node));
  return <>
    <div className="lineage-detail-heading"><span style={{ background: COLORS[node.kind] }}>{node.kind}</span><b className={node.compliant ? "compliant" : "unsupported"}>{node.compliant ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}{node.status}</b></div>
    <h2>{node.label}</h2>
    <p>{node.subtitle}</p>
    {node.score !== null && <div className="lineage-score"><span>Policy score</span><strong>{node.score}</strong><i><b style={{ width: `${Math.max(0, Math.min(100, node.score))}%` }} /></i></div>}
    <dl>{Object.entries(node.details).map(([key, value]) => <div key={key}><dt>{key.replaceAll(/([A-Z])/g, " $1")}</dt><dd>{String(value)}</dd></div>)}</dl>
    {node.url && (node.url.startsWith("/") ? <a className="command-button" href={node.url}>Open artifact</a> : <a className="command-button" href={node.url} target="_blank" rel="noreferrer">Open source <ExternalLink size={13} /></a>)}
    <div className="lineage-connections"><span>Connected paths</span>{connected.map(({ edge, node: related }) => <button key={edge.id} onClick={() => onSelect(related.id)}><i style={{ background: COLORS[related.kind] }} /><span><strong>{related.label}</strong><small>{edge.label}</small></span></button>)}</div>
  </>;
}
