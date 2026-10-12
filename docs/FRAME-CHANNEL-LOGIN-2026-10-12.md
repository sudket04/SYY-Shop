# frameChannel: login compatibility fix — 2026-10-12

## 1. Outcome
Only the frameChannel issue is in scope. Provide a one-file server correction so the user does not need to replace 13 HTML files to resolve this missing variable.

## 2. Root cause and evidence
The user-supplied Code.gs matches the previous main revision (ignoring line endings/trailing whitespace). Authenticated routing assigns template.frameChannel, but login routing did not assign loginTemplate.frameChannel. The supplied /exec URL returned ReferenceError: frameChannel is not defined (line 4), even without a token. A local legacy-template regression reproduces that error on the login path before this correction. The live login HTML and deployed source/version remain unavailable; this identifies a reproducible compatibility gap, not proof of the live template's contents.

## 3. Module impact
Unauthenticated, expired-session, explicit login, password-reset and authenticated routes retain their existing routing. No CSS/layout, user-role, gateway or business-operation changes.

## 4. Implementation
Assign loginTemplate.frameChannel = "" before evaluating login. Existing authenticated channel validation stays in place. A legacy direct printing scriptlet now receives a defined value on either path. Empty login channel keeps trusted frame messaging closed.

## 5. Risks and limits
This fixes a missing frameChannel variable, not arbitrary incorrect HTML copied into login. Other template-variable errors require inspecting the actual template. Local VM coverage does not replace Google's HtmlService integration tests. Git source updates do not automatically update Apps Script /exec.

## 6. Files changed
Code.gs (one production line), tests/security.test.cjs (legacy-template routing regression), and this report. Existing untracked audit is excluded.

## 7. Validation
The new regression fails with the reported ReferenceError before the change. After correction, npm test passes 113/113 and the syntax/manifest check passes 68 scripts. Tests simulate direct frameChannel lookup before evaluating actual repository HTML, covering absent events/parameters, login, expired session, reset and all authenticated routes, with and without channel. Login's channel stays empty even when the request supplies an invalid channel. No HTML/browser behavior is changed; the prior 60-group browser result is historical and is not claimed as a new run.

## 8. Firestore impact
No added reads/writes/deletes. No production service calls, data/schema/index/IAM or permissions changes. Session lookup and authentication are unchanged.

## 9. Commit and deployment
Commit/push intended files to main under the standing authorization. The implementation SHA is the commit adding this report. No Apps Script sync or production deployment is performed.

## 10. User update and live verification
For the minimum edit, add `loginTemplate.frameChannel = "";` immediately after `loginTemplate.webAppUrl = getWebAppUrl_();` in doGet. Alternatively replace only doGet with the prepared local text artifact, or replace Code.gs using the supplied latest file. Save and verify through Test deployments first. If successful, update the existing versioned deployment to a new version while retaining its existing access/execution settings and URL. Test anonymous login, reset and authenticated navigation. If /exec still fails but /dev succeeds, inspect the version selected by the deployment and the project/URL being used.

Google references: [Templated HTML](https://developers.google.com/apps-script/guides/html/templates), [Deployments](https://developers.google.com/apps-script/concepts/deployments), [Web apps and test deployments](https://developers.google.com/apps-script/guides/web).
