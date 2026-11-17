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

## Round 4 — fixed by lead (verified: API 320/320, E2E 124/124)

| Bug                                                    | Fix                                                                                                     | Verified by                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R3-1 settings save clears reports without a tax change | `packages/db/src/index.ts`: only the `engine` key, and only when its value changes, invalidates reports | `tests/api/13-round3.test.ts` › what clears a stored report (3 tests)                     |
| R3-2 balances for one year clear every year's report   | `invalidateReports` takes an optional tax year; balance saves pass theirs                               | `tests/api/13-round3.test.ts` › actual balances for one year keep the other year's report |
| R3-3 duplicate flag-code chips on Transactions         | chips are unique per code (`TransactionsClient.tsx`)                                                    | manual                                                                                    |
| R3-4 Overview counts report notices as review items    | info-severity codes are excluded; wording is "N item(s) need(s) review"                                 | `tests/e2e/round3.spec.ts` › report notices are not counted                               |
| R3-5 row numbers start at 0                            | import screens show 1-based data row numbers                                                            | manual                                                                                    |

Still noted, not changed: ledger edits invalidate every year (safe but broad); uncomputed reports return 404 by design.

---

# Phase 2 — browser E2E, 2026-11-17

Run: `PHASE2_ONLY=1 pnpm exec playwright test -c tests/e2e/phase2.config.ts --project phase2` (Chromium) against
Compose project `taxe2e2` on **3112** (`docker-compose.yml` + `tests/e2e/phase2.compose.yml`, every `*_API_BASE`
pointing at `tools/mock-sync` on host port **11602**). Image `tax-tracker-app:local` built from `main` at `3baa51b`.
Phase 1 specs run unchanged through `pnpm test:e2e` (stacks on 3102–3104); `playwright.config.ts` ignores `phase2-*`.

Final run (both on the same image, after a Docker Desktop restart mid-session):

- **Phase 2: 72 tests, 66 pass, 5 fail, 1 skipped (2.8 min).** The 5 failures are exactly the product-bug tests below
  (P2-E2E-1 ×2, P2-E2E-3 ×2, P2-E2E-4). The skip is the opt-in full Binance sync (P2-E2E-2, `PHASE2_BINANCE_FULL=1`).
  No test uses `test.fail()`; bug tests assert the correct behaviour and fail.
- **Phase 1: 124 tests, 111 pass, 13 fail (3.2 min).** 10 are the specs listed under "Phase 1 specs that need a
  redesign". 3 failed only on stale expectations I had just edited, and were corrected _after_ the final run, not re-run:
  `import.spec.ts` › Binance trade history (the header `Date(UTC)` makes the zone "UTC (from the file name)"),
  › CoinDCX workbook (two `parse_warning` notices now, `.first()`), `imports-list.spec.ts` › detail drawer (heading
  "Warnings (1)" is now "Notices (1)").

| Phase 2 spec                     | Pass | Fail | Skip |
| -------------------------------- | ---- | ---- | ---- |
| `phase2-connections.spec.ts`     | 14   | 2    | 0    |
| `phase2-import.spec.ts`          | 8    | 1    | 0    |
| `phase2-report-settings.spec.ts` | 3    | 0    | 0    |
| `phase2-responsive-a11y.spec.ts` | 34   | 0    | 0    |
| `phase2-sync.spec.ts`            | 7    | 2    | 1    |

| Phase 1 spec              | Pass | Fail                       |
| ------------------------- | ---- | -------------------------- |
| `empty-states.spec.ts`    | 7    | 0                          |
| `import.spec.ts`          | 8    | 2 (stale, fixed after run) |
| `imports-list.spec.ts`    | 2    | 1 (stale, fixed after run) |
| `password.spec.ts`        | 11   | 0                          |
| `recipe-wizard.spec.ts`   | 7    | 0                          |
| `report.spec.ts`          | 6    | 0                          |
| `responsive-a11y.spec.ts` | 32   | 0                          |
| `review.spec.ts`          | 5    | 6 (redesign)               |
| `round3.spec.ts`          | 11   | 2 (redesign)               |
| `screenshots.spec.ts`     | 4    | 0                          |
| `settings.spec.ts`        | 5    | 0                          |
| `shell.spec.ts`           | 9    | 0                          |
| `transactions.spec.ts`    | 4    | 2 (redesign)               |

