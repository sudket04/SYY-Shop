# Password reveal — 13 October 2026

The shared password control previously stayed revealed after a click and displayed its button even for empty inputs. The approved behavior is now **press and hold to reveal**, with the button appearing after the first character, independently of password validation.

## Changes

- `UiSystem.html`: shared behavior covers all nine existing password inputs in login, password reset, forced password change, Profile and TOTP confirmation, plus dynamically created password inputs.
- Mouse/touch down and held Space/Enter reveal the value. Release, cancellation, dragging outside, lost pointer capture, focus loss, Escape, hidden views, page/tab/window changes, form submission/reset and modal closure mask it again. A click does not leave the value visible.
- Empty or disabled inputs hide the button. Existing populated inputs and normal input/change/focus/page-restore events synchronize visibility. UI mutations also synchronize fields cleared by existing application code.
- Preserve the original input, value, selection and autocomplete attributes. Buttons are 44 × 44 CSS pixels and expose their pressed state and Thai instructions. Suppress Edge's native reveal button inside this shared control to avoid a second reveal behavior.
- `tests/browser.cjs`: replace the earlier click-toggle expectations with hold/release, keyboard, touch, cancellation, reset, visibility, dynamic-field and modal regressions.

## Verification and impact

- Syntax: 68 scripts and Apps Script manifest passed.
- Backend/security regression: 134 tests passed.
- Browser regression: 75 groups passed in local Chromium, including emulated mobile touch and desktop/mobile viewport checks. Real iOS/Android devices were not used.
- Visually checked the populated mobile login control at 390 px.
- Firestore impact: **zero additional reads or writes**. No backend, password policy, account permission, schema or production data changes.
- Local logs: `test-results/password-hold-regression.log` and `test-results/password-hold-browser.log` (excluded from Git).

Only **`UiSystem.html`** is a changed Apps Script runtime file for this release; the test file and this report are repository files. Source is delivered through `main`; the completion message identifies the exact commit. Apps Script production sync/deployment was not performed. Source rollback requires restoring the preceding `UiSystem.html` from `3a9a3f32f2f43da12a242439e0e371499bcc6881`, with no database rollback.
