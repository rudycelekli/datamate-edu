"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import AppHeader from "@/components/AppHeader";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, AreaChart, Area, ReferenceLine,
} from "recharts";
import {
  Loader2, TrendingUp, TrendingDown, Newspaper, RefreshCw, ExternalLink,
  Clock, ArrowUpRight, ArrowDownRight, Minus, MapPin, Lock, Unlock,
  AlertTriangle, Activity, DollarSign, Home, Users, BarChart3,
  Shield, ChevronDown, ChevronUp, Zap, BookOpen, Target,
} from "lucide-react";
import {
  getMarketCache, setMarketCache, isMarketFresh,
  getPipelineStateBreakdown, getPipelineSummary,
} from "@/lib/pipeline-store";

// ─── Types ───

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  category: string;
}

interface RatePoint { date: string; rate30yr?: number; rate15yr?: number; label?: string; }
interface TreasuryPoint { date: string; yr2?: number; yr5?: number; yr10?: number; yr30?: number; label?: string; }
interface SpreadPoint { date: string; spread: number | null; rate30yr?: number; yr10?: number; }

interface EconIndicator {
  name: string;
  value: number;
  prevValue: number | null;
  change: number | null;
  changeType: "bps" | "pct" | "pts" | "value";
  direction: "up" | "down" | "flat";
  date: string;
  yoyChange?: number | null;
  series: { date: string; value: number }[];
  context: string;
}

interface LockAdvisor { signal: "lock" | "float" | "neutral"; reason: string; treasuryTrend: number; }
interface RateAnalysis {
  current30yr?: number; weekChange?: number | null; monthChange?: number | null;
  yearChange?: number | null; yearHigh?: number; yearLow?: number;
  currentSpread?: number | null; avgSpread?: number | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  "mortgage-rates": "Rates", "housing-market": "Housing", "fed-policy": "Fed",
  "lending-industry": "Lending", "local-market": "Local",
};
const CATEGORY_COLORS: Record<string, string> = {
  "mortgage-rates": "bg-orange-100 text-orange-700 border-orange-200",
  "housing-market": "bg-blue-100 text-blue-700 border-blue-200",
  "fed-policy": "bg-purple-100 text-purple-700 border-purple-200",
  "lending-industry": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "local-market": "bg-amber-100 text-amber-700 border-amber-200",
};

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
  CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",
  IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",
  ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",
  MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",
  OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
  TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",
  WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia",
};

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function fmtDate(d: string) {
  try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  catch { return d; }
}

function fmtRate(v: number | undefined) { return v !== undefined && !isNaN(v) ? `${v.toFixed(2)}%` : "--"; }

function fmtCurrency(v: number) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtEconValue(v: number, name: string) {
  if (name.includes("Rate") || name.includes("Unemployment") || name.includes("Savings")) return `${v.toFixed(2)}%`;
  if (name.includes("Price")) return fmtCurrency(v);
  if (name.includes("CPI") || name.includes("Case-Shiller") || name.includes("Sentiment") || name.includes("Affordability")) return v.toFixed(1);
  if (name.includes("Starts") || name.includes("Sales")) return `${v.toFixed(0)}K`;
  if (name.includes("Months of Supply")) return `${v.toFixed(1)} mo`;
  return v.toFixed(2);
}

// ─── Compact chart tooltip ───
function MiniTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-[10px]">
      <p className="font-semibold">{label}</p>
      {payload.map((p, i) => <p key={i} style={{ color: p.color }}>{p.name}: {typeof p.value === "number" ? p.value.toFixed(2) : p.value}</p>)}
    </div>
  );
}

