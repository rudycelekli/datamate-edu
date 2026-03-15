# Hybrid Cache Architecture for Full Pipeline Scale (30-70K Loans)

## Context

The portal currently fetches pipeline data from Encompass on every request:
- Pipeline page: 50 rows per page, client-side filters only work on those 50 rows
- Intelligence page: hard-capped at 500 loans, missing 90%+ of the data
- Every page load = live API call to Encompass (slow, rate-limited)
- Multiple users = multiplied API load

**Goal:** Serve ALL 30-70K loans instantly to all users, no PII in persistent storage. Loan detail/documents stay live.

## Architecture: Server-Side In-Memory Cache

```
                     Encompass API
                          │
                    ┌─────▼──────┐
                    │  In-Memory  │  Refreshes every 5 min
                    │   Cache     │  ~90MB RAM for 70K loans
                    │  (Node.js)  │  Lost on restart (rebuilt)
                    └──┬────┬──┬─┘
                       │    │  │
        ┌──────────────┘    │  └──────────────┐
        ▼                   ▼                  ▼
   Pipeline Page    Intelligence Page    AI Ask Endpoint
   50 rows/page     Compact ALL rows     Pre-aggregated
   Server filter    No PII (~3MB gz)     stats → Claude
   Server sort      Client aggregation
   Server search    (unchanged logic)

        ┌───────────────────────────────────────┐
        │  LIVE from Encompass (unchanged):     │
        │  Loan detail, documents, milestones,  │
        │  field reader, AI search              │
        └───────────────────────────────────────┘
```

## Files to Create

### 1. `src/lib/pipeline-cache.ts` — Singleton in-memory cache

- Fetches ALL pipeline loans from Encompass on first request (exhaustive pagination in batches of 500)
- Stores full pipeline rows (Layer 1) + compact analytics rows without PII (Layer 2)
- Background refresh every 5 minutes via `setInterval`
- Atomic swap: builds new arrays, then replaces references in one step
- Stale-while-revalidate: if refresh fails, keeps serving old data
- Exports:
  - `ensureReady()` — triggers warmup if not started, returns readiness
  - `queryPipeline(params)` — server-side filter/sort/search/paginate, returns `{ rows, total, totalVolume, filterOptions, cacheAge }`
  - `getCompactRows(filters?)` — compact analytics rows (no PII), optionally filtered
  - `getAIContext(question)` — pre-aggregated stats + stratified sample for Claude
  - `getStatus()` — cache state, row count, last refresh time, errors

### 2. `src/app/api/pipeline/stats/route.ts` — Cache status endpoint

- `GET` returns cache status (state, totalRows, lastRefresh, duration)
- `POST` forces immediate refresh (admin use)

## Files to Modify

### 3. `src/app/api/pipeline/route.ts` — Cache-backed pipeline API

**Current:** Every request hits Encompass API directly
**New:** Reads from cache with server-side query processing

New query params:
```
?page=0&pageSize=50              (pagination)
&search=smith                     (full-text: loan#, borrower name, LO, city, state)
&sortField=modified&sortDir=desc  (server-side sort)
&milestone=Processing             (exact filter)
&lo=Jane+Smith&state=CA           (more filters)
&purpose=Purchase&lock=Locked
&amountMin=200000&amountMax=500000
&rateMin=5.5&rateMax=7.0
```

New response shape:
```json
{
  "rows": [...],
  "total": 28432,
  "totalVolume": 8500000000,
  "page": 0,
  "pageSize": 50,
  "cacheAge": 180000,
  "filterOptions": {
    "milestones": [...], "los": [...], "states": [...],
    "purposes": [...], "locks": [...], "programs": [...]
  }
}
```

Falls back to direct Encompass query during initial warmup (~30-60s).

### 4. `src/app/page.tsx` — Pipeline page (server-driven filters)

