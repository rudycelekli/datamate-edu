# Encompass Portal — Complete Codebase Documentation

> **Purpose**: Give any AI agent or developer complete knowledge of the entire codebase — every file, integration, data flow, business rule, and architectural decision.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [Directory Structure](#3-directory-structure)
4. [Database Schema](#4-database-schema)
5. [External Integrations](#5-external-integrations)
6. [Library Files (src/lib/)](#6-library-files-srclib)
7. [Components (src/components/)](#7-components-srccomponents)
8. [Pages (src/app/)](#8-pages-srcapp)
9. [API Routes (src/app/api/)](#9-api-routes-srcappapi)
10. [Scripts (scripts/)](#10-scripts-scripts)
11. [Data Flow & Sync Pipeline](#11-data-flow--sync-pipeline)
12. [Business Logic & Algorithms](#12-business-logic--algorithms)
13. [Styling & Theming](#13-styling--theming)
14. [Environment Variables](#14-environment-variables)
15. [Caching Strategy](#15-caching-strategy)

---

## 1. Project Overview

**Encompass Portal** (branded "Premier Lending Portal") is an internal mortgage pipeline management dashboard for Premier Lending. It connects to ICE Mortgage Technology's Encompass LOS (Loan Origination System) to pull loan data, stores it in Supabase (PostgreSQL), and provides:

- **Pipeline Dashboard** — Filterable, sortable loan table with AI-powered natural language search
- **Intelligence Analytics** — 9 chart sections with AI-generated insights, interactive query bar, and deep strategic analysis
- **Market Intelligence** — Live mortgage rates, economic indicators, rate lock advisor, industry news
- **Milo AI** — An AI underwriting assistant backed by mortgage guideline PDFs (FHA, VA, Fannie Mae, Freddie Mac, USDA)
- **Loan Detail** — 5-tab deep-dive into individual loans with documents, milestones, mapped fields, raw JSON, plus a collapsible **Milo AI Copilot** sidebar that provides loan-specific AI guidance

**Architecture**: Next.js App Router (server components + client pages) → API routes → Supabase (PostgreSQL) + Encompass API + Anthropic Claude + FRED API + Google News RSS.

---

## 2. Tech Stack & Dependencies

### Core Framework
| Package | Version | Purpose |
|---------|---------|---------|
| `next` | ^15.3.0 | App Router, API routes, SSR |
| `react` / `react-dom` | ^19.0.0 | UI framework |
| `typescript` | ^5.7.0 | Type safety |
| `tailwindcss` | ^4.0.0 | CSS utility framework (v4 with `@import "tailwindcss"`) |

### Data & Backend
| Package | Purpose |
|---------|---------|
| `@supabase/supabase-js` ^2.99.1 | Database client (admin + browser) |
| `pdf-lib` ^1.17.1 | PDF splitting/chunking for Milo AI document routing |

### Visualization
| Package | Purpose |
|---------|---------|
| `recharts` ^3.8.0 | Charts (bar, line, pie, stacked, horizontal) |
| `topojson-client` ^3.1.0 | US map GeoJSON data |
| `d3-geo` ^3.1.1 | Albers USA map projection |
| `d3-selection` / `d3-zoom` | Map zoom/pan |
| `react-simple-maps` ^3.0.0 | Declarative map components (partially used alongside custom SVG) |

### UI
| Package | Purpose |
|---------|---------|
| `lucide-react` ^0.475.0 | Icon library |

---

## 3. Directory Structure

```
encompass-portal/
├── package.json
├── next.config.ts               # reactStrictMode: true
├── tsconfig.json                # ES2017, bundler resolution, @/* → ./src/*
├── postcss.config.mjs           # Tailwind v4 PostCSS plugin
├── docs/
│   ├── CODEBASE.md              # ← This file
│   ├── hybrid-cache-architecture.md
│   └── MIlo AI/                 # Mortgage guideline PDFs (FHA, VA, Fannie, Freddie, USDA)
│       └── .chunks/             # Auto-generated PDF chunks (45-page splits)
├── scripts/
│   ├── supabase-schema.sql      # Full DB schema (tables, indexes, RLS, RPC functions)
│   ├── seed-supabase.ts         # One-time full pipeline seed
│   ├── sync-daemon.ts           # Background delta sync every 5 min
│   └── export-client-list.ts    # CSV export of all loans with PII fields
├── src/
│   ├── app/
│   │   ├── layout.tsx           # Root layout (title, font, bg color)
│   │   ├── globals.css          # CSS variables, custom classes
│   │   ├── page.tsx             # Pipeline page (/)
│   │   ├── loan/[loanId]/page.tsx  # Loan detail (/loan/:id)
│   │   ├── intelligence/page.tsx   # Intelligence analytics (/intelligence)
│   │   ├── market/page.tsx         # Market intelligence (/market)
│   │   ├── milo/page.tsx           # Milo AI chat (/milo)
│   │   └── api/                    # 20 API route files (see §9)
│   ├── components/
│   │   ├── AppHeader.tsx        # Shared nav header
│   │   ├── LoanCopilot.tsx      # Milo AI copilot sidebar for loan detail page
│   │   └── USMap.tsx            # Interactive choropleth map
│   └── lib/
│       ├── supabase.ts          # Supabase client factory (admin + browser)
│       ├── supabase-queries.ts  # Database query layer
│       ├── encompass.ts         # Encompass API client
│       ├── encompass-to-db.ts   # Field mapping (API ↔ DB)
│       ├── field-definitions.ts # Encompass field ID → label maps
│       ├── pipeline-cache.ts    # Server-side in-memory cache (legacy, being replaced by Supabase)
│       ├── pipeline-store.ts    # Client-side sessionStorage cache
│       ├── milo-docs.ts         # PDF routing & chunking for Milo AI
│       ├── pii-config.json      # Config-driven PII field definitions for loan context stripping
│       ├── strip-pii.ts         # Recursive PII stripping engine (config-driven, returns deep clone)
│       └── build-loan-context.ts # Rich markdown loan context builder for Milo AI (PII-free)
```

---

## 4. Database Schema

**File**: `scripts/supabase-schema.sql`

### Table: `pipeline_loans`
Primary loan data table. ~22,000+ rows.

| Column | Type | Description |
|--------|------|-------------|
| `loan_guid` | TEXT PK | Encompass unique loan identifier |
| `loan_number` | TEXT | Human-readable loan number (e.g. "503432825") |
| `borrower_first` | TEXT | Borrower first name (PII) |
| `borrower_last` | TEXT | Borrower last name (PII) |
| `co_borrower_first` | TEXT | Co-borrower first name (PII) |
| `co_borrower_last` | TEXT | Co-borrower last name (PII) |
| `loan_folder` | TEXT | Pipeline folder ("My Pipeline", "Completed", etc.) |
| `last_modified` | TEXT | ISO datetime of last update |
| `loan_amount` | NUMERIC | Dollar amount |
| `loan_status` | TEXT | Active/Inactive status |
| `date_created` | TEXT | ISO datetime — loan origination |
| `milestone` | TEXT | Pipeline stage (25 possible values: Started → Reconciled) |
| `loan_officer` | TEXT | LO full name |
| `loan_processor` | TEXT | Processor full name |
| `property_address` | TEXT | Street address (PII) |
| `property_city` | TEXT | City |
| `property_state` | TEXT | 2-letter state code |
| `property_zip` | TEXT | ZIP code |
| `note_rate` | NUMERIC | Interest rate % |
| `loan_program` | TEXT | 670+ variations (FHA, VA, Conv, Jumbo, USDA, etc.) |
| `loan_purpose` | TEXT | Purchase, Cash-Out Refinance, NoCash-Out Refinance, etc. |
| `lien_position` | TEXT | FirstLien / SecondLien |
| `channel` | TEXT | Origination channel |
| `lock_status` | TEXT | Locked / NotLocked / Expired |
| `lock_expiration` | TEXT | ISO datetime |
| `closing_date` | TEXT | ISO datetime (empty if not yet closed) |
| `application_date` | TEXT | ISO datetime |
| `updated_at` | TIMESTAMPTZ | Auto-set on insert/update |

### Indexes (12)
- `idx_pl_milestone`, `idx_pl_loan_officer`, `idx_pl_property_state`, `idx_pl_loan_purpose`, `idx_pl_lock_status`, `idx_pl_loan_program` — equality filters
- `idx_pl_last_modified` (DESC) — sort by recency
- `idx_pl_loan_amount`, `idx_pl_note_rate` — range filters
- `idx_pl_loan_number`, `idx_pl_borrower_last` — name lookups
- `idx_pl_date_created` — date range filters
- `idx_pl_search` — GIN full-text search on loan_number, names, LO, city, state

### Table: `sync_status`
Singleton row tracking sync state.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INT PK | Always 1 (CHECK constraint) |
| `last_sync_at` | TIMESTAMPTZ | Last successful sync timestamp |
| `total_rows` | INT | Current row count in pipeline_loans |
| `status` | TEXT | "idle", "syncing", "ready", "error" |
| `error_message` | TEXT | Last error (nullable) |
| `sync_duration_ms` | INT | Duration of last sync |

### RPC Functions

**`get_filter_options()`** — Returns JSON with distinct values for all filter dropdowns:
```json
{ "milestones": [...], "los": [...], "states": [...], "purposes": [...], "locks": [...], "programs": [...] }
```

**`execute_readonly_query(query_text TEXT)`** — SECURITY DEFINER function for AI text-to-SQL. Validates: must be SELECT, must reference `pipeline_loans`, blocks DELETE/UPDATE/INSERT/DROP/ALTER/CREATE/TRUNCATE/GRANT/REVOKE/COPY.

### RLS Policies
- `pipeline_loans`: Public read (anyone), service_role write
- `sync_status`: Public read, service_role write

### Realtime
`pipeline_loans` is published to `supabase_realtime` for live updates on the Pipeline page.

---

## 5. External Integrations

### 5.1 Encompass / ICE Mortgage Technology
**File**: `src/lib/encompass.ts`

- **Base URL**: `https://api.elliemae.com`
- **Auth**: OAuth2 password grant → `/oauth2/v1/token`
- **Credentials**: `CLIENT_ID`, `CLIENT_SECRET`, `USERNAME`, `PASSWORD` (from env vars, with hardcoded fallbacks)
- **Token caching**: In-memory, auto-refreshes 60s before expiry

**Endpoints used**:
| Function | Encompass API | Purpose |
|----------|--------------|---------|
| `searchPipeline()` | POST `/encompass/v1/loanPipeline` | Batch pipeline search (500/batch) |
| `searchPipelineWithFilters()` | POST `/encompass/v1/loanPipeline` | Filtered search with custom terms |
| `getLoan()` | GET `/encompass/v3/loans/{id}` | Full loan JSON |
| `readFields()` | POST `/encompass/v3/loans/{id}/fieldReader` | Read specific field IDs |
| `getDocuments()` | GET `/encompass/v3/loans/{id}/documents` | Loan documents list |
| `getAttachments()` | GET `/encompass/v3/loans/{id}/attachments` | Attachment metadata |
| `getAttachmentSignedUrls()` | POST `/encompass/v3/loans/{id}/attachments/url` | Signed download URLs for files/pages |
| `getMilestones()` | GET `/encompass/v3/loans/{id}/milestones` | Milestone log |
| `getDisclosureTracking()` | GET `/encompass/v3/loans/{id}/disclosureTracking2015Logs` | Disclosure tracking |
| `getLoanFolders()` | GET `/encompass/v3/loans/{id}/folders` | eFolder list |

**Pipeline fields fetched** (25 canonical + field IDs): LoanNumber, BorrowerFirstName, BorrowerLastName, CoBorrowerFirstName, CoBorrowerLastName, LoanFolder, LastModified, LoanAmount, LoanStatus, DateCreated, CurrentMilestoneName, LoanOfficerName, LoanProcessorName, SubjectPropertyAddress/City/State/Zip, NoteRatePercent, LoanProgram, LoanPurpose, LienPosition, Channel, LockStatus, LockExpirationDate, ClosingDate, Fields.14/12/11/3/748/745.

### 5.2 Supabase (PostgreSQL + Realtime)
**File**: `src/lib/supabase.ts`

Two clients:
1. **Admin client** (server-side): `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Lazy-initialized via Proxy to avoid browser-bundle crash. Full read/write.
2. **Browser client**: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Read-only via RLS. Used for Realtime subscriptions.

### 5.3 Anthropic Claude API
**Used in 4 API routes**:

| Route | Model | Purpose |
|-------|-------|---------|
| `/api/ai-search` | `claude-haiku-4-5-20251001` | Natural language → SQL for pipeline search |
| `/api/intelligence/ask` | `claude-haiku-4-5-20251001` | Text-to-SQL for analytics charts (fast path) or blueprint generation (fallback) |
| `/api/intelligence/insight` | `claude-sonnet-4-20250514` | Per-chart AI insights with actionable recommendations |
| `/api/intelligence/deep-analysis` | `claude-sonnet-4-20250514` | Streaming strategic pipeline analysis (5-section, 2000-3000 words) |
| `/api/milo/chat` | `claude-sonnet-4-20250514` | Streaming mortgage underwriting assistant with PDF documents |

**Auth**: `x-api-key` header with `ANTHROPIC_API_KEY`. API version `2023-06-01`.

**Milo document injection**: PDFs are sent as base64 `document` content blocks with `cache_control: { type: "ephemeral" }` for prompt caching.

### 5.4 FRED (Federal Reserve Economic Data)
**File**: `src/app/api/market/rates/route.ts`

- **Base URL**: `https://fred.stlouisfed.org/graph/fredgraph.csv`
- **Auth**: None (publicly accessible CSV endpoints)
- **Caching**: `next: { revalidate: 3600 }` (1-hour ISR)

**21 series fetched in parallel**:

| Category | Series ID | Name |
|----------|-----------|------|
| Mortgage (weekly) | MORTGAGE30US, MORTGAGE15US | 30yr/15yr fixed (Freddie Mac PMMS) |
| Mortgage (daily) | OBMMIFHA30YF, OBMMIVA30YF, OBMMIJUMBO30YF, OBMMIC30YF | FHA/VA/Jumbo/Conforming 30yr (Optimal Blue OBMMI) |
| Treasury (daily) | DGS2, DGS5, DGS10, DGS30 | 2yr/5yr/10yr/30yr yields |
| Economic | FEDFUNDS, CPIAUCSL, UNRATE, HOUST, CSUSHPINSA, UMCSENT, MSPUS, T10Y2Y, EXHOSLUSM495S, FIXHAI, MSACSR | Fed funds, CPI, unemployment, housing starts, Case-Shiller, sentiment, median price, yield spread, existing sales, affordability index, months of supply |

### 5.5 Optimal Blue (OBMMI)
Accessed via FRED series (see above). Provides daily product-level mortgage rates: Conforming, FHA, VA, Jumbo 30-year fixed.

### 5.6 Google News RSS
**File**: `src/app/api/market/news/route.ts`

- 4 category feeds: mortgage-rates, housing-market, fed-policy, lending-industry
- State-specific feeds: dynamically built for pipeline's top states (up to 8)
- RSS XML parsing with CDATA extraction
- Deduplication by normalized title
- Cached via `next: { revalidate: 300 }` (5 min)

---

## 6. Library Files (src/lib/)

### 6.1 `supabase.ts` (39 lines)
Supabase client factory.

**Exports**:
- `getSupabaseAdmin()` — Lazy-init server admin client
- `supabaseAdmin` — Proxy object wrapping `getSupabaseAdmin()` for backward-compatible import
- `createBrowserClient()` — Singleton browser client (anon key, RLS)

### 6.2 `supabase-queries.ts` (~516 lines)
Database query layer. All Pipeline/Intelligence/Market pages use this.

**Exports**:
- `queryPipeline(opts)` — Paginated, filtered, sorted query. Supports: search (full-text + ILIKE fallback), milestone, lo, state, purpose, lock, program, amountMin/Max, rateMin/Max, dateFrom/To, sortField, sortDir. Returns `{ rows, total, filterOptions }`.
- `getCompactRows()` — All rows with PII stripped (for Intelligence page). Uses `dbRowToCompact()`.
- `getAIContext(question?, filters?)` — Pre-aggregated stats for Claude AI: byMilestone, byState, byProgram, byProgramGroup, byPurpose, byLO, byLock, rateDistribution, byYear, byMonthYear, byYearState. **Cached 2 minutes**.
- `getFilterOptions()` — Calls `get_filter_options()` RPC. **Cached 60 seconds**.
- `getStatus()` — Reads `sync_status` table row.
- `triggerSync(baseUrl)` — POSTs to `/api/cron/sync-pipeline`.

**Internal**: `fetchAllRows()` paginates Supabase's 1000-row limit.

### 6.3 `encompass.ts` (~298 lines)
Encompass API client. See §5.1 for full API coverage.

**Key detail**: `PIPELINE_FIELDS` array maps canonical names + field IDs used in pipeline search. Trash folder is always excluded from searches.

### 6.4 `encompass-to-db.ts` (~180 lines)
Bidirectional field mapping between Encompass API and Supabase DB.

**Exports**:
- `normalizeDate(raw)` — Converts "MM/DD/YYYY HH:MM:SS AM/PM" to ISO "YYYY-MM-DDTHH:MM:SS"
- `encompassFieldsToDbRow(guid, fields)` — API → DB row. Maps canonical names to DB columns with fallback to field IDs (e.g. `Fields.14` → `property_state`).
- `dbRowToPipelineRow(row)` — DB → Frontend format. Output: `{ loanGuid, loanNumber, borrowerName, coBorrowerName, loanAmount, loanStatus, noteRate, loanOfficer, loanProcessor, milestone, loanProgram, loanPurpose, lienPosition, propertyState, propertyCity, propertyZip, propertyAddress, lockStatus, lockExpiration, closingDate, dateCreated, applicationDate, modified, channel, loanFolder }`.
- `dbRowToCompact(row)` — DB → Compact (no PII). Strips borrower names, address. Used for Intelligence page.

**Interfaces**: `DbRow` (26 columns), `CompactRow` (16 fields).

### 6.5 `field-definitions.ts` (~89 lines)
Maps Encompass field IDs to human-readable labels for the Loan Detail "Mapped Fields" tab.

**Exports**:
- `PROCESSING_FIELDS` — 22 field IDs (loan info, property, team, dates)
- `BRANCH_FIELDS` — 15 field IDs (branch, pricing, margin, fees)
- `STATUS_FIELDS` — 13 field IDs (status, milestone tracking)
- `ALL_FIELD_IDS` — Deduplicated union (50 fields)
- `FIELD_LABEL_MAP` — `Record<string, string>` mapping field ID → display label

### 6.6 `pipeline-cache.ts` (~659 lines)
**Legacy** server-side in-memory cache. Month-by-month exhaustive fetch from Encompass API (2000-present). Being replaced by `supabase-queries.ts` for DB-backed data.

**Key functions**: `ensureReady()`, `forceRefresh()`, `queryPipeline()`, `getCompactRows()`, `getAIContext()`, `getStatus()`.

**Pattern**: Stale-while-revalidate with 5-minute refresh interval. Batch size 500. Progressive data availability during warmup.

### 6.7 `pipeline-store.ts` (~277 lines)
Client-side shared state with `sessionStorage` persistence. Enables instant page navigation without re-fetching.

**Exports**:
- `getPipelineCache()` / `setPipelineCache()` — Pipeline page data
- `getIntelCache()` / `setIntelCache()` — Intelligence page data
- `getMarketCache()` / `setMarketCache()` — Market page data
- `getConnectedStatus()` / `setConnectedStatus()` — Encompass connection status
- `getPipelineSummary()` — Generates text summary for Milo AI context injection (total loans, volume, top states, top LOs, milestone breakdown)
- `getPipelineStateBreakdown()` — Returns `{ state, count }[]` for Market page news targeting
- `compactToPipelineRow(compact)` — Converts compact row back to full PipelineRow format

**Staleness**: 5 minutes. Data read from sessionStorage is used immediately if fresh, otherwise triggers API fetch.

**Hydration safety**: `sessionStorage` reads are deferred to `useEffect` to prevent SSR/CSR mismatch.

### 6.8 `milo-docs.ts` (~383 lines)
Document routing engine for Milo AI.

**PDF Library**: 5 large PDFs + 18 small chapter PDFs in `docs/MIlo AI/`:

| Document | Pages | Category |
|----------|-------|----------|
| HUD 4000.1 (FHA Handbook) | ~1,100+ | FHA |
| VA Pamphlet 26-7 | ~500+ | VA |
| Fannie Mae Selling Guide | ~1,000+ | Conventional |
| Freddie Mac Seller/Servicer Guide | ~800+ | Conventional |
| USDA HB-1-3555 | ~300+ | USDA |
| 18 chapter PDFs | Variable | FHA/VA/Conventional chapters |

**Chunking**: Large PDFs are split into ~45-page chunks using `pdf-lib`. Chunks cached to `docs/MIlo AI/.chunks/` directory with base64 encoding. Budget: 75 pages per API call.

**Exports**:
- `routeDocs(question, conversationContext)` — Scores question against categories (fha/va/conventional/usda/general) using regex keyword matching. Returns `DocMeta[]` fitting within 75-page budget.
- `routeDocsMultiBatch(question, context)` — Returns `{ directBatch, overflowBatches }`. Direct batch goes to Claude as PDF attachments. Overflow batches are pre-extracted via Haiku in parallel, then injected as text context.
- `loadDocBase64(filename)` — Returns base64 string for a PDF file (cached in memory).

**Routing algorithm**:
1. Score question against keyword patterns per category
2. Select top-scoring category's docs
3. If question spans multiple categories, include cross-category docs
4. Sort by relevance score, fill up to 75-page budget
5. Overflow docs go to secondary extraction batches

---

## 7. Components (src/components/)

### 7.1 `AppHeader.tsx` (~161 lines)
Shared navigation header across all pages.

**Props**: `{ activeTab: TabId, rightContent?: ReactNode }`

**TabId**: `"pipeline" | "intelligence" | "market" | "milo"`

**Tabs**:
| Tab | Label | Route | Icon |
|-----|-------|-------|------|
| pipeline | Pipeline | `/` | none |
| intelligence | Intelligence | `/intelligence` | BarChart3 |
| market | Market | `/market` | Globe |
| milo | Milo AI | `/milo` | Sparkles |

**Features**:
- Mobile hamburger menu (below `sm` breakpoint)
- Connection status: polls `/api/auth/test` on mount, caches result via `pipeline-store`
- Pipeline stats: total loans + sync age from `/api/pipeline/stats`, polled every 30s
- `rightContent` prop for page-specific header actions (e.g. filter count, refresh button)

### 7.2 `LoanCopilot.tsx` (~380 lines)
Collapsible left-side AI copilot panel for the Loan Detail page. Replicates full Milo AI functionality with loan-specific context injection.

**Props**: `{ isOpen: boolean, onClose: () => void, loanContext: string }`

**Features**:
- **Fixed left panel** (420px) with slide-in/out animation (`translate-x-0` / `-translate-x-full`). State preserved while panel is hidden.
- **Full Milo AI chat**: Streaming SSE responses from `/api/milo/chat`, same system prompt and document knowledge (FHA, VA, Fannie Mae, Freddie Mac, USDA).
- **Dynamic loan context**: Receives `loanContext` prop — a PII-stripped, rich markdown context built by `stripPii()` + `buildLoanContext()`. Includes loan overview, property (city/state/zip only), income & assets, document inventory, key dates, and loan team. Injected into the AI system prompt alongside `pipelineContext`.
- **Citation support**: Same `【bracket notation】` parsing and clickable orange citation badges as Milo page. `SOURCE_TO_FILE` mapping resolves citations to PDF filenames.
- **PDF side panel**: Fixed right-side overlay when a citation is clicked. Page jumping via URL fragment (`#page=N&search=term`). Uses `/api/milo/docs` to serve PDFs.
- **Markdown renderer**: Full renderer for bold, tables, bullet/numbered lists, headers (h1-h3), code blocks, horizontal rules, and citation badges. Compact styling for sidebar width.
- **Loan-specific starters**: 4 pre-written questions (eligibility check, red flags, document checklist, rate lock analysis) instead of Milo's generic 8 starters.
- **Follow-up chips**: Quick-tap buttons for "Check DTI limits", "Required conditions", "Compare programs".
- **Streaming indicator**: Pulse dot during active streaming, phase indicator for multi-batch synthesis.

**Shared utilities** (duplicated from Milo page for isolation):
- `SOURCE_TO_FILE` — 25+ citation name → PDF filename mapping
- `resolveSourceFile(citation)` — Resolves citation text to filename with fuzzy matching
- `parseCitationLocation(citation)` — Extracts `{ page, search }` from citation string
- `buildPdfUrl(file, citation)` — Builds `/api/milo/docs?file=...#page=N&search=term` URL

### 7.3 `USMap.tsx` (~290 lines)
Custom SVG choropleth map of the US using TopoJSON (us-atlas).

**Props**: `{ data: Record<string, { units: number; volume: number }>, selectedState?: string, onStateClick?: (state: string) => void }`

**Implementation**:
- Loads US topology from `us-atlas/states-10m.json`
- Custom Albers USA projection (implemented from scratch, no d3-geo dependency for the projection itself — uses `d3-geo` only for `geoPath`)
- FIPS-to-state-abbreviation mapping (50 states + DC)
- Color scale: orange intensity based on volume relative to max
- Interactive: hover tooltip (state name, unit count, volume), click-to-filter
- Selected state: highlighted border
- SVG rendered with `<path>` elements, no canvas

---

## 8. Pages (src/app/)

### 8.0 `layout.tsx` (Root Layout)
- Title: "Premier Lending Portal"
- Body class: `bg-[var(--bg-primary)]`, system-ui font
- Wraps all pages with `<html>` + `<body>`

### 8.1 Pipeline Page — `page.tsx` (~618 lines, route: `/`)

**Purpose**: Main loan pipeline table with search, filters, sort, pagination.

**Data flow**:
1. On mount: check `pipeline-store` for cached data
2. If stale/empty: fetch `GET /api/pipeline?page=0&pageSize=50&sortField=modified&sortDir=desc&...filters`
3. Cache response in `pipeline-store`
4. Subscribe to Supabase Realtime channel `pipeline-changes` for live updates

**Features**:
- **AI Search**: Natural language input → `POST /api/ai-search` → SQL → results. Uses Haiku to generate SQL, executes via `execute_readonly_query()` RPC.
- **12 filters**: milestone, LO, state, purpose, lock status, program, amount range (min/max), rate range (min/max), date range (from/to). All populated from `filterOptions` returned by `getFilterOptions()`.
- **Sortable columns**: Click column header to sort. Fields: loanNumber, borrowerName, loanAmount, noteRate, milestone, loanOfficer, propertyState, lockStatus, modified.
- **Pagination**: 50 rows/page. Page buttons at bottom.
- **Row click**: Navigates to `/loan/{loanGuid}`.
- **Real-time**: Supabase Realtime subscription on `pipeline_loans` table. On INSERT/UPDATE, increments badge counter. Click badge to refresh.

**Key state**: `rows`, `total`, `filterOptions`, `search`, `aiSearchQuery`, `aiResults`, `aiDescription`, `sortField`, `sortDir`, `page`, `filters` (12 individual filter states).

### 8.2 Loan Detail Page — `loan/[loanId]/page.tsx` (~1,290 lines, route: `/loan/:id`)

**Purpose**: Deep-dive into a single loan. 5 tabs + collapsible AI copilot sidebar.

**Data fetching**: Parallel fetch of 4 endpoints on mount:
1. `GET /api/loans/{id}` → full loan JSON
2. `GET /api/loans/{id}/fields` → mapped field values
3. `GET /api/loans/{id}/documents` → documents + attachments
4. `GET /api/loans/{id}/milestones` → milestone log

**Milo AI Copilot**:
- Toggle button ("Milo AI" with Sparkles icon) in the header next to Refresh
- Opens `LoanCopilot` component as a fixed left panel (420px)
- Main content shifts right (`ml-[420px]` with CSS transition) when copilot is open
- PII stripping pipeline (`stripPii()` from `strip-pii.ts`) removes ~60 always-PII fields, custom fields, contact info, credit scores, street addresses, SSNs, etc. Config-driven via `pii-config.json`.
- `buildLoanContext()` produces rich markdown context (~5x more detail than before):
  - PII safety header (instructs AI not to reproduce/infer removed data)
  - Loan overview: number, amount, rate, program, purpose, milestone, LTV/CLTV, DTI, AUS, QM
  - Property: city/state/zip/county only (NO street addresses)
  - Income & assets: monthly/annual income, asset totals, liability breakdown table
  - Document inventory: eFolder summary, verification counts, disclosure counts, UW conditions
  - Key dates & expirations: 18 date fields (application through flood expiration)
  - Loan team: role/name pairs from milestones, milestone status
- Memoized with `useMemo` (deps: `[loan, milestones, docs]`) for performance
- The `loanContext` string is passed to the copilot, which sends it to `/api/milo/chat` alongside `pipelineContext`

**Tabs**:

**Overview** — Borrower info, property details, loan team, key dates (application, closing, lock expiry), pricing/margins. 4-column card layout.

**Mapped Fields** — Uses `FIELD_LABEL_MAP` to display ~50 Encompass fields with human labels. Search/filter within fields. Grouped by category.

**Documents** — Document list with attachment count, status badges. Each document expandable to show attachments. Inline PDF preview via iframe (calls `/api/loans/{id}/attachments/{attachmentId}?page=N` for page images or native PDF). File download button. Search by document title.

**Milestones** — Timeline of milestone events with dates, durations between milestones.

**Raw JSON** — Collapsible JSON viewer of the full Encompass loan response. Copy-to-clipboard.

### 8.3 Intelligence Page — `intelligence/page.tsx` (~1,430 lines, route: `/intelligence`)

**Purpose**: Analytics dashboard with 9 chart sections + AI query bar.

**Data fetching**: `GET /api/intelligence/stats?state=...&lo=...&milestone=...&program=...&purpose=...&lock=...&dateFrom=...&dateTo=...` → pre-aggregated stats (~5KB). Auto-refetch every 5 minutes.

**9 chart sections** (all collapsible):
1. **Geographic Distribution** — USMap heatmap + top states table
2. **Pipeline Snapshot** — Milestone bar chart + lock status pie chart
3. **Loan Characteristics** — Rate distribution + amount distribution bar charts
4. **Distribution** — Program pie + purpose pie
5. **Volume by LO** — Horizontal bar chart (top 25) + data table
6. **Timeline & Alerts** — Monthly trend line chart (last 12 months)
7. **Performance Metrics** — Avg rate by program, avg loan size by program
8. **Cross-Tab Analysis** — State × Purpose stacked bar chart
9. **Deep Analysis** — AI-powered strategic pipeline analysis (see below)

**AI Features**:
- **AI Query Bar**: Text input → `POST /api/intelligence/ask` → chart response with data. Supports bar, pie, line, horizontal-bar, stacked-bar, grouped-bar, multi-line, table chart types. Two-tier approach: text-to-SQL (fast path) or blueprint (fallback).
- **AI Insight buttons**: Per-chart "Get AI Insight" → `POST /api/intelligence/insight` → bullet-point analysis from Sonnet.
- **Deep Analysis**: Manual-trigger streaming analysis via `POST /api/intelligence/deep-analysis`. Sends all pre-aggregated stats to Claude Sonnet, which produces a 5-section strategic report: (1) Pipeline Health by Milestone Stage, (2) Trend Discovery & Pattern Analysis, (3) Risk Alerts & Red Flags (CRITICAL/WARNING/ADVISORY), (4) Strategic Recommendations (5-7 actionable items), (5) Deep Dive (random surprising topic or user-specified topic). Supports 4 optional focus controls (milestone, state, LO, free-text topic) that weight the AI emphasis without changing the data. Streaming response (~2000-3000 words) renders progressively with a custom markdown renderer (headers, bold, code, bullet/numbered lists, tables with orange headers, horizontal rules). Results clear automatically when page filters change. Abort via AbortController.

**Filters**: 8 dropdowns with pill badges showing active count. Filters applied server-side.

**Export**: CSV download of any chart's data. Data table toggle for raw numbers.

### 8.4 Market Page — `market/page.tsx` (~982 lines, route: `/market`)

**Purpose**: Market intelligence for loan officers.

**Data fetching**: Parallel fetch on mount:
1. `GET /api/market/rates` → mortgage rates, treasury yields, economic indicators, rate lock advisor, daily product rates
2. `GET /api/market/news` → industry news
3. Pipeline data from `pipeline-store` (cross-page sharing)

**Sections**:

**Market Summary Banner** — Today's 30yr rate, weekly change, direction indicator.

**Market Pulse** — 6 KPI cards: 30yr Rate, 15yr Rate, 10yr Treasury, Fed Funds Rate, Spread, Inflation Rate.

**Today's Product Rates** — 4 cards: Conforming, FHA, VA, Jumbo (from Optimal Blue daily data). Shows rate + date.

**Rate Lock Advisor** — Signal: Lock / Float / Neutral. Based on 5-day treasury trend and mortgage-treasury spread analysis. Shows reasoning.

**Pipeline Rate Intelligence** — Pipeline's average rate vs current market rate. Shows spread and whether pipeline is above/below market.

**Affordability Impact Calculator** — Interactive: input home price, down payment %, loan term → calculates monthly P&I at current rate vs rate +/- 0.5%.

**LO Talking Points** — AI-generated conversation starters based on current market conditions.

**Upcoming Rate-Moving Events** — Calendar of FOMC meetings, CPI releases, jobs reports. Hardcoded schedule with countdown timers.

**Rate & Spread Analysis** — 4 sub-charts:
- Mortgage rates trend (30yr + 15yr, Recharts line)
- Treasury yields (2yr/5yr/10yr/30yr)
- Mortgage-Treasury spread
- Yield curve spread (10Y-2Y)

**Economic Dashboard** — 10 indicator cards with sparklines, values, change direction, YoY change, context explanations.

**Pipeline Exposure by State** — Top states from pipeline with market context.

**Industry News** — Category tabs (All, Mortgage Rates, Housing Market, Fed Policy, Lending Industry, Local Market). State-specific news matches pipeline's top states.

**LO Knowledge Center** — Static Q&A cards about common LO questions (rate locks, buydowns, ARM vs fixed).

### 8.5 Milo AI Page — `milo/page.tsx` (~663 lines, route: `/milo`)

**Purpose**: AI underwriting assistant with streaming chat and PDF source viewer.

**Data flow**:
1. User sends message
2. Client sends `POST /api/milo/chat` with `{ messages, pipelineContext }`
3. `pipelineContext` = `getPipelineSummary()` from `pipeline-store` (loan stats for context)
4. Server routes question to relevant PDFs → sends as document blocks to Claude
5. Streams response back as SSE text
6. Client renders markdown with citation support

**Features**:
- **Streaming**: Response streamed as plain text chunks. Client accumulates and renders progressively.
- **Citation badges**: `【Source Name, Section X, p.XX】` brackets → clickable badges that open PDF side panel to specific page.
- **PDF side panel**: Loads PDFs from `/api/milo/docs?file=filename.pdf`. Opens to specific page from citation.
- **SOURCE_TO_FILE mapping**: 25+ guideline document names → actual PDF filenames. Handles synonyms (e.g. "HUD 4000.1" = "FHA Handbook 4000.1").
- **8 starter questions**: Pre-written common underwriting questions for quick start.
- **Document metadata**: Response header includes `<!--DOCS:[...]-->` with list of consulted guideline documents.
- **Multi-batch indicator**: `<!--PHASE:synthesizing-->` when overflow batches were used.
- **Markdown rendering**: Custom renderer for bold, tables, bullet points, code blocks, citations.

---

## 9. API Routes (src/app/api/)

### 9.1 `auth/test` — GET
Tests Encompass API connectivity. Returns `{ success: true, tokenPrefix }` or `{ success: false, error }`.

### 9.2 `pipeline` — GET
Main pipeline query endpoint.

**Query params**:
- `compact=true&all=true` → Returns compact rows (no PII) for Intelligence page
- `all=true` → Same as compact (legacy compat)
- Otherwise: paginated query with `page`, `pageSize`, `search`, `sortField`, `sortDir`, `milestone`, `lo`, `state`, `purpose`, `lock`, `program`, `amountMin`, `amountMax`, `rateMin`, `rateMax`, `dateFrom`, `dateTo`

**Response**: `{ rows: PipelineRow[], total: number, filterOptions: {...} }`

### 9.3 `pipeline/stats` — GET, POST

**GET**: Returns sync status. Auto-triggers sync if data is stale (>5 min) and cooldown OK (4 min).

**POST**: Triggers immediate sync via `/api/cron/sync-pipeline`.

**Response**: `{ totalRows, lastRefresh, state }` from `sync_status` table.

### 9.4 `ai-search` — POST
AI-powered natural language pipeline search.

**Request**: `{ query: string, filters?: { milestone, lo, state, purpose, lock, program, amountMin, amountMax, rateMin, rateMax, dateFrom, dateTo } }`

**Flow**:
1. Get total row count (cached 5 min)
2. Build SQL generation prompt with table schema + active filters
3. Call `claude-haiku-4-5-20251001` (max 512 tokens) → generates SQL + description
4. Validate: must be SELECT
5. Execute via `execute_readonly_query()` RPC on Supabase
6. Convert DB rows → PipelineRow format

**Response**: `{ rows: PipelineRow[], description: string, total: number }`

### 9.5 `loans/[loanId]` — GET
Proxies to `getLoan(loanId)`. Returns full Encompass loan JSON.

### 9.6 `loans/[loanId]/fields` — GET
Calls `readFields(loanId, ALL_FIELD_IDS)`. Returns ~50 mapped field values.

### 9.7 `loans/[loanId]/documents` — GET
Fetches documents + attachments in parallel. Enriches documents with attachment details (file size, page count, download URLs). Returns standalone attachments separately.

**Response**: `{ documents: [...], standaloneAttachments: [...], summary: { totalDocuments, docsWithAttachments, totalAttachments, standaloneAttachments } }`

### 9.8 `loans/[loanId]/milestones` — GET
Proxies to `getMilestones(loanId)`. Returns milestone event array.

### 9.9 `loans/[loanId]/attachments/[attachmentId]` — GET
Proxies and downloads attachment file from Encompass signed URLs.

**Query params**: `?page=N` (optional) — serve specific page image instead of original file.

**Flow**: Gets signed URLs → if no page param, downloads original file (PDF); if page param, downloads page image (PNG). Proxies bytes with correct Content-Type.

### 9.10 `loans/[loanId]/attachments/[attachmentId]/urls` — GET
Returns page URLs and thumbnails for an attachment.

**Response**: `{ id, pages: string[], thumbnails: string[], pageCount, originalUrls }`

### 9.11 `intelligence/stats` — GET
Server-side aggregation for Intelligence page.

**Query params**: Same filters as pipeline (state, lo, milestone, program, purpose, lock, dateFrom, dateTo).

**Flow**: Fetches all matching rows from Supabase (paginated 1000/batch), aggregates entirely server-side.

**Response** (~5KB): `{ totalUnits, totalVolume, milestoneData, stateData, programData, purposeData, loData, lockData, rateData, amountData, trendData, lienData, topState, topStatePercent, avgRate, purchasePercent, byStateMap, avgByProgram, milestoneVolData, avgRateByProgram, statePurposeData, allPurposes, loTableData, cacheAge, filterOptions }`

### 9.12 `intelligence/ask` — POST
AI analytics query with dynamic chart generation.

**Request**: `{ question: string, filters?: {...} }`

**Two-tier approach**:

**Fast Path** (when `execute_readonly_query` RPC exists):
1. Get 5 sample rows + total count (cached 5 min)
2. Build comprehensive SQL generation prompt with table schema, 30+ example queries, chart config format
3. Call Haiku → generates SQL + chartConfig (type, title, dataKey, nameKey, formatValue, pivotBy, topN)
4. Validate SQL (no writes, must be SELECT)
5. Execute via RPC
6. Handle pivot for multi-series charts
7. Build human-readable summary from actual query results

**Fallback Path** (no RPC):
1. Get pre-aggregated stats via `getAIContext()`
2. Send compact stats summary to Haiku with blueprint prompt
3. Haiku returns chart blueprint (source name, chart type, valueField, topN)
4. Server builds actual data arrays from stats using blueprint

**Response**: `{ title, summary, charts: [{ type, title, dataKey, nameKey, data, fullData, seriesKeys, formatValue }] }`

### 9.13 `intelligence/insight` — POST
Per-chart AI insight generation.

**Request**: `{ chartName, data, totalUnits, totalVolume }`

**Model**: `claude-sonnet-4-20250514` (800 max tokens)

**Prompt**: "Analyze this [chartName] data... Provide 3-5 key insights with specific numbers and actionable recommendations."

**Response**: `{ insight: string }`

### 9.14 `intelligence/deep-analysis` — POST
Streaming strategic pipeline analysis.

**Request**: `{ stats: StatsData, focus?: { milestone?, state?, lo?, topic? }, filters?: { state?, lo?, milestone?, program?, purpose?, lock?, dateFrom?, dateTo? } }`

**Model**: `claude-sonnet-4-20250514` (4096 max tokens, streaming)

**System prompt**: Senior mortgage pipeline strategist. Produces structured 5-section analysis:
1. Pipeline Health by Milestone Stage (early/active/approval/post-close)
2. Trend Discovery & Pattern Analysis (momentum, program shifts, geographic concentration, rate clusters, LO concentration, lock health)
3. Risk Alerts & Red Flags (CRITICAL/WARNING/ADVISORY with specific data points)
4. Strategic Recommendations (5-7 numbered, actionable items with impact estimates)
5. Deep Dive (AI picks a surprising topic, or uses user's custom topic)

**Focus controls**: Optional milestone/state/LO/topic params weight the AI emphasis. Active page-level filters are noted so AI knows data is a filtered subset.

**Stream format**: Same SSE-to-plain-text pattern as `/api/milo/chat`. Client reads via `ReadableStream.getReader()`.

**Response**: Streamed plain text (~2000-3000 words of markdown).

### 9.15 `milo/chat` — POST

Streaming mortgage AI assistant.

**Request**: `{ messages: ChatMessage[], pipelineContext?: string, loanContext?: string }`

**Flow**:
1. Route question to relevant PDFs via `routeDocsMultiBatch()`
2. For overflow batches: extract relevant content via Haiku in parallel
3. Build API messages with PDF document blocks on first user message
4. Inject extracted context into last user message
5. Stream from `claude-sonnet-4-20250514` (8192 max tokens)
6. Forward SSE stream: parse `content_block_delta` events → extract text → write to response
7. Prepend `<!--DOCS:[...]-->` metadata and optional `<!--PHASE:synthesizing-->` indicator

**System prompt**: 152-line comprehensive mortgage underwriting expert prompt covering FHA, VA, Conventional, USDA guidelines with citation formatting rules.

**Context injection** (appended to system prompt):
- `pipelineContext` → `## Live Pipeline Data` section (portfolio-level stats from `getPipelineSummary()`)
- `loanContext` → `## Current Loan Context` section (PII-stripped loan data from `stripPii()` + `buildLoanContext()`). Rich markdown with loan overview, property (city/state/zip only), income/assets, document inventory, key dates, and loan team. No street addresses, credit scores, SSNs, or contact details reach the AI.

### 9.16 `milo/docs` — GET
Serves PDF files for the Milo AI side panel.

**Query params**: `?file=filename.pdf`

**Security**: `basename()` sanitization, no path traversal. Checks `.chunks/` dir first, then main docs dir.

**Headers**: `Content-Type: application/pdf`, `Cache-Control: public, max-age=86400`.

### 9.17 `market/rates` — GET
Fetches all market data from FRED in parallel (21 series).

**Response**:
```typescript
{
  mortgage: [{ date, rate30yr, rate15yr }],
  treasury: [{ date, yr2, yr5, yr10, yr30 }],
  spreadData: [{ date, spread, rate30yr, yr10 }],
  yieldCurveSpread: [{ date, spread }],
  rateAnalysis: { current30yr, weekChange, monthChange, yearChange, yearHigh, yearLow, currentSpread, avgSpread },
  economic: EconIndicator[],  // 10 indicators with series, changes, context
  inflationRate: number,
  lockAdvisor: { signal, reason, treasuryTrend },
  dailyRates: [{ date, conforming, fha, va, jumbo }],
  productRates: { conforming, fha, va, jumbo },  // latest values
  fetchedAt: string,
}
```

### 9.18 `market/news` — GET
Fetches and aggregates Google News RSS feeds.

**Query params**: `?category=mortgage-rates|housing-market|fed-policy|lending-industry|local-market&states=CA,TX,FL`

**Response**: `{ items: NewsItem[], fetchedAt }` — sorted by date desc, deduplicated.

### 9.19 `cron/sync-pipeline` — POST, GET
Delta sync: fetches recently modified loans from Encompass, upserts to Supabase.

**Auth**: `CRON_SECRET` Bearer token (optional, for Vercel Cron).

**Flow**:
1. Set `sync_status` → "syncing"
2. Read `last_sync_at` from `sync_status`
3. Fetch loans modified since (last_sync - 2min overlap), max 5000
4. Upsert to `pipeline_loans` in 500-row batches
5. Update `sync_status` with new timestamp, total rows, duration

**Vercel**: `maxDuration = 60` (Pro plan).

### 9.20 `cron/normalize-dates` — POST, GET
One-time maintenance: normalizes US-format dates ("MM/DD/YYYY HH:MM:SS AM/PM") to ISO format in all date columns.

**Columns**: date_created, last_modified, closing_date, lock_expiration, application_date.

---

## 10. Scripts (scripts/)

### 10.1 `supabase-schema.sql`
Full database schema. See §4 for details. Run in Supabase SQL Editor before first use.

### 10.2 `seed-supabase.ts`
**Usage**: `npx tsx scripts/seed-supabase.ts`

One-time full pipeline seed. Loads ALL Encompass loans into Supabase.

**Strategy**: Month-by-month windows (2000-present) to avoid Encompass API's offset recycling bug. Deduplicates by loanGuid. Batch upsert (500/batch). Also fetches loans with empty DateCreated.

**Loads**: `.env.local` manually (no dotenv dependency).

### 10.3 `sync-daemon.ts`
**Usage**: `npx tsx scripts/sync-daemon.ts`

Background process: delta-syncs every 5 minutes. Fetches only recently modified loans (since last_sync - 2min overlap). Max 5000 loans per sync. Updates `sync_status` table.

**Alternative to**: Vercel Cron + `/api/cron/sync-pipeline`. Run this for local development.

### 10.4 `export-client-list.ts`
**Usage**: `npx tsx scripts/export-client-list.ts`

Exports ALL loans with PII fields to `data/client-list.csv`. Includes: borrower/co-borrower names, emails, phones, DOB, credit score, marital status, application date, full addresses. Month-by-month pagination with deduplication.

**WARNING**: Contains hardcoded Encompass credentials. Output includes PII.

---

## 11. Data Flow & Sync Pipeline

### Initial Setup
```
1. Run supabase-schema.sql in Supabase SQL Editor
2. Set env vars in .env.local
3. Run: npx tsx scripts/seed-supabase.ts
   → Fetches ALL loans month-by-month from Encompass API
   → Upserts into pipeline_loans table (~22K+ rows)
   → Updates sync_status
```

### Ongoing Sync (two options)

**Option A: Vercel Cron (production)**
```
AppHeader polls /api/pipeline/stats every 30s
  → If data stale (>5 min) → auto-triggers /api/cron/sync-pipeline
  → Delta sync: fetch loans modified in last 7 min
  → Upsert to Supabase
```

**Option B: Sync Daemon (local dev)**
```
npx tsx scripts/sync-daemon.ts
  → Every 5 min: delta sync from Encompass → Supabase
```

### Request Flow (Pipeline Page)
```
Browser                         Server                      Database/API
  │                               │                             │
  ├──GET /api/pipeline─────────►  │                             │
  │  (with filters, sort, page)   ├──supabase-queries.ts──────► │
  │                               │  queryPipeline()            │ Supabase
  │  ◄───── JSON response ────────┤                             │
  │                               │                             │
  ├──Realtime subscription──────► │ ────────────────────────────► Supabase
  │  (channel: pipeline-changes)  │                             │ Realtime
  │                               │                             │
  ├──POST /api/ai-search──────►  │                             │
  │  (natural language query)     ├──Claude Haiku───────────►   │ Anthropic
  │                               │  (generate SQL)             │
  │                               ├──execute_readonly_query()──► Supabase
  │  ◄───── AI results ──────────┤                             │
```

### Request Flow (Intelligence Page)
```
Browser                         Server                      External
  │                               │                             │
  ├──GET /api/intelligence/stats► │                             │
  │  (with filters)               ├──fetchAllRows()────────────► Supabase
  │                               │  (paginate 1000/batch)      │
  │                               ├──aggregate server-side──►   │
  │  ◄───── aggregated stats─────┤  (~5KB response)            │
  │                               │                             │
  ├──POST /api/intelligence/ask─► │                             │
  │  (question + filters)         ├──Claude Haiku──────────────► Anthropic
  │                               │  (generate SQL or blueprint)│
  │                               ├──execute SQL or build data─► Supabase
  │  ◄───── chart data ──────────┤                             │
```

### Request Flow (Milo AI)
```
Browser                         Server                      External
  │                               │                             │
  ├──POST /api/milo/chat────────► │                             │
  │  (messages + pipelineCtx)     ├──routeDocsMultiBatch()──►   │ (PDF routing)
  │                               │  (select relevant PDFs)     │
  │                               ├──[overflow] extractFromBatch()
  │                               │  via Claude Haiku──────────► Anthropic
  │                               │                             │
  │                               ├──buildApiMessages()         │
  │                               │  (attach PDFs as base64)    │
  │                               ├──Claude Sonnet (stream)───► Anthropic
  │  ◄───── SSE text stream──────┤                             │
  │                               │                             │
  ├──GET /api/milo/docs?file=──► │                             │
  │  (PDF viewer)                 ├──readFileSync()────────────► filesystem
  │  ◄───── PDF bytes ───────────┤                             │
```

### Client-Side Caching
```
Pipeline Page ──setPipelineCache()──► sessionStorage
                                          │
Intelligence Page ──setIntelCache()──►    │
                                          │
Market Page ──setMarketCache()──►         │
                                          │
Milo AI ──getPipelineSummary()◄───────────┘
Market  ──getPipelineStateBreakdown()◄────┘
```

---

## 12. Business Logic & Algorithms

### 12.1 Program Classification
Classifies 670+ raw `loan_program` strings into 6 categories:

```
ILIKE '%fha%'                                    → FHA
ILIKE '%va %' OR starts with 'va'                → VA
ILIKE '%usda%'                                   → USDA
ILIKE '%jumbo%'                                  → Jumbo
ILIKE '%conv%' OR '%fannie%' OR '%freddie%' OR '%agency%' → Conventional
else                                             → Other
```

Used in: `intelligence/stats`, `intelligence/ask`, `supabase-queries.ts`.

### 12.2 Rate Lock Advisor
**File**: `market/rates/route.ts` (lines 282-308)

**Inputs**:
- Last 5 days of 10Y Treasury yields → trend direction
- Current mortgage-treasury spread vs 52-week average spread

**Algorithm**:
```
IF treasury_trend > +5 bps → LOCK ("rates likely moving up")
IF treasury_trend < -5 bps → FLOAT ("rates may drop further")
IF spread > avg_spread + 20 bps → LOCK ("above-average spread")
IF spread < avg_spread - 10 bps → FLOAT ("favorable conditions")
ELSE → NEUTRAL ("no strong signals")
```

### 12.3 Affordability Impact Calculator
**File**: `market/page.tsx` (client-side calculation)

```
Monthly P&I = principal * (r * (1+r)^n) / ((1+r)^n - 1)
where:
  principal = homePrice * (1 - downPaymentPct/100)
  r = annualRate / 100 / 12
  n = loanTerm * 12
```

Shows comparison at current rate, +0.5%, and -0.5%.

### 12.4 AI Text-to-SQL
**Files**: `ai-search/route.ts`, `intelligence/ask/route.ts`

1. Build prompt with full table schema, column descriptions, example queries
2. Send natural language question + active filters to Claude Haiku
3. Parse JSON response: `{ sql, description/chartConfig }`
4. Validate: must start with SELECT, no forbidden keywords
5. Execute via `execute_readonly_query()` RPC (SECURITY DEFINER)
6. Convert results to frontend format

**Safety**: RPC function validates SELECT-only, blocks writes, requires `pipeline_loans` reference.

### 12.5 Document Routing (Milo)
**File**: `milo-docs.ts`

1. Score question against keyword patterns:
   - FHA: "fha", "hud", "4000.1", "mip", "ufmip", "203k", "manual underwriting"
   - VA: "va", "veteran", "irrrl", "funding fee", "residual income"
   - Conventional: "conventional", "fannie", "freddie", "conforming", "du", "lp", "homestyle", "homeready"
   - USDA: "usda", "rural", "guarantee fee", "gus"
   - General: "down payment", "dti", "credit score", "appraisal"
2. Select documents from top-scoring category
3. Budget: 75 pages per API call
4. Overflow → secondary extraction batches via Haiku

### 12.6 Delta Sync Strategy
**Files**: `cron/sync-pipeline/route.ts`, `scripts/sync-daemon.ts`

1. Read `last_sync_at` from `sync_status`
2. Fetch loans where `Loan.LastModified >= (last_sync - 2min overlap)`
3. Paginate (500/batch, max 5000 loans)
4. Upsert to Supabase on `loan_guid` conflict
5. Update `sync_status` with new timestamp

**Auto-trigger**: `/api/pipeline/stats` GET checks staleness (>5 min) and auto-fires sync with 4-min cooldown.

### 12.7 Month-by-Month Exhaustive Fetch
**Files**: `seed-supabase.ts`, `pipeline-cache.ts`

Encompass API has an offset recycling bug where deep pagination (>2000 offset) returns duplicate rows. Solution: partition by `DateCreated` month windows (2000-01 through current month), paginate within each window. Deduplicate by `loanGuid` using a Set.

---

## 13. Styling & Theming

**File**: `src/app/globals.css`

### CSS Custom Properties
```css
--bg-primary: #ffffff
--bg-secondary: #f8f8f8
--bg-card: #ffffff
--bg-card-hover: #fafafa
--border: #e5e5e5
--text-primary: #1a1a1a
--text-secondary: #555555
--text-muted: #999999
--accent: #f26522          /* Premier Lending brand orange */
--accent-light: #f47c3c
--accent-dark: #d9551a
--success: #22c55e
--warning: #f59e0b
--danger: #ef4444
--info: #3b82f6
```

### Custom Classes
| Class | Purpose |
|-------|---------|
| `.glass-card` | Card with border, rounded-12px, subtle shadow |
| `.status-badge` | Pill-shaped badge with icon + text |
| `.pulse-dot` | Pulsing opacity animation (2s cycle) for live indicators |
| `.skeleton` | Shimmer loading animation (gradient sweep) |
| `.data-table` | Pipeline table: sticky headers, hover highlight (#fff7f2), pointer cursor |
| `.tab-active` | Orange bottom border + accent color text |
| `.tab-inactive` | Muted text, transparent border, hover darkens |

### Custom Scrollbar
6px width, #ccc thumb on #f8f8f8 track.

### Tailwind v4
Imported via `@import "tailwindcss"`. No `tailwind.config.js` — uses default configuration with PostCSS plugin.

---

## 14. Environment Variables

### Server-Side Only
| Variable | Used In | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | `supabase.ts` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase.ts` | Full-access service role key |
| `ANTHROPIC_API_KEY` | `ai-search`, `intelligence/*`, `milo/chat` | Claude API key |
| `ENCOMPASS_CLIENT_ID` | `encompass.ts` | Encompass OAuth client ID |
| `ENCOMPASS_CLIENT_SECRET` | `encompass.ts` | Encompass OAuth client secret |
| `ENCOMPASS_USERNAME` | `encompass.ts` | Encompass API username |
| `ENCOMPASS_PASSWORD` | `encompass.ts` | Encompass API password |
| `CRON_SECRET` | `cron/sync-pipeline`, `cron/normalize-dates` | Bearer token for cron auth |

### Client-Side (NEXT_PUBLIC_)
| Variable | Used In | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `supabase.ts` | Supabase URL for browser client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `supabase.ts` | Anon key for RLS-restricted reads |

### Fallback Values
`encompass.ts` and scripts have hardcoded fallback credentials for `CLIENT_ID`, `CLIENT_SECRET`, `USERNAME`, `PASSWORD`. These should be moved to env vars in production.

---

## 15. Caching Strategy

### Server-Side Caches

| Cache | TTL | Location | What |
|-------|-----|----------|------|
| Encompass OAuth token | ~1 hour (token expiry - 60s) | In-memory (`encompass.ts`) | Access token |
| AI context stats | 2 minutes | In-memory (`supabase-queries.ts`) | Pre-aggregated pipeline stats |
| Filter options | 60 seconds | In-memory (`supabase-queries.ts`) | Distinct dropdown values |
| AI search row count | 5 minutes | In-memory (`ai-search/route.ts`) | Total pipeline_loans count |
| Intelligence sample+count | 5 minutes | In-memory (`intelligence/ask`) | 5 sample rows + count |
| RPC existence check | Permanent (until error) | In-memory (`intelligence/ask`) | Whether `execute_readonly_query` exists |
| FRED data | 1 hour | Next.js ISR (`market/rates`) | `next: { revalidate: 3600 }` |
| News RSS | 5 minutes | Next.js ISR (`market/news`) | `next: { revalidate: 300 }` |
| PDF base64 | Permanent | In-memory (`milo-docs.ts`) | Base64-encoded PDF content |
| PDF chunks | Permanent | Filesystem (`.chunks/`) | Split PDF files |
| Auto-sync cooldown | 4 minutes | In-memory (`pipeline/stats`) | Prevents sync spam |

### Client-Side Caches

| Cache | TTL | Storage | What |
|-------|-----|---------|------|
| Pipeline data | 5 minutes | sessionStorage | Rows, filters, total |
| Intelligence data | 5 minutes | sessionStorage | Aggregated stats |
| Market data | 5 minutes | sessionStorage | Rates, economic, news |
| Connection status | Session | sessionStorage | Boolean connected flag |

### Real-Time Updates
- Pipeline page subscribes to Supabase Realtime channel `pipeline-changes` on `pipeline_loans` table
- On INSERT/UPDATE events: shows badge with count of changes, user clicks to refresh

---

*Generated from source code analysis. Last updated: 2026-03-16.*
