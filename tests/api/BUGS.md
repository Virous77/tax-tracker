# API defects found by `tests/api`

Regression run on 2026-11-17 against image `tax-tracker-app:local` built from `main` at `1cc6111`
(after fix commits `f1f5394` server and `1cc6111` UI).
Historical result: **296 tests, 296 pass, 0 fail.**

Second server fix round: **309 tests, 309 pass, 0 fail** across 12 files. A subsequent targeted run
of `12-server-round2.test.ts` passed all 13 tests, including retention of the first invalidation reason.
The test image was rebuilt with a temporary Compose/Dockerfile override that skips Next's UI type
check inside the image only. The normal `docker compose build`, `pnpm -r build` and `pnpm typecheck`
fail on the documented UI contract consumers pending the next UI agent; repository build settings
and UI sources are unchanged. All 104 package/server tests and scoped Biome checks pass. Full-repo
lint finds the existing formatting issue in `tests/e2e/BUGS.md`, which is outside this task's ownership.

The fix commit `f1f5394` also updated the suite for intended contract changes (host.docker.internal
and private hosts are local AI endpoints, wrong explicit source → 422, suggest on a finished import →
409, `reportStatus` / `reportItems` in review, grouped warnings, `difference = actual − computed`,
logout revokes the session, `?next=` on the login redirect). Those edits were re-read in this round:
each one follows the contract in `packages/core/src/api/index.ts` and none of them weakens a check.

## Status of earlier findings

| #   | Finding                                                          | Status    | Verified by                                                                                                            |
| --- | ---------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | High: generic imports not idempotent across recipe ids           | **FIXED** | `04-recipes.test.ts › the same generic file confirmed twice with differently-named recipes does not double the ledger` |
| 2   | Low: settings accept a default tax year with no rule file        | **FIXED** | `01-health-settings.test.ts › settings › PUT rejects bad tax year with 400`                                            |
| 3   | Low: oversize upload message differs from the documented one     | **FIXED** | `03-edge-data.test.ts › huge.csv → 413 file_too_large 'File exceeds 25 MB.'`                                           |
| O1  | Observation: logout did not revoke a copied token                | **FIXED** | `09-auth.test.ts › logout …` (old cookie → 401, a fresh login works)                                                   |
| O2  | Observation: wrong explicit source stored as an all-error import | **FIXED** | `02-imports.test.ts › wrong explicit source returns 422 naming the expected headers`                                   |
| O3  | Observation: suggest on a finished import still called the AI    | **FIXED** | `04-recipes.test.ts › suggest and payload preview reject a completed import without calling AI`                        |
| —   | Docker same-origin check (E2E bug 1)                             | **FIXED** | `10-security.test.ts › same-origin mutations use the public localhost port in Docker`                                  |
| —   | Balance difference sign (E2E bug 14)                             | **FIXED** | `07-reports.test.ts › 18 balance mismatch … difference -0.1` (report, CSV and XLSX)                                    |

## Second server fix round — 2026-11-17

All seven server findings are fixed. `12-server-round2.test.ts` adds regressions for per-year
status and compute targets, negative holdings, unresolved reasons, prior-year acquisition warnings,
global/per-source warning trails, non-parse warning codes, intentional skips, and report-missing
reasons. `02-imports.test.ts` verifies the mixed statement fixture and re-import accounting;
`08-exports.test.ts` verifies readable metadata in every CSV/XLSX kind and retains formula-injection checks.

- **API N1 / E2E N4:** balance warnings retain asset/source and contributing ledger ids. Actual-only
  assets legitimately have no ids but retain explicit context. Each warning counts one problem.
- **API N2 / E2E N4:** non-parse warnings use `ca_verification_pending`, `import_incomplete`,
  `fx_unavailable`, `ambiguous_transfer`, or `fee_review_required`; parsing issues keep `parse_warning`.
- **E2E N1:** Review exposes `reportStatuses` and `computeTaxYears`. The compatibility aggregate
  remains missing until every requested year has a report; the UI must compute the named missing years.
- **E2E N2:** Review includes negative holdings, all unresolved reasons, balance mismatches, and
  report-wide warnings. It omits ledger items represented by those report items. A sell without a buy
  can have two distinct report checks (negative balance and unresolved slice), with no duplicate ledger item.
- **Still-open CSV metadata:** disclaimer first, readable `Setting,Value` / `Section,Reference`
  rows and shared labels/values across CSV and XLSX.
- **Still-open statement overlap:** `rowsSkipped` / `skippedRows` carry intentional overlap rows;
  the 32-row fixture has 2 income transactions, 27 skips and 3 real row errors. Re-import gives
  2 duplicates, 27 skips and 3 errors. Raw rows remain preserved.
- **Missing report explanation:** 404 uses `report_not_computed` with persisted `invalidatedAt` and
  `cause`; a fresh year gives `never_computed` and null. The first invalidating cause is retained while
  the report remains missing. A server test verifies persistence across closing/reopening the database.

The authoritative UI handoff is `apps/web/src/server/README.md`. E2E was not run or edited. UI changes
are required to consume the new fields and union variant; server-only changes do not resolve the UI banners yet.

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
| **Total**                          |                              | **309** | **309** | **0** |

## Not covered

- **Recipe preview `checks` for Binance edge files.** Preview applies only to generic recipes, so the
  HTTP API cannot produce those checks for a Binance import. Counts, row errors and missing history are asserted instead.
- **XLSX numeric text** such as `9074.400000000001` getting a `parse_warning`. No fixture contains it.
- **Brute-force lock expiry** (15 minutes) and **cookie expiry** (12 hours): need clock control in the container.
- **The `Secure` cookie flag**, set only on HTTPS. The stack serves plain HTTP.
- **Session revocation across a container restart** (whether the revocation list survives a restart) was not tested.
