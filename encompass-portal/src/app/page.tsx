"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  FileText,
  DollarSign,
  User,
  X,
  ChevronUp,
  ChevronDown,
  Sparkles,
  BarChart3,
  Clock,
  MessageSquare,
} from "lucide-react";
import {
  getPipelineCache,
  setPipelineCache,
  isPipelineFresh,
  getConnectedStatus,
  setConnectedStatus,
} from "@/lib/pipeline-store";

interface PipelineRow {
  loanGuid: string;
  fields: Record<string, string>;
}

interface FilterOptions {
  milestones: string[];
  los: string[];
  states: string[];
  purposes: string[];
  locks: string[];
  programs: string[];
}

interface PipelineResponse {
  rows: PipelineRow[];
  total: number;
  totalVolume: number;
  page: number;
  pageSize: number;
  cacheAge: number;
  filterOptions: FilterOptions;
  _warming?: boolean;
  _loadedSoFar?: number;
}

type SortDir = "asc" | "desc";
type SortKey =
  | "loanNumber"
  | "borrower"
  | "amount"
  | "milestone"
  | "lo"
  | "modified"
  | "rate"
  | "property"
  | "closingDate"
  | "appDate";

const formatCurrency = (val: string | undefined) => {
  if (!val) return "--";
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};

const formatDate = (val: string | undefined) => {
  if (!val) return "--";
  try {
    return new Date(val).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return val;
  }
};

const getStatusColor = (status: string | undefined) => {
  if (!status) return "bg-gray-100 text-gray-600 border border-gray-200";
  const s = status.toLowerCase();
  if (s.includes("funded") || s.includes("closed") || s.includes("reconciled") || s.includes("purchased") || s.includes("shipping"))
    return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (s.includes("approved") || s.includes("approval") || s.includes("docs out"))
    return "bg-blue-50 text-blue-700 border border-blue-200";
  if (s.includes("review") || s.includes("processing") || s.includes("submission") || s.includes("packaging") || s.includes("qualification"))
    return "bg-amber-50 text-amber-700 border border-amber-200";
  if (s.includes("suspended") || s.includes("adverse") || s.includes("denied"))
    return "bg-red-50 text-red-700 border border-red-200";
  return "bg-gray-100 text-gray-600 border border-gray-200";
};

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronUp className="w-3 h-3 text-transparent" />;
  return dir === "asc" ? (
    <ChevronUp className="w-3 h-3 text-[var(--accent)]" />
  ) : (
    <ChevronDown className="w-3 h-3 text-[var(--accent)]" />
  );
}

// Helper to read a pipeline field with Field ID fallback
const pf = (f: Record<string, string>, canonical: string, fieldId?: string) =>
  f[canonical] || (fieldId ? f[`Fields.${fieldId}`] : "") || "";

