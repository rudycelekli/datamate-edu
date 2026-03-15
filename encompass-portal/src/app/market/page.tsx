"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  Loader2, TrendingUp, TrendingDown, Newspaper, RefreshCw, ExternalLink,
  BarChart3, Globe, Clock, ArrowUpRight, ArrowDownRight, Minus, MessageSquare,
} from "lucide-react";
import {
  getMarketCache,
  setMarketCache,
  isMarketFresh,
  getConnectedStatus,
  setConnectedStatus,
} from "@/lib/pipeline-store";

// ─── Types ───
interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  category: string;
}

interface RatePoint {
  date: string;
  rate30yr?: number;
  rate15yr?: number;
  rate5arm?: number;
}

interface TreasuryPoint {
  date: string;
  mo1?: number;
  mo3?: number;
  mo6?: number;
  yr1?: number;
  yr2?: number;
  yr5?: number;
  yr10?: number;
  yr30?: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  "mortgage-rates": "Mortgage Rates",
  "housing-market": "Housing Market",
  "fed-policy": "Fed & Policy",
  "lending-industry": "Lending Industry",
};

const CATEGORY_COLORS: Record<string, string> = {
  "mortgage-rates": "bg-orange-100 text-orange-700 border-orange-200",
  "housing-market": "bg-blue-100 text-blue-700 border-blue-200",
  "fed-policy": "bg-purple-100 text-purple-700 border-purple-200",
  "lending-industry": "bg-emerald-100 text-emerald-700 border-emerald-200",
};

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function formatRate(v: number | undefined): string {
  if (v === undefined || isNaN(v)) return "--";
  return `${v.toFixed(2)}%`;
}

function rateChange(data: RatePoint[], key: keyof RatePoint): { current: number; change: number; direction: "up" | "down" | "flat" } | null {
  if (data.length < 2) return null;
  const current = data[data.length - 1]?.[key];
  const prev = data[data.length - 2]?.[key];
  if (typeof current !== "number" || typeof prev !== "number") return null;
  const change = current - prev;
  return {
    current,
    change,
    direction: change > 0.01 ? "up" : change < -0.01 ? "down" : "flat",
  };
}

const RateTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value?.toFixed(2)}%</p>
      ))}
    </div>
  );
};

