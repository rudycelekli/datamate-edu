import { NextResponse } from "next/server";

// FRED (Federal Reserve Economic Data) CSV endpoints - publicly accessible, no API key needed
const FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";

const SERIES = {
  // Mortgage rates (weekly)
  rate30yr: "MORTGAGE30US",
  rate15yr: "MORTGAGE15US",
  // Treasury yields (daily)
  yr2: "DGS2",
  yr5: "DGS5",
  yr10: "DGS10",
  yr30: "DGS30",
  // Economic indicators
  fedFunds: "FEDFUNDS",         // Federal Funds Rate (monthly)
  cpi: "CPIAUCSL",             // CPI All Urban (monthly, index)
  unemployment: "UNRATE",       // Unemployment Rate (monthly)
  housingStarts: "HOUST",      // Housing Starts (monthly, thousands)
  caseShiller: "CSUSHPINSA",   // Case-Shiller National HPI (monthly)
  consumerSentiment: "UMCSENT", // U of Michigan Consumer Sentiment (monthly)
  medianPrice: "MSPUS",        // Median Sales Price of Houses Sold (quarterly)
  spread10y2y: "T10Y2Y",       // 10Y-2Y Treasury Spread (daily)
  personalSavings: "PSAVERT",  // Personal Savings Rate (monthly)
  existingHomeSales: "EXHOSLUSM495S", // Existing Home Sales (monthly)
  newHomeSales: "HSN1F",       // New Home Sales (monthly, thousands)
  mortgageApps: "MBAVPREALAPPW", // MBA Mortgage Applications (weekly, may be discontinued)
};

// Start date for rate/treasury data (1 year)
const rateStart = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
})();

// Start date for economic data (3 years for trends)
const econStart = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 3);
  return d.toISOString().slice(0, 10);
})();