An earlier Phase 1 run also failed the recipe-wizard AI-error tests ("AI endpoint is unavailable") and password mode
(RSC 404s on `/login` after logout); both passed in the two later runs, so I treat them as environmental, not bugs.

Harness (`support/phase2.ts`): every Phase 2 test runs with an auto fixture that routes all browser requests,
aborts and fails on any origin other than `http://localhost:3112`, and scans every JSON/text/JS response body the
browser receives for the fixture secrets (vault passphrases, PDF password, every `mock-*` key and the replaced keys).
`noSecrets()` also checks the DOM, every input value, `localStorage` and `sessionStorage`. `reset()` deletes
connections, imports and manual rows, resets the vault and settings, and — if a sync is still running — switches the
mock to `bad_signature` so the leftover job fails at its next request instead of blocking the next test.
Screenshots: `tests/e2e/screenshots/phase2/` (gitignored).

## Bugs (ranked)

### P2-E2E-1. Medium — sync errors drop the vendor message

- **Page:** Connections (connection card, sync error banner, "Last sync error"), Review (connections group).
- **Steps:** add Binance with the mock keys → mock scenario `bad_signature` → Sync now (or switch to
  `bad_signature` while a sync runs).
- **Expected:** SPEC-phase2 §9: `upstream_auth` (502) carries the vendor message, e.g. Binance `-1022`
  "Signature for this request is not valid.", so the user can tell a signature/clock problem from a revoked key
  or an IP-binding restriction.
- **Actual:** card, reload and Review all show only "Upstream rejected credentials or permissions". The vendor code
  and text are dropped in `packages/sync/src/http.ts:149-160` (`UpstreamAuthError` gets a fixed string).
- **Screenshots:** `phase2/sync-bad-signature.png`, `phase2/review-failed-connection.png`,
  `phase2/sync-binance-interrupted-failed.png`.
- **Specs:** `phase2-sync.spec.ts` › "bad_signature persists failed status and error on the connection and Review"
  and › "binance: live progress updates, reload mid-sync resumes, a failure keeps checkpointed streams"
  (`expect.soft(...).toMatch(/signature/i)`; everything else in both tests passes).

### P2-E2E-2. Medium — a first Binance sync can take over an hour

- **Page:** Connections (Binance card stays "Syncing…").
- **Steps:** add Binance (mock keys, `normal`) → Sync now → watch `GET http://localhost:11602/__requests`.
- **Expected:** a first sync of a small account finishes in minutes, or the UI says it will take long and why.
- **Actual:** `binance:fiat:0` walks 89-day windows from `FIRST_SYNC` (2017-07-01) and the client waits a full
  minute before every `/sapi/v1/fiat/orders` call (weight 90,000 against half of the 180,000 UID budget,
  `packages/sync/src/binance/client.ts:130-165`); `withdraw/history` (18,000) gets ~5 calls a minute. Mock log on
  3112: `fiat/orders` at 04:26:21, 04:27:21, 04:28:21, 04:29:21, 04:30:22 UTC for windows starting 2017-07-01, 2017-09-28, 2017-12-26, 2018-03-25, 2018-06-22
  ≈ 39 windows × 2 directions ≈ 80 minutes for fiat alone. After 14.8 min the job was still on `fiat:0`.
  The live line only says "Syncing stream binance:fiat:0 · Streams: 4 · 9 rows fetched" for minutes on end, with no
  hint that it is waiting on a rate limit. One measurement on a fresh scratch stack (3115 + mock 11603) finished the
  whole sync in ~5 min with the same image and mock code; I could not explain that difference, so it needs a
  developer look (both runs were first syncs on new connections).
- **Suggest:** start fiat/convert/withdrawal walks at a user-chosen "account opened" date, or skip known-empty ranges
  using the account's earliest activity; show "waiting for Binance rate limit (resumes at hh:mm)".
