import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getFilterOptions, getStatus } from "@/lib/supabase-queries";

/**
 * Server-side aggregation for Intelligence page.
 * Avoids shipping 22k+ rows to the browser — sends only pre-computed stats (~5KB).
 */

interface Bucket { units: number; volume: number }

async function fetchAllRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
  pageSize = 1000,
) {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as Record<string, unknown>[];
    all.push(...rows);
    offset += pageSize;
    hasMore = rows.length === pageSize;
  }
  return all;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    // Build filtered query
    function buildQuery() {
      let q = supabaseAdmin.from("pipeline_loans").select(
        "loan_amount,loan_program,loan_purpose,milestone,loan_officer,lock_status,note_rate,property_state,date_created,lien_position,channel,closing_date,lock_expiration",
      );
      const state = sp.get("state");
      const lo = sp.get("lo");
      const milestone = sp.get("milestone");
      const program = sp.get("program");
      const purpose = sp.get("purpose");
      const lock = sp.get("lock");
      const dateFrom = sp.get("dateFrom");
      const dateTo = sp.get("dateTo");

      if (state) q = q.eq("property_state", state);
      if (lo) q = q.eq("loan_officer", lo);
      if (milestone) q = q.eq("milestone", milestone);
      if (program) q = q.eq("loan_program", program);
      if (purpose) q = q.eq("loan_purpose", purpose);
      if (lock) q = q.eq("lock_status", lock);
      if (dateFrom) q = q.gte("date_created", dateFrom);
      if (dateTo) q = q.lte("date_created", dateTo + "T23:59:59");
      return q;
    }

    const [allRows, filterOpts, statusData] = await Promise.all([
      fetchAllRows(buildQuery),
      getFilterOptions(),
      getStatus(),
    ]);

    // ── Aggregate everything server-side ──
    const byMilestone: Record<string, Bucket> = {};
    const byState: Record<string, Bucket> = {};
    const byProgram: Record<string, Bucket> = {};
    const byPurpose: Record<string, Bucket> = {};
    const byLO: Record<string, Bucket> = {};
    const byLock: Record<string, number> = {};
    const byLien: Record<string, number> = {};
    const rateRanges: Record<string, number> = {};
    const amountRanges: Record<string, number> = {};
    const monthlyTrend: Record<string, Bucket> = {};

    let totalVolume = 0;
    let rateSum = 0;
    let rateCount = 0;

    for (const r of allRows) {
      const amount = Number(r.loan_amount) || 0;
      const ms = (r.milestone as string) || "Unknown";
      const st = (r.property_state as string) || "";
      const prog = (r.loan_program as string) || "Other";
      const purp = (r.loan_purpose as string) || "Unknown";
      const lo = (r.loan_officer as string) || "";
      const lock = (r.lock_status as string) || "Unknown";
      const rate = Number(r.note_rate) || 0;
      const lien = (r.lien_position as string) || "Unknown";
      const created = (r.date_created as string) || "";

      totalVolume += amount;

      // Milestone
      if (!byMilestone[ms]) byMilestone[ms] = { units: 0, volume: 0 };
      byMilestone[ms].units++;
      byMilestone[ms].volume += amount;

      // State
      if (st) {
        if (!byState[st]) byState[st] = { units: 0, volume: 0 };
        byState[st].units++;
        byState[st].volume += amount;
      }

      // Program type (simplified)
      let pType = "Other";
      const pl = prog.toLowerCase();
      if (pl.includes("fha")) pType = "FHA";
      else if (pl.includes("va ") || pl.startsWith("va")) pType = "VA";
      else if (pl.includes("usda")) pType = "USDA";
      else if (pl.includes("jumbo")) pType = "Jumbo";
      else if (pl.includes("conv") || pl.includes("fannie") || pl.includes("freddie") || pl.includes("agency")) pType = "Conventional";
      if (!byProgram[pType]) byProgram[pType] = { units: 0, volume: 0 };
      byProgram[pType].units++;
      byProgram[pType].volume += amount;

      // Purpose
      if (!byPurpose[purp]) byPurpose[purp] = { units: 0, volume: 0 };
      byPurpose[purp].units++;
      byPurpose[purp].volume += amount;

      // LO
      if (lo) {
        if (!byLO[lo]) byLO[lo] = { units: 0, volume: 0 };
        byLO[lo].units++;
        byLO[lo].volume += amount;
      }

      // Lock
      byLock[lock] = (byLock[lock] || 0) + 1;

      // Rate distribution
      if (rate > 0) {
        rateSum += rate;
        rateCount++;
        const bucket = rate < 5 ? "<5%" : rate < 5.5 ? "5-5.5%" : rate < 6 ? "5.5-6%" : rate < 6.5 ? "6-6.5%" : rate < 7 ? "6.5-7%" : rate < 7.5 ? "7-7.5%" : rate < 8 ? "7.5-8%" : ">8%";
        rateRanges[bucket] = (rateRanges[bucket] || 0) + 1;
      }

      // Amount distribution
      if (amount > 0) {
        const bucket = amount < 200000 ? "<$200K" : amount < 300000 ? "$200-300K" : amount < 400000 ? "$300-400K" : amount < 500000 ? "$400-500K" : amount < 750000 ? "$500-750K" : amount < 1000000 ? "$750K-1M" : ">$1M";
        amountRanges[bucket] = (amountRanges[bucket] || 0) + 1;
      }

      // Monthly trend
      if (created) {
        const key = created.slice(0, 7); // "YYYY-MM"
        if (key.length === 7) {
          if (!monthlyTrend[key]) monthlyTrend[key] = { units: 0, volume: 0 };
          monthlyTrend[key].units++;
          monthlyTrend[key].volume += amount;
        }
      }

      // Lien
      const lienLabel = lien === "FirstLien" ? "First Lien" : lien === "SecondLien" ? "Second Lien" : lien;
      byLien[lienLabel] = (byLien[lienLabel] || 0) + 1;
    }

    const totalUnits = allRows.length;

    // ── Format into chart-ready arrays ──
    const sort = <T extends { units?: number; volume?: number; value?: number }>(arr: T[], key: "units" | "volume" | "value") =>
      arr.sort((a, b) => ((b[key] as number) || 0) - ((a[key] as number) || 0));

    const milestoneData = sort(Object.entries(byMilestone).map(([name, d]) => ({ name, ...d })), "units");
    const stateData = sort(Object.entries(byState).map(([name, d]) => ({ name, ...d })), "volume").slice(0, 20);
    const programData = sort(Object.entries(byProgram).map(([name, d]) => ({ name, ...d })), "volume");
    const purposeData = sort(Object.entries(byPurpose).map(([name, d]) => ({ name, ...d })), "volume");
    const loData = sort(Object.entries(byLO).map(([name, d]) => ({ name, ...d })), "volume").slice(0, 25);
    const lockData = sort(Object.entries(byLock).map(([name, value]) => ({ name, value })), "value");
    const lienData = Object.entries(byLien).map(([name, value]) => ({ name, value }));

    const rateOrder = ["<5%", "5-5.5%", "5.5-6%", "6-6.5%", "6.5-7%", "7-7.5%", "7.5-8%", ">8%"];
    const rateData = rateOrder.map((name) => ({ name, units: rateRanges[name] || 0 })).filter(d => d.units > 0);
    const amtOrder = ["<$200K", "$200-300K", "$300-400K", "$400-500K", "$500-750K", "$750K-1M", ">$1M"];
    const amountData = amtOrder.map((name) => ({ name, units: amountRanges[name] || 0 })).filter(d => d.units > 0);
    const trendData = Object.entries(monthlyTrend)
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(-12);

    const topState = stateData[0];
    const topStatePercent = topState ? ((topState.volume / totalVolume) * 100).toFixed(1) : "0";
    const avgRate = rateCount > 0 ? (rateSum / rateCount).toFixed(2) : "0";
    const purchaseCount = byPurpose["Purchase"]?.units || 0;
    const purchasePercent = totalUnits ? ((purchaseCount / totalUnits) * 100).toFixed(1) : "0";
    const avgByProgram = programData.map(d => ({
      name: d.name, avgAmount: d.units > 0 ? Math.round(d.volume / d.units) : 0, units: d.units,
    }));
    const milestoneVolData = milestoneData.map(d => ({
      name: d.name.length > 16 ? d.name.slice(0, 14) + "..." : d.name, units: d.units, volume: d.volume,
    }));

    // Rate by program
    const rateByProg: Record<string, { total: number; count: number }> = {};
    for (const r of allRows) {
      const rate = Number(r.note_rate) || 0;
      const prog = ((r.loan_program as string) || "Other").toLowerCase();
      let pType = "Other";
      if (prog.includes("fha")) pType = "FHA";
      else if (prog.includes("va ") || prog.startsWith("va")) pType = "VA";
      else if (prog.includes("usda")) pType = "USDA";
      else if (prog.includes("jumbo")) pType = "Jumbo";
      else if (prog.includes("conv") || prog.includes("fannie") || prog.includes("freddie") || prog.includes("agency")) pType = "Conventional";
      if (rate > 0) {
        if (!rateByProg[pType]) rateByProg[pType] = { total: 0, count: 0 };
        rateByProg[pType].total += rate;
        rateByProg[pType].count++;
      }
    }
    const avgRateByProgram = Object.entries(rateByProg)
      .map(([name, d]) => ({ name, avgRate: parseFloat((d.total / d.count).toFixed(3)) }))
      .sort((a, b) => b.avgRate - a.avgRate);

    // State × Purpose cross-tab (top 10 states)
    const topStates = stateData.slice(0, 10).map(s => s.name);
    const statePurposeData: Array<Record<string, unknown>> = [];
    const stPurpAgg: Record<string, Record<string, number>> = {};
    for (const r of allRows) {
      const st = (r.property_state as string) || "";
      if (!topStates.includes(st)) continue;
      const purp = (r.loan_purpose as string) || "Other";
      if (!stPurpAgg[st]) stPurpAgg[st] = {};
      stPurpAgg[st][purp] = (stPurpAgg[st][purp] || 0) + 1;
    }
    for (const st of topStates) {
      statePurposeData.push({ name: st, ...(stPurpAgg[st] || {}) });
    }
    const allPurposes = [...new Set(allRows.map(r => (r.loan_purpose as string) || "Other"))];

    // LO table
    const loTableData = loData.map(d => ({
      ...d,
      avgLoan: d.units > 0 ? Math.round(d.volume / d.units) : 0,
      pct: totalVolume > 0 ? parseFloat(((d.volume / totalVolume) * 100).toFixed(1)) : 0,
    }));

    const cacheAge = statusData.lastRefresh
      ? Date.now() - new Date(statusData.lastRefresh).getTime()
      : 0;

    return NextResponse.json({
      totalUnits,
      totalVolume,
      milestoneData,
      stateData,
      programData,
      purposeData,
      loData,
      lockData,
      rateData,
      amountData,
      trendData,
      lienData,
      topState: topState?.name || "--",
      topStatePercent,
      avgRate,
      purchasePercent,
      byStateMap: byState,
      avgByProgram,
      milestoneVolData,
      avgRateByProgram,
      statePurposeData,
      allPurposes,
      loTableData,
      cacheAge,
      filterOptions: filterOpts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
