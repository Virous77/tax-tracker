# Browser E2E findings — regression round 3, 2026-11-17

Run: `pnpm test:e2e` (Playwright 1.65, Chromium, image `tax-tracker-app:local` built from `main` at
`9fe338e`, after fix commits `70566bc` server and `9fe338e` UI).
Result: **123 tests: 123 pass, 0 fail** (108 existing + 15 new).

Before the test updates, the first run gave **101 pass, 7 fail**. All 7 failures came from intended
contract/UI changes, not bugs (see "Assertions changed"). The earlier failing N1 test now passes.

Global setup starts three throwaway Compose stacks: `taxe2e` (3102), `taxe2epw` (3103, `APP_PASSWORD`)
and `taxe2efresh` (3104, read-only empty-state checks). Global teardown stops them. Playwright's
`webServer` runs the mock LLM on 11502. Screenshots: `tests/e2e/screenshots/` (gitignored).

---

## Status of earlier findings

| #    | Finding                                                            | Status    | Verified by                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1   | Medium: All-years Compute never cleared the "not computed" banner  | **FIXED** | `review.spec.ts` › "All years: after Compute the banner no longer says that year is not computed" and "All years with one year computed names only the missing year"            |
| N2   | Medium: negative holdings never reached Review                     | **FIXED** | `review.spec.ts` › "a sell without a buy shows both the negative holding and the unresolved slice"; `round3.spec.ts` › "global pool: negative holding shows the asset chip…"    |
| N3   | Low: Review showed only the first flag message per transaction     | **FIXED** | `round3.spec.ts` › "Review lists every flag message of a transaction, not only the first"                                                                                       |
| N4   | Low: balance warning without ids; non-parse codes as parse_warning | **FIXED** | `round3.spec.ts` › "per-source pool: balance mismatch shows asset · source and every contributing transaction"; `transactions.spec.ts` › "flag chips…" (`fee_review_required`)  |
| N5   | Low: "1 flagged transaction item need review"                      | **FIXED** | `round3.spec.ts` › "Overview: one item needs review" / "two items need review" / "Report: one Schedule VDA row…"; `review.spec.ts` › "singular and plural item counts"          |
| UX   | Raw settings JSON in CSV exports                                   | **FIXED** | `report.spec.ts` › "every export button downloads…" (disclaimer first, `Setting,Value` rows, no JSON; XLSX has the same labels)                                                 |
| UX   | Statement overlap rows shown as red errors                         | **FIXED** | `round3.spec.ts` › "import summary shows a neutral skipped section and the count equation"; "re-import: duplicates, skips and errors still add up…"                             |
| UX   | No reason when a report disappears (Report, Overview)              | **FIXED** | `round3.spec.ts` › "a cleared report explains why" (ledger, settings, balances, first cause kept); `settings.spec.ts` (settings cause); `empty-states.spec.ts` (never computed) |
| 1–14 | Earlier rounds (403 in Docker, wizard ID, a11y, …)                 | **FIXED** | Unchanged tests still pass                                                                                                                                                      |

## STILL OPEN

None from earlier rounds.

## NEW (ranked)

### R3-1. Medium — Save settings clears every report even when nothing tax-related changed

- **Steps:** compute both years → Settings → press _Save settings_ without editing (or change only the AI
  model or the default tax year) → Report.
- **Expected:** reports stay; the AI endpoint and default year are not engine inputs.
- **Actual:** both reports are gone and the page says "Your report was cleared because tax engine settings
  changed on …".
- **Cause / test:** server side, see `tests/api/BUGS.md` R3-1 (`apps/web/src/server/settings.ts:81-87`,
  `packages/db/src/index.ts:255`). Failing API tests in `13-round3.test.ts`. No E2E test, because the
  defect is in the API, and the E2E settings specs reset settings in every test.

### R3-2. Low — editing 2026-27 data also clears the 2025-26 report

- **Steps:** compute both years → edit the 01 Apr 2026 CoinDCX sell's INR value (or save 2026-27 actual
  balances) → Overview for 2025-26 says "Report cleared for 2025-26 … because transactions changed".
- **Expected:** a 2026-27 change leaves 2025-26 current (allowing for the transfer-match window around 31 March).
- **Cause:** `invalidateReports` has no year scope (`packages/db/src/index.ts:43-60`). Balance case:
  failing API test `13-round3.test.ts › actual balances for one year keep the other year's report`.

### R3-3. Low — duplicate flag chips on Transactions

- The sell-without-buy swap shows `tds_not_deducted missing_history fee_review_required missing_history`.
  The two `missing_history` flags have different messages (unresolved slice and negative holding), but
  the chips show only the code, so the same chip appears twice. `TransactionsClient.tsx:422` maps every
  flag. Suggest deduplicating by code with a count or tooltip. Not asserted. This is UX, not a correctness issue.

### R3-4. Low — Overview counts report notices as "flagged transaction items"

- After compute, "N flagged transaction items need review" includes `ca_verification_pending` and
  `import_incomplete` notices that are not transactions (`OverviewClient.tsx:98`, sum of `group.count`).
  Suggest "N review items" or counting ledger items only.

### R3-5. Low — skipped and error rows are numbered from 0

- The import summary and Imports drawer show "Row 0" for the first data row (`ImportClient.tsx:332,372`,
  `ImportsClient.tsx:547,575`). The API index is zero-based by contract. Users matching against a
  spreadsheet expect row 2 (header = row 1). Suggest displaying `rowIndex + 2` for CSV or labelling "data row #".