async function fetchFredSeries(seriesId: string, start?: string): Promise<Map<string, number>> {
  const url = `${FRED_BASE}?id=${seriesId}&cosd=${start || rateStart}&coed=2026-12-31`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return new Map();
    const text = await res.text();
    const map = new Map<string, number>();
    const lines = text.split("\n").slice(1);
    for (const line of lines) {
      const [date, val] = line.split(",");
      if (date && val && val.trim() !== ".") {
        const num = parseFloat(val);
        if (!isNaN(num)) map.set(date.trim(), num);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function getLatest(map: Map<string, number>): { value: number; date: string } | null {
  const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return null;
  const [date, value] = entries[entries.length - 1];
  return { value, date };
}

function getPrev(map: Map<string, number>, n = 1): { value: number; date: string } | null {
  const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length < n + 1) return null;
  const [date, value] = entries[entries.length - 1 - n];
  return { value, date };
}

function calcYoY(map: Map<string, number>): number | null {
  const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length < 13) return null; // need 12+ months
  const current = entries[entries.length - 1][1];
  const yearAgo = entries[entries.length - 13]?.[1];
  if (!yearAgo || yearAgo === 0) return null;
  return ((current - yearAgo) / yearAgo) * 100;
}

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

export async function GET() {
  try {
    // Fetch all data in parallel
    const [
      m30, m15, t2, t5, t10, t30,
      fedFunds, cpi, unemployment, housingStarts,
      caseShiller, consumerSentiment, medianPrice,
      spread10y2y, existingHomeSales,
    ] = await Promise.all([
      fetchFredSeries(SERIES.rate30yr),
      fetchFredSeries(SERIES.rate15yr),
      fetchFredSeries(SERIES.yr2),
      fetchFredSeries(SERIES.yr5),
      fetchFredSeries(SERIES.yr10),
      fetchFredSeries(SERIES.yr30),
      fetchFredSeries(SERIES.fedFunds, econStart),
      fetchFredSeries(SERIES.cpi, econStart),
      fetchFredSeries(SERIES.unemployment, econStart),
      fetchFredSeries(SERIES.housingStarts, econStart),
      fetchFredSeries(SERIES.caseShiller, econStart),
      fetchFredSeries(SERIES.consumerSentiment, econStart),
      fetchFredSeries(SERIES.medianPrice, econStart),
      fetchFredSeries(SERIES.spread10y2y),
      fetchFredSeries(SERIES.existingHomeSales, econStart),
    ]);

    // ─── Mortgage rates ───
    const mortgageDates = [...m30.keys()].sort();
    const mortgage = mortgageDates.map((date) => ({
      date,
      rate30yr: m30.get(date),
      rate15yr: m15.get(date),
    }));

    // ─── Treasury rates ───
    const treasuryDates = [...t10.keys()].sort();
    const recentTreasury = treasuryDates.slice(-60);
    const treasury = recentTreasury.map((date) => ({
      date,
      yr2: t2.get(date),
      yr5: t5.get(date),
      yr10: t10.get(date),
      yr30: t30.get(date),
    }));

    // ─── Spread data (30yr mortgage - 10yr treasury) ───
    const spreadData = mortgageDates
      .filter(d => m30.has(d))
      .map(date => {
        const t10val = t10.get(date);
        const m30val = m30.get(date);
        return {
          date,
          spread: m30val && t10val ? +(m30val - t10val).toFixed(2) : null,
          rate30yr: m30val,
          yr10: t10val,
        };
      })
      .filter(d => d.spread !== null);

    // ─── 10Y-2Y Spread (yield curve) ───
    const spreadDates = [...spread10y2y.keys()].sort().slice(-60);
    const yieldCurveSpread = spreadDates.map(date => ({
      date,
      spread: spread10y2y.get(date),
    }));

    // ─── Rate Analysis ───
    const latestRate30 = getLatest(m30);
    const weekAgoRate30 = getPrev(m30, 1);
    const monthAgoRate30 = getPrev(m30, 4);
    const yearAgoRate30 = getPrev(m30, 52);

    const rateAnalysis = {
      current30yr: latestRate30?.value,
      weekChange: latestRate30 && weekAgoRate30 ? +(latestRate30.value - weekAgoRate30.value).toFixed(2) : null,
      monthChange: latestRate30 && monthAgoRate30 ? +(latestRate30.value - monthAgoRate30.value).toFixed(2) : null,
      yearChange: latestRate30 && yearAgoRate30 ? +(latestRate30.value - yearAgoRate30.value).toFixed(2) : null,
      yearHigh: Math.max(...[...m30.values()]),
      yearLow: Math.min(...[...m30.values()]),
      currentSpread: spreadData.length > 0 ? spreadData[spreadData.length - 1].spread : null,
      avgSpread: spreadData.length > 0
        ? +(spreadData.reduce((s, d) => s + (d.spread || 0), 0) / spreadData.length).toFixed(2)
        : null,
    };

    // ─── Economic Indicators ───
    function buildIndicator(
      name: string,
      map: Map<string, number>,
      changeType: "bps" | "pct" | "pts" | "value",
      context: string,
    ): EconIndicator {
      const latest = getLatest(map);
      const prev = getPrev(map);
      const val = latest?.value ?? 0;
      const prevVal = prev?.value ?? null;
      const change = prevVal !== null ? +(val - prevVal).toFixed(2) : null;
      const direction: "up" | "down" | "flat" = change === null ? "flat" : change > 0.005 ? "up" : change < -0.005 ? "down" : "flat";

      const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const series = entries.slice(-24).map(([date, value]) => ({ date, value }));

      return {
        name,
        value: val,
        prevValue: prevVal,
        change,
        changeType,
        direction,
        date: latest?.date || "",
        yoyChange: calcYoY(map),
        series,
        context,
      };
    }

    const economic: EconIndicator[] = [
      buildIndicator("Federal Funds Rate", fedFunds, "bps",
        "The Fed's benchmark rate. When it rises, mortgage rates tend to follow. Rate cuts signal cheaper borrowing ahead."),
      buildIndicator("CPI Index", cpi, "pts",
        "Consumer Price Index measures inflation. High CPI = higher rates. The Fed targets 2% annual inflation."),
      buildIndicator("Unemployment Rate", unemployment, "pts",
        "Low unemployment = strong economy = potentially higher rates. High unemployment may lead to rate cuts."),
      buildIndicator("Housing Starts", housingStarts, "value",
        "New home construction starts (thousands/year). High starts = builder confidence. Low starts = potential inventory shortage."),
      buildIndicator("Case-Shiller HPI", caseShiller, "pts",
        "National Home Price Index. Rising prices = growing equity for homeowners. Rapid rises may trigger affordability concerns."),
      buildIndicator("Consumer Sentiment", consumerSentiment, "pts",
        "University of Michigan survey. Higher = consumers feel good about the economy. Affects home buying decisions."),
      buildIndicator("Median Home Price", medianPrice, "value",
        "Median price of homes sold nationally. Key affordability metric. Compare to your pipeline's average loan size."),
      buildIndicator("Existing Home Sales", existingHomeSales, "value",
        "Annualized rate of existing home sales (millions). Indicates housing market activity and inventory turnover."),
    ];

    // CPI YoY inflation rate
    const cpiEntries = [...cpi.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let inflationRate: number | null = null;
    if (cpiEntries.length >= 13) {
      const current = cpiEntries[cpiEntries.length - 1][1];
      const yearAgo = cpiEntries[cpiEntries.length - 13][1];
      inflationRate = +((current - yearAgo) / yearAgo * 100).toFixed(1);
    }

    // ─── Rate Lock Advisor signals ───
    const last5Treasury = [...t10.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-5);
    const treasuryTrend = last5Treasury.length >= 2
      ? last5Treasury[last5Treasury.length - 1][1] - last5Treasury[0][1]
      : 0;

    const lastSpread = spreadData.length > 0 ? spreadData[spreadData.length - 1].spread : null;
    const avgSpread = rateAnalysis.avgSpread;

    let lockSignal: "lock" | "float" | "neutral" = "neutral";
    let lockReason = "";

    if (treasuryTrend > 0.05) {
      lockSignal = "lock";
      lockReason = `10Y Treasury rose ${(treasuryTrend * 100).toFixed(0)} bps over last 5 days — rates likely moving up. Lock now.`;
    } else if (treasuryTrend < -0.05) {
      lockSignal = "float";
      lockReason = `10Y Treasury fell ${Math.abs(treasuryTrend * 100).toFixed(0)} bps over last 5 days — rates may drop further. Consider floating.`;
    } else if (lastSpread !== null && avgSpread !== null && lastSpread > avgSpread + 0.2) {
      lockSignal = "lock";
      lockReason = `Mortgage-Treasury spread is ${lastSpread}% vs ${avgSpread}% average — above-average spread suggests lock now before compression.`;
    } else if (lastSpread !== null && avgSpread !== null && lastSpread < avgSpread - 0.1) {
      lockSignal = "float";
      lockReason = `Mortgage-Treasury spread is tight at ${lastSpread}% vs ${avgSpread}% average — favorable conditions, rates may improve.`;
    } else {
      lockReason = "Market is relatively stable. No strong directional signals. Default to locking if within target range.";
    }

    return NextResponse.json({
      mortgage,
      treasury,
      spreadData,
      yieldCurveSpread,
      rateAnalysis,
      economic,
      inflationRate,
      lockAdvisor: { signal: lockSignal, reason: lockReason, treasuryTrend: +(treasuryTrend * 100).toFixed(1) },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch rates" },
      { status: 500 }
    );
  }
}