- **Screenshot:** `phase2/sync-live-progress.png` (stream line; the full-sync test timed out before its own shot).
- **Spec:** `phase2-sync.spec.ts` › "binance normal full sync…" — opt-in with `PHASE2_BINANCE_FULL=1`, timeout 100 min.

### P2-E2E-3. Low — short vault passphrase never shows the inline error (setup and change)

- **Page:** Connections › Secrets Vault.
- **Steps:** type a 5-character passphrase into "Passphrase (min 12 characters)" and "Confirm passphrase" →
  Set up vault. Same for "New passphrase (min 12 chars)" in Change passphrase.
- **Expected:** the inline `role="alert"` "Passphrase must be at least 12 characters." (the code exists in
  `VaultCard.tsx:66-68` and `:135-137`), consistent with the mismatch error that does appear inline.
- **Actual:** the inputs carry `minLength={12}` inside forms without `noValidate`, so Chromium's native bubble
  ("Please lengthen this text to 12 characters or more…") blocks submit and the handler never runs; no alert is
  rendered or announced. (Astra's finding, confirmed.)
- **Screenshots:** `phase2/vault-short-passphrase.png`, `phase2/vault-change-short-passphrase.png`.
- **Specs:** `phase2-connections.spec.ts` › "vault rejects short passphrases inline",
  › "vault change-passphrase rejects a short new passphrase inline".

### P2-E2E-4. Low — internal "catalogue §" references in user-facing flag messages

- **Page:** Transactions drawer (and Review) after importing a Binance Spot Order History.
- **Steps:** import `binance-spot-order-history(UTC+5).csv` → Transactions → open the 1INCH buy.
- **Expected:** a plain-language note.
- **Actual:** "Order History contains no fee; import Spot Trade History to obtain the actual fee and fee asset
  (catalogue §1.3)." The section reference points at a research document the user never sees. Same pattern in
  `packages/importers/src/coindcx/order-history.ts:120,126` (§2.2) and `binance/spot-order-history.ts:112`.
- **Screenshot:** `phase2/order-history-fee-flag-drawer.png`.
- **Spec:** `phase2-import.spec.ts` › "order-history flag messages shown to the user carry no internal catalogue references".

### P2-E2E-5. Cosmetic — "Read-only key verified" printed twice

- **Page:** Add connection › Binance, after Save (and "Check key" on the card).
- **Expected:** the title once, then any extra detail.
- **Actual:** the green banner title and the server `message` are the same string, so it reads
  "Read-only key verified / Read-only key verified" (`KeyCheckBanner.tsx:60-75`).
- **Screenshot:** `phase2/binance-key-check.png`.
- **Spec:** none asserts it (the test selects `.first()`).

### P2-E2E-6. Low — ambiguous statement legs show as empty "Fee" rows, even when Trade History covers them

- **Page:** Transactions, Review (`unknown_type` group).
- **Steps:** import `binance-trade-history.csv` (UTC) → import `binance-transaction-statement.csv` (UTC) →
  Transactions, filter 2025-06-15.
- **Expected:** the statement's same-second group (two BTC buys, two USDT spends, two BTC fees) is recognised as covered
  by the two Trade History fills (linked or skipped like the 4 duplicates are), or at least shown as "Unclassified"
  rather than as a fee.
- **Actual:** the two correct swaps from Trade History **plus** six rows of type **Fee** with no asset or amount, each
  flagged `unknown_type` ("Statement has non-unique or incomplete trade legs…"). Same for the two ETH sells on
  2026-05-10. Review then asks about 7–12 `unknown_type` items the user already resolved by importing Trade History.
  No amount is double counted (holdings net to the statement's true BTC 0.003968), so this is noise, not a tax error.
  Not guessing the pairing is documented and correct (`packages/importers/README.md`).
- **Screenshot:** none (API-verified on 3112).
- **Spec:** none; documented here.

## Mock problems (not product bugs)

### M1. `normal` Binance balances cannot reconcile: P2P buy is outside the API window

- The fixture's only USDT source is the 2025-04-08 P2P buy of 5,000 USDT (mock README timeline). The mock pins its
  own clock at `2026-04-01`, but the app uses the real clock (2026-11-17). The client correctly caps P2P history at
  six months, so the buy is never requested: the sync completes with `binance:p2p:BUY` marked incomplete ("P2P API
  only returns the past six months; import older orders from a file") and the balance table shows
  **USDT fetched 1977.433845, computed −3022.566155, difference 5000**, flagged with a Review link. BNB, ETH, USDC
  and XRP match exactly. The product behaves correctly (it flags rather than guesses); the README's "Final balances
  equal what the ledger implies" only holds when the client clock is near the pinned date.
- Suggest: move the P2P buy inside six months of the real date, make P2P timestamps relative to wall-clock now, or
  let the app read a test clock. Measured on a scratch stack: a full first Binance sync takes ~5 minutes.
- **Spec:** `phase2-sync.spec.ts` › "binance normal full sync…" asserts the three matched assets, the incomplete P2P
  note and the exact 5000 USDT difference (with a comment pointing here). CoinDCX and all five EVM chains reconcile
  to zero in `normal`.

## Assertions changed in Phase 1 specs (intended Phase 2 UI changes)

| Spec                                                                                | Old                                                                               | New                                                                    | Why                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import.spec.ts`, `round3.spec.ts`, `recipe-wizard.spec.ts`, `empty-states.spec.ts` | time zone radio `/^UTC \(/`, `/^IST \(/`, `/IST \(Asia\/Kolkata/`                 | `/^UTC /`, `/^IST /`, `/^IST \(\+05:30\) Asia\/Kolkata/`               | radios are now "IST (+05:30) Asia/Kolkata…", "UTC Coordinated Universal Time · +00:00", "Other offset …"                                                                                                            |
| `imports-list.spec.ts`, `responsive-a11y.spec.ts`                                   | cell named exactly `malformed.csv` / `coindcx-report.xlsx`                        | cell name starting with the file name                                  | the file cell now also shows the report-kind label ("malformed.csv Binance Spot Trade History")                                                                                                                     |
| `import.spec.ts`                                                                    | "Source: Binance · File timezone: UTC", "Source: CoinDCX · File timezone: IST"    | "… · Time zone: UTC (your answer)", "… · Time zone: IST (your answer)" | the summary now says where the zone came from (file name vs your answer)                                                                                                                                            |
| `import.spec.ts`, `imports-list.spec.ts`                                            | CoinDCX workbook: 7 inserted, 3 row errors; 11 → 7 transactions around the delete | 8 inserted, 2 row errors ("Row Errors (2)"); 12 → 8 transactions       | Phase 2 imports the Futures Orders (USDT-M) sheet: its row is now a ledger row flagged `unknown_type`/`complex_onchain` with the warning "The coindcx:futures-orders layout is unverified…", instead of a row error |
| `import.spec.ts` (after final run)                                                  | "UTC (your answer)" for `binance-trade-history.csv`; one `parse_warning`          | "UTC (from the file name)"; `.first()`                                 | `Date(UTC)` header counts as a file zone; CoinDCX now has two notices                                                                                                                                               |
| `imports-list.spec.ts` (after final run)                                            | drawer heading "Warnings (1)"                                                     | "Notices (1)"                                                          | renamed in the drawer                                                                                                                                                                                               |
| `support/env.ts`                                                                    | fixed ports/projects                                                              | `E2E_PORT_BASE`, `E2E_PROJECT_PREFIX` (defaults unchanged)             | lets a second e2e stack run beside another agent's                                                                                                                                                                  |

## Phase 1 specs that need a redesign (left failing on purpose)

Phase 2 made the Binance Transaction History statement a ledger source (`packages/importers/README.md`: trades are
rebuilt from one received leg, one spent leg and at most one fee per second; ambiguous groups become `unknown_type`
rows without amounts). Phase 1 skipped every overlapping statement row ("preserved but not applied"). The fixture
pair used by these tests (`sell-without-buy.csv` + `binance-transaction-statement.csv`) therefore no longer produces
the scenario each test checks. They need new fixtures or a new premise, not new numbers, so I did not edit them:

| Spec › test                                                   | Was                                                           | Now (verified on 3102/3112)                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `review.spec.ts` › reportStatus banner … balance mismatch     | "BTC: computed 0, actual 2"                                   | "BTC: computed -0.00802, actual 2": the June BTC buys are an ambiguous group, the later sells/withdrawal/deposit apply                                       |
| `review.spec.ts` › a sell without a buy … unresolved slice    | negative ETH −0.01                                            | the statement now supplies the 0.05 ETH buy, so ETH is positive; the only negative holding is BTC −0.00802                                                   |
| `review.spec.ts` › fix action for missing history             | pre-filled buy for ETH                                        | pre-filled buy for BTC (`?add=buy&asset=BTC`)                                                                                                                |
| `review.spec.ts` › singular and plural item counts            | TDS group "1 item"                                            | 2 items (the statement's BTC sell now also lacks TDS)                                                                                                        |
| `review.spec.ts` › resolving a flag / edit-INR fix link       | one row in "Missing INR valuation"                            | the UI shows two rows there (strict-mode violation on the single "Edit INR value" link / "Inspect" button)                                                   |
| `round3.spec.ts` › statement overlap rows are skips (×2)      | "32 read = 2 inserted + 0 duplicates + 27 skipped + 3 errors" | statement alone: 23 inserted, 9 skipped (grouped legs), 0 errors; after Trade History: 19 inserted, 4 duplicates, 9 skipped. "Overlap skips" no longer exist |
| `transactions.spec.ts` › flag chips / drawer and editing (×2) | "Showing 1–2 of 2" flagged rows; an Income drawer             | the flagged-only count is no longer 2 and the Income drawer is not found; same fixture change, not analysed further                                          |

## Coverage (Phase 2 specs)

- **Vault** (`phase2-connections`): recovery wording; mismatch inline; setup; lock; wrong passphrase → alert and
  cleared field; unlock; change; Reset dialog opened by keyboard, focus starts in "Type RESET to confirm", Tab and
  Shift+Tab wrap inside, Escape returns focus to the opener, lowercase "reset" keeps the button disabled, typed
  RESET resets and connections show `keySet:false`.
- **Provider keys** (×5): set, replace (empty field, value never shown back), reload, remove via a focus-trapped
  confirm with focus return; Etherscan Free/Paid tier labels.
- **Connections:** Binance how-to ("Create a read-only key", "Leave trading and withdrawals off", API-management link
  with `target=_blank rel="noopener noreferrer"`), automatic check → "Read-only key verified"; replace keys under
  `trading_key` → red `role=alert` "This key can trade or withdraw…". CoinDCX warning, dashboard link, `readOnly:null`
  "Key check note" with the IP-binding message. EVM on all five chains: invalid address inline error, valid address
  saved. Base without an Alchemy key: "This chain needs an Alchemy key." and "Add Alchemy key" focuses and scrolls to
  the Alchemy input.
- **Sync** (`phase2-sync`): Binance live region (`aria-live="polite"`) shows "Syncing stream binance:…" with
  changing stream/count text; reload mid-sync shows "Syncing…" and resumes the live region; failure mid-run keeps
  checkpointed streams in the job. Full Binance sync (M1). CoinDCX: streams, zero differences, summary again after
  reload, Imports row with Synced badge and connection label, delete-confirm "Delete sync import?" with the
  cursor-reset sentence. Five chains: zero differences, `evm:<id>` source filter in the URL, drawer link to the right
  explorer host (`etherscan.io`, `basescan.org`, `arbiscan.io`, `polygonscan.com`, `bscscan.com`) with
  `target=_blank` and `noopener noreferrer`; Ethereum: `suspected_spam` chip and "Suspected spam token" in the report's
  excluded list. `drift`: USDC difference 0.5 highlighted with "Flagged · Review" → Review. `bad_signature`: Failed
  badge, error, "Last sync error" after reload, Review "Failed or incomplete connection syncs" with "Fix in Connections".
- **Settings / Report** (`phase2-report-settings`): price lookup toggles, basis, exact host sentence, persistence;
  "Fetch missing prices" disabled with "enable in Settings" link while off; when on, 202, live "Fetching…" region,
  "Price lookup complete: N fetched, M already cached", Missing → 0 and Cached = API value without reload; trail drawer
  shows the market price source and ETHUSDT. Transactions source filter lists the seven new sources;
  `possible_duplicate` chip and message.
- **Import** (`phase2-import`): IST, UTC and Other offset (`+15:00` → `aria-invalid` + inline message, `-04:00`
  accepted); Order History `(UTC+5)` → "Detected: Binance Spot Order History", "+05:00 (from the file name)", the
  no-fee notice, kind label on Imports; matching Trade History → exactly one "Replaced" row, drawer note, and the
  report's "Replaced by a more detailed export…" reason; mismatched fills → `possible_duplicate`; encrypted synthetic
  PDF (`packages/importers/test/pdf-fixture.ts`) → focused password field, wrong password clears it, right password →
  Balance Snapshot (3 rows), compare (Asset/Statement/Computed/Difference), apply; mid-year statement → friendly 409
  text; Form 16A → "TDS certificates can't be imported yet."
- **Responsive / a11y** (`phase2-responsive-a11y`): 7 screens × 375/1280 × light/dark — one `main`, footer
  disclaimer, every visible control labelled, no horizontal page scroll, screenshot; the three Add-connection forms at
  each size/theme fit and keep "Save connection" reachable; WCAG AA text contrast on all seven screens per theme.

## Screenshots (`tests/e2e/screenshots/phase2/`, 101 files)

- Vault: `vault-short-passphrase`, `vault-change-short-passphrase`, `vault-wrong-passphrase`, `vault-reset-confirm`.
- Provider keys: `provider-{etherscan,alchemy,nodereal,blockscout,coingecko}`.
- Connections: `binance-key-check`, `binance-trading-key-warning`, `coindcx-key-check`, `connection-{1,8453,42161,137,56}`,
  `base-needs-alchemy`.
- Sync: `sync-live-progress`, `sync-reload-mid-sync`, `sync-binance-interrupted-failed`, `sync-coindcx-complete`,
  `sync-coindcx-reloaded`, `sync-chain-{1,8453,42161,137,56}`, `sync-drift`, `sync-bad-signature`,
  `review-failed-connection`, `delete-sync-import-confirm`.
- Transactions: `transaction-explorer-{1,8453,42161,137,56}`, `transactions-replaced-drawer`,
  `transactions-possible-duplicate`, `possible-duplicate-drawer`, `order-history-fee-flag-drawer`.
- Report / Settings: `settings-price-lookups`, `report-prices-disabled`, `report-prices-fetched`, `report-price-trail`,
  `report-spam-excluded`, `report-superseded-exclusion`, `statement-applied`, `statement-midyear-409`.
- Import: `import-order-{IST,UTC,Other-offset}`, `import-invalid-offset`, `pdf-wrong-password`, `pdf-snapshot`,
  `form16a-unsupported`.
- Responsive: `{connections,settings,report,import,imports,transactions,review}-{375,1280}-{light,dark}` (28),
  `dialog-{Binance,CoinDCX,EVM-address}-{375,1280}-{light,dark}` (12).
- Failures from the final run (5): `failure-vault-rejects-short-passphrases-inline`,
  `failure-vault-change-passphrase-…`, `failure-order-history-flag-messages-…`, `failure-binance-live-progress-…`,
  `failure-bad-signature-…`. Older failure shots from earlier runs were deleted.

## Not testable / not covered

- Real screen-reader announcements: live regions are checked structurally (`aria-live="polite"` + changing text).
- Explorer pages themselves: links are asserted, never followed (privacy fixture would block them by design).
- Alchemy/NodeReal-backed sync through the UI: chains are synced with a paid Etherscan key; the provider fallback
  paths are covered by the API suite.
- `rate_limit_once`, `ban_418`, `clock_skew`, `upstream_500_once`, `big_history`, `empty`: API-suite territory; no
  distinct UI beyond the error banner already covered.
- Vault idle auto-lock (30 min) and `SECRETS_PASSPHRASE` auto-unlock: need a long wait or a different container env.
- Real Binance/CoinDCX PDFs and exports: only synthetic fixtures, as required.
