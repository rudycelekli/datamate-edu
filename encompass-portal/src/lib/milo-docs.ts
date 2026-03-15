import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { PDFDocument } from "pdf-lib";

const DOCS_DIR = join(process.cwd(), "docs", "MIlo AI");
const CHUNKS_DIR = join(DOCS_DIR, ".chunks");
const MAX_SINGLE_DOC_SIZE = 1.5 * 1024 * 1024; // 1.5MB - docs under this load directly
const PAGE_BUDGET = 75; // Claude allows 100 pages/request; keep margin
const BYTES_PER_PAGE = 12_000;
const CHUNK_PAGES = 45; // Pages per chunk for large PDFs

export interface DocMeta {
  filename: string;
  category: "fha" | "va" | "conventional" | "usda";
  topic: string;
  keywords: string[];
  /** If this is a chunk, the parent filename */
  parentFile?: string;
  /** Page range for chunks (e.g. "1-45") */
  pageRange?: string;
}

// ── Full catalog including large docs ──
const LARGE_DOCS: { filename: string; category: DocMeta["category"]; topic: string; keywords: string[] }[] = [
  {
    filename: "40001 FHA SFH Handbook.pdf",
    category: "fha",
    topic: "FHA Single Family Handbook (4000.1)",
    keywords: ["fha", "hud", "4000.1", "fha handbook", "single family", "fha loan", "fha underwriting", "mortgagee", "fha approval", "fha mip", "ufmip", "fha case", "manual underwriting"],
  },
  {
    filename: "Freddie Mac Selling Guide 10.2.24.pdf",
    category: "conventional",
    topic: "Freddie Mac Seller/Servicer Guide",
    keywords: ["freddie", "fhlmc", "freddie mac", "home possible", "loan prospector", "lp", "freddie selling", "freddie condo", "freddie manufactured"],
  },
  {
    filename: "Selling-Guide_12-11-24 Highighted.pdf",
    category: "conventional",
    topic: "Fannie Mae Selling Guide",
    keywords: ["fannie", "fnma", "fannie mae", "homeready", "desktop underwriter", "du", "fannie selling", "fannie condo", "fannie manufactured"],
  },
  {
    filename: "USDA hb-1-3555_0 12.2.24.pdf",
    category: "usda",
    topic: "USDA HB-1-3555 Handbook",
    keywords: ["usda", "rural", "rural development", "rural housing", "grh", "guarantee fee", "gus", "usda income", "usda eligib", "income limit", "rural area"],
  },
  {
    filename: "VA Handbook all chapters 12.2.24 (2).pdf",
    category: "va",
    topic: "VA Lenders Handbook (26-7)",
    keywords: ["va handbook", "va full", "va lender", "va pamphlet", "26-7"],
  },
];

// Small docs that load directly
export const SMALL_DOCS: DocMeta[] = [
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
  { filename: "VA Table_of_Contents.pdf", category: "va", topic: "VA Handbook Overview", keywords: ["va overview", "va contents"] },
  { filename: "chapter2-veterans-eligibility-and-entitlement.pdf", category: "va", topic: "VA Eligibility & Entitlement", keywords: ["eligibility", "entitlement", "coe", "dd-214", "veteran status", "active duty", "national guard", "reserves", "surviving spouse"] },
  { filename: "chapter3-the-va-loan-and-guaranty.pdf", category: "va", topic: "VA Loan & Guaranty", keywords: ["guaranty", "guarantee", "va loan types", "purchase", "construction", "loan limits"] },
  { filename: "chapter_4_credit_underwriting.pdf", category: "va", topic: "VA Credit & Underwriting", keywords: ["credit", "underwriting", "dti", "residual income", "income", "assets", "bankruptcy", "foreclosure", "collections", "credit history"] },
  { filename: "vap26-7-chapter5-how-to-process-va-loans-and-submit-them-to-va.pdf", category: "va", topic: "VA Loan Processing", keywords: ["processing", "submission", "va form", "application"] },
  { filename: "chapter6-refinancing-loans.pdf", category: "va", topic: "VA Refinancing", keywords: ["refinance", "irrrl", "streamline", "cash out", "refi", "rate reduction"] },
  { filename: "vchapter7-loans-requiring-special-underwriting-guaranty-and-other-considerations.pdf", category: "va", topic: "VA Special Underwriting", keywords: ["special", "supplemental", "joint loan", "manufactured home", "energy improvement", "adapted housing"] },
  { filename: "chapter8-borrower-fees-and-charges-and-the-va-funding-fee.pdf", category: "va", topic: "VA Fees & Funding Fee", keywords: ["fees", "funding fee", "charges", "closing costs", "discount points", "va funding"] },
  { filename: "ch9-legal-instruments-liens-escrows-and-related-issues.pdf", category: "va", topic: "VA Legal Instruments & Liens", keywords: ["legal", "lien", "escrow", "deed of trust", "note", "title"] },
];

