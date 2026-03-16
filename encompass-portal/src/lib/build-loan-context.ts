/**
 * Build a rich, PII-free markdown context string from a stripped loan object.
 * Used by Milo AI copilot to understand the current loan without accessing PII.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Helpers ──

/** Safely access a nested value with a dot-separated path. */
function safe(obj: any, path: string, fallback: string = "N/A"): string {
  const val = path.split(".").reduce((o, k) => o?.[k], obj);
  if (val === undefined || val === null || val === "") return fallback;
  return String(val);
}

/** Look up a custom field by fieldName. */
function cx(obj: any, fieldName: string, fallback: string = "N/A"): string {
  const cf = obj?.customFields;
  if (!Array.isArray(cf)) return fallback;
  const entry = cf.find((f: any) => f?.fieldName === fieldName);
  if (!entry || entry.value === undefined || entry.value === null || entry.value === "")
    return fallback;
  return String(entry.value);
}

function fmtMoney(val: any): string {
  if (val === undefined || val === null || val === "") return "N/A";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return String(val);
  return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(val: any): string {
  if (val === undefined || val === null || val === "") return "N/A";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return String(val);
  return num.toFixed(3) + "%";
}

/** Get applications[0] safely. */
function firstApp(loan: any): any {
  return loan?.applications?.[0] ?? {};
}

// ── Sections ──

function piiSafetyHeader(): string {
  return `## PII Safety Notice
**IMPORTANT:** This loan context has been scrubbed of personally identifiable information.
- Do NOT attempt to reproduce or infer: SSNs, full names, street addresses, account numbers, dates of birth, email addresses, phone numbers, or credit scores.
- Refer to the primary borrower as "the borrower" and co-borrower as "the co-borrower."
- If asked for PII, explain that it has been removed for privacy and security reasons.
`;
}

function loanOverview(loan: any): string {
  const app = firstApp(loan);
  const lines = ["## Loan Overview", ""];
  const rows: [string, string][] = [
    ["Loan Number", safe(loan, "loanNumber")],
    ["Agency Case #", safe(loan, "agencyCaseIdentifier")],
    ["Loan Type", safe(loan, "loanType")],
    ["Loan Program", safe(loan, "loanProgramName")],
    ["Loan Purpose", safe(loan, "loanPurposeType")],
    ["Current Milestone", safe(loan, "currentMilestoneName")],
    ["File Status", safe(loan, "loanFolder")],
    ["Channel", safe(loan, "channel")],
    ["Loan Amount", fmtMoney(loan?.baseLoanAmount)],
    ["Note Rate", fmtPct(loan?.requestedInterestRatePercent)],
    ["Amortization Type", safe(loan, "amortizationType")],
    ["Loan Term (months)", safe(loan, "loanTermMonths")],
    ["LTV", fmtPct(loan?.ltv)],
    ["CLTV", fmtPct(loan?.cltv)],
    ["DTI (Front)", fmtPct(app?.frontEndRatio)],
    ["DTI (Back)", fmtPct(app?.backEndRatio)],
    ["AUS Recommendation", safe(loan, "ausRecommendation")],
    ["QM Status", safe(loan, "qmStatus")],
    ["Application Date", safe(loan, "applicationDate")],
    ["Expected Close Date", safe(loan, "expectedCloseDate")],
  ];
  rows.forEach(([label, val]) => lines.push(`- **${label}:** ${val}`));
  return lines.join("\n");
}

function propertySection(loan: any): string {
  const prop = firstApp(loan)?.property ?? {};
  const lines = ["## Property", ""];
  const rows: [string, string][] = [
    ["City", safe(prop, "city")],
    ["State", safe(prop, "state")],
    ["Zip", safe(prop, "postalCode")],
    ["County", safe(prop, "county")],
    ["Property Type", safe(prop, "propertyType")],
    ["Number of Units", safe(prop, "numberOfUnits")],
    ["Year Built", safe(prop, "yearBuilt")],
    ["Occupancy", safe(prop, "occupancyType")],
    ["Appraised Value", fmtMoney(prop?.appraisedValue)],
    ["Purchase Price", fmtMoney(prop?.purchasePrice)],
    ["Flood Zone", safe(prop, "floodZone")],
  ];

  // REO properties count
  const reos = loan?.reoProperties;
  if (Array.isArray(reos) && reos.length > 0) {
    rows.push(["REO Properties", `${reos.length} property(ies)`]);
  }

  rows.forEach(([label, val]) => lines.push(`- **${label}:** ${val}`));
  return lines.join("\n");
}

function incomeAndAssets(loan: any): string {
  const app = firstApp(loan);
  const lines = ["## Income & Assets", ""];

  // Income
  const totalMonthlyIncome = app?.totalMonthlyIncome;
  lines.push(`- **Total Monthly Income:** ${fmtMoney(totalMonthlyIncome)}`);
  if (totalMonthlyIncome) {
    const annual = (typeof totalMonthlyIncome === "string" ? parseFloat(totalMonthlyIncome) : totalMonthlyIncome) * 12;
    lines.push(`- **Annual Income (est.):** ${fmtMoney(annual)}`);
  }

  // Income sources (from employment, but employment was stripped — use aggregates)
  const incomeTypes = loan?.incomeTypes;
  if (Array.isArray(incomeTypes) && incomeTypes.length > 0) {
    lines.push("", "**Income Sources:**");
    incomeTypes.forEach((src: any) => {
      if (src?.incomeType && src?.monthlyAmount) {
        lines.push(`- ${src.incomeType}: ${fmtMoney(src.monthlyAmount)}/mo`);
      }
    });
  }

  // Assets
  const assets = app?.assets;
  if (Array.isArray(assets) && assets.length > 0) {
    let totalAssets = 0;
    assets.forEach((a: any) => {
      const amt = typeof a?.cashOrMarketValue === "string"
        ? parseFloat(a.cashOrMarketValue)
        : (a?.cashOrMarketValue ?? 0);
      if (!isNaN(amt)) totalAssets += amt;
    });
    lines.push(`- **Total Assets Available:** ${fmtMoney(totalAssets)}`);
    lines.push(`- **Asset Accounts:** ${assets.length} account(s)`);
  }

  // Liabilities
  const liabilities = loan?.vols ?? app?.liabilities;
  if (Array.isArray(liabilities) && liabilities.length > 0) {
    lines.push(`- **Liabilities:** ${liabilities.length} account(s)`);
    const byType: Record<string, { count: number; balance: number; payment: number }> = {};
    liabilities.forEach((l: any) => {
      const type = l?.liabilityType || l?.accountType || "Other";
      if (!byType[type]) byType[type] = { count: 0, balance: 0, payment: 0 };
      byType[type].count++;
      const bal = typeof l?.unpaidBalance === "string" ? parseFloat(l.unpaidBalance) : (l?.unpaidBalance ?? 0);
      const pmt = typeof l?.monthlyPayment === "string" ? parseFloat(l.monthlyPayment) : (l?.monthlyPayment ?? 0);
      if (!isNaN(bal)) byType[type].balance += bal;
      if (!isNaN(pmt)) byType[type].payment += pmt;
    });
    lines.push("", "| Type | Count | Balance | Monthly Payment |");
    lines.push("|------|-------|---------|-----------------|");
    for (const [type, data] of Object.entries(byType)) {
      lines.push(`| ${type} | ${data.count} | ${fmtMoney(data.balance)} | ${fmtMoney(data.payment)} |`);
    }
  }

  return lines.join("\n");
}

interface DocsSummary {
  documents: any[];
  standaloneAttachments?: any[];
  summary: {
    totalDocuments: number;
    docsWithAttachments: number;
    totalAttachments: number;
    standaloneAttachments?: number;
  };
}

function documentInventory(loan: any, docs: DocsSummary): string {
  const lines = ["## Document Inventory", ""];

  // eFolder summary
  lines.push(`- **Total Documents:** ${docs.summary.totalDocuments}`);
  lines.push(`- **Documents with Attachments:** ${docs.summary.docsWithAttachments}`);
  lines.push(`- **Total Attachments:** ${docs.summary.totalAttachments}`);
  if (docs.summary.standaloneAttachments) {
    lines.push(`- **Standalone Attachments:** ${docs.summary.standaloneAttachments}`);
  }

  // Find last added/changed
  const allDocs = docs.documents || [];
  const sorted = [...allDocs]
    .filter((d) => d.updatedDate)
    .sort((a, b) => new Date(b.updatedDate).getTime() - new Date(a.updatedDate).getTime());
  if (sorted.length > 0) {
    lines.push(`- **Last Document Changed:** ${sorted[0].title} (${sorted[0].updatedDate})`);
  }

  // Unassigned docs
  const unassigned = allDocs.filter(
    (d: any) => !d.milestone || d.milestone === "" || d.milestone === "Unassigned",
  );
  if (unassigned.length > 0) {
    lines.push(`- **Unassigned Documents:** ${unassigned.length}`);
  }

  // Verification doc counts
  const docNames = allDocs.map((d: any) => (d.title || "").toLowerCase());
  const countByPrefix = (prefix: string) =>
    docNames.filter((n: string) => n.includes(prefix.toLowerCase())).length;

  const verifications: [string, string][] = [
    ["VOD (Verification of Deposit)", String(countByPrefix("vod"))],
    ["VOE (Verification of Employment)", String(countByPrefix("voe"))],
    ["VOL (Verification of Liability)", String(countByPrefix("vol"))],
    ["VOM (Verification of Mortgage)", String(countByPrefix("vom"))],
    ["VOR (Verification of Rent)", String(countByPrefix("vor"))],
  ];

  const hasVerifs = verifications.some(([, c]) => c !== "0");
  if (hasVerifs) {
    lines.push("", "**Verification Documents:**");
    verifications.forEach(([label, count]) => {
      if (count !== "0") lines.push(`- ${label}: ${count}`);
    });
  }

  // Disclosure counts
  const leCount = countByPrefix("loan estimate") + countByPrefix("initial le");
  const cdCount = countByPrefix("closing disclosure") + countByPrefix("initial cd");
  if (leCount > 0 || cdCount > 0) {
    lines.push("", "**Disclosures:**");
    if (leCount > 0) lines.push(`- Loan Estimate (LE): ${leCount}`);
    if (cdCount > 0) lines.push(`- Closing Disclosure (CD): ${cdCount}`);
  }

  // Third-party document status
  const thirdParty: [string, string][] = [
    ["Appraisal", safe(loan, "appraisalStatus")],
    ["Credit Report", safe(loan, "creditReportStatus")],
    ["AUS (DU/LP)", safe(loan, "ausStatus")],
    ["Flood Cert", safe(loan, "floodCertStatus")],
    ["Title", safe(loan, "titleStatus")],
    ["HOI", safe(loan, "hoiStatus")],
  ];
  const hasThirdParty = thirdParty.some(([, v]) => v !== "N/A");
  if (hasThirdParty) {
    lines.push("", "**Third-Party Status:**");
    lines.push("| Document | Status |");
    lines.push("|----------|--------|");
    thirdParty.forEach(([label, status]) => {
      if (status !== "N/A") lines.push(`| ${label} | ${status} |`);
    });
  }

  // UW conditions
  const conditions = loan?.conditions;
  if (Array.isArray(conditions) && conditions.length > 0) {
    const open = conditions.filter((c: any) => !c.isFulfilled && !c.isWaived).length;
    const ptf = conditions.filter((c: any) => c.priorTo === "Funding" && !c.isFulfilled && !c.isWaived).length;
    lines.push("", "**Underwriting Conditions:**");
    lines.push(`- Total: ${conditions.length}`);
    lines.push(`- Open: ${open}`);
    lines.push(`- Prior-to-Funding (open): ${ptf}`);
  }

  return lines.join("\n");
}

function keyDatesSection(loan: any): string {
  const lines = ["## Key Dates & Expirations", ""];
  const dates: [string, string][] = [
    ["Application Date", safe(loan, "applicationDate")],
    ["Initial LE Sent", safe(loan, "initialLeSentDate")],
    ["Intent to Proceed", safe(loan, "intentToProceedDate")],
    ["UW Submission", safe(loan, "uwSubmissionDate")],
    ["UW Approval", safe(loan, "uwApprovalDate")],
    ["UW Expiry", safe(loan, "uwExpirationDate")],
    ["CTC Date", safe(loan, "ctcDate")],
    ["Lock Date", safe(loan, "lockDate")],
    ["Lock Expiration", safe(loan, "lockExpirationDate")],
    ["Rescission Date", safe(loan, "rescissionDate")],
    ["Signing Date", safe(loan, "signingDate")],
    ["Disbursement Date", safe(loan, "disbursementDate")],
    ["First Payment", safe(loan, "firstPaymentDate")],
    ["Credit Expiration", safe(loan, "creditExpirationDate")],
    ["Income Expiration", safe(loan, "incomeExpirationDate")],
    ["Appraisal Expiration", safe(loan, "appraisalExpirationDate")],
    ["Title Expiration", safe(loan, "titleExpirationDate")],
    ["Flood Expiration", safe(loan, "floodExpirationDate")],
  ];

  const activeDates = dates.filter(([, v]) => v !== "N/A");
  if (activeDates.length === 0) {
    lines.push("No key dates available.");
  } else {
    lines.push("| Date | Value |");
    lines.push("|------|-------|");
    activeDates.forEach(([label, val]) => lines.push(`| ${label} | ${val} |`));
  }

  return lines.join("\n");
}

interface MilestoneItem {
  milestoneName?: string;
  doneIndicator?: boolean;
  startDate?: string;
  loanAssociate?: {
    name?: string;
    roleName?: string;
  };
}

function loanTeamSection(milestones: MilestoneItem[]): string {
  const lines = ["## Loan Team", ""];

  // Extract unique role/name pairs from milestones
  const seen = new Set<string>();
  const team: [string, string][] = [];

  milestones.forEach((ms) => {
    const assoc = ms.loanAssociate;
    if (assoc?.roleName && assoc?.name) {
      const key = `${assoc.roleName}:${assoc.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        team.push([assoc.roleName, assoc.name]);
      }
    }
  });

  if (team.length === 0) {
    // Fallback: show milestones status
    lines.push("No team assignments available from milestones.");
  } else {
    lines.push("| Role | Name |");
    lines.push("|------|------|");
    team.forEach(([role, name]) => lines.push(`| ${role} | ${name} |`));
  }

  // Milestone status summary
  if (milestones.length > 0) {
    lines.push("", "**Milestone Status:**");
    milestones.forEach((ms) => {
      const status = ms.doneIndicator ? "Complete" : "Pending";
      lines.push(`- ${ms.milestoneName || "Unknown"}: ${status}`);
    });
  }

  return lines.join("\n");
}

/**
 * Build a rich, PII-free markdown context for the Milo AI copilot.
 */
export function buildLoanContext(
  cleanLoan: any,
  milestones: MilestoneItem[],
  docs: DocsSummary,
): string {
  const sections = [
    piiSafetyHeader(),
    loanOverview(cleanLoan),
    propertySection(cleanLoan),
    incomeAndAssets(cleanLoan),
    documentInventory(cleanLoan, docs),
    keyDatesSection(cleanLoan),
    loanTeamSection(milestones),
  ];
  return sections.join("\n\n");
}
