# Browser E2E findings — 2026-11-16

Run: `pnpm test:e2e` (Playwright 1.65, Chromium, image `tax-tracker-app:local` from `f12dd07`).
Result: **99 tests: 83 pass, 16 fail.** Every failing test fails because of an app defect listed below.

Global setup starts three throwaway Compose stacks: `taxe2e` (port 3102), `taxe2epw` (3103,
`APP_PASSWORD`) and `taxe2efresh` (3104, read-only empty-state checks). Each gets a fresh
`/private/tmp` data dir, and global teardown stops them. Playwright's `webServer` runs the mock LLM on 11502.
`E2E_REUSE_STACK=1` reuses running stacks and `E2E_KEEP_STACK=1` leaves them running after the run.

**Test-only workaround for bug 1.** Without it nothing can be written from a browser in Docker, so
every UI flow would stop at its first save. `support/origin-proxy.ts` runs proxies on 3112 and 3113
that change only the `Origin` header. The browser specs use these proxies. The tests marked
"without the test-only Origin workaround" talk to the app directly and fail because of bug 1. Set
`E2E_NO_ORIGIN_WORKAROUND=1` to turn the proxies off for every spec.

Screenshots: `tests/e2e/screenshots/` (gitignored). `screen-<name>-{light,dark,mobile,mobile-dark}.png`
cover every screen; the other files are per-scenario captures.

---

## Functional defects (ranked)

### 1. Critical — every browser write is rejected with 403 inside Docker (import, compute, settings, login…)

- **Screen:** all screens. Seen on Import, Report, Settings and Login.
- **Steps:** `APP_PORT=3102 docker compose up` → open `http://localhost:3102/import` → upload any file → _Upload & import_.
- **Expected:** import summary. **Actual:** `403 forbidden "Cross-origin mutations are not allowed."`.
  In password mode a correct password also gets 403, so nobody can log in.
- **Cause:** `apps/web/src/server/http.ts:126-127` compares `Origin` with `new URL(request.url).origin`.
  In the standalone container that is always `http://0.0.0.0:3000` (`HOSTNAME=0.0.0.0`) whatever the
  `Host` header says. Checked with curl: `Origin: http://localhost:3000` → 403, `Origin: http://0.0.0.0:3000` → 200.
  So it fails on the default port 3000 too, not only when the port is remapped. Compare against the
  `Host` / `X-Forwarded-Host` header instead.
- **Tests:** `import.spec.ts` › "a real browser upload is accepted…", `password.spec.ts` › "a real browser can log in".
- **Screenshot:** `test-results/import-without-the-test-on-*/test-failed-1.png` (kept only after a failing run).

### 2. High — the generic CSV wizard drops real trades as "duplicates" (data loss)

- **Screen:** Import → generic recipe wizard.
- **Steps:** import `tests/data/out/generic-ddmmyyyy.csv` (auto, IST) → map the columns → leave
  _Trade / Order ID_ as the wizard pre-filled it → _Confirm & import_.
- **Expected:** 4 inserted. **Actual:** 2 inserted, **2 "Duplicates skipped"** on an empty ledger. Each row's `sourceRef` is `Buy` or `Sell`.
- **Cause:** `apps/web/src/components/import/RecipeWizard.tsx:212`. `guessColumn(h, ["id", …])`
  matches substrings, and "S**id**e" contains "id", so the _Side_ column becomes the dedupe key. This
  breaks "never guess silently" and "never throw away rows". Match `id` only as a whole word, or
  leave the field empty.
- **Test:** `recipe-wizard.spec.ts` › "the wizard's first guess does not use the Side column as the row ID".
- **Screenshot:** `screenshots/wizard-row-preview.png` for context.

### 3. High — Settings shows `host.docker.internal` (and LAN / `.local` hosts) as "Local", but the server treats it as cloud and won't save it

- **Screen:** Settings → AI Recipe Assistant.
- **Steps:** set the base URL to `http://host.docker.internal:11502/v1`, a model and a key → _Save settings_.
- **Expected:** the cloud warning and acknowledgement appear, then the save succeeds. **Actual:** the
  badge says "Local endpoint" and no acknowledgement checkbox appears. The save fails with
  `cloud_acknowledgement_required`, and the UI gives no way to acknowledge. Docker users who run
  Ollama on the host are stuck.
