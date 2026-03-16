/**
 * One-time seed script: loads ALL Encompass loans into Supabase.
 * Run: npx tsx scripts/seed-supabase.ts
 *
 * Requires .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ──
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(__dirname, "../.env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  let val = trimmed.slice(eq + 1);
  // Strip quotes
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    val = val.slice(1, -1);
  }
  process.env[key] = val;
}

// ── Setup ──

const API_BASE = "https://api.elliemae.com";
const CLIENT_ID = process.env.ENCOMPASS_CLIENT_ID || "ybfs8jf";
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

const BATCH_SIZE = 500;

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

// ── Month windows (same logic as pipeline-cache.ts) ──

function generateMonthWindows(): Array<{ from: string; to: string; label: string }> {
  const months: Array<{ from: string; to: string; label: string }> = [];
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1;
  let y = 2000, m = 1;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    months.push({
      from: `${y}-${String(m).padStart(2, "0")}-01`,
      to: `${nextY}-${String(nextM).padStart(2, "0")}-01`,
      label: `${y}-${String(m).padStart(2, "0")}`,
    });
    m = nextM;
    y = nextY;
  }
  return months;
}

// ── Main ──

async function main() {
  console.log("=== Encompass → Supabase Seed ===\n");

  // Verify Supabase connection
  const { error: pingError } = await supabase.from("sync_status").select("id").limit(1);
  if (pingError) {
    console.error("Cannot connect to Supabase:", pingError.message);
    console.error("Make sure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local");
    console.error("And that you've run the schema SQL in scripts/supabase-schema.sql");
    process.exit(1);
  }

  // Verify Encompass auth
  console.log("Authenticating with Encompass...");
  await getAccessToken();
  console.log("Authenticated.\n");

  const seenGuids = new Set<string>();
  let totalInserted = 0;
  const pendingRows: ReturnType<typeof toDbRow>[] = [];

  async function flushBatch() {
    if (pendingRows.length === 0) return;
    const batch = pendingRows.splice(0, pendingRows.length);
    const { error } = await supabase
      .from("pipeline_loans")
      .upsert(batch, { onConflict: "loan_guid" });
    if (error) {
      console.error(`  Upsert error: ${error.message}`);
    } else {
      totalInserted += batch.length;
    }
  }

  // Fetch by month windows
  const months = generateMonthWindows();
  console.log(`Fetching loans across ${months.length} month windows...\n`);

  for (const { from, to, label } of months) {
    let offset = 0;
    let hasMore = true;
    let monthCount = 0;

    while (hasMore) {
      try {
        const batch = await searchPipeline(
          {
            operator: "and",
            terms: [
              { canonicalName: "Loan.DateCreated", value: from, matchType: "greaterThanOrEquals", include: true },
              { canonicalName: "Loan.DateCreated", value: to, matchType: "lessThan", include: true },
            ],
          },
          [{ canonicalName: "Loan.DateCreated", order: "asc" }],
          offset,
          BATCH_SIZE,
        );

        let newInBatch = 0;
        for (const row of batch) {
          if (!seenGuids.has(row.loanGuid)) {
            seenGuids.add(row.loanGuid);
            pendingRows.push(toDbRow(row.loanGuid, row.fields || {}));
            newInBatch++;
            monthCount++;
          }
        }

        offset += BATCH_SIZE;
        hasMore = batch.length === BATCH_SIZE;

        // All dupes — API is recycling
        if (newInBatch === 0 && batch.length === BATCH_SIZE) hasMore = false;

        // Flush when batch is large enough
        if (pendingRows.length >= BATCH_SIZE) await flushBatch();
      } catch (err) {
        console.error(`  Error in ${label} offset ${offset}: ${err}`);
        hasMore = false;
      }
    }

    if (monthCount > 0) {
      process.stdout.write(`  ${label}: ${monthCount} new loans (${seenGuids.size} total)\n`);
    }
  }

  // Also fetch loans with no DateCreated
  console.log("\nFetching loans with empty DateCreated...");
  let offset = 0;
  let hasMore = true;
  let emptyCount = 0;
  while (hasMore) {
    try {
      const batch = await searchPipeline(
        { canonicalName: "Loan.DateCreated", value: "", matchType: "isEmpty", include: true },
        [{ canonicalName: "Loan.LoanNumber", order: "asc" }],
        offset,
        BATCH_SIZE,
      );

      let newInBatch = 0;
      for (const row of batch) {
        if (!seenGuids.has(row.loanGuid)) {
          seenGuids.add(row.loanGuid);
          pendingRows.push(toDbRow(row.loanGuid, row.fields || {}));
          newInBatch++;
          emptyCount++;
        }
      }

      offset += BATCH_SIZE;
      hasMore = batch.length === BATCH_SIZE && newInBatch > 0;

      if (pendingRows.length >= BATCH_SIZE) await flushBatch();
    } catch {
      hasMore = false;
    }
  }
  if (emptyCount > 0) console.log(`  Found ${emptyCount} loans with empty DateCreated`);

  // Final flush
  await flushBatch();

  // Update sync status
  await supabase.from("sync_status").upsert({
    id: 1,
    last_sync_at: new Date().toISOString(),
    total_rows: seenGuids.size,
    status: "ready",
    error_message: null,
    sync_duration_ms: 0,
  });

  console.log(`\n=== Done! ${totalInserted} loans upserted to Supabase (${seenGuids.size} unique) ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
