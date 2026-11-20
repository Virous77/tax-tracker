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

# P2-E2E-11 verification — browser E2E, 2026-11-20

Image `tax-tracker-app:local` built from `main` at `e2d009b` (it contains the "Balance mismatch" badge; not rebuilt).
Same harness as the round below:

- Compose project `taxe2e2` (`docker-compose.yml` + `tests/e2e/phase2.compose.yml`), `APP_PORT=3112`, a fresh
  `DATA_HOST_DIR` from `mktemp -d /private/tmp/taxe2e2-…`, `APP_PASSWORD`/`APP_SECRET` empty, `up -d --no-build`;
- `MOCK_SYNC_PORT=11602 node tools/mock-sync/server.mjs`;
- no other setup: the config's `webServer` starts mock-LLM on 11502 by itself;
- `PHASE2_ONLY=1 pnpm exec playwright test -c tests/e2e/phase2.config.ts --project=phase2`.

## Results

- **Phase 2: 97 tests, 97 pass, 0 fail, 0 skipped, 0 flaky (14.5 min)**, on a fresh stack, with the extended
  P2-E2E-11 test. An earlier full run, with the test as committed in `e2d009b`, also gave 97/97 (14.5 min).
- First Binance sync of the `normal` account: 238 s.

| Phase 2 spec                     | Pass | Fail | Skip |
| -------------------------------- | ---- | ---- | ---- |
| `phase2-connections.spec.ts`     | 16   | 0    | 0    |
| `phase2-import.spec.ts`          | 9    | 0    | 0    |
| `phase2-regression.spec.ts`      | 19   | 0    | 0    |
| `phase2-report-settings.spec.ts` | 3    | 0    | 0    |
| `phase2-responsive-a11y.spec.ts` | 34   | 0    | 0    |
| `phase2-sync.spec.ts`            | 10   | 0    | 0    |
| `phase2-venue.spec.ts`           | 6    | 0    | 0    |

## Fixed (verified this round)

| #         | Finding                                                    | Evidence (`phase2-regression.spec.ts` › "drift: a real balance difference is not shown as a clean or noted sync")                                                                                                                                                                                                                                                                                                                                              |
| --------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-E2E-11 | Real balance difference shows green "Synced" and grey note | The badge reads "Balance mismatch" in `--loss`, and the card has no "Synced" or "Synced with notes". The heading reads "Notices (1)" and there is no "Notes" heading. The notice "USDC fetched 180.5, computed 180, difference 0.5" has a `--warning` border. At 375/1280 × light/dark the badge stays red, there is no horizontal scroll and connections text contrast passes WCAG AA. Screenshots `sync-drift-status`, `sync-drift-{375,1280}-{light,dark}`. |

The amber "Synced with notes" (zero differences) and the red "Incomplete" (Counts toward gap) tests still pass, so
the new badge did not change those states.

## New bugs

None.

## The lead's stalled run (regression + sync + venue), 2026-11-18

Not reproduced, and no app or harness defect was found. What the lead's logs show:

- Run 1 was `… | tail -25` in a background shell with a 10-minute limit. The suite needs more than 10 minutes:
  the regression group's beforeAll, `phase2-sync`'s full sync and `phase2-venue`'s beforeAll each do a full Binance
  sync of about 4 minutes. So the shell was killed and `tail` printed nothing. At 10 minutes the run was in or near
  `phase2-venue`'s beforeAll sync.
- Run 2 used the same stack and data dir 5 minutes later. Tests 1–10 passed. `bad_signature` then failed with both
  `apiRequestContext.fetch: Timeout 15000ms` on `POST /api/vault/setup` and the 180 s test timeout, so the app
  stopped answering for minutes. After that, the group's beforeAll did not finish within the 40-minute limit.
  By 09:26 `/api/health` answered in 56 ms. The stack, its logs and its data dir were deleted before anyone looked
  at them, so the cause can't be confirmed.
- The `127.0.0.1:11602` in the lead's mock log is only the mock's start-up banner. The container env pointed at
  `host.docker.internal:11602`, which is correct.

What I tried on this stack (all fine):

- `vault/reset` + `vault/setup` while a Binance sync was running: both answered at once. The sync kept its key and
  finished (`completed`).
- A Binance sync left running in the paced fiat wait, as a killed run leaves it, then `regression` › "column header"
  and "bad_signature": 2 passed (1.0 min). `reset()` switched the mock to `bad_signature`, waited out the 60 s pace
  and deleted the failed job's connection. `vault/setup` then answered normally.

To avoid a repeat:

- Give the full suite at least 20 minutes (15 minutes for the three specs) and write the output to a file, not a pipe.
- After a killed run, run `down -v` and use a fresh data dir before you re-run.
- If the app hangs again, save `docker logs` and the data dir before the teardown.

## Assertion changes in this round

- `phase2-regression.spec.ts` › drift: it now asserts the "Balance mismatch" text, no "Synced", the "Notices (n)"
  heading and no "Notes" heading. The 0.5 USDC notice must have a `--warning` border. The connections page is
  checked at 375/1280 × light/dark: badge tone, no horizontal scroll, WCAG AA text contrast. `tone()` takes an optional
  CSS property, so it can also compare border colours.
- Biome formatting of the `statusBadge` helper from `e2d009b`. Without it, `pnpm lint` failed on that line.

---

# Phase 2 final regression round — browser E2E, 2026-11-18