- **Cause:** two different `isLocalEndpoint` lists. The client (`apps/web/src/lib/client/format.ts:124-140`)
  counts `host.docker.internal`, `0.0.0.0`, `*.local`, 10/8, 172.16/12 and 192.168/16 as local. The
  server (`apps/web/src/server/settings.ts:5-9`) counts only `localhost`, `127.0.0.1`, `[::1]` and
  `ollama`. Share one function.
- **Test:** `settings.spec.ts` › "host.docker.internal is treated the same way by UI and server".
- **Screenshot:** `screenshots/settings-host-docker-internal.png`.

### 4. Medium — a balance mismatch never reaches the Review queue

- **Screen:** Report → Year-End Balances, then Review.
- **Steps:** golden example → enter `0.5` as actual ETH → _Save actual balances_ → open Review for 2026-27.
- **Expected:** a "Computed vs actual balance mismatch" group. The UI already has text and a fix link for it in `lib/client/review-codes.ts`.
  **Actual:** the warning only shows under Report → Report Warnings (`balance_mismatch: ETH: computed 0, actual 0.5`).
- **Cause:** the engine raises `balance_mismatch` without a `txId` (`packages/engine/src/balances.ts:57`),
  and Review only groups flags that are attached to transactions.
- **Test:** `report.spec.ts` › "TDS section, 26AS checklist and actual-balance mismatch".
- **Screenshot:** `screenshots/report-balances-mismatch.png`.

### 5. Medium — Review says "All ledger transactions are clean" before anything has been checked

- **Screen:** Review (the Import result links here through "Check review flags").
- **Steps:** import `sell-without-buy.csv` and `binance-transaction-statement.csv` → open Review without computing a report.
- **Expected:** a prompt to compute first, or the known flags. **Actual:** "No review flags found — All
  ledger transactions are clean.", even though a sell has no buy history and an income row has no INR value.
  Flags are only attached when a report is computed (as the server README describes), and every data
  change deletes stored reports, so this message shows after every import.
- **Cause:** `apps/web/src/components/ReviewClient.tsx:100-110` treats "no report yet" the same as "no flags".
- **Test:** `review.spec.ts` › "before any compute the queue does not claim everything is clean".
- **Screenshot:** `screenshots/empty-review.png` (same wording).

### 6. Medium — the Add-transaction validation error is a raw Zod JSON dump

- **Screen:** Transactions → Add manual entry.
- **Steps:** _Missing Buy_, asset `BTC`, quantity `not-a-number`, cost `1000` → _Add transaction_.
- **Expected:** a readable sentence such as "Quantity must be a number". **Actual:** a red banner with
  `[ { "origin": "string", "code": "invalid_format", "pattern": "/^[+-]?(?:\\d+…` (see the screenshot).
- **Cause:** `apps/web/src/lib/client/api.ts:303` parses the body with Zod in the browser, and
  `getErrorMessage` (`api.ts:64-68`) returns `ZodError.message`, which is JSON.
- **Test:** `transactions.spec.ts` › "validation errors are shown and nothing is saved".
- **Screenshot:** `screenshots/transactions-validation-error.png`.

### 7. Medium (a11y) — keyboard users can't see focus on the file picker

- **Screen:** Import.
- **Steps:** Tab from "Import history" to the file input.
- **Expected:** a visible focus ring on the drop zone. **Actual:** nothing visible. The input has `sr-only`
  (`components/import/ImportClient.tsx:379`), so its outline is clipped, and the `<label>` drop zone
  has no `:focus-within` style. The keyboard upload itself works (Space opens the picker).
- **Tests:** `import.spec.ts` › "the drop zone shows a visible focus ring…" and `responsive-a11y.spec.ts` › "keyboard focus is visible on import".
- **Screenshot:** `screenshots/import-dropzone-focus.png`.

### 8. Medium (a11y) — the mobile menu doesn't close on Escape and doesn't take focus

- **Screen:** every screen at 375 px.
- **Steps:** focus ☰ → Enter → Escape. Then reopen and press Tab.
- **Expected:** Escape closes the menu; focus moves into it and returns to ☰ on close.
  **Actual:** Escape does nothing. Tab goes to the header link behind the overlay. The panel isn't a
  dialog and doesn't trap focus.
- **Cause:** `apps/web/src/components/AppShell.tsx:189-205` has no key handler and no focus management (a `<dialog>` like `Drawer` would give both).
- **Tests:** `responsive-a11y.spec.ts` › "mobile navigation" (2 tests).
- **Screenshot:** `screenshots/mobile-nav-open-mobile.png`.

### 9. Medium (a11y) — dark-mode primary buttons have 2.94:1 contrast

