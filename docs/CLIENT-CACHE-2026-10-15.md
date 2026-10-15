# Business data cache and XLFilter — 15 October 2026

This report records the first cache implementation. The later [cache quality update](CACHE-QUALITY-2026-10-15.md) supersedes its server TTL/refresh limitations and adds section reuse, source expiry propagation and Dashboard delta improvements. Production deployment is still pending.

## Diagnosis and delivered behavior

Product XLFilter previously called Apps Script on every header click, waited for
the RPC before opening the popover, and recomputed distinct values over the full
catalog even when the catalog's server cache was warm. Shared `callApi` merged
simultaneous requests but discarded successful results.

Business read routes now share a bounded browser cache. Identity is scoped to
the authenticated owner, role and Web App URL; memory also follows the current
session. Authentication, user administration, activity logs and backups are not
cached. `getProductById` remains an authoritative read for targeted recovery.

- Master lists/dropdowns: 120-second reuse, maximum browser snapshot age 5 minutes.
- Products, stock, history and document pages/details: 30-second reuse, maximum
  browser snapshot age 2 minutes. Keys include the page, search, sort and filters.
- Facet keys exclude their own filter, text search, sort and page because those
  inputs do not change the existing cascading Excel-filter semantics. Other
  column filters remain part of the key.
- Memory stores at most 40 snapshots / 6 million serialized characters, with a
  3-million-character per-snapshot limit. Compact catalog data stays compact in
  storage and expands only for callbacks. Oversized data is returned normally
  without caching; existing page arrays still hold the current view.
- Only small master/facet snapshots persist in `sessionStorage`: under 100,000
  characters per response and an aggregate budget of roughly 250,000 characters
  plus metadata. Tables, business documents, catalog image bytes and credentials
  are not persisted. Storage/quota/private-mode failures do not block reads.
- Each callback receives independent data. Unsaved table/form changes cannot
  change a cached snapshot or another callback's result.

The first unfiltered product bootstrap carries up to five low-cardinality facet
sets (part type, brand, category, zone and status), using the catalog already in
memory. Columns with more than 300 distinct values are omitted and loaded on
demand; names/codes are never eagerly included. No extra RPC or DB read is needed.
Server-side facet results are cached for up to 120 seconds by normalized filters
and existing collection generations.

XLFilter opens a loading popover immediately. Closing it makes no second RPC;
late results cannot reopen it. Escape/outside click cancel the displayed request,
and a failed load has an explicit retry action. Complete selected-value semantics
and the existing 200-option DOM window remain intact.

## Synchronization and security

Successful writes invalidate dependent snapshots before their existing success
callbacks run. Ambiguous transport failures also invalidate those snapshots
without automatically retrying the business write. Existing local record/stock
deltas continue to update UI arrays. Trusted frame messages invalidate sibling
caches; the sender does not receive its own notification again. Active related
views refresh through their existing freshness guard, while inactive views wait
until activation. A response captured before an invalidation cannot republish
old data into the browser cache or return it as a successful fresh read.

Version validation is carried by existing `apiGateway` requests, not a new poll
endpoint. The optional protocol returns either data plus collection generations,
or a not-modified response. Session, current server role, route permission and
read-rate checks run first. Validation never extends the hard browser snapshot
age. Force requests and cursor/export reads use the ordinary data worker; the
product export explicitly bypasses browser reuse. Explicit refresh buttons bypass
browser cache, preserving existing backend force behavior where available.

Legacy callers retain the original response shape. Updated clients receiving
bare results from an older server do not cache them. Sync the client and backend
as a coherent release to enable the complete optimization.

Quotation and tax-invoice generations now invalidate through existing cache
metadata paths after saves/deletes/atomic commits. These are Script Properties
and CacheService operations, not Firestore revision documents or extra DB writes.
Logout clears all data-cache namespaces for the current account's roles; session
expiry clears the current read cache while preserving the established draft flow.

## Verification and measured limits

- Syntax: 69 scripts and Apps Script manifest passed.
- Automated regression: 173 tests passed, including 14 cache tests.
- Local Chromium regression: 87 groups passed, including all routed pages,
  Viewer behavior, stock/document transactions, trusted frame communication,
  10,000-product browsing, filter loading/retry and actual browser cache reuse.
- Ten identical successful reads within the reuse window: 10 RPCs become 1,
  a measured **90% reduction in those RPCs**, with nine browser hits.
- Server conditional validation against unchanged versions: the data worker is
  skipped. Tests use stub authentication and do not measure billable auth reads.
- Repeating the same server facet context executes the full catalog processing
  once; a product generation change executes it again.
- No production access, Firestore mutation, schema/index/IAM change or role
  expansion occurred. Existing atomic writes, retry IDs and server stock checks
  remain the authority.

This is not a measured percentage reduction of total Firestore Reads or production
latency. Warm server caches may already avoid catalog reads; avoided browser RPCs
also avoid the work/auth checks that those calls would otherwise require.

Changes through this application's write paths update generations. Direct Firebase
console/external writes do not update Apps Script generations: recovery remains
bounded by the **existing server cache TTLs** (products 15 minutes, images 30
minutes, customers 1 hour, other masters up to 6 hours), in addition to browser
expiry and the current reconciliation logic. A browser refresh alone does not
guarantee bypass of every underlying server collection cache. This release does
not introduce Firestore listeners, indexes or change feeds.

## Files and rollout

Runtime: `Code.gs`, `Shared.html`, `XLFilter.html`, `index.html`,
`Master_Products.html`. Verification: `tests/client-cache.test.cjs`,
`tests/browser.cjs`, `package.json`. Documentation: this report and `README.md`.

Delivery is source on `main`. Apps Script sync, a separately authorized production
deployment, and live multi-user UAT/read/latency measurements remain outstanding.

UAT should include first-load/filter cache hit, manual refresh, two accounts on
separate browsers, product/master/document mutations, role/session revocation,
network failures and a 10,000-product catalog. Deploy all runtime files from one
verified release package; do not mix individually copied client/server revisions.
