# API defects found by `tests/api`

Regression round 3 on 2026-11-17 against image `tax-tracker-app:local` built from `main` at `9fe338e`
(after fix commits `70566bc` server and `9fe338e` UI).
Result: **320 tests: 316 pass, 4 fail** across 13 files. The 4 failures are the new defects R3-1 and R3-2
below. They are left failing on purpose.

Stack: `APP_PORT=3101 DATA_HOST_DIR=<mktemp> docker compose -p taxapi up -d --no-build`, mock LLM on
11501, `pnpm -r build`, `pnpm test:api`. Stack and mock were stopped afterwards.

No existing API assertion was changed in this round. The suite was already updated for the new
contract in `70566bc`. Those edits (02, 03, 06, 07, 08 and the new 12) were re-read: each one follows
`packages/core/src/api/index.ts` and the server README, and none weakens a check.

## Status of earlier findings

| #      | Finding                                                              | Status    | Verified by                                                                                                                             |
| ------ | -------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | High: generic imports not idempotent across recipe ids               | **FIXED** | `04-recipes.test.ts › the same generic file confirmed twice with differently-named recipes does not double the ledger`                  |
| 2      | Low: settings accept a default tax year with no rule file            | **FIXED** | `01-health-settings.test.ts › settings › PUT rejects bad tax year with 400`                                                             |
| 3      | Low: oversize upload message differs from the documented one         | **FIXED** | `03-edge-data.test.ts › huge.csv → 413 file_too_large 'File exceeds 25 MB.'`                                                            |
| O1–O3  | Logout revocation, wrong explicit source, suggest on finished import | **FIXED** | `09-auth`, `02-imports`, `04-recipes` (unchanged, still pass)                                                                           |
| N1     | Balance warnings lost asset/source and transaction ids               | **FIXED** | `12-server-round2.test.ts` (warning trails); E2E `round3.spec.ts › per-source pool: balance mismatch…`                                  |
| N2     | Non-parse warnings coded `parse_warning`                             | **FIXED** | `12-server-round2.test.ts › non-parse warning codes`; E2E `transactions.spec.ts › flag chips…` (now `fee_review_required`)              |
| E2E N1 | All-years Review had no way to name the missing years                | **FIXED** | `12-server-round2.test.ts › All years identifies exactly which report still needs computing`                                            |
| E2E N2 | Negative holdings missing from Review                                | **FIXED** | `12-server-round2.test.ts › negative fee holdings appear once in Review…`                                                               |
| —      | CSV metadata as one JSON cell                                        | **FIXED** | `08-exports.test.ts` (readable `Setting,Value` in every CSV/XLSX kind); E2E `report.spec.ts › every export button…`                     |
| —      | Statement overlap rows counted as errors                             | **FIXED** | `02-imports.test.ts` (2 inserted / 27 skipped / 3 errors); `13-round3.test.ts › … read = inserted + duplicate + error + skipped, twice` |
| —      | Missing report gave no reason                                        | **FIXED** | `12-server-round2.test.ts` (persisted cause); `13-round3.test.ts › a missing report blocks every export kind with the same explanation` |

## STILL OPEN

None from earlier rounds.

## NEW (ranked)

### R3-1. Medium — saving non-engine or unchanged settings deletes every stored report

- **Repro:** compute 2025-26 and 2026-27 → `PUT /api/settings` with only `ai` (another model), or only
  `defaultTaxYear`, or exactly the current settings → `GET /api/review` shows both years `missing`;
  `GET /api/reports/2026-27` → 404 `report_not_computed`, `cause: "settings_changed"`.
- **Expected:** reports stay current. The AI endpoint and the default year are not tax engine inputs,
  and an unchanged save changes nothing.
- **Actual:** every report is deleted, and Report/Overview tell the user "Your report was cleared because
  tax engine settings changed", which is not true. In the UI, pressing _Save settings_ without editing
  anything also clears every report.
- **Suspected cause:** `apps/web/src/server/settings.ts:81-87` always writes the `engine` key and writes
  `ai`/`defaultTaxYear` through the same `db.settings.set`, which calls
  `invalidateReports("settings_changed")` unconditionally (`packages/db/src/index.ts:255`). Invalidate only
  when the parsed engine settings differ from the stored ones.
- **Tests:** `13-round3.test.ts › changing only the AI model keeps stored reports`,
  `› changing only the default tax year keeps stored reports`, `› saving unchanged settings keeps stored reports` (all fail).

### R3-2. Low — actual balances for one year delete every year's report