### Design notes (no defect)

- **404 for an uncomputed report.** `GET /api/reports/<year>` answers 404 `report_not_computed` by design, and
  Chromium logs "Failed to load resource" for each one. The fixture (`support/fixtures.ts`) ignores that
  console line only for `GET /api/reports/<yyyy-yy>`, and a response listener now records a problem
  unless the 404 body has code `report_not_computed`. Every other console error or failed request still
  fails the test. Suggest a non-error shape, for example `200 {status:"missing", details}`.
- **Prior-year warnings in the 2026-27 Review.** With `?taxYear=2026-27`, the 2025 airdrop's
  `missing_inr_value` still appears as a "Report warning" row, because the 2026-27 report evaluates full
  history (server README: warnings on out-of-year transactions are kept). This is intended, but a user filtering by
  year may not expect it. A "from earlier year" label would help.
- The balance-warning message uses the raw source id ("BTC at coindcx: …") while the chip next to it
  says "CoinDCX".

## Assertions changed (intended contract/UI changes only)

| Test                                             | Old assertion                                                     | New assertion                                                                                                                                     | Why                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `empty-states.spec.ts` › review empty state      | "Report not computed for 2026-27" + "Compute 2026-27 report"      | All years: "Reports not computed for 2025-26, 2026-27" + "Compute 2025-26 & 2026-27 reports"; the 2026-27 filter still shows the single-year text | Per-year `computeTaxYears` banner (N1 fix)                                                                   |
| `settings.spec.ts` › `recompute()` helper        | heading "No report computed for 2026-27"                          | heading "Report cleared for 2026-27" + "cleared because tax engine settings changed on <IST time>"                                                | The cause is now explained (stricter than before)                                                            |
| `transactions.spec.ts` › flag chips              | swap has `parse_warning`                                          | swap has `fee_review_required` and no `parse_warning`                                                                                             | Crypto-fee note has its own code (API N2)                                                                    |
| `review.spec.ts` › groups / fix action           | one "Add missing buy" link                                        | `.first()`; a new test asserts exactly 2 rows (negative holding + unresolved slice), both linking to the pre-filled buy                           | Server README: one sell without a buy yields two report checks                                               |
| `review.spec.ts` › year filter narrows the queue | "Missing INR valuation" heading count 0 (raced the loading state) | waits for data; the 2025 Income ledger row is gone; its warning remains one "Report warning" row with no Inspect button                           | Out-of-year warnings are now `warning` report items; the old check passed only because it ran during loading |
| `review.spec.ts` › All years test (old N1)       | clicked "Compute 2026-27 report"                                  | clicks "Compute 2025-26 & 2026-27 reports"; the banner must be gone after reload                                                                  | Button now computes `computeTaxYears`                                                                        |
| `report.spec.ts` › every export button           | CSV contains the disclaimer                                       | CSV line 1 is the disclaimer; readable `Setting,Value` rows; no JSON settings; XLSX has the labels                                                | Readable export metadata (stricter)                                                                          |
| `support/fixtures.ts`                            | ignored any `/api/reports/<year>` 404 console line                | also requires the 404 body code to be `report_not_computed`                                                                                       | Stricter. See the design note                                                                                |

## New tests (15)

`round3.spec.ts` (12): statement skips (import summary + re-import/Imports drawer), cleared-report cause
for ledger / settings / balances, first cause kept + API details, singular/plural on Overview (1 and 2)
and Report, warning chips (global asset, per-source asset · source with "View 4 transactions"), every flag
message per transaction. `review.spec.ts` (+3): negative holding and unresolved slice, singular/plural
counts, All years with one year computed. `empty-states.spec.ts` now also checks `never_computed` + `invalidatedAt: null` from the API.

## Exploration notes (≈20 min, Playwright scripts + curl against `taxe2e`, `taxe2epw`, `taxapi`)

Checked and working:

- **Full Binance + CoinDCX import via UI:** equations correct for every file
  (statement: 32 = 2 + 0 + 27 + 3; CoinDCX: 10 = 7 + 0 + 0 + 3).
- **Review All years → "Compute 2025-26 & 2026-27 reports"** computes both and the banner disappears;
  editing data then shows "Computed: 2026-27 · Not computed: 2025-26" correctly after one recompute.
- **Edit → recompute:** setting the 01 Apr 2026 CoinDCX sell to ₹50,000 cleared the report (cause shown),
  recompute gave Consideration ₹73,164.98, Taxable ₹31,415.00, Total tax ₹9,801.48 (30% + 4% cess), and the
  Schedule VDA CSV contains 50000.
- **2025-26:** 1961-Act sections in UI and CSV (115BBH, 194S, 2(47A), 285BAA, Rule 115), Total tax ₹245.70.
- **Exports when missing:** all 8 kind/format pairs return 404 `report_not_computed` with the cause.
- **Password mode:** `/review` → `/login?next=%2Freview` → Unlock → back on Review; UI import of the
  statement shows the skip equation; All-years compute; export 200; after logout export 401. No console errors.

## Not tested

- Real OS drag-and-drop onto the drop zone; `mock-slow` (120 s timeout); Firefox and WebKit.
- EVM and US-stock flows (no UI yet).
- `fx_unavailable` and `ambiguous_transfer` labels in the browser: no fixture produces them through the
  UI (the server tests cover the codes; `review-codes.ts` has labels for both).
- A "Compute all N missing reports" label (more than two missing years): only two rule years exist.
- Dark-mode contrast of the new chips and the skipped section (screenshots only).
