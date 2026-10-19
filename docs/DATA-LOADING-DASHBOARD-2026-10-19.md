# Data loading recovery and Dashboard layout — 19 October 2026

## Scope and deployment

Authorized source work: investigate and fix slow/intermittently empty Products, shared read recovery, and the Dashboard skeleton/layout reviewed with the owner. Search and XLFilter semantics, authentication, role permissions, stock transactions and database contents stay unchanged. No Apps Script source sync or Production deployment is performed. Production remains the last verified Version 98; the earlier menu recovery commit `bfe26f1` is also pending deployment.

## Reproduced causes

- Products originally started its first request on `window.onload`, after unrelated page assets finished. A held image fixture demonstrates that the revised table loads before the window finishes loading.
- Searching before the first Products response rendered an empty local array. The first response could then display products for the previous query. Initial and subsequent reads now use the same sequence fence and a 200 ms search debounce; superseded replies cannot replace current rows.
- Product initialization bundled full edit dropdowns behind the product page and initialized dropdown UI before rendering rows. The table now requests only its page; edit metadata loads on the first Add/Edit action. Failed dropdown loading cannot blank the list or open an incomplete editor. Concurrent form-open actions share the pending metadata read.
- Shared business RPCs had no client deadline. A missing callback could leave all coalesced callers pending indefinitely. Reads now settle after 45 seconds, release pending callers, and offer the page's explicit retry. Late success/failure callbacks are ignored. This does not cancel GAS server execution. No automatic retry is introduced, and writes retain their existing uncertain-result handling without this read deadline.
- Products previously treated a missing `products` field as an empty list. It now distinguishes invalid response shape, legitimate empty results and transport/auth errors; invalid product responses evict the related local cache so an explicit retry can request valid data.
- Dashboard used nine skeleton/error columns for ten actual columns. KPI, alert and chart panels had no corresponding placeholders. A first render marked `notModified` could skip drawing entirely despite receiving restored data. The first successful snapshot now always renders.

These are local reproductions against the actual templates with mocked Apps Script transport. They do not establish the sole cause of every intermittent Production failure, or a measured Production latency reduction.

## Dashboard behavior

Four KPI cards use a consistent 4/2/1 responsive grid: stock value, sales, receipts and issues. Four stock alerts follow, then Stock Health, trend/category analytics, and Fast/Slow/Aging panels. All sections reserve their loading space, use meaningful period/filter labels, disable unavailable actions, and clear skeletons after failure. Refresh retains existing data.

Stock Health still filters/sorts and calculates totals over the entire loaded dataset. It draws at most 50 data rows per page; page navigation is local and sends no RPC. Re-rendering unchanged criteria preserves the selected page; changing criteria resets to page one and shrinking results clamps the page. Export and product detail data retain the complete sorted/loaded data. A 10,000-row fixture verifies 50 rendered rows (99.5% fewer initial row DOM elements), full-set search/totals, and zero navigation RPCs. **This is a DOM reduction, not a claim of fewer Firestore reads or equivalent end-to-end speedup.**

## Cache, Firestore and security impact

- No backend workers, Firestore schema/index/rules/IAM, database values, Drive contents, user permissions or triggers are changed. No Production read/write test is run.
- Normal Products navigation retains its bounded cursor query. Browsing no longer requests complete edit-only master dropdown collections. Row labels still use the existing targeted reference reads; opening an editor later adds one metadata RPC and reuses the existing authenticated cache policy.
- No additional polling, automatic retries, monitoring writes, expanded durable-cache allowlist or longer cache lifetimes are introduced. Existing IndexedDB account/session/role isolation and server validation remain mandatory.
- Existing cold full-catalog search/XLFilter and Dashboard bootstrap costs remain. No unmeasured percentage reduction in billed Reads/Write is claimed.
- Pending product draft recovery is retained in local draft capture while metadata is loading or fails. The editor only resumes after metadata succeeds; restoration submits no writes.

## Diagnostics

`syyCacheStats.byApi` records actual RPC count, errors, elapsed duration and calls taking at least three seconds, including uncached read APIs. Coalesced listeners and memory hits are not counted as extra RPCs.

`syyCacheStats.views.products` and `.dashboard` retain up to 20 local samples: data-wait time, synchronous render time, total duration, row count and cache source, with p50/p95 across those samples. These are local page diagnostics, not Firestore billing metrics, network/server-time isolation, long-term telemetry or a representative Production benchmark. They record no request arguments, product rows, tokens or credentials and send no telemetry. Browser layout/paint and external script/HTML startup can still add time outside the measured render interval.

## Files changed

- `Master_Products.html`: earlier list startup, criteria sequencing, lazy editor metadata, response validation, draft safety and timing samples.
- `Shared.html`: once-only read completion/deadline and bounded local diagnostics.
- `index.html`: earlier shell initialization, aligned skeletons/error recovery, first cached render, balanced section order and bounded local table rendering.
- `tests/browser.cjs`: real template regressions, including held assets/requests, reversed responses, retry, 10,000 rows and draft recovery; existing form tests wait for the intentionally lazy editor.
- `tests/client-cache.test.cjs`: RPC metrics and bounded diagnostic tests.
- `README.md` and this report: review/rollout context.

## Validation

Local tests use synthetic data, block external HTTPS and do not contact Production:

- `npm test`: **222/222 pass** (backend, security, integrity, recovery, read efficiency, cache and backup regressions).
- `npm run test:browser`: **121/121 groups pass** in the complete final run, including all 15 routed pages and the seven new recovery/layout/scale groups. Async form tests now wait for actual readiness rather than relying on a fixed delay.
- `npm run check`: **70 scripts and the Apps Script manifest parse**.
- `npm run test:reads`: synthetic read-model assertions pass; its historical baseline comparisons are not measurements of this change's Production savings.
- `git diff --check`: pass.
- Desktop/mobile screenshots of loading, ready and lower analytics panels were inspected; overflow checks pass.

Evidence is kept locally under ignored `test-results/loading-2026-10-19-*` and `test-results/dashboard-*-2026-10-19.png`. Production smoke and comparable cold/warm timings remain to be measured after a separately authorized sync/deployment. The committed revision is recorded with the completion summary; no billing reduction percentage is asserted.