// ── Chunk management ──

let _chunkCatalog: DocMeta[] | null = null;
let _chunkingPromise: Promise<void> | null = null;

/** Ensure chunks directory exists */
function ensureChunksDir() {
  if (!existsSync(CHUNKS_DIR)) mkdirSync(CHUNKS_DIR, { recursive: true });
}

/** Check if a large doc has already been chunked */
function isChunked(filename: string): boolean {
  const marker = join(CHUNKS_DIR, `${filename}.done`);
  return existsSync(marker);
}

/** Split a large PDF into ~45-page chunks and save to disk */
async function chunkPdf(filename: string): Promise<{ chunkFile: string; startPage: number; endPage: number }[]> {
  const filepath = join(DOCS_DIR, filename);
  if (!existsSync(filepath)) return [];

  const pdfBytes = readFileSync(filepath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  const chunks: { chunkFile: string; startPage: number; endPage: number }[] = [];

  for (let start = 0; start < totalPages; start += CHUNK_PAGES) {
    const end = Math.min(start + CHUNK_PAGES, totalPages);
    const chunkDoc = await PDFDocument.create();
    const pages = await chunkDoc.copyPages(pdfDoc, Array.from({ length: end - start }, (_, i) => start + i));
    pages.forEach(p => chunkDoc.addPage(p));

    const baseName = filename.replace(/\.pdf$/i, "");
    const chunkFile = `${baseName}_p${start + 1}-${end}.pdf`;
    const chunkPath = join(CHUNKS_DIR, chunkFile);
    const chunkBytes = await chunkDoc.save();
    writeFileSync(chunkPath, chunkBytes);
    chunks.push({ chunkFile, startPage: start + 1, endPage: end });
  }

  // Write marker
  writeFileSync(join(CHUNKS_DIR, `${filename}.done`), String(totalPages));
  return chunks;
}

/** Build or load the chunk catalog for all large docs */
async function buildChunkCatalog(): Promise<DocMeta[]> {
  if (_chunkCatalog) return _chunkCatalog;

  ensureChunksDir();
  const catalog: DocMeta[] = [];

  for (const doc of LARGE_DOCS) {
    if (!existsSync(join(DOCS_DIR, doc.filename))) continue;

    if (isChunked(doc.filename)) {
      // Load existing chunks from disk
      const baseName = doc.filename.replace(/\.pdf$/i, "");
      const existing = readdirSync(CHUNKS_DIR).filter(f => f.startsWith(baseName + "_p") && f.endsWith(".pdf"));
      for (const chunkFile of existing) {
        const match = chunkFile.match(/_p(\d+)-(\d+)\.pdf$/);
        if (match) {
          catalog.push({
            filename: chunkFile,
            category: doc.category,
            topic: `${doc.topic} (pp.${match[1]}-${match[2]})`,
            keywords: doc.keywords,
            parentFile: doc.filename,
            pageRange: `${match[1]}-${match[2]}`,
          });
        }
      }
    } else {
      // Chunk the PDF
      const chunks = await chunkPdf(doc.filename);
      for (const chunk of chunks) {
        catalog.push({
          filename: chunk.chunkFile,
          category: doc.category,
          topic: `${doc.topic} (pp.${chunk.startPage}-${chunk.endPage})`,
          keywords: doc.keywords,
          parentFile: doc.filename,
          pageRange: `${chunk.startPage}-${chunk.endPage}`,
        });
      }
    }
  }

  _chunkCatalog = catalog;
  return catalog;
}

/** Get the full doc catalog (small docs + large doc chunks) */
export async function getFullCatalog(): Promise<DocMeta[]> {
  if (!_chunkingPromise) {
    _chunkingPromise = buildChunkCatalog().then(() => {});
  }
  await _chunkingPromise;
  return [...SMALL_DOCS, ...(_chunkCatalog || [])];
}

// ── In-memory base64 cache ──
const b64Cache = new Map<string, string>();
const sizeCache = new Map<string, number>();

function getFileSize(filename: string): number {
  if (sizeCache.has(filename)) return sizeCache.get(filename)!;
  // Check chunks dir first, then main docs dir
  const chunkPath = join(CHUNKS_DIR, filename);
  const mainPath = join(DOCS_DIR, filename);
  try {
    const path = existsSync(chunkPath) ? chunkPath : mainPath;
    const size = statSync(path).size;
    sizeCache.set(filename, size);
    return size;
  } catch { return Infinity; }
}

function estimatePages(filename: string): number {
  return Math.ceil(getFileSize(filename) / BYTES_PER_PAGE);
}

export function loadDocBase64(filename: string): string | null {
  if (b64Cache.has(filename)) return b64Cache.get(filename)!;
  // Check chunks dir first, then main docs dir
  const chunkPath = join(CHUNKS_DIR, filename);
  const mainPath = join(DOCS_DIR, filename);
  const filepath = existsSync(chunkPath) ? chunkPath : mainPath;
  try {
    const size = getFileSize(filename);
    if (size > MAX_SINGLE_DOC_SIZE) return null;
    const buf = readFileSync(filepath);
    const b64 = buf.toString("base64");
    b64Cache.set(filename, b64);
    return b64;
  } catch {
    return null;
  }
}

/** Route a question to the most relevant guideline documents, respecting page budget */
export async function routeDocs(question: string, conversationContext?: string): Promise<DocMeta[]> {
  const q = (question + " " + (conversationContext || "")).toLowerCase();
  const fullCatalog = await getFullCatalog();

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
  if (/\bcondo|condominium/i.test(q)) { scores.fha += 5; scores.conventional += 4; }
  if (/\bself.employ|1099|schedule\s*c|tax\s*return/i.test(q)) { scores.fha += 2; scores.va += 3; scores.conventional += 3; }
  if (/\bmanufact|mobile\s*home/i.test(q)) { scores.fha += 3; scores.va += 4; scores.conventional += 3; }
  if (/compar|versus|\bvs\.?\b|which\s*(loan|program|is\s*better)|difference\s*between/i.test(q)) {
    scores.fha += 3; scores.va += 3; scores.conventional += 3; scores.usda += 2;
  }

  // If no signals, return empty - rely on system prompt knowledge
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
    const catDocs = fullCatalog.filter(d => d.category === cat);
    if (catDocs.length === 0) continue;

    // Score each doc by keyword hits
    const scored = catDocs.map(doc => {
      const hits = doc.keywords.filter(kw => q.includes(kw)).length;
      return { doc, hits };
    }).sort((a, b) => b.hits - a.hits);

    // Prefer small (non-chunk) docs first, then chunk docs
    const maxPerCat = activeCats.length <= 2 ? 3 : 2;
    let taken = 0;
    for (const { doc } of scored) {
      if (taken >= maxPerCat) break;
      const size = getFileSize(doc.filename);
      if (size > MAX_SINGLE_DOC_SIZE) continue; // skip oversized (shouldn't happen for chunks)
      const pages = estimatePages(doc.filename);
      if (pagesUsed + pages > PAGE_BUDGET) continue;
      selected.push(doc);
      pagesUsed += pages;
      taken++;
    }
  }

  return selected;
}