// ─── Section Component ───
function Section({ id, title, icon, children, defaultOpen = true }: {
  id: string; title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4">
      <button
        id={`market-${id}`}
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(() => document.getElementById(`market-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
        }}
        className="w-full flex items-center justify-between px-4 py-3 glass-card hover:bg-[var(--bg-secondary)] transition-colors scroll-mt-4"
      >
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        {open ? <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export default function MarketPage() {
  // Data state
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState("");
  const [newsCategory, setNewsCategory] = useState("");
  const [newsFetchedAt, setNewsFetchedAt] = useState("");

  const [mortgageRates, setMortgageRates] = useState<RatePoint[]>([]);
  const [treasuryRates, setTreasuryRates] = useState<TreasuryPoint[]>([]);
  const [spreadData, setSpreadData] = useState<SpreadPoint[]>([]);
  const [yieldCurveSpread, setYieldCurveSpread] = useState<{ date: string; spread?: number }[]>([]);
  const [rateAnalysis, setRateAnalysis] = useState<RateAnalysis>({});
  const [economic, setEconomic] = useState<EconIndicator[]>([]);
  const [inflationRate, setInflationRate] = useState<number | null>(null);
  const [lockAdvisor, setLockAdvisor] = useState<LockAdvisor | null>(null);
  const [productRates, setProductRates] = useState<{ conforming?: { value: number; date: string } | null; fha?: { value: number; date: string } | null; va?: { value: number; date: string } | null; jumbo?: { value: number; date: string } | null }>({});
  const [dailyRates, setDailyRates] = useState<{ date: string; conforming?: number; fha?: number; va?: number; jumbo?: number }[]>([]);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesFetchedAt, setRatesFetchedAt] = useState("");

  const stateBreakdown = getPipelineStateBreakdown();
  const topStates = stateBreakdown?.slice(0, 5).map(s => s.state).join(",") || "";

  const fetchNews = useCallback(async (cat?: string, force = false) => {
    if (!force && !cat && isMarketFresh()) return;
    setNewsLoading(true);
    setNewsError("");
    try {
      const query = new URLSearchParams();
      if (cat) query.set("category", cat);
      if (topStates) query.set("states", topStates);
      const qs = query.toString();
      const res = await fetch(`/api/market/news${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setNews(data.items || []);
      setNewsFetchedAt(data.fetchedAt || "");
    } catch (err: unknown) {
      setNewsError(err instanceof Error ? err.message : "Failed to load news");
    } finally {
      setNewsLoading(false);
    }
  }, [topStates]);

  const fetchRates = useCallback(async (force = false) => {
    if (!force && isMarketFresh()) return;
    setRatesLoading(true);
    try {
      const res = await fetch("/api/market/rates");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMortgageRates(data.mortgage || []);
      setTreasuryRates(data.treasury || []);
      setSpreadData(data.spreadData || []);
      setYieldCurveSpread(data.yieldCurveSpread || []);
      setRateAnalysis(data.rateAnalysis || {});
      setEconomic(data.economic || []);
      setInflationRate(data.inflationRate ?? null);
      setLockAdvisor(data.lockAdvisor || null);
      setProductRates(data.productRates || {});
      setDailyRates(data.dailyRates || []);
      setRatesFetchedAt(data.fetchedAt || "");
      setMarketCache({
        news, rates: data, newsFetchedAt, ratesFetchedAt: data.fetchedAt || "",
      });
    } catch { /* rates may fail, ok */ }
    finally { setRatesLoading(false); }
  }, [news, newsFetchedAt]);

  useEffect(() => { fetchNews(); fetchRates(); }, [fetchNews, fetchRates]);
  useEffect(() => {
    const interval = setInterval(() => fetchNews(newsCategory || undefined), 300000);
    return () => clearInterval(interval);
  }, [fetchNews, newsCategory]);

  // Chart formatting
  const chartRates = useMemo(() => mortgageRates.map(r => ({ ...r, label: fmtDate(r.date) })), [mortgageRates]);
  const chartTreasury = useMemo(() => treasuryRates.map(r => ({ ...r, label: fmtDate(r.date) })), [treasuryRates]);
  const chartSpread = useMemo(() => spreadData.map(r => ({ ...r, label: fmtDate(r.date) })), [spreadData]);
  const chartYieldSpread = useMemo(() => yieldCurveSpread.map(r => ({ ...r, label: fmtDate(r.date) })), [yieldCurveSpread]);

  // Rate changes
  const r30current = mortgageRates.length > 0 ? mortgageRates[mortgageRates.length - 1].rate30yr : undefined;
  const r30prev = mortgageRates.length > 1 ? mortgageRates[mortgageRates.length - 2].rate30yr : undefined;
  const r30change = r30current !== undefined && r30prev !== undefined ? +(r30current - r30prev).toFixed(2) : null;
  const r15current = mortgageRates.length > 0 ? mortgageRates[mortgageRates.length - 1].rate15yr : undefined;
  const r15prev = mortgageRates.length > 1 ? mortgageRates[mortgageRates.length - 2].rate15yr : undefined;
  const r15change = r15current !== undefined && r15prev !== undefined ? +(r15current - r15prev).toFixed(2) : null;

  // Pipeline stats for comparison
  const pipelineSummary = getPipelineSummary();

  // News with pipeline exposure
  const newsWithExposure = useMemo(() => news.map(item => {
    const title = item.title.toLowerCase();
    const matchedStates: Array<{ state: string; pct: number; count: number; volume: number }> = [];
    if (stateBreakdown) {
      for (const s of stateBreakdown) {
        const fullName = STATE_NAMES[s.state]?.toLowerCase() || "";
        if (title.includes(fullName) || title.includes(` ${s.state.toLowerCase()} `) ||
            title.startsWith(`${s.state.toLowerCase()} `) || title.endsWith(` ${s.state.toLowerCase()}`)) {
          matchedStates.push(s);
        }
      }
    }
    return { ...item, matchedStates };
  }), [news, stateBreakdown]);

  // ─── Affordability Impact ───
  const affordability = useMemo(() => {
    if (!r30current) return null;
    const loanAmounts = [250000, 350000, 500000, 750000];
    const monthlyRate = r30current / 100 / 12;
    const n = 360; // 30 year
    return loanAmounts.map(loan => {
      const payment = loan * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
      // Payment change per +0.25%
      const upRate = (r30current + 0.25) / 100 / 12;
      const paymentUp = loan * (upRate * Math.pow(1 + upRate, n)) / (Math.pow(1 + upRate, n) - 1);
      // Payment change per -0.25%
      const downRate = (r30current - 0.25) / 100 / 12;
      const paymentDown = loan * (downRate * Math.pow(1 + downRate, n)) / (Math.pow(1 + downRate, n) - 1);
      return {
        loan,
        payment: Math.round(payment),
        changeUp: Math.round(paymentUp - payment),
        changeDown: Math.round(paymentDown - payment),
      };
    });
  }, [r30current]);

  // ─── Market Summary ───
  const marketSummary = useMemo(() => {
    if (!r30current || !lockAdvisor) return "";
    const parts: string[] = [];
    const direction = r30change && r30change > 0 ? "rose" : r30change && r30change < 0 ? "fell" : "held steady";
    parts.push(`The 30-year fixed mortgage rate is at ${r30current.toFixed(2)}%, having ${direction} ${r30change ? Math.abs(r30change).toFixed(2) + "%" : ""} from the prior week.`);
    if (rateAnalysis.yearChange !== null && rateAnalysis.yearChange !== undefined) {
      parts.push(`Over the past year, rates have ${rateAnalysis.yearChange > 0 ? "risen" : "fallen"} ${Math.abs(rateAnalysis.yearChange).toFixed(2)}%.`);
    }
    if (inflationRate !== null) {
      parts.push(`Inflation stands at ${inflationRate}% YoY.`);
    }
    const fed = economic.find(e => e.name === "Federal Funds Rate");
    if (fed) {
      parts.push(`The Fed Funds rate is ${fed.value.toFixed(2)}%.`);
    }
    parts.push(`Lock advisor signal: ${lockAdvisor.signal.toUpperCase()}.`);
    return parts.join(" ");
  }, [r30current, r30change, rateAnalysis, inflationRate, economic, lockAdvisor]);

  // ─── Talking Points ───
  const talkingPoints = useMemo(() => {
    const points: string[] = [];
    if (r30current) {
      const direction = r30change && r30change > 0 ? "up" : r30change && r30change < 0 ? "down" : "unchanged";
      points.push(`30-year fixed rates are at ${r30current.toFixed(2)}%, ${direction} ${r30change ? Math.abs(r30change).toFixed(2) : "0"}% from last week.`);
    }
    if (rateAnalysis.yearHigh && rateAnalysis.yearLow && r30current) {
      const pctFromHigh = (((rateAnalysis.yearHigh - r30current) / rateAnalysis.yearHigh) * 100).toFixed(0);
      if (Number(pctFromHigh) > 3) points.push(`Rates are ${pctFromHigh}% below the 52-week high of ${rateAnalysis.yearHigh.toFixed(2)}% — a good opportunity to lock.`);
    }
    if (inflationRate !== null) {
      points.push(`Inflation is running at ${inflationRate}% year-over-year. ${inflationRate > 3 ? "Elevated inflation keeps upward pressure on rates." : inflationRate < 2.5 ? "Low inflation supports the case for lower rates ahead." : "Inflation is near the Fed's target range."}`);
    }
    const fedRate = economic.find(e => e.name === "Federal Funds Rate");
    if (fedRate) {
      points.push(`The Fed Funds rate is ${fedRate.value.toFixed(2)}%. ${fedRate.direction === "down" ? "The Fed has been cutting rates — mortgage rates typically follow with a delay." : fedRate.direction === "up" ? "The Fed has been raising rates." : "The Fed is holding steady for now."}`);
    }
    const sentiment = economic.find(e => e.name === "Consumer Sentiment");
    if (sentiment) {
      points.push(`Consumer sentiment is at ${sentiment.value.toFixed(0)}, ${sentiment.direction === "up" ? "improving" : sentiment.direction === "down" ? "declining" : "stable"}. ${sentiment.value > 70 ? "Buyers feel confident about the economy." : "Cautious consumers may be hesitant to commit."}`);
    }
    if (rateAnalysis.currentSpread && rateAnalysis.avgSpread) {
      const spreadDiff = rateAnalysis.currentSpread - rateAnalysis.avgSpread;
      if (Math.abs(spreadDiff) > 0.1) {
        points.push(`The mortgage-to-Treasury spread is ${rateAnalysis.currentSpread.toFixed(2)}% vs the ${rateAnalysis.avgSpread.toFixed(2)}% average. ${spreadDiff > 0 ? "Above-average spread means rates could compress (improve) relative to Treasuries." : "Tight spread suggests rates are competitive right now."}`);
      }
    }
    return points;
  }, [r30current, r30change, rateAnalysis, inflationRate, economic]);

  return (
    <div className="min-h-screen">
      <AppHeader
        activeTab="market"
        rightContent={
          <button
            onClick={() => { fetchNews(newsCategory || undefined, true); fetchRates(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${newsLoading || ratesLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6">

        {/* ═══════ MARKET SUMMARY BANNER ═══════ */}
        {marketSummary && (
          <div className="glass-card p-3 mb-4 border-l-4 border-[var(--accent)] bg-orange-50/30">
            <div className="flex items-start gap-2">
              <Zap className="w-4 h-4 text-[var(--accent)] mt-0.5 shrink-0" />
              <p className="text-xs text-[var(--text)] leading-relaxed">{marketSummary}</p>
            </div>
            {ratesFetchedAt && <p className="text-[9px] text-[var(--text-muted)] mt-1 ml-6">Data as of {new Date(ratesFetchedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
          </div>
        )}

        {/* ═══════ MARKET PULSE ═══════ */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
          <PulseCard label="30-Year Fixed" value={fmtRate(r30current)} change={r30change} unit="%" direction={r30change && r30change > 0 ? "up" : r30change && r30change < 0 ? "down" : "flat"} loading={ratesLoading} icon={<DollarSign className="w-4 h-4" />} color="text-[var(--accent)]" />
          <PulseCard label="15-Year Fixed" value={fmtRate(r15current)} change={r15change} unit="%" direction={r15change && r15change > 0 ? "up" : r15change && r15change < 0 ? "down" : "flat"} loading={ratesLoading} icon={<DollarSign className="w-4 h-4" />} color="text-blue-600" />
          <PulseCard label="10Y Treasury" value={fmtRate(treasuryRates.length > 0 ? treasuryRates[treasuryRates.length - 1].yr10 : undefined)} change={treasuryRates.length >= 2 ? +((treasuryRates[treasuryRates.length - 1].yr10 ?? 0) - (treasuryRates[treasuryRates.length - 2].yr10 ?? 0)).toFixed(2) : null} unit="%" loading={ratesLoading} icon={<BarChart3 className="w-4 h-4" />} color="text-red-600" />
          <PulseCard label="Inflation (YoY)" value={inflationRate !== null ? `${inflationRate}%` : "--"} loading={ratesLoading} icon={<TrendingUp className="w-4 h-4" />} color="text-purple-600" />
          <PulseCard label="Mtg-10Y Spread" value={rateAnalysis.currentSpread ? `${rateAnalysis.currentSpread}%` : "--"} loading={ratesLoading} icon={<Activity className="w-4 h-4" />} color="text-emerald-600" />
          {lockAdvisor && (
            <div className={`glass-card p-3 flex flex-col justify-between ${lockAdvisor.signal === "lock" ? "border-l-4 border-red-400" : lockAdvisor.signal === "float" ? "border-l-4 border-emerald-400" : "border-l-4 border-gray-300"}`}>
              <div className="text-[10px] text-[var(--text-muted)] font-medium mb-1 flex items-center gap-1">
                {lockAdvisor.signal === "lock" ? <Lock className="w-3 h-3 text-red-500" /> : lockAdvisor.signal === "float" ? <Unlock className="w-3 h-3 text-emerald-500" /> : <Minus className="w-3 h-3" />}
                Lock Advisor
              </div>
              <div className={`text-lg font-bold ${lockAdvisor.signal === "lock" ? "text-red-600" : lockAdvisor.signal === "float" ? "text-emerald-600" : "text-gray-500"}`}>
                {lockAdvisor.signal === "lock" ? "LOCK" : lockAdvisor.signal === "float" ? "FLOAT" : "HOLD"}
              </div>
              <div className="text-[9px] text-[var(--text-muted)] mt-0.5">
                10Y trend: {lockAdvisor.treasuryTrend > 0 ? "+" : ""}{lockAdvisor.treasuryTrend} bps (5d)
              </div>
            </div>
          )}
        </div>

        {/* ═══════ TODAY'S PRODUCT RATES (Daily Optimal Blue) ═══════ */}
        {(productRates.conforming || productRates.fha || productRates.va || productRates.jumbo) && (
          <Section id="product-rates" title="Today's Product Rates (Daily)" icon={<DollarSign className="w-4 h-4 text-emerald-600" />}>
            <div className="glass-card p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                {[
                  { label: "Conforming", data: productRates.conforming, color: "text-blue-600" },
                  { label: "FHA", data: productRates.fha, color: "text-emerald-600" },
                  { label: "VA", data: productRates.va, color: "text-purple-600" },
                  { label: "Jumbo", data: productRates.jumbo, color: "text-amber-600" },
                ].map(p => (
                  <div key={p.label} className="p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)]">
                    <div className={`text-[10px] font-semibold ${p.color}`}>{p.label} 30-Year</div>
                    <div className="text-xl font-bold text-[var(--text)] mt-0.5">{p.data ? `${p.data.value.toFixed(3)}%` : "--"}</div>
                    {p.data && <div className="text-[9px] text-[var(--text-muted)] mt-0.5">as of {fmtDate(p.data.date)}</div>}
                  </div>
                ))}
              </div>
              {dailyRates.length > 0 && (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={dailyRates.map(r => ({ ...r, label: fmtDate(r.date) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip content={<MiniTooltip />} />
                    <Line type="monotone" dataKey="conforming" name="Conforming" stroke="#2563EB" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="fha" name="FHA" stroke="#059669" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="va" name="VA" stroke="#7C3AED" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="jumbo" name="Jumbo" stroke="#D97706" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div className="flex gap-4 mt-1 text-[9px] text-[var(--text-muted)]">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#2563EB] inline-block" /> Conforming</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#059669] inline-block" /> FHA</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#7C3AED] inline-block" /> VA</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#D97706] inline-block" /> Jumbo</span>
              </div>
              <p className="text-[9px] text-[var(--text-muted)] mt-2">Source: Optimal Blue Mortgage Market Indices (OBMMI). Updated daily — more granular than weekly Freddie Mac PMMS.</p>
            </div>
          </Section>
        )}

        {/* ═══════ RATE LOCK ADVISOR ═══════ */}
        {lockAdvisor && (
          <Section id="lock-advisor" title="Rate Lock Advisor" icon={<Shield className="w-4 h-4 text-[var(--accent)]" />}>
            <div className={`glass-card p-5 ${lockAdvisor.signal === "lock" ? "border-l-4 border-red-400 bg-red-50/30" : lockAdvisor.signal === "float" ? "border-l-4 border-emerald-400 bg-emerald-50/30" : "border-l-4 border-gray-300"}`}>
              <div className="flex items-start gap-4">
                <div className={`w-16 h-16 rounded-xl flex items-center justify-center ${lockAdvisor.signal === "lock" ? "bg-red-100" : lockAdvisor.signal === "float" ? "bg-emerald-100" : "bg-gray-100"}`}>
                  {lockAdvisor.signal === "lock" ? <Lock className="w-8 h-8 text-red-600" /> : lockAdvisor.signal === "float" ? <Unlock className="w-8 h-8 text-emerald-600" /> : <Minus className="w-8 h-8 text-gray-500" />}
                </div>
                <div className="flex-1">
                  <h4 className={`text-xl font-bold ${lockAdvisor.signal === "lock" ? "text-red-700" : lockAdvisor.signal === "float" ? "text-emerald-700" : "text-gray-600"}`}>
                    Recommendation: {lockAdvisor.signal === "lock" ? "LOCK NOW" : lockAdvisor.signal === "float" ? "CONSIDER FLOATING" : "NEUTRAL — Default to Lock"}
                  </h4>
                  <p className="text-sm text-[var(--text)] mt-1">{lockAdvisor.reason}</p>
                  <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-muted)]">
                    <span>10Y Treasury 5-day: <strong className={lockAdvisor.treasuryTrend > 0 ? "text-red-600" : lockAdvisor.treasuryTrend < 0 ? "text-emerald-600" : ""}>{lockAdvisor.treasuryTrend > 0 ? "+" : ""}{lockAdvisor.treasuryTrend} bps</strong></span>
                    {rateAnalysis.currentSpread && <span>Mortgage-10Y Spread: <strong>{rateAnalysis.currentSpread}%</strong> (avg {rateAnalysis.avgSpread}%)</span>}
                    {rateAnalysis.yearHigh && <span>52-wk range: {rateAnalysis.yearLow?.toFixed(2)}% — {rateAnalysis.yearHigh?.toFixed(2)}%</span>}
                  </div>
                </div>
              </div>
            </div>
          </Section>
        )}

        {/* ═══════ AFFORDABILITY IMPACT ═══════ */}
        {affordability && (
          <Section id="affordability" title="Affordability Impact Calculator" icon={<DollarSign className="w-4 h-4 text-emerald-600" />}>
            <div className="glass-card p-4">
              <p className="text-[10px] text-[var(--text-muted)] mb-3">Monthly P&I at today&apos;s {r30current?.toFixed(2)}% rate. Shows impact of +/- 0.25% rate change.</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {affordability.map(a => (
                  <div key={a.loan} className="p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)]">
                    <div className="text-[10px] font-medium text-[var(--text-muted)]">{fmtCurrency(a.loan)} loan</div>
                    <div className="text-lg font-bold text-[var(--text)] mt-0.5">${a.payment.toLocaleString()}<span className="text-[10px] font-normal text-[var(--text-muted)]">/mo</span></div>
                    <div className="flex items-center gap-2 mt-1 text-[10px]">
                      <span className="text-red-500 flex items-center gap-0.5"><ArrowUpRight className="w-3 h-3" />+${a.changeUp}/mo</span>
                      <span className="text-emerald-500 flex items-center gap-0.5"><ArrowDownRight className="w-3 h-3" />-${Math.abs(a.changeDown)}/mo</span>
                    </div>
                    <div className="text-[9px] text-[var(--text-muted)] mt-0.5">per 0.25% rate change</div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-[var(--text-muted)] mt-3 border-t border-[var(--border)] pt-2">
                Use these numbers with your borrowers: &quot;At today&apos;s rate, your monthly payment on a $350K loan would be ${affordability[1]?.payment.toLocaleString()}/mo. If rates go up just a quarter point, that&apos;s an extra ${affordability[1]?.changeUp}/month.&quot;
              </p>
            </div>
          </Section>
        )}

        {/* ═══════ LO TALKING POINTS ═══════ */}
        {talkingPoints.length > 0 && (
          <Section id="talking-points" title="What to Tell Your Borrowers Today" icon={<BookOpen className="w-4 h-4 text-[var(--accent)]" />}>
            <div className="glass-card p-4">
              <div className="space-y-3">
                {talkingPoints.map((point, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-100 text-[var(--accent)] flex items-center justify-center text-xs font-bold">{i + 1}</span>
                    <p className="text-sm text-[var(--text)] leading-relaxed">{point}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-3 border-t border-[var(--border)] pt-2">
                Generated from live FRED data. Use these points when discussing rates and market conditions with your borrowers.
              </p>
            </div>
          </Section>
        )}

        {/* ═══════ RATE TRENDS ═══════ */}
        <Section id="rates" title="Rate & Spread Analysis" icon={<TrendingUp className="w-4 h-4 text-[var(--accent)]" />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Mortgage Rate Trends */}
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold">Mortgage Rate Trends</h4>
                <span className="text-[9px] text-[var(--text-muted)]">Source: Freddie Mac PMMS</span>
              </div>
              {ratesLoading ? <LoadingChart /> : chartRates.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartRates}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip content={<MiniTooltip />} />
                    <Line type="monotone" dataKey="rate30yr" name="30-Year" stroke="#EA580C" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="rate15yr" name="15-Year" stroke="#2563EB" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div className="flex gap-3 mt-1 text-[9px] text-[var(--text-muted)]">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#EA580C] inline-block" /> 30-Year</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#2563EB] inline-block" /> 15-Year</span>
              </div>
            </div>

            {/* Mortgage-Treasury Spread */}
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold">Mortgage-to-Treasury Spread</h4>
                <span className="text-[9px] text-[var(--text-muted)]">30yr Fixed − 10yr Treasury</span>
              </div>
              {ratesLoading ? <LoadingChart /> : chartSpread.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartSpread}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip content={<MiniTooltip />} />
                    {rateAnalysis.avgSpread && <ReferenceLine y={rateAnalysis.avgSpread} stroke="#999" strokeDasharray="4 4" label={{ value: `avg ${rateAnalysis.avgSpread}%`, fontSize: 9, fill: "#999" }} />}
                    <Area type="monotone" dataKey="spread" name="Spread" fill="#EA580C20" stroke="#EA580C" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
              <p className="text-[9px] text-[var(--text-muted)] mt-1">A wider spread means mortgage rates are high relative to Treasuries — potential for improvement. A narrow spread signals competitive rates.</p>
            </div>

            {/* Treasury Yield Trends */}
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold">Treasury Yield Trends</h4>
                <span className="text-[9px] text-[var(--text-muted)]">Source: U.S. Treasury</span>
              </div>
              {ratesLoading ? <LoadingChart /> : chartTreasury.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartTreasury}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip content={<MiniTooltip />} />
                    <Line type="monotone" dataKey="yr2" name="2-Year" stroke="#7C3AED" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="yr10" name="10-Year" stroke="#DC2626" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="yr30" name="30-Year" stroke="#D97706" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div className="flex gap-3 mt-1 text-[9px] text-[var(--text-muted)]">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#7C3AED] inline-block" /> 2Y</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#DC2626] inline-block" /> 10Y</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#D97706] inline-block" /> 30Y</span>
              </div>
            </div>

            {/* Yield Curve Spread */}
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold">Yield Curve (10Y − 2Y Spread)</h4>
                <span className="text-[9px] text-[var(--text-muted)]">Inverted = recession signal</span>
              </div>
              {ratesLoading ? <LoadingChart /> : chartYieldSpread.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartYieldSpread}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip content={<MiniTooltip />} />
                    <ReferenceLine y={0} stroke="#DC2626" strokeDasharray="4 4" />
                    <Area type="monotone" dataKey="spread" name="10Y-2Y Spread" fill={chartYieldSpread.length > 0 && (chartYieldSpread[chartYieldSpread.length - 1].spread ?? 0) > 0 ? "#16A34A20" : "#DC262620"} stroke={chartYieldSpread.length > 0 && (chartYieldSpread[chartYieldSpread.length - 1].spread ?? 0) > 0 ? "#16A34A" : "#DC2626"} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
              <p className="text-[9px] text-[var(--text-muted)] mt-1">Positive = normal (long-term rates higher). Negative (inverted) = historically signals recession. Watch for crossover.</p>
            </div>
          </div>
        </Section>

        {/* ═══════ ECONOMIC DASHBOARD ═══════ */}
        <Section id="economic" title="Economic Dashboard" icon={<Activity className="w-4 h-4 text-blue-600" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {economic.map((ind) => (
              <EconCard key={ind.name} indicator={ind} loading={ratesLoading} />
            ))}
          </div>
        </Section>

        {/* ═══════ PIPELINE EXPOSURE ═══════ */}
        {stateBreakdown && stateBreakdown.length > 0 && (
          <Section id="exposure" title="Your Pipeline Exposure" icon={<MapPin className="w-4 h-4 text-amber-600" />} defaultOpen={false}>
            <div className="glass-card p-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {stateBreakdown.slice(0, 10).map(s => (
                  <div key={s.state} className="p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold">{s.state}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{s.pct.toFixed(1)}%</span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">{s.count} loans</div>
                    <div className="text-xs font-semibold text-[var(--text)]">{fmtCurrency(s.volume)}</div>
                    <div className="w-full h-1.5 bg-gray-200 rounded-full mt-2 overflow-hidden">
                      <div className="h-full bg-[var(--accent)] rounded-full" style={{ width: `${Math.min(s.pct * 2, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-[var(--text-muted)] mt-3">
                News articles are flagged when they mention states in your active pipeline. State-level housing data helps you advise borrowers in your markets.
              </p>
            </div>
          </Section>
        )}

        {/* ═══════ NEWS FEED ═══════ */}
        <Section id="news" title="Industry News & Local Markets" icon={<Newspaper className="w-4 h-4 text-[var(--accent)]" />}>
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 flex-wrap mb-4">
              {["", ...Object.keys(CATEGORY_LABELS)].map(key => (
                <button key={key} onClick={() => { setNewsCategory(key); fetchNews(key || undefined); }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    newsCategory === key ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-white text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)]"
                  }`}
                >{key ? CATEGORY_LABELS[key] : "All"}</button>
              ))}
              {newsFetchedAt && <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" /> {timeAgo(newsFetchedAt)}</span>}
            </div>
            {newsLoading ? (
              <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="flex gap-3 animate-pulse"><div className="w-14 h-4 skeleton" /><div className="flex-1"><div className="h-4 skeleton mb-2 w-3/4" /><div className="h-3 skeleton w-1/3" /></div></div>)}</div>
            ) : newsError ? (
              <div className="text-sm text-red-600 p-4 text-center">{newsError}</div>
            ) : news.length === 0 ? (
              <div className="text-sm text-gray-400 p-8 text-center">No news articles found</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {newsWithExposure.map((item, i) => (
                  <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
                    className="flex items-start gap-3 py-2.5 px-1 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors group"
                  >
                    <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-[9px] font-medium border ${CATEGORY_COLORS[item.category] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                      {CATEGORY_LABELS[item.category] || item.category}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors line-clamp-2 leading-snug">
                        {item.title}<ExternalLink className="w-3 h-3 inline-block ml-1 opacity-0 group-hover:opacity-60" />
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[var(--text-muted)]">
                        {item.source && <span className="font-medium">{item.source}</span>}
                        {item.pubDate && <span>{timeAgo(item.pubDate)}</span>}
                      </div>
                      {item.matchedStates.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <MapPin className="w-3 h-3 text-amber-500 shrink-0" />
                          {item.matchedStates.map(ms => (
                            <span key={ms.state} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[9px] font-medium border border-amber-200">
                              {ms.state}: {ms.count} loans · {fmtCurrency(ms.volume)} · {ms.pct.toFixed(1)}%
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* ═══════ KNOWLEDGE CENTER ═══════ */}
        <Section id="knowledge" title="LO Knowledge Center" icon={<Target className="w-4 h-4 text-purple-600" />} defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <KnowledgeCard title="Why Do Mortgage Rates Move?" content="Mortgage rates are primarily driven by the 10-Year Treasury yield, plus a spread that reflects credit risk and market conditions. When the Fed raises rates, it directly affects short-term rates, but mortgage rates follow Treasury yields more closely. The spread between mortgage rates and the 10Y Treasury typically ranges from 1.5% to 2.5%." />
            <KnowledgeCard title="Reading the Yield Curve" content="A normal yield curve slopes upward (long-term rates > short-term). An inverted curve (2Y > 10Y) has preceded every recession since 1970. Watch the 10Y-2Y spread: when it turns negative, it's a warning sign. When it steepens from inversion, it often signals rate cuts ahead." />
            <KnowledgeCard title="Lock vs Float Decision" content="LOCK when: 10Y Treasury is trending up, the Fed signals hawkish policy, inflation data is hot, or your borrower can't afford rate risk. FLOAT when: 10Y is trending down, the spread is above average (room to compress), or major economic data suggests weakness. When in doubt, default to locking." />
            <KnowledgeCard title="Understanding the Spread" content="The mortgage-to-Treasury spread reflects MBS market conditions. A wider spread means lenders are keeping rates higher relative to Treasury yields — often during volatility. When the spread narrows, it's usually because the MBS market is calming and rates are becoming more competitive." />
            <KnowledgeCard title="Economic Calendar Impact" content="Key dates that move rates: CPI/PPI (inflation), Jobs Report (employment), FOMC meetings (Fed policy), GDP releases (growth), and Consumer Confidence. Hot inflation or strong jobs data = rates up. Weak data = rates down. Position your locks around these events." />
            <KnowledgeCard title="Talking to Borrowers About Rates" content="Don't predict where rates are going — focus on context. Share: where rates are vs 52-week range, the trend direction (up/down/flat), and what's driving the movement. Help them understand that waiting for 'the bottom' often means missing the opportunity. A rate that works for their budget is the right rate." />
          </div>
        </Section>

      </main>
    </div>
  );
}

// ─── Components ───

function PulseCard({ label, value, change, unit, direction, loading, icon, color }: {
  label: string; value: string; change?: number | null; unit?: string;
  direction?: "up" | "down" | "flat" | null; loading: boolean;
  icon: React.ReactNode; color: string;
}) {
  return (
    <div className="glass-card p-3">
      <div className={`text-[10px] text-[var(--text-muted)] font-medium mb-1 flex items-center gap-1 ${color}`}>{icon}{label}</div>
      {loading ? <div className="h-6 skeleton w-16" /> : (
        <>
          <div className="text-lg font-bold text-[var(--text)]">{value}</div>
          {change !== null && change !== undefined && (
            <span className={`flex items-center text-[10px] font-medium ${direction === "up" ? "text-red-600" : direction === "down" ? "text-emerald-600" : "text-gray-400"}`}>
              {direction === "up" ? <ArrowUpRight className="w-3 h-3" /> : direction === "down" ? <ArrowDownRight className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
              {Math.abs(change).toFixed(2)}{unit} vs last week
            </span>
          )}
        </>
      )}
    </div>
  );
}

function EconCard({ indicator, loading }: { indicator: EconIndicator; loading: boolean }) {
  const iconMap: Record<string, React.ReactNode> = {
    "Federal Funds Rate": <Zap className="w-3.5 h-3.5 text-purple-500" />,
    "CPI Index": <TrendingUp className="w-3.5 h-3.5 text-red-500" />,
    "Unemployment Rate": <Users className="w-3.5 h-3.5 text-blue-500" />,
    "Housing Starts": <Home className="w-3.5 h-3.5 text-emerald-500" />,
    "Case-Shiller HPI": <BarChart3 className="w-3.5 h-3.5 text-amber-500" />,
    "Consumer Sentiment": <Activity className="w-3.5 h-3.5 text-cyan-500" />,
    "Median Home Price": <DollarSign className="w-3.5 h-3.5 text-green-500" />,
    "Existing Home Sales": <Home className="w-3.5 h-3.5 text-indigo-500" />,
    "Affordability Index": <Target className="w-3.5 h-3.5 text-pink-500" />,
    "Months of Supply": <Clock className="w-3.5 h-3.5 text-slate-500" />,
  };

  return (
    <div className="glass-card p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          {iconMap[indicator.name] || <Activity className="w-3.5 h-3.5" />}
          <span className="text-[10px] font-semibold text-[var(--text)]">{indicator.name}</span>
        </div>
        <span className={`flex items-center gap-0.5 text-[10px] font-medium ${indicator.direction === "up" ? "text-red-500" : indicator.direction === "down" ? "text-emerald-500" : "text-gray-400"}`}>
          {indicator.direction === "up" ? <ArrowUpRight className="w-3 h-3" /> : indicator.direction === "down" ? <ArrowDownRight className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
        </span>
      </div>
      {loading ? <div className="h-5 skeleton w-12" /> : (
        <div className="text-base font-bold text-[var(--text)]">{fmtEconValue(indicator.value, indicator.name)}</div>
      )}
      {indicator.yoyChange !== null && indicator.yoyChange !== undefined && (
        <div className="text-[9px] text-[var(--text-muted)]">YoY: {indicator.yoyChange > 0 ? "+" : ""}{indicator.yoyChange.toFixed(1)}%</div>
      )}
      {/* Mini sparkline */}
      {indicator.series.length > 2 && (
        <div className="mt-1.5 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={indicator.series}>
              <Line type="monotone" dataKey="value" stroke={indicator.direction === "up" ? "#EF4444" : indicator.direction === "down" ? "#10B981" : "#9CA3AF"} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[8px] text-[var(--text-muted)] mt-1 line-clamp-2 leading-tight">{indicator.context}</p>
    </div>
  );
}

function KnowledgeCard({ title, content }: { title: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="glass-card p-4 cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors" onClick={() => setExpanded(!expanded)}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-[var(--text)]">{title}</h4>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
      </div>
      <p className={`text-xs text-[var(--text-muted)] leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>{content}</p>
    </div>
  );
}

function LoadingChart() {
  return <div className="flex items-center justify-center h-[200px] text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...</div>;
}

function EmptyChart() {
  return <div className="flex items-center justify-center h-[200px] text-xs text-gray-400">Data unavailable</div>;
}
