"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpenText,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Layers3,
  LoaderCircle,
  Menu,
  Network,
  PanelLeftClose,
  PieChart,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertsWorkspace } from "@/app/components/alerts-workspace";
import { ComparisonWorkspace } from "@/app/components/comparison-workspace";
import { EvidenceWorkspace } from "@/app/components/evidence-workspace";
import secEvidenceCacheJson from "@/data/generated/sec-evidence.json";
import irEvidenceCacheJson from "@/data/generated/ir-evidence.json";
import type {
  EvidenceCache,
  EvidenceSignal,
  FilingComparison,
  SecEvidenceResponse,
  SecFilingDetail,
  SecFilingDetailResponse,
  SecRefreshStatus,
} from "@/lib/evidence/types";
import { baseFilingForm, getFilingComparisonMode } from "@/lib/evidence/compare";
import type { IrDocumentDetail, IrDocumentDetailResponse, IrEvidenceCache, IrEvidenceResponse, IrIngestionRun, IrIngestionSummary } from "@/lib/ir/types";

type Signal = EvidenceSignal;
type SecUiStatus = SecRefreshStatus | "refreshing";
type IrUiStatus = "fresh" | "cached" | "stale" | "refreshing";

type Evidence = {
  source: string;
  company: string;
  claim: string;
  age: string;
  score: number;
  signal: Signal;
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

type ResearchView = {
  recent: Array<{ title: string; source: string; age: string; sourceUrl?: string }>;
  companies: string[];
  bull: string;
  bear: string;
  confidence: number;
  quality: number;
  evidence: Evidence[];
  memoTitle: string;
};

const secEvidenceCache = secEvidenceCacheJson as unknown as EvidenceCache;
const irEvidenceCache = irEvidenceCacheJson as unknown as IrEvidenceCache;

function formatFilingDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatRefreshDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

const navItems = [
  { label: "AI Infra Map", icon: Network },
  { label: "Companies", icon: Building2 },
  { label: "Themes", icon: Layers3 },
  { label: "Evidence Feed", icon: FileText },
  { label: "Memos", icon: Sparkles },
  { label: "Alerts", icon: Bell },
  { label: "Sources", icon: Database },
];

const themeGroups = [
  { title: "Compute & Silicon", items: ["GPUs / Accelerators", "AI Servers / Racks", "Memory / HBM", "Foundry / Packaging"] },
  { title: "Cloud & Capacity", items: ["Hyperscalers", "Neoclouds", "Colocation / DC REITs", "Sovereign AI"] },
  { title: "Power & Electrical", items: ["Utilities / Generation", "Grid & Interconnect", "Power Equipment", "UPS / Batteries"] },
  { title: "Cooling & Facilities", items: ["Liquid Cooling", "Air Cooling", "Construction / EPC", "Land / Permitting"] },
  { title: "Networking", items: ["Ethernet / Switching", "InfiniBand / Fabrics", "Optical Networking", "Network Software"] },
  { title: "Physical AI", items: ["Edge Compute", "Sensors / Vision", "Robotics Platforms", "Actuators / Motion"] },
];

const liquidCoolingEvidence: Evidence[] = [
  { source: "SEC 10-Q", company: "Vertiv (VRT)", claim: "Liquid cooling backlog growth", age: "2h ago", score: 85, signal: "positive" },
  { source: "Earnings Call", company: "Super Micro (SMCI)", claim: "Liquid cooling demand outlook", age: "6h ago", score: 78, signal: "positive" },
  { source: "Press Release", company: "Schneider Electric", claim: "CDU product launch", age: "9h ago", score: 74, signal: "positive" },
  { source: "SEC 10-Q", company: "CoolIT Systems", claim: "Revenue growth drivers", age: "1d ago", score: 70, signal: "positive" },
  { source: "EIA", company: "Market wide", claim: "Industrial electricity demand outlook", age: "1d ago", score: 68, signal: "neutral" },
  { source: "Earnings Call", company: "Vertiv (VRT)", claim: "2026 capex commentary", age: "2d ago", score: 66, signal: "positive" },
  { source: "Press Release", company: "Danfoss", claim: "Partnership with data center OEM", age: "2d ago", score: 64, signal: "watch" },
  { source: "SEC 10-K", company: "NVIDIA (NVDA)", claim: "DGX platform thermal architecture", age: "3d ago", score: 62, signal: "watch" },
];

function createNeocloudResearchView(cache: EvidenceCache, irCache: IrEvidenceCache): ResearchView {
  const secEvidence: Evidence[] = cache.filings.map((filing) => ({
    source: `SEC ${filing.formType}`,
    company: `${filing.companyName} (${filing.ticker})`,
    claim: filing.summary,
    age: formatFilingDate(filing.filedAt),
    score: filing.sourceQuality,
    signal: filing.signal,
    sourceUrl: filing.sourceUrl,
    accessionNumber: filing.accessionNumber,
    cik: filing.cik,
    primaryDocument: filing.primaryDocument,
    formType: filing.formType,
    filedAt: filing.filedAt,
    isLive: true,
    canExtract: true,
    detailKind: "sec",
  }));
  const irEvidence: Evidence[] = irCache.documents.map((document) => ({
    source: document.documentType,
    company: `${document.companyName} (${document.ticker})`,
    claim: document.title,
    age: formatFilingDate(document.publishedAt),
    score: document.sourceQuality,
    signal: document.signal,
    sourceUrl: document.sourceUrl,
    accessionNumber: document.id,
    documentId: document.id,
    filedAt: document.publishedAt,
    isLive: true,
    canExtract: true,
    detailKind: "ir",
  }));
  const evidence = [...secEvidence, ...irEvidence].sort((left, right) => (right.filedAt ?? "").localeCompare(left.filedAt ?? ""));
  const recent = evidence.slice(0, 3).map((item) => ({ title: item.claim, source: item.source, age: item.age, sourceUrl: item.sourceUrl }));

  return {
    recent,
    companies: ["CoreWeave", "Nebius", "Lambda", "Crusoe", "Fluidstack", "Nscale", "RunPod", "Applied Digital"],
    bull: "AI-native clouds can win with faster accelerator access, purpose-built clusters, and software tuned for large training and inference workloads.",
    bear: "Capital intensity, customer concentration, financing costs, utilization risk, and hyperscaler competition can pressure returns on new capacity.",
    confidence: 74,
    quality: 71,
    evidence,
    memoTitle: "Compare CoreWeave vs Nebius",
  };
}

const researchViews: Record<string, ResearchView> = {
  "Liquid Cooling": {
    recent: [
      { title: "Vertiv launches next-gen CDU supporting 1.4MW+ racks", source: "Press Release", age: "2h ago" },
      { title: "Supermicro discusses liquid cooling demand on earnings call", source: "Earnings Call", age: "6h ago" },
      { title: "Microsoft data center liquid cooling patent published", source: "USPTO", age: "1d ago" },
    ],
    companies: ["Vertiv", "Super Micro", "CoolIT", "Schneider Electric", "Danfoss", "NVIDIA", "STULZ", "Iceotope"],
    bull: "Rising rack densities make liquid cooling necessary for performance, reliability, and efficiency at scale.",
    bear: "Adoption could be slower than expected as air cooling improves and deployment costs remain high.",
    confidence: 72,
    quality: 68,
    evidence: liquidCoolingEvidence,
    memoTitle: "Compare Vertiv vs Super Micro",
  },
};

function createDefaultResearchView(theme: string): ResearchView {
  return {
    recent: [
      { title: `New filing adds evidence to the ${theme} outlook`, source: "SEC Filing", age: "2h ago" },
      { title: `Management commentary updates demand expectations`, source: "Earnings Call", age: "8h ago" },
      { title: `Supply-chain update changes near-term capacity view`, source: "Industry Update", age: "1d ago" },
    ],
    companies: ["NVIDIA", "Broadcom", "Vertiv", "Arista", "Eaton", "Dell", "Oracle", "Equinix"],
    bull: `${theme} is positioned to benefit from sustained AI infrastructure spending and increasingly specialized deployment requirements.`,
    bear: `Capacity cycles, customer concentration, execution risk, and rapid technology changes may limit durable returns in ${theme}.`,
    confidence: 67,
    quality: 64,
    evidence: liquidCoolingEvidence,
    memoTitle: `Compare leading ${theme} exposures`,
  };
}

function findPreviousFiling(evidence: Evidence, cache: EvidenceCache) {
  const { cik, filedAt, formType } = evidence;
  if (!cik || !filedAt || !formType) return null;
  if (getFilingComparisonMode(formType) === "event") return null;
  const baseForm = baseFilingForm(formType);
  return cache.filings
    .filter((filing) =>
      filing.cik === cik &&
      baseFilingForm(filing.formType) === baseForm &&
      getFilingComparisonMode(filing.formType) !== "amendment" &&
      filing.filedAt < filedAt,
    )
    .sort((left, right) => right.filedAt.localeCompare(left.filedAt))[0] ?? null;
}

const memoSections = [
  { icon: FileText, title: "Summary", description: "Key takeaways and current positioning.", count: 6, sources: ["SEC 10-Q", "Earnings Call", "Press Release"] },
  { icon: Activity, title: "Evidence-backed claims", description: "Side-by-side claims with citations.", count: 18, sources: ["SEC 10-Q", "Earnings Call", "Press Release"] },
  { icon: AlertTriangle, title: "Risks", description: "Key risks for each company.", count: 8, sources: ["Earnings Call", "SEC Filings"] },
  { icon: Zap, title: "Catalysts", description: "Near- and mid-term catalysts.", count: 6, sources: ["Press Release", "EIA"] },
  { icon: CircleHelp, title: "Unanswered questions", description: "Open questions to monitor.", count: 9, sources: ["Expert Interview", "Web Search"] },
];

function ScoreGauge({ score, label }: { score: number; label: string }) {
  return (
    <div className="score-block">
      <p className="eyebrow">{label}</p>
      <div className="gauge" style={{ "--score": `${score * 1.8}deg` } as React.CSSProperties}>
        <div><strong>{score}</strong><span>/100</span></div>
      </div>
      <span className="score-label">{score >= 70 ? "High" : "Good"}</span>
    </div>
  );
}

function AppLogo() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export default function Home() {
  const [selectedTheme, setSelectedTheme] = useState("Neoclouds");
  const [activeTab, setActiveTab] = useState("Overview");
  const [activeNav, setActiveNav] = useState("AI Infra Map");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All sources");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedMemo, setExpandedMemo] = useState<string | null>(null);
  const [liveSecCache, setLiveSecCache] = useState(secEvidenceCache);
  const [liveIrCache, setLiveIrCache] = useState(irEvidenceCache);
  const [secRefreshStatus, setSecRefreshStatus] = useState<SecUiStatus>("refreshing");
  const [irRefreshStatus, setIrRefreshStatus] = useState<IrUiStatus>("refreshing");
  const [irIngestionSummary, setIrIngestionSummary] = useState<IrIngestionSummary | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [filingDetail, setFilingDetail] = useState<SecFilingDetail | null>(null);
  const [irDocumentDetail, setIrDocumentDetail] = useState<IrDocumentDetail | null>(null);
  const [filingComparison, setFilingComparison] = useState<FilingComparison | null>(null);
  const [detailPersistence, setDetailPersistence] = useState<"postgres" | "memory">("memory");
  const [detailTab, setDetailTab] = useState<"evidence" | "changes">("evidence");
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailError, setDetailError] = useState("");
  const [copiedPassage, setCopiedPassage] = useState<string | null>(null);
  const [unreadAlertCount, setUnreadAlertCount] = useState(0);
  const detailRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function refreshOnLoad() {
      try {
        const response = await fetch("/api/sec-evidence", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("SEC refresh request failed");
        }

        const result = (await response.json()) as SecEvidenceResponse;
        setLiveSecCache(result.cache);
        setSecRefreshStatus(result.refresh.status);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setSecRefreshStatus("stale");
      }
    }

    void refreshOnLoad();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ir-evidence", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("IR refresh request failed");
        return await response.json() as IrEvidenceResponse;
      })
      .then(async (result) => {
        setLiveIrCache(result.cache);
        setIrRefreshStatus(result.refresh.status);
        if (result.ingestion) setIrIngestionSummary(result.ingestion);
        try {
          const queueResponse = await fetch("/api/ir-ingestion", { method: "POST", cache: "no-store", signal: controller.signal });
          if (queueResponse.ok) {
            const queueResult = await queueResponse.json() as IrIngestionRun;
            setIrIngestionSummary(queueResult.summary);
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) return;
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setIrRefreshStatus("stale");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => () => detailRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/alerts?status=unread", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (result?.summary) setUnreadAlertCount(result.summary.unread);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const researchView = useMemo(
    () => selectedTheme === "Neoclouds"
      ? createNeocloudResearchView(liveSecCache, liveIrCache)
      : researchViews[selectedTheme] ?? createDefaultResearchView(selectedTheme),
    [liveIrCache, liveSecCache, selectedTheme],
  );

  const metrics = useMemo(() => [
    {
      label: "Real source documents",
      value: String(liveSecCache.filings.length + liveIrCache.documents.length),
      change: secRefreshStatus === "refreshing"
        ? "Refreshing on page load"
        : `${liveSecCache.filings.length} SEC + ${liveIrCache.documents.length} IR`,
      icon: FileText,
      tone: "positive",
    },
    { label: "Open thesis questions", value: "47", change: "5 vs yesterday", icon: CircleHelp, tone: "negative" },
    { label: "Thesis alerts", value: String(unreadAlertCount), change: "Evidence-backed", icon: Bell, tone: "positive" },
    { label: "Source coverage", value: "82%", change: "4pp vs yesterday", icon: PieChart, tone: "positive" },
  ], [liveIrCache, liveSecCache, secRefreshStatus, unreadAlertCount]);

  const ingestion = useMemo(() => [
    {
      name: "SEC Filings",
      detail: `${liveSecCache.filings.length} filings`,
      time: formatRefreshDate(liveSecCache.generatedAt),
      status: secRefreshStatus === "refreshing"
        ? "Refreshing"
        : secRefreshStatus === "fresh"
          ? "Live"
          : secRefreshStatus === "cached"
            ? "Cached"
            : "Stale cache",
      connected: secRefreshStatus === "fresh" || secRefreshStatus === "cached",
    },
    {
      name: "IR Pages",
      detail: irIngestionSummary
        ? [
            `${irIngestionSummary.completed} extracted`,
            `${irIngestionSummary.pending} queued`,
            irIngestionSummary.processing ? `${irIngestionSummary.processing} running` : null,
            irIngestionSummary.failed ? `${irIngestionSummary.failed} failed` : null,
          ].filter(Boolean).join(" · ")
        : `${liveIrCache.documents.length} documents`,
      time: formatRefreshDate(liveIrCache.generatedAt),
      status: irRefreshStatus === "refreshing" ? "Refreshing" : irRefreshStatus === "fresh" ? "Live" : irRefreshStatus === "cached" ? "Cached" : "Stale cache",
      connected: irRefreshStatus === "fresh" || irRefreshStatus === "cached",
    },
    { name: "GDELT News", detail: "Not connected", time: "Planned", status: "Mock", connected: false },
    { name: "EIA Power Data", detail: "Not connected", time: "Planned", status: "Mock", connected: false },
    { name: "Manual Notes", detail: "12 mock notes", time: "Local", status: "Mock", connected: false },
  ], [irIngestionSummary, irRefreshStatus, liveIrCache, liveSecCache, secRefreshStatus]);

  const liveStatusLabel = secRefreshStatus === "refreshing"
    ? "Refreshing SEC"
    : secRefreshStatus === "fresh"
      ? "SEC refreshed"
      : secRefreshStatus === "cached"
        ? "SEC cache current"
        : "Using cached SEC";

  const filteredEvidence = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return researchView.evidence.filter((row) => {
      const matchesQuery = !normalized || Object.values(row).join(" ").toLowerCase().includes(normalized);
      const matchesSource = sourceFilter === "All sources" || row.source === sourceFilter;
      return matchesQuery && matchesSource;
    });
  }, [query, researchView, sourceFilter]);

  const sourceOptions = useMemo(
    () => ["All sources", ...Array.from(new Set(researchView.evidence.map((row) => row.source)))],
    [researchView],
  );

  const selectTheme = (theme: string) => {
    setSelectedTheme(theme);
    setActiveTab("Overview");
    setSourceFilter("All sources");
    setToast(`${theme} research view loaded`);
    window.setTimeout(() => setToast(null), 2200);
  };

  const closeEvidenceDetail = () => {
    detailRequest.current?.abort();
    setSelectedEvidence(null);
    setFilingDetail(null);
    setIrDocumentDetail(null);
    setFilingComparison(null);
    setDetailStatus("idle");
    setDetailError("");
  };

  const openEvidenceDetail = async (evidence: Evidence) => {
    if (!evidence.detailKind) {
      setToast("Detailed extraction is unavailable for this source");
      window.setTimeout(() => setToast(null), 2200);
      return;
    }

    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setSelectedEvidence(evidence);
    setFilingDetail(null);
    setIrDocumentDetail(null);
    setFilingComparison(null);
    setDetailTab("evidence");
    setDetailError("");
    setDetailStatus("loading");

    if (evidence.detailKind === "ir") {
      if (!evidence.documentId) {
        setDetailError("This IR document is missing its evidence identifier.");
        setDetailStatus("error");
        return;
      }
      try {
        const response = await fetch(`/api/ir-document-detail?id=${encodeURIComponent(evidence.documentId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = (await response.json()) as IrDocumentDetailResponse | { error: string };
        if (!response.ok || !("detail" in result)) {
          throw new Error("error" in result ? result.error : "Unable to extract this IR document");
        }
        setIrDocumentDetail(result.detail);
        setDetailPersistence(result.persistence);
        setDetailStatus("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDetailError(error instanceof Error ? error.message : "Unable to extract this IR document");
        setDetailStatus("error");
      }
      return;
    }

    if (!evidence.cik || !evidence.accessionNumber || !evidence.primaryDocument || !evidence.formType || !evidence.filedAt) {
      setDetailError("This SEC filing is missing extraction metadata.");
      setDetailStatus("error");
      return;
    }

    const params = new URLSearchParams({
      cik: evidence.cik,
      accession: evidence.accessionNumber,
      document: evidence.primaryDocument,
      form: evidence.formType,
      filedAt: evidence.filedAt,
    });
    const previous = findPreviousFiling(evidence, liveSecCache);
    if (previous) {
      params.set("previouscik", previous.cik);
      params.set("previousaccession", previous.accessionNumber);
      params.set("previousdocument", previous.primaryDocument);
      params.set("previousform", previous.formType);
      params.set("previousfiledAt", previous.filedAt);
    }

    try {
      const response = await fetch(`/api/sec-filing-detail?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const result = (await response.json()) as SecFilingDetailResponse | { error: string };
      if (!response.ok || !("detail" in result)) {
        throw new Error("error" in result ? result.error : "Unable to extract this filing");
      }
      setFilingDetail(result.detail);
      setFilingComparison(result.comparison);
      setDetailPersistence(result.persistence);
      setDetailStatus("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDetailError(error instanceof Error ? error.message : "Unable to extract this filing");
      setDetailStatus("error");
    }
  };

  const copyPassage = async (passageId: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedPassage(passageId);
    window.setTimeout(() => setCopiedPassage(null), 1800);
  };

  const openAlertFiling = (filingId: string) => {
    const filing = liveSecCache.filings.find((candidate) => candidate.id === filingId);
    if (!filing) {
      setToast("This filing is outside the current evidence window");
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    void openEvidenceDetail({
      source: `SEC ${filing.formType}`,
      company: `${filing.companyName} (${filing.ticker})`,
      claim: filing.summary,
      age: formatFilingDate(filing.filedAt),
      score: filing.sourceQuality,
      signal: filing.signal,
      sourceUrl: filing.sourceUrl,
      accessionNumber: filing.accessionNumber,
      cik: filing.cik,
      primaryDocument: filing.primaryDocument,
      formType: filing.formType,
      filedAt: filing.filedAt,
      isLive: true,
      canExtract: true,
      detailKind: "sec",
    });
  };

  const documentDetail = filingDetail ?? irDocumentDetail;
  const documentDate = filingDetail?.filedAt ?? irDocumentDetail?.publishedAt;
  const documentType = filingDetail?.formType ?? irDocumentDetail?.documentType;

  return (
    <main className="terminal-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <AppLogo />
          <span>AI Infrastructure<br />Terminal</span>
          <button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                className={`nav-item ${activeNav === item.label ? "active" : ""}`}
                onClick={() => { setActiveNav(item.label); setSidebarOpen(false); setToast(`${item.label} selected`); window.setTimeout(() => setToast(null), 1800); }}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.label === "Alerts" && unreadAlertCount > 0 && <b>{unreadAlertCount > 99 ? "99+" : unreadAlertCount}</b>}
              </button>
            );
          })}
        </nav>
        <button className="collapse-button" onClick={() => setSidebarOpen(false)}>
          <PanelLeftClose size={17} />
          <span>Collapse</span>
        </button>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <label className="global-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies, themes, claims, filings..." />
            {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}
          </label>
          <div className="header-actions">
            <button className="command-button" onClick={() => setActiveNav("Memos")}><Plus size={16} /> <span>New Memo</span></button>
            <button className="command-button" onClick={() => { setToast("Watchlist updated"); window.setTimeout(() => setToast(null), 1800); }}><Star size={16} /> <span>Watchlist</span></button>
            <button className="avatar" aria-label="Open profile menu">TW</button>
            <ChevronDown size={15} className="profile-chevron" />
          </div>
        </header>

        {activeNav === "Alerts" ? (
          <AlertsWorkspace onOpenFiling={openAlertFiling} onUnreadChange={setUnreadAlertCount} />
        ) : activeNav === "Evidence Feed" ? (
          <EvidenceWorkspace onBuildComparison={() => setActiveNav("Memos")} />
        ) : activeNav === "Memos" ? (
          <ComparisonWorkspace onReviewEvidence={() => setActiveNav("Evidence Feed")} />
        ) : (
        <div className="dashboard">
          <div className="title-row">
            <div>
              <p className="breadcrumb">Research workspace / Infrastructure</p>
              <h1>AI Infrastructure Map</h1>
            </div>
            <div className={`live-status ${secRefreshStatus}`} data-refresh-status={secRefreshStatus}>
              <span /> {liveStatusLabel}
            </div>
          </div>

          <section className="metrics-grid" aria-label="Research metrics">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <article className="metric-card" key={metric.label}>
                  <div className="metric-icon"><Icon size={23} strokeWidth={1.6} /></div>
                  <div><p>{metric.label}</p><strong>{metric.value}</strong><span className={metric.tone}>{metric.tone === "negative" ? "↓" : "↑"} {metric.change}</span></div>
                </article>
              );
            })}
          </section>

          <section className="primary-grid">
            <article className="panel themes-panel">
              <div className="panel-heading"><div><span className="section-kicker">Market structure</span><h2>Infrastructure Themes</h2></div><button className="icon-button" aria-label="Theme map help"><CircleHelp size={16} /></button></div>
              <div className="theme-map">
                <div className="map-origin"><div className="chip-icon"><Activity size={17} /></div><span>AI<br />Infrastructure</span></div>
                <div className="theme-grid">
                  {themeGroups.map((group) => (
                    <div className="theme-group" key={group.title}>
                      <h3>{group.title}</h3>
                      <div className="theme-list">
                        {group.items.map((theme) => (
                          <button key={theme} className={selectedTheme === theme ? "selected" : ""} onClick={() => selectTheme(theme)}>{theme}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="map-legend"><span><i className="line primary" /> Primary dependency</span><span><i className="line secondary" /> Adjacent exposure</span><span className="selected-label">Selected: {selectedTheme}</span></div>
            </article>

            <article className="panel research-panel">
              <div className="research-header">
                <div><span className="section-kicker">Selected theme</span><h2>{selectedTheme}</h2></div>
                <span className="theme-badge">Theme</span>
              </div>
              <div className="tabs" role="tablist" aria-label={`${selectedTheme} research sections`}>
                {["Overview", "Evidence", "Companies", "Memos", "Questions"].map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>)}
              </div>
              <div className="research-content">
                {activeTab === "Overview" ? (
                  <>
                    <div className="recent-column">
                      <h3>Recent evidence</h3>
                      {researchView.recent.map((item) => item.sourceUrl ? (
                        <a className="evidence-item" href={item.sourceUrl} key={item.title} target="_blank" rel="noreferrer"><FileText size={16} /><span><strong>{item.title}</strong><em>{item.source}</em></span><time>{item.age}</time><ExternalLink className="source-external" size={12} /></a>
                      ) : (
                        <button className="evidence-item" key={item.title}><FileText size={16} /><span><strong>{item.title}</strong><em>{item.source}</em></span><time>{item.age}</time></button>
                      ))}
                      <button className="text-link">View all evidence <ChevronRight size={15} /></button>
                    </div>
                    <div className="thesis-column">
                      <h3>Key companies</h3>
                      <div className="company-tags">{researchView.companies.map((company) => <button key={company}>{company}</button>)}</div>
                      <div className="thesis-copy"><h3>Bull thesis</h3><p>{researchView.bull}</p><h3>Bear thesis</h3><p>{researchView.bear}</p></div>
                    </div>
                    <div className="scores-column"><ScoreGauge score={researchView.confidence} label="Confidence score" /><ScoreGauge score={researchView.quality} label="Evidence quality" /><button className="text-link">Methodology <ChevronRight size={14} /></button></div>
                  </>
                ) : (
                  <div className="tab-placeholder">
                    <span className="tab-icon"><Layers3 size={22} /></span>
                    <h3>{activeTab} for {selectedTheme}</h3>
                    <p>Additional research content is organized here. SEC filings and official investor-relations documents are connected to the evidence workspace.</p>
                    <button onClick={() => setActiveTab("Overview")}>Return to overview</button>
                  </div>
                )}
              </div>
            </article>
          </section>

          <section className="secondary-grid">
            <article className="panel evidence-panel">
              <div className="panel-heading compact"><div className="heading-with-count"><h2>Evidence Feed</h2><span>{filteredEvidence.length}</span></div><div className="table-actions"><select aria-label="Filter evidence source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>{sourceOptions.map((source) => <option key={source}>{source}</option>)}</select><button className="text-link" onClick={() => setActiveNav("Evidence Feed")}>View all <ChevronRight size={14} /></button></div></div>
              <div className="evidence-table-wrap">
                <table className="evidence-table">
                  <colgroup>
                    <col className="source-column" />
                    <col className="company-column" />
                    <col className="claim-column" />
                    <col className="recency-column" />
                    <col className="score-column" />
                  </colgroup>
                  <thead><tr><th>Source</th><th>Company</th><th>Claim impacted</th><th>Recency</th><th>Evidence score</th></tr></thead>
                  <tbody>
                    {filteredEvidence.map((row, index) => (
                      <tr
                        key={row.accessionNumber ?? `${row.company}-${index}`}
                        className={row.canExtract ? "evidence-row actionable" : "evidence-row"}
                        tabIndex={row.canExtract ? 0 : undefined}
                        onClick={row.canExtract ? () => void openEvidenceDetail(row) : undefined}
                        onKeyDown={(event) => {
                          if (row.canExtract && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            void openEvidenceDetail(row);
                          }
                        }}
                      >
                        <td>
                          <div className="source-cell">
                            {row.sourceUrl ? (
                              <a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer" title={`Open ${row.source} source`} onClick={(event) => event.stopPropagation()}>
                                <FileText size={14} />
                                <span className="source-name">{row.source}</span>
                                {row.isLive && <span className="live-source">Real</span>}
                                <ExternalLink size={11} />
                              </a>
                            ) : <><FileText size={14} /><span className="source-name">{row.source}</span></>}
                          </div>
                        </td>
                        <td title={row.company}>{row.company}</td>
                        <td title={row.claim}>{row.claim}</td>
                        <td>{row.age}</td>
                        <td><div className="evidence-score"><strong>{row.score}</strong><span className="score-bar"><i className={row.signal} style={{ width: `${row.score}%` }} /></span></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredEvidence.length && <div className="empty-state"><Search size={19} /><span>No evidence matches this search.</span><button onClick={() => { setQuery(""); setSourceFilter("All sources"); }}>Clear filters</button></div>}
              </div>
              <button className="footer-link" onClick={() => setActiveNav("Evidence Feed")}>View all evidence feed <ChevronRight size={15} /></button>
            </article>

            <article className="panel memo-panel">
              <div className="panel-heading compact"><div className="heading-with-count"><h2>Memo Workspace</h2><span>3</span></div><button className="command-button small" onClick={() => setActiveNav("Memos")}>Open in editor <ChevronRight size={14} /></button></div>
              <div className="memo-title"><div><h3>{researchView.memoTitle}</h3><p>Last updated: 1h ago</p></div><div><span>Sources: 23</span><span>Evidence items: 47</span><button className="icon-button" aria-label="Save memo"><Star size={15} /></button></div></div>
              <div className="memo-sections">
                {memoSections.map((section) => {
                  const Icon = section.icon;
                  const open = expandedMemo === section.title;
                  return (
                    <button key={section.title} className={`memo-row ${open ? "expanded" : ""}`} onClick={() => setExpandedMemo(open ? null : section.title)}>
                      <Icon size={17} /><strong>{section.title}</strong><span className="memo-description">{section.description}</span><span className="source-tags">{section.sources.map((source) => <em key={source}>{source}</em>)}</span><b>{section.count}</b><ChevronRight size={15} />
                      {open && <p className="memo-preview">Current mock conclusion: evidence is directionally supportive, but the durability of demand and execution risk should remain explicit in the final memo.</p>}
                    </button>
                  );
                })}
              </div>
              <button className="add-section"><Plus size={15} /> Add section</button>
            </article>
          </section>
        </div>
        )}

        <footer className="ingestion-bar">
          <div className="ingestion-title"><strong>Ingestion Status</strong><CircleHelp size={14} /></div>
          {ingestion.map((item) => <div className="ingestion-item" key={item.name}><div><strong>{item.name}</strong><span>Last run: {item.time}</span><span>{item.detail}</span></div><span className={item.connected ? "success-dot" : "success-dot status-pending"}>{item.connected ? <ShieldCheck size={15} /> : <CircleHelp size={15} />}{item.status}</span></div>)}
          <button>View Ingestion Dashboard <ChevronRight size={15} /></button>
        </footer>
      </section>

      {toast && <div className="toast"><span><ShieldCheck size={16} /></span>{toast}</div>}

      {selectedEvidence && (
        <div className="evidence-drawer-layer" role="presentation" onMouseDown={closeEvidenceDetail}>
          <aside
            className="evidence-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-detail-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="drawer-header">
              <div>
                <span className="section-kicker">Source document</span>
                <h2 id="evidence-detail-title">{selectedEvidence.company}</h2>
                <p>{selectedEvidence.source} · {selectedEvidence.age}</p>
              </div>
              <button className="icon-button drawer-close" onClick={closeEvidenceDetail} aria-label="Close evidence detail" title="Close evidence detail"><X size={18} /></button>
            </header>

            {detailStatus === "loading" && (
              <div className="drawer-state">
                <LoaderCircle className="drawer-spinner" size={25} />
                <strong>Extracting source evidence</strong>
                <p>Reading the source document and identifying citation-ready research passages.</p>
              </div>
            )}

            {detailStatus === "error" && (
              <div className="drawer-state error">
                <AlertTriangle size={24} />
                <strong>Extraction unavailable</strong>
                <p>{detailError}</p>
                <button className="command-button" onClick={() => void openEvidenceDetail(selectedEvidence)}>Try again</button>
              </div>
            )}

            {detailStatus === "ready" && documentDetail && documentDate && documentType && (
              <div className="drawer-body">
                <section className="filing-summary">
                  <div><span>{irDocumentDetail ? "Published" : "Filed"}</span><strong>{formatFilingDate(documentDate)}</strong></div>
                  <div><span>{irDocumentDetail ? "Document" : "Form"}</span><strong>{documentType}</strong></div>
                  <div><span>{irDocumentDetail?.pageCount ? "Pages / words" : "Words scanned"}</span><strong>{irDocumentDetail?.pageCount ? `${irDocumentDetail.pageCount} / ${documentDetail.wordCount.toLocaleString()}` : documentDetail.wordCount.toLocaleString()}</strong></div>
                  <div><span>Extraction</span><strong className={`quality-${documentDetail.extraction.quality}`}>{documentDetail.extraction.quality}</strong></div>
                </section>

                <div className="extraction-note"><ShieldCheck size={15} /><span>{documentDetail.extraction.message} {detailPersistence === "postgres" ? "Saved to Postgres." : "Using the session cache."}</span></div>

                {filingDetail && <div className="drawer-tabs" role="tablist" aria-label="Filing detail views">
                  <button role="tab" aria-selected={detailTab === "evidence"} className={detailTab === "evidence" ? "active" : ""} onClick={() => setDetailTab("evidence")}>
                    Evidence <span>{filingDetail.sections.reduce((total, section) => total + section.passages.length, 0)}</span>
                  </button>
                  <button role="tab" aria-selected={detailTab === "changes"} className={detailTab === "changes" ? "active" : ""} onClick={() => setDetailTab("changes")}>
                    {getFilingComparisonMode(filingDetail.formType) === "event"
                      ? "Event signals"
                      : getFilingComparisonMode(filingDetail.formType) === "amendment"
                        ? "Changes from base filing"
                        : "Changes since prior period"} <span>{filingComparison ? Object.values(filingComparison.counts).reduce((total, count) => total + count, 0) : 0}</span>
                  </button>
                </div>}

                {(irDocumentDetail || detailTab === "evidence") && documentDetail.sections.length > 0 ? (
                  <div className="filing-sections">
                    {documentDetail.sections.map((section) => (
                      <section className="filing-section" key={section.id}>
                        <div className="filing-section-heading"><span>{section.category}</span><h3>{section.title}</h3></div>
                        {section.passages.map((passage) => (
                          <article className="evidence-passage" key={passage.id}>
                            <BookOpenText size={16} />
                            <p>{passage.text}</p>
                            <div>
                              <span className="passage-meta">
                                {passage.pageNumber && <a href={`${selectedEvidence.sourceUrl}#page=${passage.pageNumber}`} target="_blank" rel="noreferrer">Page {passage.pageNumber} <ExternalLink size={10} /></a>}
                                <span>{passage.wordCount} words</span>
                              </span>
                              <button className="icon-button" onClick={() => void copyPassage(passage.id, passage.text)} aria-label="Copy evidence passage" title="Copy evidence passage">
                                {copiedPassage === passage.id ? <ShieldCheck size={15} /> : <Copy size={15} />}
                              </button>
                            </div>
                          </article>
                        ))}
                      </section>
                    ))}
                  </div>
                ) : irDocumentDetail || detailTab === "evidence" ? (
                  <div className="drawer-state compact"><CircleHelp size={22} /><strong>No narrative sections found</strong><p>This document may primarily contain exhibits or structured tables.</p></div>
                ) : filingComparison ? (
                  <div className="filing-changes">
                    <div className="comparison-summary">
                      <div>
                        <span>{filingComparison.previousFiling ? "Compared with" : "Comparison policy"}</span>
                        <strong>{filingComparison.previousFiling
                          ? `${filingComparison.previousFiling.formType} · ${formatFilingDate(filingComparison.previousFiling.filedAt)}`
                          : filingComparison.policyLabel}</strong>
                      </div>
                      <div className="change-counts">
                        {filingComparison.mode === "event" ? (
                          <span className="new-event">{filingComparison.counts.new_event} new event</span>
                        ) : (
                          <>
                            <span className="added">+{filingComparison.counts.added} added</span>
                            <span className="modified">{filingComparison.counts.modified} changed</span>
                            <span className="not-repeated">{filingComparison.counts.not_repeated} not repeated</span>
                            {filingComparison.counts.explicitly_removed > 0 && <span className="explicitly-removed">{filingComparison.counts.explicitly_removed} explicit removal</span>}
                          </>
                        )}
                      </div>
                      {filingComparison.previousFiling
                        ? <a href={filingComparison.previousFiling.sourceUrl} target="_blank" rel="noreferrer" title="Open prior filing"><ExternalLink size={14} /></a>
                        : <span aria-hidden="true" />}
                    </div>
                    {filingComparison.changes.length > 0 ? filingComparison.changes.map((change) => (
                      <article className="filing-change" key={change.id}>
                        <div className="change-heading">
                          <span className={`change-type ${change.type}`}>{change.type.replaceAll("_", " ")}</span>
                          <span className={`change-significance ${change.significance}`}>{change.significance}</span>
                          {change.relevanceScore !== null && <span className="change-relevance">R {change.relevanceScore}</span>}
                          {change.similarity !== null && <span className="change-similarity">{change.similarity}% overlap</span>}
                        </div>
                        <span className="change-category">{change.category}{change.eventCode ? ` · Item ${change.eventCode}` : ""}</span>
                        <h3>{change.eventType ?? change.sectionTitle}</h3>
                        <p>{change.relevanceReason ?? change.summary}</p>
                        <details>
                          <summary>Review source excerpts</summary>
                          {change.currentText && <div><strong>Current filing</strong><p>{change.currentText}</p></div>}
                          {change.previousText && <div><strong>Prior filing</strong><p>{change.previousText}</p></div>}
                        </details>
                      </article>
                    )) : <div className="drawer-state compact"><ShieldCheck size={22} /><strong>No material language changes</strong><p>The extracted passages closely match the prior filing.</p></div>}
                  </div>
                ) : (
                  <div className="drawer-state compact"><CircleHelp size={22} /><strong>No comparable prior filing</strong><p>Recurring-section comparison begins after an earlier base filing is available.</p></div>
                )}
              </div>
            )}

            <footer className="drawer-footer">
              <span>{selectedEvidence.documentId ?? selectedEvidence.accessionNumber}</span>
              <a href={selectedEvidence.sourceUrl} target="_blank" rel="noreferrer">Open original document <ExternalLink size={14} /></a>
            </footer>
          </aside>
        </div>
      )}

    </main>
  );
}
