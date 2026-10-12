# Read efficiency implementation — 13 October 2026

Implemented the nine approved read-efficiency items against baseline `4f8c42dc78d7ae9c5fb8b32afcfd6795029679dc`. All verification used local synthetic data and mocked Apps Script/Firestore services. No production database access, data migration, permission change or deployment was performed.

## Changes and evidence

| Item | Implemented behavior | Expected reduction, with its conditions |
| --- | --- | --- |
| 1. Excessive dashboard reads | Reject invalid, future and older-than-15-minute delta watermarks before querying; drain 200-row pages against one snapshot. Sign continuation cursors to prevent changing the position, count, project or snapshot. Apply authenticated per-account read limits after fresh authentication and role checks. | An invalid/stale delta itself reads zero movement documents; recovery still requires a bounded full refresh. No defensible fixed percentage for abuse prevention. Authentication reads remain necessary. |
| 2. Stock changes invalidating the whole catalog | After a confirmed stock commit, batch-read only changed raw product documents and patch a valid catalog cache. Preserve unknown fields, order, update times and the original expiry. Fall back to invalidation if another mutation wins or a cache/read fails. | For a warm 769-product cache and 1–5 changed products, catalog refresh reads become 1–5 instead of 769: **99.35–99.87%** reduction in this portion. Stock precondition/idempotency reads remain. If the cache is cold or expired, the normal full catalog load still occurs. |
| 3. Overlapping dashboard ranges | Merge adjacent/overlapping selected-year and stock-health ranges; keep distant ranges disjoint at a shared read time. Cache the movement snapshot for up to 60 seconds, invalidated on movement writes. | A previous-year selection with 1,000 movements/year reads **3,000 instead of 4,000: 25%**. Other year selections have different savings. |
| 4. Simultaneous cache misses | Use short metadata locks and expiring read leases; followers wait at most 900 ms for a completed cache entry, then perform their own read if necessary. Exceptions, eviction or contention cannot publish partial cache data. | Five identical requests using one completed cache entry instead of five loads save **80%** of those collection reads. Slow loaders beyond the bounded wait, eviction, force refresh and different keys can still cause duplicate reads. |
| 5. PO bootstrap/pending summary | Reuse the complete first-page/pending-summary snapshot for up to 60 seconds, with the original timestamp. Invalidate on PO, product, image and relevant master changes. Manual refresh bypasses snapshot reuse. Existing server search/continuations remain targeted. | With 200 pending POs, the cold path remains **251 document results** (200 summary + 51 page). A repeat bootstrap within the unchanged cache window reads **0 PO documents: 100% of that repeated PO portion**. Authentication and cache-miss work remain. |
| 6. Historic PO cost lookup | Deduplicate PO IDs and reuse raw cost/vendor-ID lookups for 120 seconds, invalidated on PO writes. Preserve recorded movement costs, zero costs and unknown costs. Cache keys cannot collide when IDs contain separators. | Three calls for the same 10 POs read **10 instead of 30: 66.7%**, while the cache remains valid. Vendor names continue to use the existing master-data cache. |
| 7. Duplicate checks during cache failure | Share a generation-bound product scan across name, part-number and barcode checks within one save. Retain all exact and normalized checks. | Three 769-row fallback scans become one: **2,307 → 769, 66.7%** of scan reads. Exact validation queries remain. |
| 8. Existence/reference checks | Use equality/array-contains queries with `limit: 1`; check both legacy `Car_ID` and array `Car_IDs`. Query failures continue to block deletion. | An unreferenced car checks two empty queries instead of scanning 769 products: approximately **769 → 2 billable query minimums, 99.74%** for that check. This is an estimate; fixture counters count returned documents, not empty-query billing. |
| 9. Stock history loading | Load 50 rows plus one lookahead initially. Add load-more and load-all controls. Search and type filtering automatically complete the existing latest-1,000-row scope. Preserve clickable transaction detail, partial results, retry position and explicit incomplete-search status. Ignore obsolete responses after refresh. | **1,000 → 51 initial document results: 94.9%**. Loading all 1,000 from a larger collection via the 200-row continuation path returns 1,006 results including lookahead rows; it does not save document reads when the user needs the entire scope. |

These percentages are separate scenarios and must not be added or presented as a total production saving. They exclude account checks, index-entry billing, retries, cache misses and unrelated routes. Existing full dashboard reconciliation every five minutes remains in place; snapshot timestamps are not reset on cache hits.

