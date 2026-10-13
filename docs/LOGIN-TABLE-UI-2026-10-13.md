# Login, table paging and product type — 2026-10-13

## Scope and root causes

Implemented the three requested UI fixes against `main` baseline `2caba40abd489f63be985051510483b469acfece`:

- Successful login, OTP and required password change must open the index automatically. The success handler already called the redirect helper; its exception path rendered a link that required another click. Asynchronous top-frame navigation can be rejected by the HtmlService iframe sandbox. See [Google's HtmlService restrictions](https://developers.google.com/apps-script/guides/html/restrictions).
- Table footers on several pages fell below the viewport because the shared maximum table height assumed a fixed header size and did not reserve the actual footer and controls.
- Product type data and badges already existed in the returned product records, but the type column was hidden by default and absent from older saved column preferences.

The user confirmed that storage-zone records had been deleted by staff and asked to skip the data concern. No inspection, recovery or migration of those records was performed.

## Files changed and behavior

| File | Change |
| --- | --- |
| `login.html` | If top navigation is rejected, replace the current frame with the existing authenticated `?page=home` URL. The router maps this to index and continues validating the same token and user-agent. |
| `Styles.html` | Give measured table viewports a maximum height and style the pagination footer with a separator, sticky position and wrapping controls. Screen-only rules leave printed documents unchanged. |
| `UiSystem.html` | Measure the table's actual position and following visible controls, reserve their height, and recalculate on resize, font readiness and DOM/layout changes. Exclude modal and dashboard tables. |
| `Master_Products.html` | Show `แท้ / เทียบ` as a required default column. Existing normalization also adds it to old saved preferences and presets while retaining other selected columns and page size. |
| `tests/browser.cjs` | Add sandboxed login, failed-login, product-type and table-footer regression coverage. Wait for actual iframe application state in existing cross-frame tests. |
| This report | Record scope, checks, Firestore impact and source-sync/deployment status. |

Product badges continue showing the existing values: green for แท้, yellow for เทียบ and รอดำเนินการ for missing/pending values. Viewer remains read-only. Mobile tables retain horizontal scrolling where all selected columns cannot fit.

Footer handling covers products, quotation lists, tax-invoice lists, purchase-order history and stock-issue history. Extremely short screens retain normal page scrolling and wrapped pagination controls. The login fallback can leave the original outer host URL in the browser bar while the authenticated index opens inside the frame; it does not require a confirmation or an extra link click.

## Checks

- `npm run check`: passed, 69 scripts and Apps Script manifest parse.
- `npm test`: passed, 152 tests, zero failures.
- `npm run test:browser`: passed, 82 regression groups, zero failures.
- `git diff --check`: passed.
- Browser scenarios cover ordinary login, OTP, required password change, rejected credentials and RPC failure. The iframe fixture disallows top navigation to exercise the automatic fallback.
- Product-type tests cover old saved preferences, presets, page size and Viewer behavior.
- Footer tests cover five modules at 1365×720, 1920×1080, 390×568 and 320×420, row scrolling, control reachability, wrapping and next-page behavior.
- Desktop and mobile fixture screenshots were visually reviewed. Browser tests use a mocked Apps Script gateway; they are not production-login UAT.

## Firestore and security impact

The runtime changes perform DOM presentation and navigation only. Type values come from the existing product data; resize, column display and local display paging introduce no additional RPC or Firestore reads/writes. No backend query, mutation, schema, index, IAM, role or permission was changed. Existing session validation, OTP and password conditions remain in force. No production data was restored, edited or deleted.

## Apps Script source and deployment

Updated the four HTML files in the [SYY-Shop Editor](https://script.google.com/home/projects/16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP/edit). Before writing, each remote source matched the previously verified main source; no additional human changes were found in these files. Preserved originals in ignored `test-results/login-table-pre-sync-2caba40`.

The first save attempt failed in the Google Editor. Preserved and verified all four unsaved buffers, recovered the editor by opening Overview and returning to Editor, then saved again. A newly opened Editor read back all four sources with matching checksums. Verified copies and checksum metadata are in ignored `test-results/login-table-post-sync-2caba40`. Save-button state alone was not treated as proof of persistence.

| File | Verified SHA-256 |
| --- | --- |
| `login.html` | `a107e65253eba7f316492a77b8831dab98903c8681fd9057bb782fbcfb512a88` |
| `Styles.html` | `6bda4ca2ed77de8c2f5733774ca4d0a3fd4b19dc0c430f2dccef4421ed35bd1b` |
| `UiSystem.html` | `380e74581b0c86ece7d584957c4dd64a96de61cb0e9ffd55d655af09797ec982` |
| `Master_Products.html` | `b525769fb13720133bac4366831561dcf724b2ecd7c2c84700e78501389d8afd` |

Hashes normalize CRLF to LF and a single trailing newline. Runtime changes are limited to these four HTML files. Backend, manifest, index, Script Properties and the existing backup trigger were not changed. During editor recovery, Ctrl+R invoked the editor's Run shortcut rather than refreshing; its log reported an unknown error. No authenticated business operation, backup or restore was invoked. The router with an absent token only renders login.

The saved-source screenshot is `test-results/login-table-apps-script-synced.jpg`, showing the new product-type column in the actual Editor. All temporary Editor tabs were closed after source verification; the verified Editor remains open. Screenshots and source snapshots remain ignored local artifacts.

No version was created and no Web App deployment was performed. Existing `/exec` deployments continue using their deployed versions until a separately authorized deployment updates them.
