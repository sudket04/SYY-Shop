# SYY-Shop — Rollout readiness, 2026-10-13

**Subsequent authorized rollout:** the user approved the concrete Version 92 target below. It was updated to Version 93 at 17:40 Asia/Bangkok, with the same URL/access and all 24 published source checksums verified. See [the deployment result](DEPLOYMENT-2026-10-13.md). The following sections record the pre-deployment readiness state; their pending-approval statements are historical.

## Completed continuation work

Fetched `origin/main` and confirmed no divergence from runtime revision `4763480831bb1489153aa0e729548d8548c947e2`. Existing unrelated untracked `docs/SYSTEM-AUDIT-2026-10-11.md` was preserved.

Prepared and verified a complete review release with 24 runtime files, `sourceDirty:false`, dependency checks and SHA-256 inventory. The ignored local package is `test-results/releases/review-4763480831bb-dd3e160f-7ff6-40c6-be4c-23a2acbb09f5`. It uses the existing production project ID and is not a write-test/staging package.

Opened a fresh [Apps Script Editor](https://script.google.com/home/projects/16P76qalO_UL1fqbI6mjSDPz0MwUI82f0ZlEXrGkvOsGdCRINM05CuORP/edit) and read all 24 Head files through its UI. Every normalized checksum matched the release. Kept the backend's existing `รหัส.gs` name. No source overwrite was necessary.

## Deployment identity and source comparison

The project has multiple active deployments; a saved Head source does not update their `/exec` URLs.

| Deployment | Observed version/date in Asia/Bangkok | URL |
| --- | --- | --- |
| Most recent version | 92, 13 October 2026, 15:40 | [Version 92 Web App](https://script.google.com/macros/s/AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS/exec) |
| Last Web App URL supplied by the user | 88, 12 October 2026, 20:47 | [Version 88 Web App](https://script.google.com/macros/s/AKfycby7jdNENWtcI4risiu8BMOP0BbFBfbNuyTZWil0BVIbLZmHgq1hcEQHYvU6guaf5EZ7/exec) |

Both configurations currently execute as the owner and allow access to everyone. This observation does not authorize changing access or deploying. No version, access setting or active/archived deployment was changed.

Read all 24 immutable Version 92 files from Project History. Twenty match Head, including `Code.gs`, `ProductImagesV2.gs`, `index.html` and `appsscript.json`. Exactly four differ: `login.html`, `Master_Products.html`, `Styles.html` and `UiSystem.html`. Their changes are the reviewed automatic-login fallback, product type column and measured table/footer layout documented in [the implementation report](LOGIN-TABLE-UI-2026-10-13.md).

This gives a concrete Version 92 update candidate: the runtime source at `4763480`, using the existing deployment ID/URL and its current execution/access settings. Historical Version 92 remains available as the exact previous source for a coordinated rollback. No rollback or deployment was performed. Updating the older Version 88 URL would require reviewing its broader source difference first; it is not assumed to be the selected target.

Prepared the existing Version 92 deployment's edit dialog with **New version** and description `UI main 4763480: automatic login, product type, table paging`. Execution identity and access settings were left as observed. The publish button was not pressed. The review screenshot is ignored `test-results/readiness-4763480/deployment-review.jpg`; the dialog remains available for an explicit target/rollout decision.

## Actual Head login smoke check

Opened the already-existing test-deployment `/dev` URL from Apps Script's Test deployments dialog. The login page rendered its username/password form without `ReferenceError` or visible unresolved include text. No application credentials were submitted and no application session was created.

With a disposable one-character test value, the password-reveal control appeared. After a Space press/release it was off; clearing the input hid the control again. The form was left empty. The complete press-and-hold, login/OTP/password-change and authorization workflows remain covered by the previous local regression, not claimed as authenticated live UAT here.

Evidence is saved locally under ignored `test-results/readiness-4763480`: Head/version-92 source snapshots and checksum inventories, `head-login-smoke.json`, and `head-login.jpg`. Source comparison normalizes CRLF to LF and one trailing newline.

## Backup follow-up

Read the existing trigger table and opened its edit dialog only to inspect settings, then cancelled without saving:

- Exactly one trigger, `dailyBackupJob_`.
- Daily time-driven event, 22:00–23:00, GMT+07:00 in the actual UI.
- Deployment shown as Version 92, with no last execution yet.
- Version 92 backend matches Head, including the approved v3 backup implementation. No trigger adjustment is needed for these four UI changes.

The earlier setup report recorded Head at installation; the current UI now shows Version 92. This is a new observation, not a claim about who changed it. Its script specifies `atHour(22).nearMinute(0)`; the UI's hour bucket is not evidence of an exact execution minute.

The supplied Drive destination still contains legacy backup entries and no visible v3 date folder from a completed first run. This check occurred before today's scheduled 22:00 run. No backup, restore, deletion, folder creation or permission change was invoked. First-run success, completeness, manifest counts, runtime and retention still require evidence after the scheduled run. The first v3 run is expected to bootstrap a Full and its same-snapshot Incremental according to the tested implementation; this is not yet a live result.

## Verification and impact

- `npm run release:prepare` and `--verify`: passed, 24 files, exact runtime commit, `sourceDirty:false`.
- `npm run test:reads`: passed; synthetic scenarios only. No claim of actual billing reduction.
- Prior unchanged-source results remain: syntax check of 69 scripts/manifest, 152 automated tests and 82 browser regression groups passed. They were not needlessly rerun for this documentation/readiness work.
- Head/server and Version 92 comparisons: 24/24 files read and checked in each set.
- Head pre-login smoke: passed within the limits described above.

Only this report and README are changed in this continuation. No runtime/API, DB, schema/index/IAM, role, permission, Script Property, trigger or deployment mutation occurred. Pre-login routing with an absent token returns before Firestore session reads; the UI checks did not submit a business RPC. No production DB reads/writes were used to validate this work.

## Remaining work and authorization

1. Choose and authorize the specific production deployment update. The concrete minimal-change candidate above is the existing Version 92 URL; latest-source sync alone has not published it. Master AI Development Instructions §10 Step 5 requires additional authorization for **Production deployment**, and AGENTS.md explicitly limits the standing main permission to source delivery.
2. Authenticated live acceptance: automatic login, product types and table paging with real HtmlService behavior and existing roles. Record actual results after an authorized rollout/test; local fixtures do not prove these outcomes in production.
3. Inspect the first scheduled v3 backup after its execution. Do not label it successful before the log/manifest evidence exists.
4. Broader staging UAT, concurrency/recovery rehearsal and measured billed reads/index-entry costs/latency need an identified isolated Apps Script/Firestore staging target and controlled test mailbox. None has been supplied. No staging IDs, credentials, measurements or passing results were invented.

Delivery of this documentation to `main` is separate from publishing a Web App version. All deployment and authenticated production acceptance results remain pending.