- `fetchPipeline()` sends all filter/sort/search as query params to the API
- Remove client-side `filteredRows` useMemo (server handles it now)
- Filter dropdowns populated from `response.filterOptions` (covers ALL 70K loans)
- Pagination shows "Showing 1-50 of 28,432 loans" from `response.total`
- Add cache freshness indicator ("Data as of 3 min ago")
- Keep AI search as-is (still queries Encompass directly)

### 5. `src/app/intelligence/page.tsx` — Full dataset analytics

- Replace `fetch("/api/pipeline?start=0&limit=500")` with `fetch("/api/pipeline?all=true&compact=true")`
- New `compact=true` param returns stripped-down rows: `{ guid, amt, prog, purp, ms, lo, lock, rate, st, dt, lien, ln, channel, closingDate, lockExp }` — NO borrower names, addresses, or other PII
- Size: ~3MB gzipped for 70K loans (acceptable)
- All existing `useMemo` chart aggregations work unchanged with a mapping layer
- Need a mapping layer: compact row → fields-like object so existing `pf()` calls work
- AI Chat: POST only `{ question }` (no pipelineData), server reads from cache
- Show total loan count and cache timestamp in header

### 6. `src/app/api/intelligence/ask/route.ts` — Smart AI context

- No longer receives `pipelineData` from client
- Reads from server cache via `pipelineCache.getAIContext(question)`
- Sends to Claude: pre-aggregated stats (by milestone, state, program, LO, etc.) + 200-row stratified sample
- Claude sees the FULL picture via aggregations (not just 500 random rows)
- Updated system prompt explains the pre-aggregated format

## What Stays LIVE (unchanged)

| Endpoint | Why |
|----------|-----|
| `/api/loans/[loanId]` | Full V3 loan object — deep PII, must be current |
| `/api/loans/[loanId]/fields` | Per-loan field reader — detailed PII fields |
| `/api/loans/[loanId]/documents` | Document tree — changes frequently |
| `/api/loans/[loanId]/attachments/*` | Binary file downloads |
| `/api/loans/[loanId]/milestones` | Real-time milestone status |
| `/api/ai-search` | AI-generated Encompass filters (live results) |
| `/api/intelligence/insight` | Already uses pre-aggregated chart data |

## Memory Budget (70K loans)

| Layer | Size |
|-------|------|
| Full rows (with PII) | ~70MB |
| Compact rows (no PII) | ~14MB |
| Indexes (4 Maps) | ~5MB |
| Total | ~90MB (Node.js default heap: 1.5GB) |

## Implementation Order

1. **pipeline-cache.ts** — build and test the cache module independently
2. **pipeline API** — swap to cache-backed, add query params, keep backward compat during warmup
3. **Pipeline page** — convert to server-driven filters/pagination
4. **Intelligence page** — switch to compact all-data fetch, add field mapping
5. **AI Ask** — switch to server-side cache reads with pre-aggregation
6. **Cache status endpoint** — monitoring

## Verification

1. Start dev server → cache should warm up (check `/api/pipeline/stats`)
2. Pipeline page: filters should show options from ALL loans, pagination should show correct totals
3. Intelligence page: charts should reflect ALL loans (not just 500)
4. AI Ask: should answer questions about the full pipeline with accurate numbers
5. Loan detail: should still load live data when clicking a loan
6. Cache refresh: wait 5 min, verify data updates

## Why In-Memory Cache (Not Database)

- **No PII persistence** — data lives only in RAM, gone on restart
- **~90MB for 70K loans** — trivially fits in Node.js (1.5GB default heap)
- **Instant reads** — sub-millisecond, no network/DB latency
- **Shared across all users** — one cache, one refresh cycle
- **No infra** — no Redis, no Postgres, no compliance burden
- **Simple** — just a TypeScript module

## Scaling Notes

- If deploying multiple server instances (e.g., 3 replicas), each maintains its own cache independently — they converge within 5 min
- For 100K+ loans, consider server-side pre-aggregation (skip sending compact rows to browser, send pre-computed chart data instead)
- The cache refresh (70K loans in batches of 500) takes ~30-120 seconds depending on Encompass API latency