Image `tax-tracker-app:local` built from `main` at `7426d76` (not rebuilt for this round). It includes `2b7d028`
(contract), `98286b1` (UI) and `7426d76` (server). Phase 2 ran on Compose project `taxe2e2` (`docker-compose.yml` +
`tests/e2e/phase2.compose.yml`, port **3112**, mock-sync **11602**, fresh data dir) with
`PHASE2_ONLY=1 pnpm exec playwright test -c tests/e2e/phase2.config.ts --project=phase2`. Phase 1 ran with
`pnpm test:e2e` (stacks `taxe2e*` on 3102–3104). The API run (`taxapi3`, 3111/11601/11511) ran at the same time on
its own stack.

## Results

- **Phase 2: 97 tests, 96 pass, 1 fail, 0 skipped (14.6 min).** The failure is the new bug test P2-E2E-11.
  No flakes: nothing needed a re-run.
- **Phase 1: 124 tests, 124 pass, 0 fail (1.5 min).**
- First Binance sync of the `normal` account through the browser: 4.0 min (`phase2-sync` › "binance normal full
  sync…"). Every Binance balance difference is 0. `drift` still shows USDC 0.5 flagged (`phase2-sync` › "drift
  highlights the 0.5 USDC difference…").

| Phase 2 spec                     | Pass | Fail          | Skip |
| -------------------------------- | ---- | ------------- | ---- |
| `phase2-connections.spec.ts`     | 16   | 0             | 0    |
| `phase2-import.spec.ts`          | 9    | 0             | 0    |
| `phase2-regression.spec.ts`      | 18   | 1 (P2-E2E-11) | 0    |
| `phase2-report-settings.spec.ts` | 3    | 0             | 0    |
| `phase2-responsive-a11y.spec.ts` | 34   | 0             | 0    |
| `phase2-sync.spec.ts`            | 10   | 0             | 0    |
| `phase2-venue.spec.ts`           | 6    | 0             | 0    |

| Phase 1 spec              | Pass | Fail |
| ------------------------- | ---- | ---- |
| `empty-states.spec.ts`    | 7    | 0    |
| `import.spec.ts`          | 10   | 0    |
| `imports-list.spec.ts`    | 3    | 0    |
| `password.spec.ts`        | 11   | 0    |
| `recipe-wizard.spec.ts`   | 7    | 0    |
| `report.spec.ts`          | 6    | 0    |
| `responsive-a11y.spec.ts` | 32   | 0    |
| `review.spec.ts`          | 11   | 0    |
| `round3.spec.ts`          | 13   | 0    |
| `screenshots.spec.ts`     | 4    | 0    |
| `settings.spec.ts`        | 5    | 0    |
| `shell.spec.ts`           | 9    | 0    |
| `transactions.spec.ts`    | 6    | 0    |

## Fixed (verified this round)

| #         | Finding                                                | Evidence (passing test in `phase2-regression.spec.ts` unless noted)                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-E2E-7  | Merged flags: ×N chip unreachable, Review list gone    | "repeated flags of one code merge into one chip without a count and list their reasons": one `parse_warning` chip, no "×N"; the drawer says "2 reasons" with 2 list items; Review shows the 2 reasons as 2 list items. Screenshot `grouped-flag-chips`.                                        |
| P2-E2E-8  | Unknown statement operation is an empty Fee row        | "no amount-free Fee rows after importing the statement (unknown operation)" and new "an unknown statement operation is an unclassified transfer, not an empty Fee row" (02 Feb 2026 row is Transfer + `unknown_type`; `?type=fee` has no `unknown_type` row, statement + all-operations file). |
| P2-E2E-9  | Zone label says "from the file name" for a header zone | "the zone source label identifies the column header" and new "the zone source label identifies the file name" (`+05:00 (from the file name)` on the summary and the Imports drawer) and "a file without a zone … (your answer)". Screenshot `import-timezone-file-name`.                       |
| P2-E2E-10 | Normal Binance sync shows "Incomplete" and a red error | New group "normal Binance sync": amber (`--warning`) "Synced with notes" badge, a Notes list (3 notes: dust, history start, P2P window), no "Last sync error", also after reload. Screenshots `sync-binance-notes`, `sync-notes-{375,1280}-{light,dark}`.                                      |

Red is still used where it should be:

- **Incomplete with a real difference:** "Counts toward in the drawer: Binance opens a red gap, Manual closes it".
  Moving a hand-recorded 50 USDT withdrawal to Binance in the drawer gives USDT difference 50, "Add missing
  transaction", a red (`--loss`) "Incomplete" badge and a red "Last sync error". Moving it back to "Manual (no
  exchange)" closes the gap ("Matched") and the card returns to amber "Synced with notes". No re-sync is needed.
  Screenshots `counts-toward-gap-open`, `counts-toward-gap-closed`.
- **Failed:** "bad_signature: the Failed badge and the last sync error stay red". Both are `--loss`, after a reload.
  Screenshot `sync-failed-red`.
- **Completed with a difference (`drift`):** not red. See P2-E2E-11.

## New bugs (ranked)

### P2-E2E-11. Low (FIXED 2026-11-20, e2d009b) — a sync with a real balance difference still shows a green "Synced" badge, and the mismatch is now a grey "Note"

- **Page:** Connections, EVM card.
- **Steps:** set an Etherscan key → add an EVM connection (chain 1, wallet B) → mock scenario `drift` → Sync now.
- **Expected:** the USDC difference of 0.5 is a problem, so the card status should read as one (loss colour, as an
  incomplete Binance sync with a gap now does). It should not look like a clean sync.
- **Actual:**
  - The job is `completed`, so the badge is the green (`--positive`) "Synced". There is no red anywhere on the card.
  - Since `98286b1`, the mismatch notice "Phase 2 evm 1: USDC fetched 180.5, computed 180, difference 0.5" is listed
    under "Notes (1)" in the same neutral style as harmless notes. It used to be an amber "Notices" box.
  - The balance row itself is still amber with "Flagged · Review", and Review still lists it.
  - The green badge is older than this round. The grey note is new.
- **Screenshots:** `phase2/sync-drift-status.png`, `phase2/failure-drift-a-real-balance-difference-is-not-shown-as-a-clean-or-noted-sync.png`.
- **Spec:** `phase2-regression.spec.ts` › "drift: a real balance difference is not shown as a clean or noted sync"
  (fails: badge tone `positive`, expected `loss`).

### Observation (no test)

- After "Save changes", the transaction drawer stays open. The read-only summary and the list update ("Manual
  (Binance)"), so this looks deliberate. The new test waits for the PATCH response instead of the drawer closing.

## Tests added this round (`phase2-regression.spec.ts`, +12)

- The zone label: "from the file name" (summary + Imports drawer) and "your answer" (no conflict warning).
- An unknown statement operation is a Transfer with `unknown_type`, never an empty Fee row.
- bad_signature stays red; drift is not green (P2-E2E-11).
- A serial group sharing one normal Binance sync:
  - "Synced with notes" in amber;
  - Counts toward edits open and close the gap;
  - imported rows have no Counts toward control;
  - the notes card and the edit drawer at 375/1280 × light/dark: every control labelled, the drawer fits, no
    horizontal page scroll, "Save changes" reachable, WCAG AA text contrast.
- The file-level `beforeEach` reset skips that group, so the sync is done once.
- `tone()` compares an element's computed colour with `--loss`/`--warning`/`--positive`. The status badge is found as a
  `span`, because the streams table has a column header that is also called "Incomplete".

---

# Phase 2 regression round — browser E2E, 2026-11-18

Image `tax-tracker-app:local` built from `main` at `50c248b`, not rebuilt for this round. It includes:

- `8bedb99`: contract changes;
- `2bfa8e0`: UI fixes;
- `3506d72`: mock fixes;
- `d9b6170`: server fixes;
- `50c248b`: CoinGecko numeric prices.

Phase 2 ran on Compose project `taxe2e2` (port **3112**, mock-sync **11602**), with the same command and harness as below. Phase 1 ran with `pnpm test:e2e` (stacks `taxe2e*` on 3102–3104). The API agent's stack (`taxapi3`, 3111/11601/11511) was not touched.

## Results

- **Phase 2: 85 tests, 81 pass, 4 fail, 0 skipped (10.7 min).**
  - 3 failures are new bug tests: P2-E2E-7, P2-E2E-8 and P2-E2E-9. Each asserts the correct behaviour and fails.
  - 1 failure was a one-off `ECONNRESET` on `POST /api/reports/2026-27/compute` in the Ethereum test. The app did not restart (RestartCount 0, no error in the log). Compute answers 200 in 0.05 s. The test then passed 2/2 with `--repeat-each=2`, so it is not a product bug.
- **Phase 1: **124 tests, 124 pass, 0 fail (1.4 min).** The 10 redesigned specs and the 3 selector fixes that had not been re-run all pass.**

| Phase 2 spec                     | Pass | Fail                      | Skip |
| -------------------------------- | ---- | ------------------------- | ---- |
| `phase2-connections.spec.ts`     | 16   | 0                         | 0    |
| `phase2-import.spec.ts`          | 9    | 0                         | 0    |
| `phase2-regression.spec.ts` new  | 4    | 3 (P2-E2E-7/8/9)          | 0    |
| `phase2-report-settings.spec.ts` | 3    | 0                         | 0    |
| `phase2-responsive-a11y.spec.ts` | 34   | 0                         | 0    |
| `phase2-sync.spec.ts`            | 9    | 1 (transient, passes 2/2) | 0    |
| `phase2-venue.spec.ts` new       | 6    | 0                         | 0    |

| Phase 1 spec              | Pass | Fail |
| ------------------------- | ---- | ---- |
| `empty-states.spec.ts`    | 7    | 0    |
| `import.spec.ts`          | 10   | 0    |
| `imports-list.spec.ts`    | 3    | 0    |
| `password.spec.ts`        | 11   | 0    |
| `recipe-wizard.spec.ts`   | 7    | 0    |
| `report.spec.ts`          | 6    | 0    |
| `responsive-a11y.spec.ts` | 32   | 0    |
| `review.spec.ts`          | 11   | 0    |
| `round3.spec.ts`          | 13   | 0    |
| `screenshots.spec.ts`     | 4    | 0    |
| `settings.spec.ts`        | 5    | 0    |
| `shell.spec.ts`           | 9    | 0    |
| `transactions.spec.ts`    | 6    | 0    |

**Full Binance sync timing (P2-E2E-2):**

- The first sync of the `normal` fixture account takes **238 s** through the browser. This is recorded as the test annotation `full-binance-sync-seconds`, and the same figure came from a separate API-driven run.
- It used to take 80+ minutes. The opt-in `PHASE2_BINANCE_FULL=1` test is now a normal test, with a 10-minute ceiling.
- During the sync the live region shows "Waiting for Binance rate limit — resumes at hh:mm" for most of the run (160 of ~238 one-second polls had `waitingUntil` set). The `rate_limit_once` scenario was not needed.

## Status of earlier findings

| #        | Finding                                          | Status            | Evidence                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-E2E-1 | Sync errors drop the vendor message              | **FIXED**         | `phase2-sync` › "bad_signature persists…" and › "binance: live progress…" assert "Binance -1022: Signature for this request is not valid." on the card, after reload ("Last sync error: …") and in Review. These were soft checks; they are now hard.                                                                                                           |
| P2-E2E-2 | First Binance sync takes over an hour            | **FIXED**         | `phase2-sync` › "binance normal full sync…" runs by default: 238 s, the "Waiting for Binance rate limit — resumes at" line was seen, every balance matched. Screenshots: `sync-binance-complete`, `sync-binance-reloaded`.                                                                                                                                      |
| P2-E2E-3 | No inline short-passphrase error                 | **FIXED**         | `phase2-connections` › "vault rejects short passphrases inline" and › "vault change-passphrase rejects a short new passphrase inline" pass (`role=alert` "Passphrase must be at least 12 characters.").                                                                                                                                                         |
| P2-E2E-4 | "catalogue §" in user-facing messages            | **FIXED**         | `phase2-import` › "order-history flag messages shown to the user carry no internal catalogue references" passes. Screenshot: `order-history-fee-flag-drawer`.                                                                                                                                                                                                   |
| P2-E2E-5 | "Read-only key verified" printed twice           | **FIXED**         | New assertion in `phase2-connections` › Binance add-connection: exactly one `Read-only key verified` text in the dialog. Screenshot: `binance-key-check`.                                                                                                                                                                                                       |
| P2-E2E-6 | Ambiguous statement legs shown as empty Fee rows | **FIXED**         | `phase2-regression` › "statement + Trade History: covered same-second legs leave no empty rows" (15 Jun 2025 and 10 May 2026 each show exactly the 2 Trade History swaps, no `unknown_type`, and Review has no "non-unique or incomplete trade legs" item). › "statement alone: …" shows ambiguous groups as unclassified (no "Fee"). One leftover is P2-E2E-8. |
| M1       | `normal` Binance USDT off by 5000                | **FIXED**         | The full-sync test asserts zero differences and "Matched" for BNB, ETH, USDC and USDT (XRP is 0 as well).                                                                                                                                                                                                                                                       |
| M2–M5    | Mock gaps                                        | Fixed (`3506d72`) | Not browser-visible. The full sync, prices and spam checks pass on the new mock.                                                                                                                                                                                                                                                                                |

## New bugs (ranked)

### P2-E2E-7. Low (FIXED 2026-11-18, 7426d76 + 98286b1) — same-code flags are merged on the server, so the new "×N" chip never shows and the Review message list is gone

- **Page:** Transactions (flag chips), Transactions drawer ("N reasons"), Review (Details column).
- **Steps:** create a transaction with two `parse_warning` flags that have different messages (`POST /api/transactions`, or import `coindcx-report.xlsx`, whose swap carries two notes) → open /transactions?flagged=true → open Review.
- **Expected:** `2bfa8e0` groups repeated flags into one chip with "×2", the drawer says "2 reasons" and lists both, and Review shows both as a list.
- **Actual:** `d9b6170` added `mergeReviewFlags` to `LedgerTxFieldsSchema.reviewFlags` (`packages/core/src/ledger.ts`). It joins all messages of one code into a single flag ("first note about this row. second note about this row."). The UI therefore only ever sees one message per code:
  - no "×2" on the chip;
  - no "2 reasons" in the drawer;
  - Review prints the two CoinDCX notes as one run-on sentence instead of the `<ul>` it used to show.
    The text is all still there, so this is cosmetic or structural, not data loss. The server and UI should agree on one model: either keep separate flags and group them in the UI, or drop the ×N/list UI code.
- **Screenshots:** `phase2/grouped-flag-chips.png`, `phase2/failure-repeated-flags-of-one-code-are-one-chip-with-a-N-count.png`.
- **Spec:** `phase2-regression.spec.ts` › "repeated flags of one code are one chip with a ×N count" (fails at "×2"). `round3.spec.ts` › "Review lists every flag message…" now checks that both sentences are present, not that they are list items.
- **Note:** report-warning grouping works. Review shows one "Missing INR valuation" report-warning row with "(×2)" for two income rows outside the selected year (`phase2-regression` › "Review groups repeated report warnings…", screenshot `review-grouped-report-warning`).

### P2-E2E-8. Low (FIXED 2026-11-18, 7426d76) — an unknown statement operation is still an empty "Fee" row

- **Page:** Transactions (`?type=fee`), Review (`unknown_type`).
- **Steps:** import `binance-transaction-statement.csv`, with or without `binance-trade-history.csv` → Transactions → Type: Fee.
- **Expected:** like the ambiguous same-second groups (now amount-free `transfer` rows), an operation the importer does not know is shown as unclassified, not as a fee.
- **Actual:** "Some Future Operation" (2 Feb 2026, `0.5 USDT`) becomes `type: "fee"` with no asset or amount, flagged `unknown_type` "Unknown or unpaired statement operation; original preserved for review". It shows as "02 Feb 2026, 07:32 IST · Fee · Binance · — · — · … unknown_type". No amount is booked (correct), but the row is labelled a fee.
- **Screenshots:** `phase2/statement-fee-rows.png`, `phase2/failure-no-amount-free-Fee-rows-after-importing-the-statement-unknown-operation-.png`.
- **Spec:** `phase2-regression.spec.ts` › "no amount-free Fee rows after importing the statement (unknown operation)".

### P2-E2E-9. Cosmetic (FIXED 2026-11-18, 2b7d028 + 98286b1) — zone source says "from the file name" when it came from the header

- **Page:** Import summary.
- **Steps:** upload `binance-trade-history.csv` with Binance and IST selected.
- **Expected:** the summary label agrees with the warning, which correctly says the zone came from the header.
- **Actual:** the summary says "Source: Binance · Time zone: UTC (from the file name)", but the notice right below says "Used UTC from the file header instead of the selected IST.". The file name has no zone; the API only returns `timezoneSource: "file"`.
- **Screenshots:** `phase2/import-timezone-conflict.png`, `phase2/failure-the-zone-source-label-agrees-with-the-warning-header-not-file-name.png`.
- **Spec:** `phase2-regression.spec.ts` › "the zone source label agrees with the warning: header, not file name". `import.spec.ts` now accepts "from the file", "from the file name" or "from the file header", so it will not break when this is fixed.

### P2-E2E-10. Low (FIXED 2026-11-18, 98286b1) — every normal Binance sync shows "Incomplete" and a red "Last sync error"

- **Page:** Connections, Binance card.
- **Steps:** mock `normal` → Sync now → wait for completion.
- **Expected:** a sync whose balances all match reads as complete with notes, or at least not as an error. The standing API limits (P2P six-month window, `binance:history-start`, dust's 100-record cap, the delisted `ETHBTC` pair) could be shown as notes.
- **Actual:** the card shows an "Incomplete" badge and, in the loss colour, "Last sync error: One or more streams were incomplete; review the sync summary.". This happens on every Binance account, because those streams are always marked incomplete. The flag itself is right: it is what enables "Add missing transaction". Only the wording and colour are wrong.
- **Screenshot:** `phase2/venue-gap-add-missing-link.png` (the same header appears in `sync-binance-complete.png`).
- **Spec:** none fails on it. It is documented here.

## Assertion changes in this round

| Spec                                                  | Change                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase2-sync.spec.ts`                                 | The live region now matches friendly labels ("Syncing Binance … history…" or "Waiting for Binance rate limit — resumes at hh:mm") and must never show raw `binance:` ids. The vendor-error soft checks are now hard. The full sync is no longer opt-in. Spam exclusion now computes the tax year of "40 days before today" (the mock is relative to the clock), not 2025-26. |
| `phase2-connections.spec.ts`                          | Binance key check: "Read-only key verified" appears exactly once (P2-E2E-5).                                                                                                                                                                                                                                                                                                 |
| `imports-list.spec.ts`                                | The `malformed.csv` drawer has no "Notices" heading. Since `d9b6170` (P2-API-7, lead decision) invalid rows are reported once: as row errors plus one `import_incomplete` item in Review, with no `parse_warning`.                                                                                                                                                           |
| `round3.spec.ts` › "Review lists every flag message…" | Checks that both CoinDCX notes are present in the row, not that there are two list items (see P2-E2E-7).                                                                                                                                                                                                                                                                     |
| `import.spec.ts`                                      | The zone label accepts "from the file", "from the file name" or "from the file header" (see P2-E2E-9).                                                                                                                                                                                                                                                                       |

## Phase 1 redesign (the 10 specs from "Phase 1 specs that need a redesign")

The new fixtures are generated by `tests/e2e/support/statements.ts` into `tests/data/out/` (gitignored, like every generated test file). They are written fresh on each use, so nothing outside `tests/e2e` changes. Both are synthetic Binance Transaction History statements in the Phase 2 format:

- **`statement-without-eth.csv`** (review ×6, transactions ×2). It holds a USDT deposit, one unambiguous BNB trade (3 legs → 1 swap, 2 legs skipped), Simple Earn interest and the FIXT airdrop that has no INR value. It contains **no ETH and no BTC**, so the ETH sell in `sell-without-buy.csv` is still a sell the statement does not cover. That restores each test's original premise:
  - the negative ETH holding of −0.01 plus the unresolved 0.01 ETH slice;
  - "Add missing buy" pre-filled with ETH;
  - "TDS not deducted" with 1 item;
  - exactly one "Missing INR valuation" row (the airdrop);
  - "BTC: computed 0, actual 2" for the balance mismatch.

  The only number that changed: the flagged-only Transactions list is "1–3 of 3", because the statement's rebuilt BNB swap has a BNB fee and correctly carries `fee_review_required`. The test now names all three rows and checks that the unflagged USDT deposit is not listed.
- **`statement-grouped-legs.csv`** (round3 ×2). It holds two unambiguous trades, a deposit, interest, and two broken rows (bad date, bad amount). It recreates "skips are neutral, errors are not" under Phase 2:
  - "10 read = 4 inserted + 0 duplicates + 4 skipped + 2 errors", with 4 rows of "Statement leg is preserved in the grouped transaction raw rows.";
  - the skip colour differs from the error colour;
  - re-import: "0 inserted + 4 duplicates + 4 skipped + 2 errors";
  - the Imports list and drawer agree.

The 3 selector fixes from last round are re-run and pass: `import.spec.ts` › Binance trade history zone label and › CoinDCX workbook, and `imports-list.spec.ts` › detail drawer (once the P2-API-7 change was applied).

Observation, not filed: the skipped section is titled "Skipped — covered by another export", and the Imports list says "N skipped (overlap)", even for statement legs that are folded into their own rebuilt trade. Accurate wording would be "grouped into a transaction". The tests match the heading prefix only (`/^Skipped — /`).

## Coverage added this round

- **Rate-limit wait line:** the full Binance sync records every live-region text and requires "Waiting for Binance rate limit — resumes at \d{2}:\d{2}". The client's own UID-weight pacing triggers it, so `rate_limit_once` (a 1-second `Retry-After`) was not needed.
- **Add missing transaction** (`phase2-venue`):
  - A Binance sync with a hand-recorded 50 USDT withdrawal (Counts toward: Binance) dated before the API's history start. The scan starts one year back ("scanned from 2025-11-18 onward"), and synced rows cannot be deleted, so this is how the gap is made.
  - USDT shows difference 50, "Flagged · Review" and "Add missing transaction" → `/transactions?add=buy&asset=USDT&venue=binance`. Matched assets get no link.
  - Clicking it opens the drawer with Asset received = USDT, Counts toward = Binance and the venue hint.
- **Counts toward** (`phase2-venue`):
  - A missing buy of 50 USDT added as "Manual (no exchange)" leaves the Binance gap at 50.
  - The same buy added as "Binance" closes it (0, Matched, link gone). The live balance table recomputes without a re-sync.
- **Grouped chips:** see P2-E2E-7.
- **Timezone conflict:** `binance-trade-history.csv` imported as IST shows "Used UTC from the file header instead of the selected IST." exactly once on the summary and in the Imports drawer.
- **Statement + Trade History:** no empty or ambiguous rows for covered groups (P2-E2E-6 fixed). Statement alone: ambiguous groups are unclassified, not fees.
- **a11y/responsive:** the add-manual drawer with Counts toward was checked at 375 and 1280, light and dark: every control labelled, the drawer fits, no horizontal page scroll, "Add transaction" reachable, WCAG AA text contrast. The 34 earlier responsive and contrast tests also pass.

New screenshots (`tests/e2e/screenshots/phase2/`):

- Venue: `venue-gap-add-missing-link`, `venue-add-missing-prefilled`, `venue-gap-closed`, `venue-drawer-{375,1280}-{light,dark}`.
- Regression: `grouped-flag-chips`, `review-grouped-report-warning`, `import-timezone-conflict`, `statement-trade-history-transactions`, `statement-alone-unclassified`, `statement-fee-rows`.
- Failure shots for P2-E2E-7, 8 and 9.

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

### P2-E2E-1. Medium (FIXED 2026-11-18) — sync errors drop the vendor message

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

### P2-E2E-2. Medium (FIXED 2026-11-18) — a first Binance sync can take over an hour

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

### P2-E2E-3. Low (FIXED 2026-11-18) — short vault passphrase never shows the inline error (setup and change)

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

### P2-E2E-4. Low (FIXED 2026-11-18) — internal "catalogue §" references in user-facing flag messages

- **Page:** Transactions drawer (and Review) after importing a Binance Spot Order History.
- **Steps:** import `binance-spot-order-history(UTC+5).csv` → Transactions → open the 1INCH buy.
- **Expected:** a plain-language note.
- **Actual:** "Order History contains no fee; import Spot Trade History to obtain the actual fee and fee asset
  (catalogue §1.3)." The section reference points at a research document the user never sees. Same pattern in
  `packages/importers/src/coindcx/order-history.ts:120,126` (§2.2) and `binance/spot-order-history.ts:112`.
- **Screenshot:** `phase2/order-history-fee-flag-drawer.png`.
- **Spec:** `phase2-import.spec.ts` › "order-history flag messages shown to the user carry no internal catalogue references".

### P2-E2E-5. Cosmetic (FIXED 2026-11-18) — "Read-only key verified" printed twice

- **Page:** Add connection › Binance, after Save (and "Check key" on the card).
- **Expected:** the title once, then any extra detail.
- **Actual:** the green banner title and the server `message` are the same string, so it reads
  "Read-only key verified / Read-only key verified" (`KeyCheckBanner.tsx:60-75`).
- **Screenshot:** `phase2/binance-key-check.png`.
- **Spec:** none asserts it (the test selects `.first()`).

### P2-E2E-6. Low (FIXED 2026-11-18) — ambiguous statement legs show as empty "Fee" rows, even when Trade History covers them

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

### M1 (FIXED in 3506d72). `normal` Binance balances cannot reconcile: P2P buy is outside the API window

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

## Phase 1 specs that need a redesign (DONE 2026-11-18, see the regression round above)

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

---

# Phase 4 — browser E2E, 2026-11-20

Image `tax-tracker-app:local` built from `main` at `374d1cc` (`ec0a657` UI, `31a1caa` server; not rebuilt).
`TAX_TRACKER_IMAGE=tax-tracker-app:local` was set for every compose call.

- **Phase 1 + Phase 4:** `pnpm test:e2e`.
  - Stacks `taxe2e`, `taxe2epw` and `taxe2efresh` on 3102–3104 (disclaimer accepted in global-setup).
  - New first-run stacks `taxe2e4` (3105, `SOURCE_URL=https://example.org/tax-tracker`) and `taxe2e4pw` (3106,
    password). These are never accepted.
- **Phase 2:** `taxe2e2` on 3112, mock-sync on 11602,
  `PHASE2_ONLY=1 pnpm exec playwright test -c tests/e2e/phase2.config.ts --project=phase2`.

## Results

**Phase 1 + Phase 4 (`pnpm test:e2e`): 148 tests, 146 pass, 2 fail (2.0 min).**

- The run before the P4-E2E-1 test was added gave 147/147.
- The 2 failures are the P4-E2E-1 bug test and one flaky run of P4-E2E-3.

| Spec                      | Pass | Fail |
| ------------------------- | ---- | ---- |
| `empty-states.spec.ts`    | 7    | 0    |
| `import.spec.ts`          | 10   | 0    |
| `imports-list.spec.ts`    | 3    | 0    |
| `recipe-wizard.spec.ts`   | 7    | 0    |
| `report.spec.ts`          | 6    | 0    |
| `responsive-a11y.spec.ts` | 32   | 0    |
| `review.spec.ts`          | 11   | 0    |
| `round3.spec.ts`          | 13   | 0    |
| `screenshots.spec.ts`     | 4    | 0    |
| `settings.spec.ts`        | 5    | 0    |
| `shell.spec.ts`           | 9    | 0    |
| `transactions.spec.ts`    | 6    | 0    |
| `password.spec.ts`        | 10   | 1    |
| `phase4.spec.ts` (new)    | 23   | 1    |
| **Phase 1 total**         | 123  | 1    |
| **Phase 4 total**         | 23   | 1    |

**Phase 2: 97 tests, 95 pass, 2 fail (14.9 min).** Both failures are P4-E2E-2.

| Phase 2 spec                     | Pass | Fail |
| -------------------------------- | ---- | ---- |
| `phase2-connections.spec.ts`     | 16   | 0    |
| `phase2-import.spec.ts`          | 7    | 2    |
| `phase2-regression.spec.ts`      | 19   | 0    |
| `phase2-report-settings.spec.ts` | 3    | 0    |
| `phase2-responsive-a11y.spec.ts` | 34   | 0    |
| `phase2-sync.spec.ts`            | 10   | 0    |
| `phase2-venue.spec.ts`           | 6    | 0    |

The Phase 2 specs needed no change for the disclaimer. Their `reset()` puts `disclaimerAccepted: true` before any page
opens.

## New bugs (ranked)

### P4-E2E-2. Medium (regression from ec0a657) — a statement PDF on an empty ledger no longer shows its comparison

- **Steps:**
  1. Fresh ledger.
  2. Import a synthetic Binance PDF statement (a balance snapshot, no transactions).
  3. Open Report for its year.
- **Expected (Phase 2 behaviour):** the "Statements (1)" section compares the snapshot with the computed ledger. For a
  mid-year snapshot, Apply explains the 409.
- **Actual:** the new empty state "No transactions yet — import an export file" replaces the whole missing-report
  view. `#statements` is not rendered, so the snapshot can't be seen or applied from the Report page.
- **Cause:** `apps/web/src/components/report/ReportClient.tsx:797` returns the `ledgerEmpty` empty state before
  `:836`, which renders `renderStatementsSection()` when `snapshots.length > 0`. Show the empty state only when there
  are also no snapshots, or keep the statements section below it.
- **Tests (fail, unchanged):**
  - `phase2-import.spec.ts › encrypted synthetic PDF: focused password prompt, wrong password cleared, snapshot`
    (`#statements` not found);
  - `› mid-year PDF comparison works and apply explains the 409` (0 statement rows, expected 3).

### P4-E2E-1. Low — after "Try with sample data", Overview shows an all-zero year labelled "Includes sample data"

- **Steps:** on an empty ledger, click **Try with sample data**. The app opens Report 2025-26 with 2 rows, which is
  correct. Then click **Overview** in the nav.
- **Expected:** Overview shows the year that holds the sample rows (2025-26), or points to it, so a stranger sees the
  finished numbers the README promises.
- **Actual:** Overview stays on the default 2026-27 and shows "0 Schedule VDA rows" and ₹0 in every card, next to the
  "Includes sample data" badge (see `screenshots/phase4/overview-375-light.png`). Because 2026-27 has a computed report
  and no review items, the getting-started checklist marks "Resolve Review items" and "Open the report" done.
- **Suggested fix:** after loading, set the year that `DemoProvider.prepareReportYear()` chose as the Overview
  selection (or default tax year) until the sample is removed. Alternatively, show a "Sample data is in 2025-26" link.
- **Test (fails):** `phase4.spec.ts › bugs › P4-E2E-1: after loading sample data, Overview shows the year that holds
  the sample rows`. It is kept last because the file runs in serial mode.

### P4-E2E-3. Low (flaky, 1 in 5) — logging out logs 404s for `/login?next=…&_rsc=…`

- **Steps:** `password.spec.ts › logout revokes the old session cookie on the server`, run with `--repeat-each=5`.
- **Expected:** no console errors.
- **Actual:** in 1 of the 5 repeats, and once in the full run, the console guard records about 9 × "Failed to load
  resource: 404 … /login?next=%2F<page>&_rsc=…". After logout, the nav links' RSC prefetches are redirected to
  `/login`, which answers the RSC request with 404.
- **Status:** the test passed in this round's two earlier full runs and in all earlier rounds, so this is a timing
  race. The new footer/demo/disclaimer fetches on every page probably widen it. It could be fixed by `proxy.ts`
  answering RSC/prefetch requests without a session with a 401 or a plain redirect, or by turning off prefetch while
  logging out.
- **Test:** the existing test, unchanged (fails intermittently).

## What `phase4.spec.ts` covers (24 tests, serial, `phase4` project)

- **Disclaimer, on a fresh stack:**
  - the "Before you start" dialog (accessible name and description) shows on all 8 pages, with "Not tax advice.",
    "Chartered Accountant" and "Your data stays on this computer";
  - it is a native modal (`open`); focus stays inside through Tab/Shift+Tab;
  - Escape, two backdrop clicks and a click on a nav link do nothing, the URL stays, and the API stamp stays `null`;
  - "I understand" closes it, stamps an ISO time, and it stays gone after reload and on all 8 pages.
- **Password stack:**
  - `/login` has no dialog (after `networkidle`) and its footer shows `v0.1.0`;
  - after unlocking, the dialog appears and the API stamp is still `null`;
  - at 375/1280 × light/dark the dialog fits the viewport, "I understand" is reachable, every control is named,
    dialog text passes WCAG AA, and there is no horizontal scroll.
- **Footer:**
  - `v0.1.0` (root `package.json`), "AGPL-3.0" and "Not tax advice";
  - "Source code" links to `SOURCE_URL` with `target=_blank` and `rel="noopener noreferrer"`;
  - on the main stack (no `SOURCE_URL`) there is no link and no "Source".
- **Checklist:**
  - "0 of 5 steps done" on an empty ledger, with the five titles in order, each "— not done" for screen readers;
  - hrefs `/settings`, `/import`, `/review?taxYear=2026-27` and `/report?taxYear=2026-27` (×2);
  - steps 2 and 1 navigate;
  - dismissal persists across reload and navigation;
  - with sample data, step 2 is done and step 5 not done.
- **Sample data:**
  - "Try with sample data" → `/report?taxYear=2025-26` with "Includes sample data" and Schedule VDA rows;
  - the banner and its "Remove sample data" button show on all 8 pages;
  - Imports shows 3 visible "Sample" badges;
  - Cancel and Escape in the confirm dialog keep the data;
  - confirming removes it: it lands on `/`, the banner is gone on all pages, the API shows no demo and 0 transactions,
    there are no badges, the Report has no label, and "Try with sample data" is offered again.
- **New UI at 375/1280 × light/dark** on Overview, Imports, Report 2025-26 and Settings:
  - the banner, footer and checklist have no unnamed controls;
  - WCAG AA text contrast passes in the banner, checklist, footer and badges;
  - no horizontal scroll.
- **Backup:** Settings → Download backup gives a download named `tax-tracker-<ISO stamp>.db` with no failure and the
  SQLite magic. The button is enabled again, there is no error, and the `data/backups/` note is shown.

Screenshots: `tests/e2e/screenshots/phase4/` (disclaimer, sample report/imports, and 4 screens × 375/1280 × light/dark).

## Harness changes

- `support/env.ts`: `PHASE4_STACKS` (`taxe2e4` on `MAIN_PORT+3` with `SOURCE_URL`, `taxe2e4pw` on `MAIN_PORT+4`),
  `PHASE4_URL`, `PHASE4_PASSWORD_URL`, `SOURCE_URL`.
- `global-setup.ts`:
  - starts and health-checks the Phase 4 stacks without accepting the disclaimer;
  - every stack now starts with `down --remove-orphans -v` and a fresh data dir, and `SOURCE_URL` is passed through.
- `global-teardown.ts` also stops the Phase 4 stacks.
- `playwright.config.ts`: new `phase4` project (baseURL 3105); `main` ignores `phase4.spec.ts`.
- `support/phase2-contrast.ts`: `textContrastFailures(page, within?)` can be scoped to a selector. Existing callers
  are unchanged.

## Assertion changes (intended Phase 4 UI changes only)

- `empty-states.spec.ts › transactions empty state`: the copy is now "…import an export file, connect an exchange, or
  add a manual transaction."
- `empty-states.spec.ts › report empty state …`: on an empty ledger the Report now shows "No transactions yet —
  import an export file" with Import file and Try with sample data, instead of "No report computed for <year>" and a
  Compute button. The test was renamed to "report empty state offers an import or sample data". The API checks
  (`report_not_computed`, `never_computed`) are unchanged.
- `import.spec.ts › the drop zone shows a visible focus ring when tabbed to`: on an empty ledger the new "Try with
  sample data" prompt sits between "Import history" and the drop zone, so the test presses Tab once more when that
  button has focus.
- `shell.spec.ts › every nav link …`: the footer now also has the version and licence, so the check is `toContainText`
  instead of `toHaveText`.

## Repo checks

- `pnpm recipes:check` → "Checked 1 recipe(s)."
- **CONTRIBUTING "Adding a CSV recipe", followed step by step** with the ExampleX example (folder deleted afterwards,
  `recipes:check` back to 1 recipe):
  1. `pnpm recipes:new examplex-trades-v1 --header "…"` creates the 4 files, with the fingerprint computed and empty
     column mappings.
  2. `recipes:check` on the bare scaffold fails with "Sample must contain 1–20 data rows." That is expected; the error
     comes with a Node stack trace.
  3. The step 3 `recipe.json` and step 4 `sample.csv` copied from the doc import with no row errors, and `recipes:check`
     passes once `expected.json` matches.
  4. The checks reject an e-mail in the sample ("Sample must not contain email addresses.") and an undocumented `0x`
     address ("Document synthetic wallet addresses in the sample README.").
  5. `pnpm recipes:new test-recipe --header "Date,Pair,Qty"` works, and an invalid id prints the usage line.
- **Mismatches found:**
  - **D1 (doc, low).** Step 7 says "The same checks run in `pnpm test`". After adding a recipe,
    `pnpm --filter @tax/recipes test` fails `library.test.ts › builds the full validated library` until the package is
    rebuilt: `libraryRecipes` comes from the generated `src/library.generated.json`, written only by `build`. The step
    should say to run `pnpm --filter @tax/recipes build` (or `pnpm -r build`) before `pnpm test`.
  - **D2 (doc, low).** Step 5 says to work `expected.json` out by hand, but the doc's own sample row 3
    (`ETHUSDT,BUY,…,Avg Price 3000`) becomes `type: "swap"` with `priceQuote: {asset: "USDT", price: "1"}`. The engine
    prices a swap per outgoing unit (`packages/importers/src/values.ts:253`), so `price` is not 3000. A contributor who
    follows the doc writes `3000` and gets only "Imported ledger rows differ from expected.json", with no diff. The doc
    should explain the swap/`priceQuote` convention, and `check.mjs` should print the first differing row.
  - **D3 (tool, cosmetic).** Running `recipes:new` with an existing id throws a raw `EEXIST` stack trace instead of a
    one-line message.