Firestore charges for document reads and, where applicable, index entries; empty queries have a minimum read charge. Ordering by the timestamp and `__name__` can introduce index-entry charges. Use staging Query Explain and production usage metrics after an approved rollout to measure the actual effect. These fixture results do not measure invoice totals or latency. [Firestore billing documentation](https://firebase.google.com/docs/firestore/pricing)

## Integrity, security and operational behavior

- No change to business write payloads, stock preconditions, request fingerprints, idempotency, existing row scope or role hierarchy. The new paged-history route has the same Viewer read level as the existing history route; transaction detail remains Staff.
- Fresh user-document reads still precede rate limiting and cached responses. Revoked/inactive accounts cannot obtain a cached response. Writes and authentication endpoints are not subject to the new heavy-read counters.
- Limits per account and method per 60-second window: dashboard bootstrap 30; product bootstrap and legacy stock history 60; delta, paged history, transaction detail and PO bootstrap 120. Counter/lock failure rejects the heavy read with a retry message. This limits expensive queries; it does not eliminate the required authentication read or constitute network-level denial-of-service protection.
- Rate counters and cache generations use Apps Script Properties/Cache, not Firestore documents. They add Apps Script operations. Transient counters are excluded from backups; no keys or credentials are included in the report or bundle.
- Successful stock commits cannot be reported as failed just because cache patching fails. Ambiguous commit/save/delete responses invalidate affected caches; retrying a committed stock request returns its existing result without another stock write.
- Cursor signatures use the existing authentication master key with a project-specific context. Cursor expiry is 55 minutes; ordinary history refresh starts a new snapshot. The latest guaranteed read time in the first query response is used for continuations, including equal timestamps. Firestore accepts recent historical read times within one hour. [runQuery reference](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/runQuery)
- No new Firestore collections, fields, indexes, security rules or IAM roles were created. The existing `Committed_At` timestamp is parsed correctly for delta paging. No Firestore emulator/real-project index execution was performed; verify query/index behavior in staging before deployment.
- Manual refresh bypasses the newly added result-snapshot cache. Existing catalog/master TTL behavior remains. Concurrent invalidation, absent cache chunks, stale generations and unavailable cache services trigger fresh reads instead of stale cache publication.

## Files changed

Runtime files to update together in Apps Script:

1. `Code.gs` — read guards, caches, product patching, scoped invalidation, reference queries and stable signed history/delta pages.
2. `index.html` — atomic multi-page dashboard delta application; retain old data/watermark on failure; explicit and queued force refresh.
3. `StockIssue.html` — progressive history loading, full-scope search/filtering and retry/status controls.
4. `Purchase_Orders.html` — explicit force refresh and preservation of snapshot age.
5. `Shared.html` — optional original load timestamp for freshness tracking.

Verification: `package.json`, `tests/read-efficiency.test.cjs`, `tests/browser.cjs`, `tests/backend.test.cjs`, `tests/integrity.test.cjs`, `tests/security.test.cjs`, `tests/support/services.cjs`; this report. Existing unrelated `docs/SYSTEM-AUDIT-2026-10-11.md` was left untouched and excluded from the commit.

## Verification

- `npm run check`: **68 scripts and Apps Script manifest passed**.
- `npm test`: **134 tests passed**, including 19 new read-efficiency scenarios.
- `npm run test:browser`: **72 regression groups passed** using local Chromium/Playwright and an HTTPS-blocking fixture server. Includes 320/390 px layouts, complete history search, detail access, stale response rejection, retry after failed paging, multi-page delta failure recovery, queued manual refresh and original cache age.
- `git diff --check`: passed before delivery.
- No tests called live Apps Script, Firebase, Drive or email services. Actual Apps Script quotas, production index configuration, workload-wide read reduction and real-user latency remain unmeasured.

Local logs: `test-results/read-efficiency-regression.log`, `test-results/read-efficiency-browser.log`. Generated results and source bundles are ignored by Git.

## Delivery and rollout

Source changes are delivered on `main`; the completion message gives the exact commit SHA and push result. A local review bundle contains all runtime dependencies from that commit. Preparing this bundle is not an Apps Script sync or deployment.

Before an authorized production rollout, verify the five changed files together in a separate staging project, including pagination/index requirements, two-user stock updates, revocation, PO receipt/status invalidation and the Apps Script Properties quota under the intended workload. Compare equivalent usage periods with the same data volume, users and cache conditions. Production deployment and data operations require separate authorization.

Rollback is a coordinated source revert of the five runtime files to the baseline release; this change needs no database rollback or migration.
