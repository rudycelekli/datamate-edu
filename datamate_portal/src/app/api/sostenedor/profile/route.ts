import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";

/**
 * GET /api/sostenedor/profile?sost_id=XXXXX
 * Returns the full pre-computed profile for a sostenedor across all periods.
 * Also returns YOY comparisons and AI-ready context.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sostId = searchParams.get("sost_id");

    const db = getDesafioClient();

    if (sostId) {
      // Single sostenedor profile with all periods
      const [profileRes, yoyRes] = await Promise.all([
        db.from("mv_sostenedor_profile").select("*").eq("sost_id", sostId).order("periodo"),
        db.from("mv_sostenedor_yoy").select("*").eq("sost_id", sostId).order("periodo"),
      ]);

      if (profileRes.error) throw new Error(profileRes.error.message);

      return NextResponse.json({
        profile: profileRes.data || [],
        yoy: yoyRes.data || [],
        sostId,
      });
    }

    // List all sostenedores — fetch all rows (paginate past Supabase 1000 limit)
    const allProfiles: Record<string, unknown>[] = [];
    let offset = 0;
    const batchSize = 1000;
    while (true) {
      const { data, error: batchErr } = await db
        .from("mv_sostenedor_profile")
        .select("*")
        .order("risk_score", { ascending: false })
        .range(offset, offset + batchSize - 1);
      if (batchErr) throw new Error(batchErr.message);
      if (!data || data.length === 0) break;
      allProfiles.push(...data);
      offset += batchSize;
      if (data.length < batchSize) break;
    }

    // Group by sost_id, take latest periodo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latest = new Map<string, any>();
    for (const row of allProfiles) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any;
      const existing = latest.get(r.sost_id);
      if (!existing || r.periodo > existing.periodo) {
        latest.set(r.sost_id, r);
      }
    }

    const summary = {
      sostenedores: Array.from(latest.values()).sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)),
      total: latest.size,
      criticos: Array.from(latest.values()).filter(s => s.risk_level === "CRITICO").length,
      alertas: Array.from(latest.values()).filter(s => s.risk_level === "ALERTA").length,
      ok: Array.from(latest.values()).filter(s => s.risk_level === "OK").length,
    };

    return NextResponse.json(summary);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