/** Route docs and group into batches that fit within page budget.
 *  Returns { directBatch, overflowBatches } where directBatch fits in a single request
 *  and overflowBatches are additional batches that need extraction passes.
 */
export async function routeDocsMultiBatch(question: string, conversationContext?: string): Promise<{
  directBatch: DocMeta[];
  overflowBatches: DocMeta[][];
}> {
  const q = (question + " " + (conversationContext || "")).toLowerCase();
  const fullCatalog = await getFullCatalog();

  // ── Score each category ──
  const scores: Record<string, number> = { fha: 0, va: 0, conventional: 0, usda: 0 };

  if (/\bfha\b|hud\s*handbook|4000\.1|fha\s*loan|fha\s*under|fha\s*mip|ufmip|fha\s*case|fha\s*approv/i.test(q)) scores.fha += 10;
  if (/\bva\b|veteran|military|active\s*duty|va\s*loan|irrrl|dd.?214|residual\s*income|va\s*fund/i.test(q)) scores.va += 10;
  if (/conventional|conforming|fannie|freddie|fnma|fhlmc|homeready|home\s*possible|pmi|desktop\s*under|loan\s*prospect|du\s*find|lp\s*find/i.test(q)) scores.conventional += 10;
  if (/\busda\b|rural\s*develop|rural\s*hous|grh|guarantee\s*fee/i.test(q)) scores.usda += 10;

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
  if (/\bcondo|condominium/i.test(q)) { scores.fha += 5; scores.conventional += 4; }
  if (/\bself.employ|1099|schedule\s*c|tax\s*return/i.test(q)) { scores.fha += 2; scores.va += 3; scores.conventional += 3; }
  if (/\bmanufact|mobile\s*home/i.test(q)) { scores.fha += 3; scores.va += 4; scores.conventional += 3; }
  if (/compar|versus|\bvs\.?\b|which\s*(loan|program|is\s*better)|difference\s*between/i.test(q)) {
    scores.fha += 3; scores.va += 3; scores.conventional += 3; scores.usda += 2;
  }

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return { directBatch: [], overflowBatches: [] };

  const activeCats = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  // Collect ALL relevant docs (more generous than single-batch)
  const allRelevant: DocMeta[] = [];
  for (const [cat] of activeCats) {
    const catDocs = fullCatalog.filter(d => d.category === cat);
    const scored = catDocs.map(doc => {
      const hits = doc.keywords.filter(kw => q.includes(kw)).length;
      return { doc, hits };
    }).sort((a, b) => b.hits - a.hits);

    // Take top docs per category (more generous)
    const maxPerCat = activeCats.length <= 2 ? 5 : 3;
    let taken = 0;
    for (const { doc } of scored) {
      if (taken >= maxPerCat) break;
      const size = getFileSize(doc.filename);
      if (size > MAX_SINGLE_DOC_SIZE) continue;
      allRelevant.push(doc);
      taken++;
    }
  }

  // Split into batches that fit within PAGE_BUDGET
  const batches: DocMeta[][] = [];
  let currentBatch: DocMeta[] = [];
  let currentPages = 0;

  for (const doc of allRelevant) {
    const pages = estimatePages(doc.filename);
    if (currentPages + pages > PAGE_BUDGET && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentPages = 0;
    }
    currentBatch.push(doc);
    currentPages += pages;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  if (batches.length <= 1) {
    return { directBatch: batches[0] || [], overflowBatches: [] };
  }

  return { directBatch: batches[0], overflowBatches: batches.slice(1) };
}

// Re-export DOC_CATALOG for backwards compat
export const DOC_CATALOG = SMALL_DOCS;