- **Screen:** all screens in dark mode: Compute/Recompute report, Save settings, Add manual entry, the ₹ logo.
- **Expected:** at least 4.5:1 (WCAG AA). **Actual:** white text on `--accent: #5b9ec4` is 2.94:1
  (`app/globals.css:44` and `:68`). Use dark text on that colour or a darker accent.
- **Test:** `responsive-a11y.spec.ts` › "text meets WCAG AA contrast (dark)".
- **Screenshot:** `screenshots/screen-overview-dark.png`.

### 10. Low (a11y) — light-mode muted text is 4.28:1

- `--text-muted: #6e736c` on the subtle backgrounds (section-label keys on Report, review codes) is
  just under 4.5:1 (`app/globals.css:13`).
- **Test:** `responsive-a11y.spec.ts` › "text meets WCAG AA contrast (light)".

### 11. Low (a11y) — all eight export links are named just "CSV" or "XLSX"

- **Screen:** Report. Screen-reader users hear "CSV, XLSX, CSV, XLSX…" with no kind.
- **Cause:** `components/report/ReportClient.tsx:280-295`. Add `aria-label="Download Schedule VDA as CSV"` and so on.
- **Test:** `report.spec.ts` › "export links have distinguishable accessible names".

### 12. Low — after login the user always lands on Overview

- **Screen:** Login (password mode).
- **Steps:** open `/report?taxYear=2026-27` while logged out → log in.
- **Expected:** back on the report. **Actual:** `/`. `proxy.ts:21` redirects to `/login` without `?next=`, although `LoginClient` already supports `next`.
- **Test:** `password.spec.ts` › "after login the user lands on the page they asked for".

### 13. Low (a11y) — closing the Add-transaction drawer doesn't return focus

- After Escape, focus goes to `<body>` instead of the _Add manual entry_ button
  (`components/ui/Drawer.tsx`; no focus restore). A soft assertion in `responsive-a11y.spec.ts` ›
  "add-transaction drawer traps focus…". Focus trapping and Escape work in every dialog and drawer.

### 14. Low — the balance "Difference" sign differs between the UI and the API/exports

- The UI shows `actual − computed` (`ReportClient.tsx:846`). The API's `balances[].difference` is
  `computed − actual` (`BTC computed 0, actual 5 → difference "-5"`). A CA comparing the screen with
  the export sees opposite signs. Found through the API; not asserted in a test.

---

## UX / visual issues (lower severity, no failing test)

- **Report → "TDS Possibly Due"** shows ₹2,500.00 with a warning badge for the manual source even when
  ₹2,500.00 TDS was deducted (`screenshots/screen-report-light.png`). It reads as if TDS is still owed.
- **Report → Report Warnings** lists 30 lines, mostly the same two messages repeated per transaction
  ("Export does not separate GST…", "Crypto-denominated fee reduces holdings…"). Group them with a count.
- **"Schedule VDA (1 rows)"** has the wrong plural (`ReportClient.tsx`, heading).
- **Raw keys shown to users:** the section labels (`vdaTax:`, `vdaTds:`, `currencyConversionRule:`) and
  "Engine Settings Used" (`feeTreatment`, `usdtInrRate` with values like `ledger_usdt_inr`) are
  internal identifiers, not plain words. The CSV export puts the settings in one JSON cell.
- **Imports list on mobile:** Status, counts and the Inspect/Delete actions sit off-screen in a
  horizontal-scroll table with no hint (`screenshots/screen-imports-mobile.png`). There is no page-level overflow.
- **Import summary source label:** the generic import shows "Source: generic" in lower case while the
  others say "Binance" and "CoinDCX" (`formatSourceLabel` has no `generic` case).
- **Statement import:** `binance-transaction-statement.csv` gives 2 inserted and 30 row errors, 27 of them
  "overlaps trade/deposit/withdrawal exports". That's by design, but it shows as 30 red "errors". A
  separate "skipped (covered by other export)" count would worry users less.
- **Report empty state after any change:** any import, edit or settings save deletes every stored report,
  so Overview and Report fall back to the "No report computed" state. This is intended, but no banner
  explains why the numbers disappeared.

## Not tested

- Real drag-and-drop onto the drop zone (Playwright can't send OS file drags); only the picker and keyboard paths were tested.
- `mock-slow` (a 120 s upstream timeout), because of run time.
- Firefox and WebKit; only Chromium was run.
- The EVM and US-stock flows (Phase 3; no UI yet).
- Dark-mode contrast inside dialogs and drawers; the screenshots cover them only visually.
