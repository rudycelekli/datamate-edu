import { readFileSync, statSync } from "fs";
import { join } from "path";

const DOCS_DIR = join(process.cwd(), "docs", "MIlo AI");
const MAX_DOC_SIZE = 1.5 * 1024 * 1024; // 1.5MB per doc
const PAGE_BUDGET = 75; // Claude Sonnet allows 100 pages/request; keep margin
const BYTES_PER_PAGE = 12_000; // conservative estimate for PDF page size

export interface DocMeta {
  filename: string;
  category: "fha" | "va" | "conventional" | "usda";
  topic: string;
  keywords: string[];
}

export const DOC_CATALOG: DocMeta[] = [
  // ── FHA Chapters (small, focused) ──
  { filename: "Chapter_1_Lender_Approval_Guidelines.pdf", category: "fha", topic: "FHA Lender Approval Guidelines", keywords: ["lender approval", "mortgagee", "fha approval"] },
  { filename: "Ch10_Appraisal_Process_NEW.pdf", category: "fha", topic: "FHA Appraisal Process", keywords: ["appraisal", "appraiser", "property value", "fha appraisal"] },
  { filename: "Ch11_Appraisal_Report.pdf", category: "fha", topic: "FHA Appraisal Report", keywords: ["appraisal report", "1004", "urar"] },
  { filename: "Ch12_Minimum_Property_Requirement_NEW.pdf", category: "fha", topic: "FHA Minimum Property Requirements", keywords: ["mpr", "property requirements", "property standards", "health safety"] },
  { filename: "Chapter_13.pdf", category: "fha", topic: "FHA Title & Survey", keywords: ["title", "survey", "legal description"] },
  { filename: "Chapter_14.pdf", category: "fha", topic: "FHA Closing & Insurance", keywords: ["closing", "insurance", "settlement", "endorsement"] },
  { filename: "Chapter_15.pdf", category: "fha", topic: "FHA Quality Control", keywords: ["quality control", "qc", "audit", "review"] },
  { filename: "Chapter_16.pdf", category: "fha", topic: "FHA Special Programs", keywords: ["special programs", "energy efficient", "section 251"] },
  { filename: "Chapter_17.pdf", category: "fha", topic: "FHA Condominium", keywords: ["condo", "condominium", "hoa", "condo approval"] },
  { filename: "Chapter_18.pdf", category: "fha", topic: "FHA 203k Rehabilitation", keywords: ["203k", "rehabilitation", "rehab", "renovation", "fixer"] },

  // ── VA Chapters (small, focused) ──
  { filename: "VA Table_of_Contents.pdf", category: "va", topic: "VA Handbook Overview", keywords: ["va overview", "va contents"] },
  { filename: "chapter2-veterans-eligibility-and-entitlement.pdf", category: "va", topic: "VA Eligibility & Entitlement", keywords: ["eligibility", "entitlement", "coe", "dd-214", "veteran status", "active duty", "national guard", "reserves", "surviving spouse"] },
  { filename: "chapter3-the-va-loan-and-guaranty.pdf", category: "va", topic: "VA Loan & Guaranty", keywords: ["guaranty", "guarantee", "va loan types", "purchase", "construction", "loan limits"] },
  { filename: "chapter_4_credit_underwriting.pdf", category: "va", topic: "VA Credit & Underwriting", keywords: ["credit", "underwriting", "dti", "residual income", "income", "assets", "bankruptcy", "foreclosure", "collections", "credit history"] },
  { filename: "vap26-7-chapter5-how-to-process-va-loans-and-submit-them-to-va.pdf", category: "va", topic: "VA Loan Processing", keywords: ["processing", "submission", "va form", "application"] },
  { filename: "chapter6-refinancing-loans.pdf", category: "va", topic: "VA Refinancing", keywords: ["refinance", "irrrl", "streamline", "cash out", "refi", "rate reduction"] },
  { filename: "vchapter7-loans-requiring-special-underwriting-guaranty-and-other-considerations.pdf", category: "va", topic: "VA Special Underwriting", keywords: ["special", "supplemental", "joint loan", "manufactured home", "energy improvement", "adapted housing"] },
  { filename: "chapter8-borrower-fees-and-charges-and-the-va-funding-fee.pdf", category: "va", topic: "VA Fees & Funding Fee", keywords: ["fees", "funding fee", "charges", "closing costs", "discount points", "va funding"] },
  { filename: "ch9-legal-instruments-liens-escrows-and-related-issues.pdf", category: "va", topic: "VA Legal Instruments & Liens", keywords: ["legal", "lien", "escrow", "deed of trust", "note", "title"] },

  // Conventional & USDA large docs excluded - system prompt has deep knowledge
];

// ── In-memory base64 cache ──
const b64Cache = new Map<string, string>();
const sizeCache = new Map<string, number>();

