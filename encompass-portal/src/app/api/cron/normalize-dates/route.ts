import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

const DATE_COLS = [
  "date_created",
  "last_modified",
  "closing_date",
  "lock_expiration",
  "application_date",
];

function norm(raw: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}/.test(raw)) return raw;
  const match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (!match) return raw;
  const [, m, d, y, hRaw, min, sec, ampm] = match;
  let h = parseInt(hRaw, 10);
  if (ampm) {
    if (ampm.toUpperCase() === "PM" && h < 12) h += 12;
    if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
  }
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${String(h).padStart(2, "0")}:${min}:${sec}`;
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const PAGE = 500;
  let offset = 0;
  let updated = 0;
  let total = 0;
  let errors: string[] = [];
  let sampleBefore = "";
  let sampleAfter = "";

  try {
    while (true) {
      // Fetch ALL columns so upsert has complete rows
      const { data, error } = await supabaseAdmin
        .from("pipeline_loans")
        .select("*")
        .range(offset, offset + PAGE - 1);

      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      total += data.length;

      // Normalize date columns in each row
      const toUpdate: Record<string, unknown>[] = [];
      for (const row of data as Record<string, unknown>[]) {
        let changed = false;
        const updated_row = { ...row };
        // Remove the auto-generated updated_at column
        delete updated_row.updated_at;

        for (const col of DATE_COLS) {
          const raw = String(row[col] ?? "");
          const normalized = norm(raw);
          if (normalized !== raw) {
            updated_row[col] = normalized;
            changed = true;
            if (!sampleBefore) {
              sampleBefore = `${col}: ${raw}`;
              sampleAfter = normalized;
            }
          }
        }

        if (changed) toUpdate.push(updated_row);
      }

      if (toUpdate.length > 0) {
        const { error: upsertErr } = await supabaseAdmin
          .from("pipeline_loans")
          .upsert(toUpdate, { onConflict: "loan_guid" });
        if (upsertErr) {
          errors.push(`offset ${offset}: ${upsertErr.message}`);
        } else {
          updated += toUpdate.length;
        }
      }

      offset += PAGE;
      if (data.length < PAGE) break;
    }

    return NextResponse.json({
      ok: true,
      total,
      updated,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      sample: sampleBefore ? { before: sampleBefore, after: sampleAfter } : "already normalized",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg, errors: errors.slice(0, 5) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
