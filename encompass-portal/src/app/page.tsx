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
} from "lucide-react";

interface PipelineRow {
  loanGuid: string;
  fields: Record<string, string>;
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

export default function PipelinePage() {
  const router = useRouter();
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [connected, setConnected] = useState<boolean | null>(null);
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
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [rateMin, setRateMin] = useState("");
  const [rateMax, setRateMax] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("modified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchPipeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        start: String(page * pageSize),
        limit: String(pageSize),
      });
      if (search) params.set("search", search);
      const res = await fetch(`/api/pipeline?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetch("/api/auth/test")
      .then((r) => r.json())
      .then((d) => setConnected(d.success))
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

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

  // Use AI results when active, otherwise standard rows
  const sourceRows = aiRows ?? rows;

  // Extract unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const milestones = new Set<string>();
    const los = new Set<string>();
    const locks = new Set<string>();
    const states = new Set<string>();
    const purposes = new Set<string>();
    sourceRows.forEach((r) => {
      const f = r.fields || {};
      if (f["Loan.CurrentMilestoneName"]) milestones.add(f["Loan.CurrentMilestoneName"]);
      if (f["Loan.LoanOfficerName"]) los.add(f["Loan.LoanOfficerName"]);
      if (f["Loan.LockStatus"]) locks.add(f["Loan.LockStatus"]);
      const state = pf(f, "Loan.SubjectPropertyState", "14");
      if (state) states.add(state);
      if (f["Loan.LoanPurpose"]) purposes.add(f["Loan.LoanPurpose"]);
    });
    return {
      milestones: [...milestones].sort(),
      los: [...los].sort(),
      locks: [...locks].sort(),
      states: [...states].sort(),
      purposes: [...purposes].sort(),
    };
  }, [sourceRows]);

  // Client-side filter + sort
  const filteredRows = useMemo(() => {
    let result = sourceRows.filter((r) => {
      const f = r.fields || {};
      if (milestoneFilter && f["Loan.CurrentMilestoneName"] !== milestoneFilter) return false;
      if (loFilter && f["Loan.LoanOfficerName"] !== loFilter) return false;
      if (lockFilter && f["Loan.LockStatus"] !== lockFilter) return false;
      if (stateFilter && pf(f, "Loan.SubjectPropertyState", "14") !== stateFilter) return false;
      if (purposeFilter && f["Loan.LoanPurpose"] !== purposeFilter) return false;
      if (amountMin || amountMax) {
        const amt = parseFloat(f["Loan.LoanAmount"] || "0") || 0;
        if (amountMin && amt < parseFloat(amountMin)) return false;
        if (amountMax && amt > parseFloat(amountMax)) return false;
      }
      if (rateMin || rateMax) {
        const rate = parseFloat(pf(f, "Loan.NoteRatePercent", "3") || "0") || 0;
        if (rateMin && rate < parseFloat(rateMin)) return false;
        if (rateMax && rate > parseFloat(rateMax)) return false;
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      const fa = a.fields || {};
      const fb = b.fields || {};
      let va = "", vb = "";
      switch (sortKey) {
        case "loanNumber": va = fa["Loan.LoanNumber"] || ""; vb = fb["Loan.LoanNumber"] || ""; break;
        case "borrower": va = `${fa["Loan.BorrowerLastName"] || ""} ${fa["Loan.BorrowerFirstName"] || ""}`; vb = `${fb["Loan.BorrowerLastName"] || ""} ${fb["Loan.BorrowerFirstName"] || ""}`; break;
        case "amount":
          return sortDir === "asc"
            ? (parseFloat(fa["Loan.LoanAmount"] || "0") || 0) - (parseFloat(fb["Loan.LoanAmount"] || "0") || 0)
            : (parseFloat(fb["Loan.LoanAmount"] || "0") || 0) - (parseFloat(fa["Loan.LoanAmount"] || "0") || 0);
        case "rate": {
          const ra = parseFloat(pf(fa, "Loan.NoteRatePercent", "3") || "0") || 0;
          const rb = parseFloat(pf(fb, "Loan.NoteRatePercent", "3") || "0") || 0;
          return sortDir === "asc" ? ra - rb : rb - ra;
        }
        case "milestone": va = fa["Loan.CurrentMilestoneName"] || ""; vb = fb["Loan.CurrentMilestoneName"] || ""; break;
        case "lo": va = fa["Loan.LoanOfficerName"] || ""; vb = fb["Loan.LoanOfficerName"] || ""; break;
        case "modified": va = fa["Loan.LastModified"] || ""; vb = fb["Loan.LastModified"] || ""; break;
        case "closingDate": va = pf(fa, "Loan.ClosingDate", "748"); vb = pf(fb, "Loan.ClosingDate", "748"); break;
        case "appDate": va = pf(fa, "", "745") || fa["Loan.DateCreated"] || ""; vb = pf(fb, "", "745") || fb["Loan.DateCreated"] || ""; break;
        case "property": va = `${pf(fa, "Loan.SubjectPropertyCity", "12")} ${pf(fa, "Loan.SubjectPropertyState", "14")}`; vb = `${pf(fb, "Loan.SubjectPropertyCity", "12")} ${pf(fb, "Loan.SubjectPropertyState", "14")}`; break;
      }
      const cmp = va.localeCompare(vb);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [sourceRows, milestoneFilter, loFilter, lockFilter, stateFilter, purposeFilter, amountMin, amountMax, rateMin, rateMax, sortKey, sortDir]);

  const totalVolume = useMemo(
    () => filteredRows.reduce((s, r) => s + (parseFloat(r.fields?.["Loan.LoanAmount"] || "0") || 0), 0),
    [filteredRows],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "modified" || key === "amount" || key === "closingDate" || key === "appDate" ? "desc" : "asc"); }
  };

  const activeFilterCount = [milestoneFilter, loFilter, lockFilter, stateFilter, purposeFilter, amountMin, amountMax, rateMin, rateMax].filter(Boolean).length;

  const selectClass = "px-2.5 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent)] min-w-0";

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-white sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Image src="/logo.png" alt="Premier Lending" width={180} height={40} className="h-7 sm:h-9 w-auto" priority />
            <div className="w-px h-6 sm:h-8 bg-[var(--border)] mx-1 sm:mx-2" />
            <span className="text-xs sm:text-sm font-semibold text-[var(--text)] border-b-2 border-[var(--accent)] pb-0.5">Pipeline</span>
            <Link href="/intelligence" className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              <BarChart3 className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              Intelligence
            </Link>
            <Link href="/market" className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              Market
            </Link>
          </div>
          <div className="flex items-center gap-2 text-xs">
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
            onClick={() => { clearAiSearch(); fetchPipeline(); }}
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
              <div className="text-xs text-[var(--text-muted)]">{aiRows !== null ? "AI Results" : "Showing"}</div>
              <div className="text-lg font-semibold">{filteredRows.length}</div>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <div>
              <div className="text-xs text-[var(--text-muted)]">Volume</div>
              <div className="text-lg font-semibold">{formatCurrency(String(totalVolume))}</div>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-3">
            <FileText className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <div className="text-xs text-[var(--text-muted)]">Page</div>
              <div className="text-lg font-semibold">{aiRows !== null ? "AI" : page + 1}</div>
            </div>
          </div>
          <div className="glass-card p-4 flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <div>
              <div className="text-xs text-[var(--text-muted)]">Per Page</div>
              <div className="text-lg font-semibold">{aiRows !== null ? filteredRows.length : pageSize}</div>
            </div>
          </div>
        </div>

        {/* Always-visible Filters */}
        <div className="glass-card p-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Milestone</label>
              <select value={milestoneFilter} onChange={(e) => setMilestoneFilter(e.target.value)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.milestones.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">LO</label>
              <select value={loFilter} onChange={(e) => setLoFilter(e.target.value)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.los.map((lo) => <option key={lo} value={lo}>{lo}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">State</label>
              <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Purpose</label>
              <select value={purposeFilter} onChange={(e) => setPurposeFilter(e.target.value)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.purposes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Lock</label>
              <select value={lockFilter} onChange={(e) => setLockFilter(e.target.value)} className={selectClass}>
                <option value="">All</option>
                {filterOptions.locks.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Amount</label>
              <input type="number" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} placeholder="Min" className={`${selectClass} w-24`} />
              <span className="text-xs text-[var(--text-muted)]">-</span>
              <input type="number" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} placeholder="Max" className={`${selectClass} w-24`} />
            </div>
            <div className="w-px h-6 bg-[var(--border)]" />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Rate %</label>
              <input type="number" step="0.125" value={rateMin} onChange={(e) => setRateMin(e.target.value)} placeholder="Min" className={`${selectClass} w-20`} />
              <span className="text-xs text-[var(--text-muted)]">-</span>
              <input type="number" step="0.125" value={rateMax} onChange={(e) => setRateMax(e.target.value)} placeholder="Max" className={`${selectClass} w-20`} />
            </div>
            {activeFilterCount > 0 && (
              <>
                <div className="w-px h-6 bg-[var(--border)]" />
                <button
                  onClick={() => { setMilestoneFilter(""); setLoFilter(""); setLockFilter(""); setStateFilter(""); setPurposeFilter(""); setAmountMin(""); setAmountMax(""); setRateMin(""); setRateMax(""); }}
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
        {(loading || aiLoading) && sourceRows.length === 0 && (
          <div className="glass-card p-12 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
            <p className="text-sm text-[var(--text-muted)]">Loading loans...</p>
          </div>
        )}

        {/* Table */}
        {(!(loading || aiLoading) || sourceRows.length > 0) && (
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
                  {filteredRows.map((row) => {
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
            Showing {page * pageSize + 1}-{page * pageSize + filteredRows.length} loans
          </p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--bg-secondary)] disabled:opacity-30">
              <ChevronLeft className="w-3 h-3" /> Prev
            </button>
            <button onClick={() => setPage((p) => p + 1)} disabled={rows.length < pageSize} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--bg-secondary)] disabled:opacity-30">
              Next <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