function getFileSize(filename: string): number {
  if (sizeCache.has(filename)) return sizeCache.get(filename)!;
  try {
    const size = statSync(join(DOCS_DIR, filename)).size;
    sizeCache.set(filename, size);
    return size;
  } catch { return Infinity; }
}

function estimatePages(filename: string): number {
  return Math.ceil(getFileSize(filename) / BYTES_PER_PAGE);
}

export function loadDocBase64(filename: string): string | null {
  if (b64Cache.has(filename)) return b64Cache.get(filename)!;
  const filepath = join(DOCS_DIR, filename);
  try {
    const size = getFileSize(filename);
    if (size > MAX_DOC_SIZE) return null;
    const buf = readFileSync(filepath);
    const b64 = buf.toString("base64");
    b64Cache.set(filename, b64);
    return b64;
  } catch {
    return null;
  }
}

/** Route a question to the most relevant guideline documents, respecting page budget */
export function routeDocs(question: string, conversationContext?: string): DocMeta[] {
  const q = (question + " " + (conversationContext || "")).toLowerCase();

  // ── Score each category ──
  const scores: Record<string, number> = { fha: 0, va: 0, conventional: 0, usda: 0 };

  if (/\bfha\b|hud\s*handbook|4000\.1|fha\s*loan|fha\s*under|fha\s*mip|ufmip|fha\s*case|fha\s*approv/i.test(q)) scores.fha += 10;
  if (/\bva\b|veteran|military|active\s*duty|va\s*loan|irrrl|dd.?214|residual\s*income|va\s*fund/i.test(q)) scores.va += 10;
  if (/conventional|conforming|fannie|freddie|fnma|fhlmc|homeready|home\s*possible|pmi|desktop\s*under|loan\s*prospect|du\s*find|lp\s*find/i.test(q)) scores.conventional += 10;
  if (/\busda\b|rural\s*develop|rural\s*hous|grh|guarantee\s*fee/i.test(q)) scores.usda += 10;

  // General mortgage topics boost relevant categories
  if (/\bdown\s*payment|ltv|loan.to.value/i.test(q)) { scores.fha += 2; scores.va += 2; scores.conventional += 2; scores.usda += 2; }
  if (/\bdti|debt.to.income/i.test(q)) { scores.fha += 2; scores.va += 3; scores.conventional += 2; scores.usda += 2; }
  if (/\bcredit\s*score|fico/i.test(q)) { scores.fha += 3; scores.va += 2; scores.conventional += 3; }
  if (/\bappraisal/i.test(q)) scores.fha += 4;
  if (/\brefin|refi|irrrl|streamline|cash.out/i.test(q)) { scores.va += 5; scores.conventional += 2; scores.fha += 2; }
  if (/\bfunding\s*fee/i.test(q)) scores.va += 8;
  if (/\bmip|mortgage\s*insurance\s*prem/i.test(q)) scores.fha += 6;
  if (/\bpmi|private\s*mortgage/i.test(q)) scores.conventional += 6;
  if (/\bincome\s*limit|rural\s*area|eligib.*area/i.test(q)) scores.usda += 8;
  if (/\b203k|rehab|renovation\s*loan/i.test(q)) scores.fha += 8;
  if (/\bcondo|condominium/i.test(q)) scores.fha += 5;
  if (/\bself.employ|1099|schedule\s*c|tax\s*return/i.test(q)) { scores.fha += 2; scores.va += 3; scores.conventional += 3; }
  if (/compar|versus|\bvs\.?\b|which\s*(loan|program|is\s*better)|difference\s*between/i.test(q)) {
    scores.fha += 3; scores.va += 3; scores.conventional += 3; scores.usda += 2;
  }

  // If no signals, assume general question - rely on system prompt knowledge, skip docs
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return [];

  // ── Pick categories with meaningful scores ──
  const activeCats = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  // ── Select docs with page budget ──
  const selected: DocMeta[] = [];
  let pagesUsed = 0;

  for (const [cat] of activeCats) {
    if (pagesUsed >= PAGE_BUDGET) break;
    const catDocs = DOC_CATALOG.filter(d => d.category === cat);
    if (catDocs.length === 0) continue; // no docs for conventional/usda

    // Score each doc by keyword hits
    const scored = catDocs.map(doc => {
      const hits = doc.keywords.filter(kw => q.includes(kw)).length;
      return { doc, hits };
    }).sort((a, b) => b.hits - a.hits);

    // Take best doc(s) that fit within page budget
    const maxPerCat = activeCats.length <= 2 ? 2 : 1;
    let taken = 0;
    for (const { doc } of scored) {
      if (taken >= maxPerCat) break;
      const size = getFileSize(doc.filename);
      if (size > MAX_DOC_SIZE) continue; // skip oversized
      const pages = estimatePages(doc.filename);
      if (pagesUsed + pages > PAGE_BUDGET) continue; // would bust budget
      selected.push(doc);
      pagesUsed += pages;
      taken++;
    }
  }

  return selected;
}
