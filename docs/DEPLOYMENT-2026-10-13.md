# SYY-Shop — Production deployment, 2026-10-13

## Authorized result

The user explicitly approved updating the existing Version 92 Web App identified in [the readiness report](ROLLOUT-READINESS-2026-10-13.md). Updated that deployment successfully to **Version 93**, published on **13 October 2026 at 17:40 Asia/Bangkok**.

- Runtime source: `4763480831bb1489153aa0e729548d8548c947e2`.
- Project: [SYY-Shop Apps Script Editor](https://script.google.com/home/projects/16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP/edit).
- Existing deployment ID: `AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS`.
- Unchanged URL: [Production Web App](https://script.google.com/macros/s/AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS/exec).
- Unchanged execution identity: owner, `shopsyy01@gmail.com`.
- Unchanged access setting: everyone. Application session and role authorization remain in place.
- Description: `UI main 4763480: automatic login, product type, table paging`.

The older Version 88 URL was not selected or updated. No additional deployment, archive action, sharing change or OAuth scope change was requested or performed. Historical Version 92 remains available as the previous source if a coordinated rollback is later authorized.

## Source and checks

Fetched `origin/main` before publication; local main and origin/main had no divergence. Verified the existing review package: 24 files, runtime commit `4763480`, `sourceDirty:false`. Read all 24 saved Head files again through a fresh Editor and compared each with both the release and current local source. All matched.

After Google's success message, reopened Manage deployments and confirmed persisted Version 93, the same deployment ID/URL, owner execution and everyone access. Read all 24 immutable Version 93 files from Project History; every checksum matched the reviewed release. Hashes normalize CRLF to LF and one trailing newline. This verifies the published version rather than relying on the editor's save state.

Opened the actual production `/exec` URL in a fresh tab. Its username/password login form and login button rendered without `ReferenceError` or visible unresolved include text. No application credentials were submitted or authenticated application session created.

Previous tests on the unchanged runtime remain valid: `npm run check` passed for 69 scripts/manifest, `npm test` passed 152 tests, and `npm run test:browser` passed 82 regression groups. Readiness also passed release verification and the synthetic read model. These were not repeated for this deployment/documentation work. Authenticated production login/OTP/password-change, Viewer, product types and pagination acceptance still need an existing application test session; local fixtures do not establish those live outcomes.

Ignored local evidence under `test-results/readiness-4763480` includes `deployment-guard-checksums.json`, the immutable `version-93/` copies and checksum inventory, `deployment-result-v93.json`, `deployment-success-v93.jpg`, `deployment-config-v93.jpg`, and production login screenshot/smoke JSON.

## Files and Firestore impact

Compared with Version 92, only `login.html`, `Master_Products.html`, `Styles.html` and `UiSystem.html` change. They enable the automatic login fallback, required visible แท้ / เทียบ column and measured table/footer layout described in [the implementation report](LOGIN-TABLE-UI-2026-10-13.md). The other 20 runtime files, including backend, index and manifest, are identical.

This deployment introduces no additional Firestore query or write, RPC, DB schema/index/IAM change, role change or data migration. Type display uses existing product data, and layout/paging operate in the DOM. Publication and the pre-login smoke did not invoke a business operation, backup, restore or DB mutation. The route with no token returns login before Firestore session reads. No actual billing or performance reduction is asserted from this smoke check.

This turn changes only README and deployment/readiness reports in Git. It preserves unrelated untracked `docs/SYSTEM-AUDIT-2026-10-11.md`. No additional runtime source edit was needed.

## Backup and remaining acceptance

The existing trigger table still has exactly one time-driven `dailyBackupJob_` trigger. Its deployment label now follows Version 93 automatically; no trigger edit or reinstall was performed. The previously inspected daily 22:00–23:00 GMT+07:00 schedule and unchanged backend remain applicable. No last execution was shown at the post-deployment check, before today's scheduled run.

First v3 backup success, counts, manifests and retention remain pending actual scheduled-run evidence. Authenticated production acceptance, isolated staging recovery/concurrency UAT, and billed reads/index-entry costs/latency measurements remain outstanding. No production data or new test accounts were created to substitute for those checks.
