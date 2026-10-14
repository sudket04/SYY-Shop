# Viewer Products blank-page investigation — 2026-10-14

## Report and current conclusion

The user reports that the Products menu is visible for Viewer, but clicking it produces an entirely blank page. The user confirmed the blank-page symptom; the affected Web App URL and an authenticated Viewer browser session have not yet been provided. **The production root cause and a production fix are not established.**

Fetched `origin/main` and confirmed no divergence from `7eb68f5`. Read `Master_Products.html`, `Code.gs` (remote name `รหัส.gs`), `index.html` and `Shared.html` through the current Apps Script Editor. All four match main after newline normalization. Ignored local source snapshots are in `test-results/viewer-products-2026-10-14/`.

The actual Manage deployments dialog still shows Version 93 on the previously approved deployment `AKfycbydnft6V1Fxlm6fm09ySlRwb0-cODawOWGhfMmOLyTsl-7Gyki-qwT_I97CEROTwqHS`, with owner execution and everyone access. That observation does not identify the user's affected URL. Opened that known `/exec` URL; it renders the login form, but no application session is available in the connected browser. The Google Editor login does not authenticate a SYY-Shop account.

## Source checks and test gap corrected

- Products is included in the shell's Viewer menu and has an unconditional iframe wrapper. The page switch accepts Viewer and assigns the existing lazy route.
- `doGet` supplies the server-validated session role to authenticated pages; absent/expired sessions route to login.
- The gateway allows Viewer to call `getAllProducts` and `getAllMasterDropdowns`. Invalid roles still fail closed. No permission was broadened.
- Product display initializes independently of the edit/draft guards. Viewer add/edit/delete/image-write handlers remain guarded; details and existing product types remain readable.
- The existing browser test checked a Viewer shell, but lazy child URLs had no role query in the local fixture and silently defaulted to Staff. Corrected the local fixture to inherit the referring shell's role, matching the real shared-session behavior. This is test infrastructure only, not authentication code.
- Strengthened the test to click the actual menu, wait for visible product rows in the child, assert `PRODUCT_ROLE === 'viewer'`, open details, check read-only controls, check usable frame dimensions at 1365/800/390/320 px, and require exactly one product read with no mutation RPC.

The stronger Viewer-in-iframe test passes with the current runtime source. This rules out the tested local menu/render path, but does not prove Google HtmlService, the user's browser, deployment URL or session behave the same. No speculative runtime change was made.

## Checks

- `npm run check`: passed, 69 scripts and manifest parse.
- Security suite: passed, 20 tests (`node --test --test-isolation=none tests/security.test.cjs`).
- Browser regression: passed, all 82 groups after the fixture/test improvement, including Viewer shell and child, direct Viewer page, Staff/Admin controls and cross-frame workflows.
- `git diff --check`: passed.

The workspace initially lacked the Playwright dependency. `npm ci` could not run because no lockfile exists; a package install was cancelled when the already-bundled runtime was located. Final browser tests used the bundled Playwright through `NODE_PATH` and the existing local Chrome, with external HTTPS blocked by the test harness. No dependency or lockfile is included in this change.

## Files, impact and next evidence

Changed only `tests/browser.cjs`, this report and the README report link. No runtime file, Firestore query, DB record, index/schema/IAM, role, deployment setting or backup trigger was changed. All regression data is local/mock; no production business request was submitted. Preserved unrelated untracked `docs/SYSTEM-AUDIT-2026-10-11.md`.

Asked the user to log into the connected Web App as an existing Viewer and click Products, or supply the affected URL if different. Keep the login tab available for that handoff. The next necessary evidence is the actual parent/child URL and frame dimensions, visible error state and console/network diagnostics from that authenticated session. Do not treat this report or test improvement as resolution of the reported production bug. No new deployment was performed; observed deployment remains Version 93.
