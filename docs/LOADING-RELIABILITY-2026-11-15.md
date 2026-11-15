# Loading reliability and staged data — 2026-11-15

Scope: implement the approved loading investigation on main. No Production deploy, login submission, database mutation, schema/index/rules/IAM change, or backup execution was performed in this implementation turn.

## Evidence and delivery boundary

The preceding live diagnosis found an authenticated app nested beneath the Login document. Products failed through the menu while the same product route opened directly. Dashboard already had data. This establishes a navigation/rendering failure separately from a complete Firestore outage; it does not establish that every slow query has been eliminated.

## Runtime changes

- `login.html`: keep the automatic top-navigation attempt. If GAS blocks it, show a real `_top` continuation link rather than navigating the Login iframe into another nested app. Clear password inputs and temporary password/token variables after successful authentication. No synthetic click or sandbox bypass.
- `index.html`: offer an explicit direct route after ten seconds of pending iframe readiness; preserve the 30-second failure boundary and the existing retry action. Direct opening removes iframe-only channel/origin parameters, uses a new tab and `noopener noreferrer`, and still goes through server authentication. Record frame-load timing separately from readiness.
- `UiBootstrap.html`: repeat only the validated readiness handshake through 25 seconds and on page restore; stop scheduled announcements on ACK. No additional business data reads.
- `Shared.html`: share a three-slot read pool across same-origin frames with the same authenticated token; isolated origins use a local pool. Coalesce identical in-flight transport requests, isolate response objects, prioritize foreground queued work, and discard superseded/expired queued requests. Writes remain outside this mechanism.
- A shared transport generation advances on cache invalidation/logout. New reads cannot attach to an older request started before a data change; old physical requests keep their concurrency slots until completion and existing cache revision checks reject stale replies. This conservative transport fence does not evict unrelated cached records or initiate extra reads by itself.
- UI read timeout no longer releases a physically running GAS request or creates duplicate retries. A later explicit identical request joins that transport, while late responses cannot overwrite an expired observer. Abandoned bookkeeping expires after 370 seconds, without restarting any operation. The surviving shell owns this timer so replacing a child frame cannot permanently occupy shared slots.
- `Code.gs`: an occupied cache-producer lease returns `CACHE_BUILDING` with a bounded retry hint rather than a non-retryable generic failure. No change to transactions, document writes or permission checks.
- `Shared.html`: at most one automatic retry for a completed `CACHE_BUILDING`, `READ_BUSY` or `AUTH_UNAVAILABLE` response. Do not auto-retry unknown network/timeout outcomes, writes, quota-limit failures or authoritative refreshes. Recheck obsolete criteria before dispatch.
- `index.html`: on a cold Dashboard, load authenticated compact product rows first and make a clearly labelled first 50 stock rows inspectable. Sales, aging and movement-dependent fields remain loading, never zero/inferred. Pass the validated catalog section to the history bootstrap to avoid re-reading/re-transmitting the product catalog. Warm persisted catalog still requires the existing server validation before display. A failed history load retains the labelled catalog preview. Filters and final totals activate only after complete analytics load.

## Read impact and limits

Synthetic authenticated fixture: 10,000 products plus 100 movement documents.

| Returned document reads | Previous combined cold load | Staged cold load |
|---|---:|---:|
| Products | 10,000 | 10,000 |
| Movements | 100 | 100 |
| Account checks | 1 | 2 |
| Total counted | 10,101 | 10,102 |

Ratio: 1.000099x (+0.0099%). HTTP requests in this fixture: 17 -> 18. The additional round trip buys earlier usable stock rows, not lower full-dashboard completion time in every environment. No speculative all-menu preload was added. A repeated identical still-running request uses one transport. Two simultaneous identical fixture reads plus their transient retry use two RPCs total instead of one per caller/attempt.

These counts exclude minimum charges for empty queries, index-entry reads, billing and Production latency. They do not prove an account-wide 10x ceiling. Actual post-deploy comparison must use equivalent successful user workloads, distinguish backup activity, and include authentication, retries and all relevant billed reads. No real 10x speedup or p95 <=10s claim is made.

The existing client `syyCacheStats.byApi.rpcCount` counts settled logical requests. It is not a billed Firestore counter and can differ from physical RPCs when requests coalesce or retry. Use gateway transport observations and Firebase usage for the Production comparison. Three genuinely stuck transports can still occupy the shared pool until a response or watchdog cleanup; this patch deliberately does not launch unbounded replacement reads.

The historical Dashboard query still returns the complete required date range. Do not silently truncate it or show partial sales/aging totals as complete. Further bounded history/aggregation work should preserve historical accuracy and the unchanged global search/XLFilter semantics. Materialized summary documents or schema/index changes require a separate approved scope.

## Validation

- Syntax: 54 scripts and the Apps Script manifest pass.
- Unit/regression: 328/328 pass on the final source. Includes transient-cache, transport deduplication, timeout, same-session/cross-session pool, post-invalidation response isolation and 10,000-product read-volume cases.
- Chromium regression: 183/183 groups pass in the final full run. Covers Login/OTP/forced-password blocked navigation; readiness recovery and direct fallback; staged Dashboard with held/failed history; shared shell/menu queue and invalidation; permissions; search/pagination; modal, image and document flows. The harness waits for both Dashboard preparation and staged loading rather than treating an idle gap between RPCs as completion.
- Backend-integrated Chromium: 11/11 groups pass using actual gateway/workers with 10,000 in-memory products; synthetic database only.
- Test evidence is ignored under `test-results/loading-fix-*.log` and `test-results/loading-read-budget.json`.

## Remaining release acceptance

After separately authorized deployment: verify saved/published source, exercise the actual Google sandbox using Admin/Staff/Viewer sessions, measure cold/warm click-to-usable data for each route, validate revoked sessions, and compare real billed reads under matched activity. Do not submit stock/product/bill mutations while the user's Production no-write restriction remains in effect.

## Platform references checked

Google documents restricted top-level navigation and user-action links in [HTML Service restrictions](https://developers.google.com/apps-script/guides/html/restrictions). The six-minute per-execution runtime used to choose the abandoned-bookkeeping watchdog is documented in [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas). The watchdog is a client cleanup boundary, not proof that a lost server request was cancelled; it never starts a replacement automatically.
