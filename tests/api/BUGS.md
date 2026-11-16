# API defects found by `tests/api`

Regression run on 2026-11-17 against image `tax-tracker-app:local` built from `main` at `1cc6111`
(after fix commits `f1f5394` server and `1cc6111` UI).
Result: **296 tests, 296 pass, 0 fail.**

The fix commit `f1f5394` also updated the suite for intended contract changes (host.docker.internal
and private hosts are local AI endpoints, wrong explicit source → 422, suggest on a finished import →
409, `reportStatus` / `reportItems` in review, grouped warnings, `difference = actual − computed`,
logout revokes the session, `?next=` on the login redirect). Those edits were re-read in this round:
each one follows the contract in `packages/core/src/api/index.ts` and none of them weakens a check.

## Status of earlier findings

| #   | Finding                                                         | Status    | Verified by                                                                                                |
| --- | --------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | High: generic imports not idempotent across recipe ids          | **FIXED** | `04-recipes.test.ts › the same generic file confirmed twice with differently-named recipes does not double the ledger` |
| 2   | Low: settings accept a default tax year with no rule file       | **FIXED** | `01-health-settings.test.ts › settings › PUT rejects bad tax year with 400`                                |
| 3   | Low: oversize upload message differs from the documented one    | **FIXED** | `03-edge-data.test.ts › huge.csv → 413 file_too_large 'File exceeds 25 MB.'`                               |
| O1  | Observation: logout did not revoke a copied token               | **FIXED** | `09-auth.test.ts › logout …` (old cookie → 401, a fresh login works)                                       |
| O2  | Observation: wrong explicit source stored as an all-error import | **FIXED** | `02-imports.test.ts › wrong explicit source returns 422 naming the expected headers`                       |
| O3  | Observation: suggest on a finished import still called the AI   | **FIXED** | `04-recipes.test.ts › suggest and payload preview reject a completed import without calling AI`            |
| —   | Docker same-origin check (E2E bug 1)                            | **FIXED** | `10-security.test.ts › same-origin mutations use the public localhost port in Docker`                      |
| —   | Balance difference sign (E2E bug 14)                            | **FIXED** | `07-reports.test.ts › 18 balance mismatch … difference -0.1` (report, CSV and XLSX)                        |

## New findings (found through the API while exploring; no failing API test)

### N1. Low — a grouped `balance_mismatch` warning has empty `txIds`

- **Endpoint:** `POST /api/reports/:taxYear/compute` (and the `full` export's warnings section).
- **Repro:** add a manual ETH buy of 1 in 2026-27 → `PUT /api/balances/actual?taxYear=2026-27`
  `[{"asset":"ETH","amount":"1.5"}]` → compute.
- **Expected:** the warning `balance_mismatch "ETH: computed 1, actual 1.5"` lists the same ledger ids as
  `balances[0].txIds`, as the grouped-warnings contract says (`warnings[].txIds` = affected transactions).
- **Actual:** `count 1, txIds []`, while `balances[0].txIds` holds the buy's id. A CA following the
  warning from the export has no transaction to open.
- **Cause:** `packages/engine/src/balances.ts:56-59` calls `warn()` without a `txId`, so the grouping has nothing to collect.

### N2. Low — non-parse warnings are coded `parse_warning`

- "Section numbers pending CA verification" (`packages/engine/src/index.ts:98`) and "Import x.xlsx:
  3 excluded rows; status imported…" both come back as `code: "parse_warning"`. Report screens and
  exports label them as import parse warnings, which they are not. A distinct code
  (e.g. `rules_pending_verification`, `import_rows_excluded`) would let the UI and CA filter them.

## Observations

- `GET /api/review` never returns `reportStatus: "stale"`; `apps/web/src/server/transactions.ts:206`
  only produces `current` or `missing` (every data change deletes stored reports). The UI's `stale`
  wording is unreachable. Not a defect while reports are deleted on change.
- `GET /api/review` without `taxYear` is `current` only when **every** rule year has a stored report.
  That is consistent, but the UI's compute button on the All-years view computes only one year
  (see `tests/e2e/BUGS.md` N1).

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
| **Total**                          |                              | **296** | **296** | **0** |

## Not covered

- **Recipe preview `checks` for Binance edge files.** Preview applies only to generic recipes, so the
  HTTP API cannot produce those checks for a Binance import. Counts, row errors and missing history are asserted instead.
- **XLSX numeric text** such as `9074.400000000001` getting a `parse_warning`. No fixture contains it.
- **Brute-force lock expiry** (15 minutes) and **cookie expiry** (12 hours): need clock control in the container.
- **The `Secure` cookie flag**, set only on HTTPS. The stack serves plain HTTP.
- **Session revocation across a container restart** (whether the revocation list survives a restart) was not tested.