- **Repro:** compute both years → `PUT /api/balances/actual?taxYear=2026-27` → 2025-26 is `missing` too
  (`cause: "balances_changed"`).
- **Expected:** only 2026-27 is cleared. Actual balances are stored per tax year and the 2025-26 report
  cannot read 2026-27 balances.
- **Suspected cause:** `invalidateReports` (`packages/db/src/index.ts:43-60`) has no year scope; the balance
  `replace` at `:284` calls it for all years.
- **Test:** `13-round3.test.ts › actual balances for one year keep the other year's report` (fails).
- **Related note (no test):** any ledger change also clears earlier years even when the transaction is
  dated months after that year's end (for example a July 2026 buy clears 2025-26). Transfer matching can
  cross 31 March within the match window, so a safe scope is "tax years ending after
  `timestamp − transferMatchWindowHours`". Lower priority; this only forces an extra recompute.

### Design note — `report_not_computed` uses HTTP 404

The browser logs every uncomputed `GET /api/reports/<year>` as "Failed to load resource: 404". The E2E
console guard allows exactly that request and now also checks the body is `report_not_computed`. A
`200 {status: "missing", details}` shape (or 204 + details header) would keep consoles clean and let
real 404s (unsupported year) stand out. Not a defect.

## Coverage

| Area                               | File                         | Tests   | Pass    | Fail  |
| ---------------------------------- | ---------------------------- | ------- | ------- | ----- |
| Health, tax years, settings        | `01-health-settings.test.ts` | 34      | 34      | 0     |
| Imports (fixtures, dedupe, delete) | `02-imports.test.ts`         | 36      | 36      | 0     |
| tests/data edge-case pack          | `03-edge-data.test.ts`       | 14      | 14      | 0     |
| Generic recipe + mock AI flow      | `04-recipes.test.ts`         | 24      | 24      | 0     |
| Transactions                       | `05-transactions.test.ts`    | 54      | 54      | 0     |
| Review groups + report status      | `06-review.test.ts`          | 11      | 11      | 0     |
| Reports, golden cases, balances    | `07-reports.test.ts`         | 29      | 29      | 0     |
| Exports (CSV/XLSX × 4 kinds)       | `08-exports.test.ts`         | 19      | 19      | 0     |
| Auth (`APP_PASSWORD`)              | `09-auth.test.ts`            | 35      | 35      | 0     |
| Security / robustness              | `10-security.test.ts`        | 32      | 32      | 0     |
| Research-flagged behaviours        | `11-research.test.ts`        | 8       | 8       | 0     |
| Second server regressions          | `12-server-round2.test.ts`   | 13      | 13      | 0     |
| Round 3: invalidation, import sums | `13-round3.test.ts`          | 11      | 7       | 4     |
| **Total**                          |                              | **320** | **316** | **4** |

## Not covered

- **Recipe preview `checks` for Binance edge files.** Preview applies only to generic recipes.
- **XLSX numeric text** such as `9074.400000000001` getting a `parse_warning`. No fixture contains it.
- **Brute-force lock expiry** (15 minutes) and **cookie expiry** (12 hours): need clock control.
- **The `Secure` cookie flag**, set only on HTTPS. The stack serves plain HTTP.
- **Session revocation and invalidation metadata across a container restart.** The server's own unit
  test covers persistence of invalidation metadata; the black-box suite does not restart the container for it.

## Round 4 — fixed by lead (verified: API 320/320, E2E 124/124)

| Bug                                                    | Fix                                                                                                     | Verified by                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R3-1 settings save clears reports without a tax change | `packages/db/src/index.ts`: only the `engine` key, and only when its value changes, invalidates reports | `tests/api/13-round3.test.ts` › what clears a stored report (3 tests)                     |
| R3-2 balances for one year clear every year's report   | `invalidateReports` takes an optional tax year; balance saves pass theirs                               | `tests/api/13-round3.test.ts` › actual balances for one year keep the other year's report |
| R3-3 duplicate flag-code chips on Transactions         | chips are unique per code (`TransactionsClient.tsx`)                                                    | manual                                                                                    |
| R3-4 Overview counts report notices as review items    | info-severity codes are excluded; wording is "N item(s) need(s) review"                                 | `tests/e2e/round3.spec.ts` › report notices are not counted                               |
| R3-5 row numbers start at 0                            | import screens show 1-based data row numbers                                                            | manual                                                                                    |

Still noted, not changed: ledger edits invalidate every year (safe but broad); uncomputed reports return 404 by design.
