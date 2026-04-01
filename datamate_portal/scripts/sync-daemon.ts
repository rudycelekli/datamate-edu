/**
 * Background sync daemon: polls Encompass every 5 minutes and upserts
 * changed loans into Supabase. Runs independently — no web server needed.
 *
 * Usage:  npx tsx scripts/sync-daemon.ts
 * Stop:   Ctrl+C
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──
const envPath = resolve(__dirname, "../.env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  let val = trimmed.slice(eq + 1);
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    val = val.slice(1, -1);
  }
  process.env[key] = val;
}

// ── Config ──
const INTERVAL_MS = 5 * 60_000; // 5 minutes
const OVERLAP_MS = 2 * 60_000;  // 2 min overlap for safety
const MAX_LOANS_PER_SYNC = 5000;
const BATCH_SIZE = 500;

const API_BASE = "https://api.elliemae.com";
const CLIENT_ID = process.env.ENCOMPASS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.ENCOMPASS_CLIENT_SECRET || "";
const USERNAME = process.env.ENCOMPASS_USERNAME || "";
const PASSWORD = process.env.ENCOMPASS_PASSWORD || "";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PIPELINE_FIELDS = [
  "Loan.LoanNumber", "Loan.BorrowerFirstName", "Loan.BorrowerLastName",
  "Loan.CoBorrowerFirstName", "Loan.CoBorrowerLastName", "Loan.LoanFolder",
  "Loan.LastModified", "Loan.LoanAmount", "Loan.LoanStatus", "Loan.DateCreated",
  "Loan.CurrentMilestoneName", "Loan.LoanOfficerName", "Loan.LoanProcessorName",
  "Loan.SubjectPropertyAddress", "Loan.SubjectPropertyCity",
  "Loan.SubjectPropertyState", "Loan.SubjectPropertyZip", "Loan.NoteRatePercent",
  "Loan.LoanProgram", "Loan.LoanPurpose", "Loan.LienPosition", "Loan.Channel",
  "Loan.LockStatus", "Loan.LockExpirationDate", "Loan.ClosingDate",
  "Fields.14", "Fields.12", "Fields.11", "Fields.3", "Fields.748", "Fields.745",
];

// ── Auth ──
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const res = await fetch(`${API_BASE}/oauth2/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      username: USERNAME,
      password: PASSWORD,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).toString(),
  });

  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return data.access_token;
}

// ── Pipeline search ──
async function searchPipeline(
  filters: unknown,
  sortOrder: unknown[],
  start: number,
  limit: number,
): Promise<Array<{ loanGuid: string; fields: Record<string, string> }>> {
  const trashFilter = {
    canonicalName: "Loan.LoanFolder",
    value: "(Trash)",
    matchType: "exact",
    include: false,
  };

  const combinedFilter = filters
    ? { operator: "and", terms: [trashFilter, filters] }
    : trashFilter;

  const token = await getAccessToken();
  const url = new URL(`${API_BASE}/encompass/v1/loanPipeline`);
  url.searchParams.set("start", String(start));
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fields: PIPELINE_FIELDS, filter: combinedFilter, sortOrder }),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ── Field mapper ──
function pf(f: Record<string, string>, canonical: string, fieldId?: string) {
  return f[canonical] || (fieldId ? f[`Fields.${fieldId}`] : "") || "";
}

function toDbRow(loanGuid: string, f: Record<string, string>) {
  return {
    loan_guid: loanGuid,
    loan_number: f["Loan.LoanNumber"] || "",
    borrower_first: f["Loan.BorrowerFirstName"] || "",
    borrower_last: f["Loan.BorrowerLastName"] || "",
    co_borrower_first: f["Loan.CoBorrowerFirstName"] || "",
    co_borrower_last: f["Loan.CoBorrowerLastName"] || "",
    loan_folder: f["Loan.LoanFolder"] || "",
    last_modified: f["Loan.LastModified"] || "",
    loan_amount: parseFloat(f["Loan.LoanAmount"] || "0") || 0,
    loan_status: f["Loan.LoanStatus"] || "",
    date_created: f["Loan.DateCreated"] || "",
    milestone: f["Loan.CurrentMilestoneName"] || "",
    loan_officer: f["Loan.LoanOfficerName"] || "",
    loan_processor: f["Loan.LoanProcessorName"] || "",
    property_address: pf(f, "Loan.SubjectPropertyAddress", "11"),
    property_city: pf(f, "Loan.SubjectPropertyCity", "12"),
    property_state: pf(f, "Loan.SubjectPropertyState", "14"),
    property_zip: f["Loan.SubjectPropertyZip"] || "",
    note_rate: parseFloat(pf(f, "Loan.NoteRatePercent", "3") || "0") || 0,
    loan_program: f["Loan.LoanProgram"] || "",
    loan_purpose: f["Loan.LoanPurpose"] || "",
    lien_position: f["Loan.LienPosition"] || "",
    channel: f["Loan.Channel"] || "",
    lock_status: f["Loan.LockStatus"] || "",
    lock_expiration: f["Loan.LockExpirationDate"] || "",
    closing_date: pf(f, "Loan.ClosingDate", "748") || "",
    application_date: pf(f, "", "745") || "",
  };
}

// ── Delta sync ──
async function deltaSync(): Promise<{ upserted: number; totalRows: number; durationMs: number }> {
  const t0 = Date.now();

  // Mark as syncing
  await supabase.from("sync_status").upsert({ id: 1, status: "syncing", error_message: null });

  // Get last sync time
  const { data: statusRow } = await supabase
    .from("sync_status")
    .select("last_sync_at")
    .eq("id", 1)
    .single();

  const lastSync = statusRow?.last_sync_at
    ? new Date(new Date(statusRow.last_sync_at).getTime() - OVERLAP_MS)
    : new Date(Date.now() - 10 * 60_000); // fallback: last 10 min

  const sinceStr = lastSync.toISOString();

  // Fetch modified loans from Encompass
  let allRows: Array<{ loanGuid: string; fields: Record<string, string> }> = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore && allRows.length < MAX_LOANS_PER_SYNC) {
    const batch = await searchPipeline(
      {
        operator: "and",
        terms: [
          {
            canonicalName: "Loan.LastModified",
            value: sinceStr,
            matchType: "greaterThanOrEquals",
            include: true,
          },
        ],
      },
      [{ canonicalName: "Loan.LastModified", order: "desc" }],
      offset,
      BATCH_SIZE,
    );

    const rows = Array.isArray(batch) ? batch : [];
    allRows.push(...rows);
    offset += BATCH_SIZE;
    hasMore = rows.length === BATCH_SIZE;
  }

  // Upsert to Supabase
  let upserted = 0;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const slice = allRows.slice(i, i + BATCH_SIZE);
    const dbRows = slice.map((r) => toDbRow(r.loanGuid, r.fields || {}));

    const { error } = await supabase
      .from("pipeline_loans")
      .upsert(dbRows, { onConflict: "loan_guid" });

    if (error) {
      console.error(`  Upsert error batch ${i}: ${error.message}`);
    } else {
      upserted += slice.length;
    }
  }

  // Get total count
  const { count } = await supabase
    .from("pipeline_loans")
    .select("loan_guid", { count: "exact", head: true });

  const durationMs = Date.now() - t0;
  const totalRows = count || 0;

  // Update sync status
  await supabase.from("sync_status").upsert({
    id: 1,
    last_sync_at: new Date().toISOString(),
    total_rows: totalRows,
    status: "ready",
    error_message: null,
    sync_duration_ms: durationMs,
  });

  return { upserted, totalRows, durationMs };
}

// ── Main loop ──
async function main() {
  console.log("=== Encompass Sync Daemon ===");
  console.log(`  Interval: ${INTERVAL_MS / 1000}s`);
  console.log(`  Supabase: ${process.env.SUPABASE_URL}`);
  console.log("");

  // Verify connections
  console.log("Verifying Encompass auth...");
  await getAccessToken();
  console.log("  OK\n");

  console.log("Verifying Supabase...");
  const { error } = await supabase.from("sync_status").select("id").limit(1);
  if (error) throw new Error(`Supabase: ${error.message}`);
  console.log("  OK\n");

  // Run immediately on start, then every INTERVAL_MS
  const runSync = async () => {
    const now = new Date().toLocaleTimeString();
    process.stdout.write(`[${now}] Syncing... `);

    try {
      const result = await deltaSync();
      console.log(
        `${result.upserted} changed, ${result.totalRows} total, ${result.durationMs}ms`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`FAILED: ${msg}`);

      await supabase
        .from("sync_status")
        .upsert({ id: 1, status: "error", error_message: msg })
        .then(() => {});
    }
  };

  await runSync();

  console.log(`\nNext sync in ${INTERVAL_MS / 1000}s. Press Ctrl+C to stop.\n`);

  setInterval(async () => {
    await runSync();
  }, INTERVAL_MS);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