export default function MarketPage() {
  const [news, setNews] = useState<NewsItem[]>(() => (getMarketCache().data?.news as NewsItem[]) || []);
  const [newsLoading, setNewsLoading] = useState(() => !getMarketCache().data);
  const [newsError, setNewsError] = useState("");
  const [newsCategory, setNewsCategory] = useState("");
  const [newsFetchedAt, setNewsFetchedAt] = useState(() => getMarketCache().data?.newsFetchedAt || "");

  const [mortgageRates, setMortgageRates] = useState<RatePoint[]>(() => (getMarketCache().data?.rates as { mortgage?: RatePoint[] })?.mortgage || []);
  const [treasuryRates, setTreasuryRates] = useState<TreasuryPoint[]>(() => (getMarketCache().data?.rates as { treasury?: TreasuryPoint[] })?.treasury || []);
  const [ratesLoading, setRatesLoading] = useState(() => !getMarketCache().data);
  const [ratesFetchedAt, setRatesFetchedAt] = useState(() => getMarketCache().data?.ratesFetchedAt || "");

  const [connected, setConnected] = useState<boolean | null>(() => getConnectedStatus());

  useEffect(() => {
    if (getConnectedStatus() !== null) { setConnected(getConnectedStatus()); return; }
    fetch("/api/auth/test")
      .then((r) => r.json())
      .then((d) => { setConnected(d.success); setConnectedStatus(d.success); })
      .catch(() => { setConnected(false); setConnectedStatus(false); });
  }, []);

  const fetchNews = useCallback(async (cat?: string, force = false) => {
    // Skip if cache is fresh and no category filter change
    if (!force && !cat && isMarketFresh()) return;
    setNewsLoading(true);
    setNewsError("");
    try {
      const params = cat ? `?category=${cat}` : "";
      const res = await fetch(`/api/market/news${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setNews(data.items || []);
      setNewsFetchedAt(data.fetchedAt || "");
      // Save to shared store
      const currentRates = getMarketCache().data;
      setMarketCache({
        news: data.items || [],
        rates: currentRates?.rates || {},
        newsFetchedAt: data.fetchedAt || "",
        ratesFetchedAt: currentRates?.ratesFetchedAt || "",
      });
    } catch (err: unknown) {
      setNewsError(err instanceof Error ? err.message : "Failed to load news");
    } finally {
      setNewsLoading(false);
    }
  }, []);

  const fetchRates = useCallback(async (force = false) => {
    if (!force && isMarketFresh()) return;
    setRatesLoading(true);
    try {
      const res = await fetch("/api/market/rates");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMortgageRates(data.mortgage || []);
      setTreasuryRates(data.treasury || []);
      setRatesFetchedAt(data.fetchedAt || "");
      // Save to shared store
      const currentMarket = getMarketCache().data;
      setMarketCache({
        news: currentMarket?.news || [],
        rates: { mortgage: data.mortgage, treasury: data.treasury },
        newsFetchedAt: currentMarket?.newsFetchedAt || "",
        ratesFetchedAt: data.fetchedAt || "",
      });
    } catch {
      // Rates may fail, that's ok
    } finally {
      setRatesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    fetchRates();
  }, [fetchNews, fetchRates]);

  // Auto-refresh news every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => fetchNews(newsCategory || undefined), 300000);
    return () => clearInterval(interval);
  }, [fetchNews, newsCategory]);

  const handleCategoryChange = (cat: string) => {
    setNewsCategory(cat);
    fetchNews(cat || undefined);
  };

  const r30 = rateChange(mortgageRates, "rate30yr");
  const r15 = rateChange(mortgageRates, "rate15yr");

  // Format chart dates to shorter labels
  const chartRates = mortgageRates.map((r) => {
    let label = r.date;
    try {
      const d = new Date(r.date);
      if (!isNaN(d.getTime())) label = `${d.getMonth() + 1}/${d.getDate()}`;
    } catch { /* keep original */ }
    return { ...r, label };
  });

  const chartTreasury = treasuryRates.map((r) => {
    let label = r.date;
    try {
      const d = new Date(r.date);
      if (!isNaN(d.getTime())) label = `${d.getMonth() + 1}/${d.getDate()}`;
    } catch { /* keep original */ }
    return { ...r, label };
  });

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] bg-white sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 sm:gap-5">
            <Image src="/logo.png" alt="Premier Lending" width={180} height={40} className="h-7 sm:h-9 w-auto" priority />
            <div className="w-px h-6 sm:h-8 bg-[var(--border)]" />
            <Link href="/" className="text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              Pipeline
            </Link>
            <Link href="/intelligence" className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              <BarChart3 className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              Intelligence
            </Link>
            <span className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-semibold text-[var(--text)] border-b-2 border-[var(--accent)] pb-0.5">
              <Globe className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[var(--accent)]" />
              Market
            </span>
            <Link href="/milo" className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
              <MessageSquare className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
              Milo AI
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

        {/* ─── Rate Cards ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <RateCard
            label="30-Year Fixed"
            rate={r30?.current}
            change={r30?.change}
            direction={r30?.direction}
            loading={ratesLoading}
          />
          <RateCard
            label="15-Year Fixed"
            rate={r15?.current}
            change={r15?.change}
            direction={r15?.direction}
            loading={ratesLoading}
          />
          <RateCard
            label="10-Year Treasury"
            rate={treasuryRates.length > 0 ? treasuryRates[treasuryRates.length - 1].yr10 : undefined}
            change={treasuryRates.length >= 2 ? (treasuryRates[treasuryRates.length - 1].yr10 ?? 0) - (treasuryRates[treasuryRates.length - 2].yr10 ?? 0) : undefined}
            direction={
              treasuryRates.length >= 2
                ? ((treasuryRates[treasuryRates.length - 1].yr10 ?? 0) - (treasuryRates[treasuryRates.length - 2].yr10 ?? 0)) > 0.01
                  ? "up"
                  : ((treasuryRates[treasuryRates.length - 1].yr10 ?? 0) - (treasuryRates[treasuryRates.length - 2].yr10 ?? 0)) < -0.01
                    ? "down"
                    : "flat"
                : "flat"
            }
            loading={ratesLoading}
          />
          <RateCard
            label="2-Year Treasury"
            rate={treasuryRates.length > 0 ? treasuryRates[treasuryRates.length - 1].yr2 : undefined}
            change={treasuryRates.length >= 2 ? (treasuryRates[treasuryRates.length - 1].yr2 ?? 0) - (treasuryRates[treasuryRates.length - 2].yr2 ?? 0) : undefined}
            direction={
              treasuryRates.length >= 2
                ? ((treasuryRates[treasuryRates.length - 1].yr2 ?? 0) - (treasuryRates[treasuryRates.length - 2].yr2 ?? 0)) > 0.01
                  ? "up"
                  : ((treasuryRates[treasuryRates.length - 1].yr2 ?? 0) - (treasuryRates[treasuryRates.length - 2].yr2 ?? 0)) < -0.01
                    ? "down"
                    : "flat"
                : "flat"
            }
            loading={ratesLoading}
          />
        </div>

        {/* ─── Charts ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Mortgage Rate Trends */}
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[var(--accent)]" />
                Mortgage Rate Trends
              </h3>
              {ratesFetchedAt && (
                <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {timeAgo(ratesFetchedAt)}
                </span>
              )}
            </div>
            {ratesLoading ? (
              <div className="flex items-center justify-center h-48 text-sm text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading rates...
              </div>
            ) : chartRates.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm text-gray-400">
                Rate data unavailable
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartRates}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip content={<RateTooltip />} />
                  <Line type="monotone" dataKey="rate30yr" name="30-Year Fixed" stroke="#EA580C" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="rate15yr" name="15-Year Fixed" stroke="#2563EB" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="rate5arm" name="5/1 ARM" stroke="#16A34A" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            )}
            <div className="flex items-center gap-4 mt-2 text-[10px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#EA580C] inline-block rounded" /> 30-Year</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#2563EB] inline-block rounded" /> 15-Year</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#16A34A] inline-block rounded border-dashed" /> 5/1 ARM</span>
              <span className="ml-auto">Source: Freddie Mac PMMS</span>
            </div>
          </div>

          {/* Treasury Yield Curve */}
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-blue-600" />
                Treasury Yield Trends
              </h3>
              {ratesFetchedAt && (
                <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {timeAgo(ratesFetchedAt)}
                </span>
              )}
            </div>
            {ratesLoading ? (
              <div className="flex items-center justify-center h-48 text-sm text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
              </div>
            ) : chartTreasury.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-sm text-gray-400">
                Treasury data unavailable
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartTreasury}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip content={<RateTooltip />} />
                  <Line type="monotone" dataKey="yr2" name="2-Year" stroke="#7C3AED" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="yr5" name="5-Year" stroke="#0891B2" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="yr10" name="10-Year" stroke="#DC2626" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="yr30" name="30-Year" stroke="#D97706" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
            <div className="flex items-center gap-4 mt-2 text-[10px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#7C3AED] inline-block rounded" /> 2Y</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#0891B2] inline-block rounded" /> 5Y</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#DC2626] inline-block rounded" /> 10Y</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#D97706] inline-block rounded" /> 30Y</span>
              <span className="ml-auto">Source: U.S. Treasury</span>
            </div>
          </div>
        </div>

        {/* ─── News Feed ─── */}
        <div className="glass-card p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-[var(--accent)]" />
              Mortgage Industry News
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => handleCategoryChange("")}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  !newsCategory ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-white text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)]"
                }`}
              >
                All
              </button>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => handleCategoryChange(key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    newsCategory === key ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-white text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)]"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => fetchNews(newsCategory || undefined)}
                className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${newsLoading ? "animate-spin" : ""}`} />
              </button>
              {newsFetchedAt && (
                <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Updated {timeAgo(newsFetchedAt)}
                </span>
              )}
            </div>
          </div>

          {newsLoading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-16 h-4 skeleton" />
                  <div className="flex-1">
                    <div className="h-4 skeleton mb-2 w-3/4" />
                    <div className="h-3 skeleton w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : newsError ? (
            <div className="text-sm text-red-600 p-4 text-center">{newsError}</div>
          ) : news.length === 0 ? (
            <div className="text-sm text-gray-400 p-8 text-center">No news articles found</div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {news.map((item, i) => (
                <a
                  key={i}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 py-3 px-1 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors group"
                >
                  <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-[10px] font-medium border ${CATEGORY_COLORS[item.category] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                    {CATEGORY_LABELS[item.category] || item.category}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors line-clamp-2 leading-snug">
                      {item.title}
                      <ExternalLink className="w-3 h-3 inline-block ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-[var(--text-muted)]">
                      {item.source && <span className="font-medium">{item.source}</span>}
                      {item.pubDate && <span>{timeAgo(item.pubDate)}</span>}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Rate Card Component ───
function RateCard({
  label,
  rate,
  change,
  direction,
  loading,
}: {
  label: string;
  rate?: number;
  change?: number;
  direction?: "up" | "down" | "flat";
  loading: boolean;
}) {
  return (
    <div className="glass-card p-3 sm:p-4">
      <div className="text-[11px] text-[var(--text-muted)] font-medium mb-1">{label}</div>
      {loading ? (
        <div className="h-7 skeleton w-20 mb-1" />
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-xl sm:text-2xl font-bold text-[var(--text)]">
            {formatRate(rate)}
          </span>
          {change !== undefined && !isNaN(change) && (
            <span className={`flex items-center text-xs font-medium ${
              direction === "up" ? "text-red-600" : direction === "down" ? "text-emerald-600" : "text-gray-400"
            }`}>
              {direction === "up" ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : direction === "down" ? (
                <ArrowDownRight className="w-3 h-3" />
              ) : (
                <Minus className="w-3 h-3" />
              )}
              {Math.abs(change).toFixed(2)}
            </span>
          )}
        </div>
      )}
      <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
        {direction === "up" ? "Rate increased" : direction === "down" ? "Rate decreased" : "No change"} vs prior week
      </div>
    </div>
  );
}
