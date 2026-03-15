import { NextResponse } from "next/server";

// FRED (Federal Reserve Economic Data) CSV endpoints - publicly accessible
const FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const SERIES = {
  rate30yr: "MORTGAGE30US",
  rate15yr: "MORTGAGE15US",
  yr2: "DGS2",
  yr5: "DGS5",
  yr10: "DGS10",
  yr30: "DGS30",
};

// Start date for data (last ~12 months)
const startDate = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
})();

interface RatePoint {
  date: string;
  rate30yr?: number;
  rate15yr?: number;
}

interface TreasuryPoint {
  date: string;
  yr2?: number;
  yr5?: number;
  yr10?: number;
  yr30?: number;
}

async function fetchFredSeries(seriesId: string): Promise<Map<string, number>> {
  const url = `${FRED_BASE}?id=${seriesId}&cosd=${startDate}&coed=2026-12-31`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return new Map();
  const text = await res.text();
  const map = new Map<string, number>();
  const lines = text.split("\n").slice(1); // skip header
  for (const line of lines) {
    const [date, val] = line.split(",");
    if (date && val && val.trim() !== ".") {
      const num = parseFloat(val);
      if (!isNaN(num)) map.set(date.trim(), num);
    }
  }
  return map;
}

export async function GET() {
  try {
    const [m30, m15, t2, t5, t10, t30] = await Promise.all([
      fetchFredSeries(SERIES.rate30yr),
      fetchFredSeries(SERIES.rate15yr),
      fetchFredSeries(SERIES.yr2),
      fetchFredSeries(SERIES.yr5),
      fetchFredSeries(SERIES.yr10),
      fetchFredSeries(SERIES.yr30),
    ]);

    // Mortgage rates (weekly, aligned by 30yr dates)
    const mortgageDates = [...m30.keys()].sort();
    const mortgage: RatePoint[] = mortgageDates.map((date) => ({
      date,
      rate30yr: m30.get(date),
      rate15yr: m15.get(date),
    }));

    // Treasury rates (daily, aligned by 10yr dates)
    const treasuryDates = [...t10.keys()].sort();
    // Take last 60 data points for readability
    const recentTreasury = treasuryDates.slice(-60);
    const treasury: TreasuryPoint[] = recentTreasury.map((date) => ({
      date,
      yr2: t2.get(date),
      yr5: t5.get(date),
      yr10: t10.get(date),
      yr30: t30.get(date),
    }));

    return NextResponse.json({
      mortgage,
      treasury,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch rates" },
      { status: 500 }
    );
  }
}
