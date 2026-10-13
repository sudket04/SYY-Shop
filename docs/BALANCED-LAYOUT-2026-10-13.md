# Balanced master list layout — 2026-10-13

## Problem and cause

The Brands screenshot showed a full-width four-column table with a large gap between the name and its actions, plus repeated heading/freshness rows. The shared compact layout previously allowed 1040 px, and its content padding made the card narrower than the heading/status frame. The previous browser width assertion selected `.page` and `.app-container`, skipping the direct `.page-body` structure used by Brands and Categories.

Mobile inspection also found sticky action headings paired with non-sticky action cells. Narrow columns could place filter controls over their labels. The production Apps Script version was not inspected; the screenshot alone does not establish which source files are deployed.

## Changes

- `UiSystem.html`: four-column compact master lists use a centered frame capped at 880 px. Heading, freshness status and content align, with responsive side margins. Width stays stable when filtering to one row or displaying long names. Older four-column master templates without a layout attribute receive the same shared classification.
- Wider compact pages, including the nine-column Zones table, retain their existing width. Other page density limits remain unchanged.
- Small screens allocate space to code, wrapping name and actions together, without an outer horizontal scrollbar. Action headings/cells align, and column filter controls have their own space and 44 px touch targets.
- `index.html`: switching to a child page hides the shell heading/freshness; returning to Dashboard restores them. Draft status remains independent.
- `tests/browser.cjs`: direct page-body layouts now participate in width checks. Regression coverage verifies Brands/Categories alignment, stable filtering, long names, sticky table headings, mobile readability/actions/filters, legacy template classification and shell navigation. The existing cross-page stock test now waits for frame/data readiness and delta delivery instead of fixed delays; one full run exposed its timing race before mocked products finished loading.

## Validation

- `npm run check`: 68 scripts and Apps Script manifest parse.
- `npm test`: 134 backend tests pass.
- `npm run test:browser`: 77 browser regression groups pass.
- `git diff --check`: passes.
- Local mocked-browser checks at 100% zoom: desktop widths 1498, 1920 and 2557 px; mobile widths 320 and 390 px. Screenshots under ignored `test-results/` were visually reviewed. These checks do not access Production Firestore.

## Firestore and delivery

No query, cache, RPC, database write, schema, index or user-permission changes. This UI change introduces zero additional Firestore reads/writes; no production data was changed. It does not claim a read reduction.

The Apps Script runtime update consists of **`UiSystem.html` and `index.html`**, copied from the same completed source revision. Brands/Categories template files do not need changes for this fix. GitHub source delivery is to `main`; no Apps Script Production deployment is performed by this task. Live confirmation requires the updated Apps Script version to be deployed.