const formatCacheAge = (ms: number) => {
  if (ms <= 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `${min} min ago`;
};

export default function PipelinePage() {
  const router = useRouter();
  // Lazy initializers read from shared store at mount time (not module-load time)
  const [rows, setRows] = useState<PipelineRow[]>(() => getPipelineCache().data?.rows || []);
  const [total, setTotal] = useState(() => getPipelineCache().data?.total || 0);
  const [totalVolume, setTotalVolume] = useState(() => getPipelineCache().data?.totalVolume || 0);
  const [cacheAge, setCacheAge] = useState(() => getPipelineCache().data?.cacheAge || 0);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(
    () => getPipelineCache().data?.filterOptions || { milestones: [], los: [], states: [], purposes: [], locks: [], programs: [] },
  );
  const [loading, setLoading] = useState(() => !getPipelineCache().data);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [connected, setConnected] = useState<boolean | null>(() => getConnectedStatus());
  const [isWarming, setIsWarming] = useState(() => getPipelineCache().data?._warming || false);
  const [loadedSoFar, setLoadedSoFar] = useState(() => getPipelineCache().data?._loadedSoFar || 0);
  const pageSize = 50;

  // AI search
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiRows, setAiRows] = useState<PipelineRow[] | null>(null);
  const [aiError, setAiError] = useState("");

  // Filters
  const [milestoneFilter, setMilestoneFilter] = useState("");
  const [loFilter, setLoFilter] = useState("");
  const [lockFilter, setLockFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [purposeFilter, setPurposeFilter] = useState("");
  const [programFilter, setProgramFilter] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [rateMin, setRateMin] = useState("");
  const [rateMax, setRateMax] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("modified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchPipeline = useCallback(async (force = false) => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortField: sortKey,
      sortDir: sortDir,
    });
    if (search) params.set("search", search);
    if (milestoneFilter) params.set("milestone", milestoneFilter);
    if (loFilter) params.set("lo", loFilter);
    if (stateFilter) params.set("state", stateFilter);
    if (purposeFilter) params.set("purpose", purposeFilter);
    if (lockFilter) params.set("lock", lockFilter);
    if (programFilter) params.set("program", programFilter);
    if (amountMin) params.set("amountMin", amountMin);
    if (amountMax) params.set("amountMax", amountMax);
    if (rateMin) params.set("rateMin", rateMin);
    if (rateMax) params.set("rateMax", rateMax);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    // Skip fetch if shared cache is fresh and params match
    if (!force && isPipelineFresh(params.toString())) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data: PipelineResponse = await res.json();

      setRows(data.rows || []);
      setTotal(data.total || 0);
      setTotalVolume(data.totalVolume || 0);
      setCacheAge(data.cacheAge || 0);
      setIsWarming(!!data._warming);
      setLoadedSoFar(data._loadedSoFar || 0);
      if (data.filterOptions) setFilterOptions(data.filterOptions);

      // Persist in shared store for instant restore on navigation
      setPipelineCache(data, params.toString());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }, [page, search, sortKey, sortDir, milestoneFilter, loFilter, stateFilter, purposeFilter, lockFilter, programFilter, amountMin, amountMax, rateMin, rateMax, dateFrom, dateTo]);

  useEffect(() => {
    if (getConnectedStatus() !== null) return;
    fetch("/api/auth/test")
      .then((r) => r.json())
      .then((d) => { setConnected(d.success); setConnectedStatus(d.success); })
      .catch(() => { setConnected(false); setConnectedStatus(false); });
  }, []);

  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

  // Poll for warmup progress every 5s while cache is warming
  useEffect(() => {
    if (!isWarming) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/pipeline/stats");
        const status = await res.json();
        setLoadedSoFar(status.loadedSoFar || 0);
        if (status.state === "ready") {
          setIsWarming(false);
          fetchPipeline(); // Refresh to get full cached data
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [isWarming, fetchPipeline]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  };

  const handleAiSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    setAiError("");
    setAiDescription("");
    setAiRows(null);
    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: aiQuery }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI search failed");
      setAiRows(data.rows || []);
      setAiDescription(data.description || "");
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : "AI search failed");
    } finally {
      setAiLoading(false);
    }
  };

  const clearAiSearch = () => {
    setAiQuery("");
    setAiRows(null);
    setAiDescription("");
    setAiError("");
  };

  // When AI search is active, show AI rows directly (client-side, no cache filtering)
  const displayRows = aiRows ?? rows;
  const displayTotal = aiRows ? aiRows.length : total;
  const displayVolume = aiRows
    ? aiRows.reduce((s, r) => s + (parseFloat(r.fields?.["Loan.LoanAmount"] || "0") || 0), 0)
    : totalVolume;

  const toggleSort = (key: SortKey) => {
    if (aiRows) return; // Don't change sort when AI search is active
    setPage(0);
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "modified" || key === "amount" || key === "closingDate" || key === "appDate" ? "desc" : "asc"); }
  };

  const handleFilterChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPage(0);
    setter(e.target.value);
  };

  const activeFilterCount = [milestoneFilter, loFilter, lockFilter, stateFilter, purposeFilter, programFilter, amountMin, amountMax, rateMin, rateMax, dateFrom, dateTo].filter(Boolean).length;

  const totalPages = Math.ceil(displayTotal / pageSize);

  const selectClass = "px-2.5 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent)] min-w-0";

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-white sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 sm:gap-5">
            <Image src="/logo.png" alt="Premier Lending" width={180} height={40} className="h-7 sm:h-9 w-auto" priority />
            <div className="w-px h-6 sm:h-8 bg-[var(--border)]" />
            <span className="text-xs sm:text-sm font-semibold text-[var(--text)] border-b-2 border-[var(--accent)] pb-0.5">Pipeline</span>
            <Link href="/intelligence" className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              <BarChart3 className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              Intelligence
            </Link>
            <Link href="/market" className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              Market
            </Link>
            <Link href="/milo" className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              <MessageSquare className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              Milo AI
            </Link>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {cacheAge > 0 && (
              <span className="flex items-center gap-1 text-[var(--text-muted)]">
                <Clock className="w-3 h-3" />
                {formatCacheAge(cacheAge)}
              </span>
            )}
            {isWarming && (
              <span className="text-amber-600 text-[10px] font-medium">
                Loading full pipeline... {loadedSoFar > 0 ? `${loadedSoFar.toLocaleString()} loans loaded` : "starting"}
              </span>
            )}
            <span className={`w-2 h-2 rounded-full ${connected === true ? "bg-emerald-500 pulse-dot" : connected === false ? "bg-red-500" : "bg-amber-500"}`} />
            <span className="text-[var(--text-muted)] hidden sm:inline">
              {connected === true ? "Connected" : connected === false ? "Disconnected" : "Connecting..."}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* AI Search */}
        <div className="flex items-center gap-2 sm:gap-3 mb-3">
          <form onSubmit={handleAiSearch} className="flex-1 relative">
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--accent)]" />
            <input
              type="text"
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              placeholder="Ask AI: e.g. &quot;Loans in NC closing this month over $400k&quot; or &quot;All FHA loans in processing&quot;..."
              className="w-full pl-10 pr-20 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
            {aiRows !== null && (
              <button type="button" onClick={clearAiSearch} className="absolute right-12 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text)] px-1">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="submit"
              disabled={aiLoading || !aiQuery.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-[var(--accent)] text-white rounded-md text-xs font-medium hover:bg-[var(--accent-dark)] disabled:opacity-40"
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Search"}
            </button>
          </form>
          <button
            onClick={() => { clearAiSearch(); fetchPipeline(true); }}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--bg-secondary)] disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        {/* AI result info */}
        {aiDescription && aiRows !== null && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-sm">
            <Sparkles className="w-4 h-4 text-[var(--accent)] flex-shrink-0" />
            <span className="text-[var(--text)]">{aiDescription}</span>
            <span className="text-[var(--text-muted)]">({aiRows.length} results)</span>
          </div>
        )}
        {aiError && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {aiError}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="glass-card p-4 flex items-center gap-3">
            <FileText className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <div className="text-xs text-[var(--text-muted)]">{aiRows !== null ? "AI Results" : "Total Loans"}</div>
              <div className="text-lg font-semibold">{displayTotal.toLocaleString()}</div>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <div>
              <div className="text-xs text-[var(--text-muted)]">Volume</div>
              <div className="text-lg font-semibold">{formatCurrency(String(displayVolume))}</div>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-3">
            <FileText className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <div className="text-xs text-[var(--text-muted)]">Showing</div>
              <div className="text-lg font-semibold">
                {aiRows !== null ? displayRows.length : `${page * pageSize + 1}-${Math.min((page + 1) * pageSize, displayTotal)}`}
              </div>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <div>
              <div className="text-xs text-[var(--text-muted)]">Page</div>
              <div className="text-lg font-semibold">{aiRows !== null ? "AI" : `${page + 1} of ${totalPages || 1}`}</div>
            </div>
          </div>
        </div>

        {/* Always-visible Filters */}
        <div className="glass-card p-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Milestone</label>
              <select value={milestoneFilter} onChange={handleFilterChange(setMilestoneFilter)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.milestones.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">LO</label>
              <select value={loFilter} onChange={handleFilterChange(setLoFilter)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.los.map((lo) => <option key={lo} value={lo}>{lo}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">State</label>
              <select value={stateFilter} onChange={handleFilterChange(setStateFilter)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Purpose</label>
              <select value={purposeFilter} onChange={handleFilterChange(setPurposeFilter)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.purposes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Lock</label>
              <select value={lockFilter} onChange={handleFilterChange(setLockFilter)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.locks.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Program</label>
              <select value={programFilter} onChange={handleFilterChange(setProgramFilter)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.programs.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Amount</label>
              <input type="number" value={amountMin} onChange={(e) => { setAmountMin(e.target.value); setPage(0); }} placeholder="Min" className={`${selectClass} w-24`} />
              <span className="text-xs text-[var(--text-muted)]">-</span>
              <input type="number" value={amountMax} onChange={(e) => { setAmountMax(e.target.value); setPage(0); }} placeholder="Max" className={`${selectClass} w-24`} />
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Rate %</label>
              <input type="number" step="0.125" value={rateMin} onChange={(e) => { setRateMin(e.target.value); setPage(0); }} placeholder="Min" className={`${selectClass} w-20`} />
              <span className="text-xs text-[var(--text-muted)]">-</span>
              <input type="number" step="0.125" value={rateMax} onChange={(e) => { setRateMax(e.target.value); setPage(0); }} placeholder="Max" className={`${selectClass} w-20`} />
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Date</label>
              <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className={`${selectClass} w-32`} />
              <span className="text-xs text-[var(--text-muted)]">-</span>
              <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className={`${selectClass} w-32`} />
            </div>
            {activeFilterCount > 0 && (
              <>
                <div className="w-px h-6 bg-[var(--border)]" />
                <button
                  onClick={() => { setMilestoneFilter(""); setLoFilter(""); setLockFilter(""); setStateFilter(""); setPurposeFilter(""); setProgramFilter(""); setAmountMin(""); setAmountMax(""); setRateMin(""); setRateMax(""); setDateFrom(""); setDateTo(""); setPage(0); }}
                  className="text-xs text-[var(--accent)] hover:underline whitespace-nowrap"
                >
                  Clear all ({activeFilterCount})
                </button>
              </>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-sm text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Loading */}
        {(loading || aiLoading) && displayRows.length === 0 && (
          <div className="glass-card p-12 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
            <p className="text-sm text-[var(--text-muted)]">Loading loans...</p>
          </div>
        )}

        {/* Table */}
        {(!(loading || aiLoading) || displayRows.length > 0) && (
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto max-h-[calc(100vh-420px)]">
              <table className="data-table">
                <thead>
                  <tr>
                    {([
                      ["loanNumber", "Loan #"],
                      ["borrower", "Borrower"],
                      ["property", "Property"],
                      ["amount", "Amount"],
                    ] as [SortKey, string][]).map(([key, label]) => (
                      <th key={key} className="cursor-pointer select-none" onClick={() => toggleSort(key)}>
                        <div className="flex items-center gap-1">{label}<SortIcon active={sortKey === key} dir={sortDir} /></div>
                      </th>
                    ))}
                    <th>Program</th>
                    <th>Purpose</th>
                    {([
                      ["rate", "Rate"],
                      ["milestone", "Milestone"],
                      ["lo", "LO"],
                    ] as [SortKey, string][]).map(([key, label]) => (
                      <th key={key} className="cursor-pointer select-none" onClick={() => toggleSort(key)}>
                        <div className="flex items-center gap-1">{label}<SortIcon active={sortKey === key} dir={sortDir} /></div>
                      </th>
                    ))}
                    <th>Lock</th>
                    {([
                      ["appDate", "App Date"],
                      ["closingDate", "Closing"],
                      ["modified", "Modified"],
                    ] as [SortKey, string][]).map(([key, label]) => (
                      <th key={key} className="cursor-pointer select-none" onClick={() => toggleSort(key)}>
                        <div className="flex items-center gap-1">{label}<SortIcon active={sortKey === key} dir={sortDir} /></div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => {
                    const f = row.fields || {};
                    return (
                      <tr key={row.loanGuid} onClick={() => router.push(`/loan/${row.loanGuid}`)}>
                        <td className="font-mono text-[var(--accent)] font-medium">{f["Loan.LoanNumber"] || "--"}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0">
                              <User className="w-3.5 h-3.5 text-[var(--accent)]" />
                            </div>
                            <div>
                              <div className="font-medium text-sm">
                                {[f["Loan.BorrowerFirstName"], f["Loan.BorrowerLastName"]].filter(Boolean).join(" ") || "--"}
                              </div>
                              {f["Loan.CoBorrowerLastName"] && (
                                <div className="text-xs text-[var(--text-muted)]">Co: {f["Loan.CoBorrowerFirstName"]} {f["Loan.CoBorrowerLastName"]}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="text-sm">{pf(f, "Loan.SubjectPropertyCity", "12") || "--"}, {pf(f, "Loan.SubjectPropertyState", "14")}</div>
                        </td>
                        <td className="font-mono">{formatCurrency(f["Loan.LoanAmount"])}</td>
                        <td className="text-xs">{f["Loan.LoanProgram"] || "--"}</td>
                        <td className="text-xs">{f["Loan.LoanPurpose"] || "--"}</td>
                        <td className="font-mono">{(() => { const r = pf(f, "Loan.NoteRatePercent", "3"); return r ? `${parseFloat(r).toFixed(3)}%` : "--"; })()}</td>
                        <td><span className={`status-badge ${getStatusColor(f["Loan.CurrentMilestoneName"])}`}>{f["Loan.CurrentMilestoneName"] || "--"}</span></td>
                        <td className="text-xs">{f["Loan.LoanOfficerName"] || "--"}</td>
                        <td><span className={`status-badge ${f["Loan.LockStatus"] === "Locked" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-gray-100 text-gray-600 border border-gray-200"}`}>{f["Loan.LockStatus"] || "--"}</span></td>
                        <td className="text-xs text-[var(--text-muted)]">{formatDate(pf(f, "", "745") || f["Loan.DateCreated"])}</td>
                        <td className="text-xs text-[var(--text-muted)]">{formatDate(pf(f, "Loan.ClosingDate", "748"))}</td>
                        <td className="text-xs text-[var(--text-muted)]">{formatDate(f["Loan.LastModified"])}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-[var(--text-muted)]">
            {aiRows !== null
              ? `Showing ${displayRows.length} AI results`
              : `Showing ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, displayTotal)} of ${displayTotal.toLocaleString()} loans`}
          </p>
          {aiRows === null && (
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--bg-secondary)] disabled:opacity-30">
                <ChevronLeft className="w-3 h-3" /> Prev
              </button>
              <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--bg-secondary)] disabled:opacity-30">
                Next <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
