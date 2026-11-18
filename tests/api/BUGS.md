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

# Phase 2

## Regression round — 2026-11-18

Run on 2026-11-18 against image `tax-tracker-app:local` from `main` at `50c248b`, compose project `taxapi3` on
port 3111 (`tests/api/phase2.env`), mock-sync on 11601 (data clock = the real day), mock LLM on 11511, fresh
data dir. **No weight proxy** (`weight-proxy.mjs` is deleted): Binance talks straight to the mock, which now
sends `X-SAPI-USED-*` headers.

```sh
node tools/mock-sync/server.mjs                         # MOCK_SYNC_PORT=11601
node tools/mock-llm/server.mjs --port 11511
set -a && . tests/api/phase2.env && set +a
DATA_HOST_DIR=$(mktemp -d /private/tmp/taxapi3-XXXX) docker compose -p taxapi3 up -d --no-build
pnpm test:api
```

**Result: 766 tests, 763 pass, 3 fail** (25 files, 35 minutes). The 3 failures are the new bug P2-API-8.
Phase 1 files (01–13): 401/401. Phase 2 files (14–24): 365 tests, 362 pass.

| File                       | Tests   | Pass    | Fail  |
| -------------------------- | ------- | ------- | ----- |
| `01-health-settings`       | 34      | 34      | 0     |
| `02-imports`               | 36      | 36      | 0     |
| `03-edge-data`             | 14      | 14      | 0     |
| `04-recipes`               | 24      | 24      | 0     |
| `05-transactions`          | 54      | 54      | 0     |
| `06-review`                | 11      | 11      | 0     |
| `07-reports`               | 29      | 29      | 0     |
| `08-exports`               | 19      | 19      | 0     |
| `09-auth`                  | 56      | 56      | 0     |
| `10-security`              | 32      | 32      | 0     |
| `11-research`              | 8       | 8       | 0     |
| `12-server-round2`         | 13      | 13      | 0     |
| `13-round3`                | 11      | 11      | 0     |
| `14-vault`                 | 41      | 41      | 0     |
| `15-providers-connections` | 74      | 74      | 0     |
| `16-sync-binance`          | 51      | 51      | 0     |
| `17-sync-coindcx`          | 13      | 13      | 0     |
| `18-sync-evm`              | 45      | 45      | 0     |
| `18b-gate`                 | 32      | 32      | 0     |
| `19-prices`                | 22      | 22      | 0     |
| `20-import-kinds`          | 54      | 54      | 0     |
| `21-pdf-snapshots`         | 27      | 27      | 0     |
| `22-dedupe-supersede`      | 16      | 16      | 0     |
| `23-phase2-security`       | 37      | 37      | 0     |
| `24-regression-round`      | 13      | 10      | 3     |
| **Total**                  | **766** | **763** | **3** |

**Gate (`18b-gate`):** every asset on Binance, CoinDCX and all ten EVM connections (A/B × chains 1, 8453,
42161, 137, 56) has `difference: "0"`, `flagged: false`. Binance USDT now reconciles (the P2P buy is
~150 days old, inside the C2C window). `18-sync-evm › drift` still gives USDC `difference: "0.5"`,
`flagged: true` and a `balance_mismatch`.

**First Binance sync timing (P2-API-1):** measured by hand on a new connection with no proxy: **237 s**
(previously 80+ minutes; ~170 s even with the proxy). The job paused three times, each exposed as
`progress.waitingUntil` about a minute ahead (`fiat/orders` costs 45,000 UID weight per call). Histories
are now scanned from one year back (`binance:history-start` is marked incomplete with "Import earlier
exports to cover any older activity"). `16-sync-binance › a first full sync … under 6 minutes` asserts it.

### Fixed (verified this round)

| Bug                                    | Evidence (passing test)                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-API-1 first Binance sync 80+ min    | 237 s without the proxy; `16 › full sync (normal) › first full sync … under 6 minutes`, `… exposes progress.waitingUntil …`, `… waitingUntil is cleared once the job ends`                                         |
| P2-API-2 interrupted import pending    | `16 › interrupted by a restart … › the interrupted sync's import is marked failed (not left pending)`                                                                                                              |
| P2-API-3 EVM incomplete history fails  | `18 › provider choice … › Arbitrum through Alchemy alone is marked incomplete …` (job completes, `balanceCheck: []`, "balance check skipped" notice)                                                               |
| P2-API-4 no way to close a venue gap   | `16 › manual rows assigned to the binance venue` (a 7 USDT `venue: binance` withdrawal opens a 7 gap, a venue-manual row does not touch it, a `venue: binance` deposit closes it); `24 › manual transaction venue` |
| P2-API-5 same PDF twice                | `21 › account statement snapshot › re-importing the same PDF is a duplicate, not a second snapshot`                                                                                                                |
| P2-API-6 no timezone-conflict warning  | `02 › a UTC-headed file imported as IST … warns about the conflicting selection` and `03 › year-boundary.csv as IST …` (the warning names both UTC and IST)                                                        |
| P2-API-7 invalid row reported twice    | `12 › CA verification and incomplete imports have distinct codes …` (lead decision: once, as `import_incomplete`)                                                                                                  |
| P2-E2E-1 vendor error dropped (API)    | `16 › bad_signature …`: `Binance -1022: …signature…`, no `signature=`/`timestamp=`/query string/URL/key, and `lastSyncError` equals the job error; `23 › failed sync errors carry the vendor meaning …`            |
| P2-E2E-4 "catalogue §" in messages     | `24 › no 'catalogue' or '§' reaches any API message` (every report-kinds fixture, statement, broken file, CoinDCX and Arbitrum syncs, reports, Review, imports, jobs, ledger; `raw` rows skipped)                  |
| P2-E2E-6 empty Fee rows (trade groups) | same-second trade legs covered by Trade History are linked; `24 › fills covered by Trade History are not duplicated …` (only the statement-only dust swap remains). Unknown operations are not fixed: P2-API-8     |
| M1–M5 (mock)                           | P2P reconciles (gate); CoinGecko INR cached (`19 › CoinGecko numeric INR is cached …`, ₹88 × 50 USDC = 4400.00); VWAP cached (`19 › the VWAP row is cached and used …`); weight headers; 20,000-entry log          |

### Tests changed this round

- `p2.ts`: `wipeP2` no longer pins the mock clock to 2026-04-01. New helpers `mockNow`, `mockDay` and
  `mockTxTime` (reads the mock's Etherscan) derive every expected date from the mock.
- `19-prices`: the tax year is the year of the mainnet ETH swap per the mock; the old XRP date is 500 days
  back (outside CoinGecko's 365 days, in another tax year). `needed` is 4 because earlier-year acquisitions
  count. Close fills now also cache VWAP (the klines have volume), so switching to `vwap` fetches nothing:
  the old "vwap is a separate cache entry … fill requests them" became "vwap needs no new fetch …", and a
  new test checks the VWAP value against the mock's kline (quote volume / base volume).
- `03-edge-data › malformed.csv`: `parse_warning` count 1 → 0, following the lead's P2-API-7 decision.
  Rows are still 11 row errors with raw rows.
- `16-sync-binance`: timing, `waitingUntil`, manual venue and vendor-message tests added.
- `23-phase2-security`: the request-detail regex also rejects a query string (`?x=`).
- New `24-regression-round.test.ts`. `README.md` and `phase2.env` updated (project `taxapi3`, no proxy).

### P2-API-8. Medium — unknown statement operations are still amount-free `fee` rows

- **Endpoint:** `POST /api/imports` (Binance Transaction History / statement), `GET /api/transactions`.
- **Steps:** import `binance-trade-history.csv`, then `binance-transaction-statement.csv` (or the statement
  alone, or `report-kinds/binance-statement-all-operations.csv`).
- **Expected:** no amount-free `fee` rows (P2-E2E-6). An operation the importer cannot classify is an
  amount-free `transfer` flagged `unknown_type`, like the unresolved same-second trade groups now are.
- **Actual:** the "Some Future Operation" row (2026-02-02 02:02:02, +0.5 USDT) is `type: "fee"` with no
  amounts and `unknown_type`. `binance-statement-all-operations.csv` gives ten such rows (00:01:03–00:01:12).
  In `packages/importers/src/binance/transaction-history.ts`, `review()` sets `type = "transfer"` only for
  `unclassifiedTrade`; the unknown-operation, wrong-sign and derivative paths keep `base()`'s `fee` type.
  The UI therefore still shows empty Fee rows.
- **Tests:** `24-regression-round.test.ts › Binance statement legs next to Trade History (P2-E2E-6) › no
  statement row is an amount-free fee row`, `› every amount-free statement row is a transfer flagged
  unknown_type`, `› no fee row anywhere in the ledger lacks a fee amount` (all fail).

### P2-API-9. Low — one "§" message is left in the EVM fee code

- **Where:** `packages/evm/src/fees.ts`. An OP-stack receipt with `operatorFeeScalar`/`operatorFeeConstant`
  but no `operatorFee` adds a `fee_review_required` flag: "…review the additional fee (research §1.8)".
- **Expected:** no research references in user messages (P2-E2E-4).
- **Actual:** found by reading the code. The mock never sends operator-fee fields, so no API test can reach
  it.
- **Test:** none; the `24` scan would catch it if the mock sent those fields.

### Observations

- Binance history is scanned from one year back on a first sync. The gap is flagged
  (`binance:history-start` incomplete), so a user with older activity is told to import files. This is a
  product trade-off, not a wrong number.
- `11-research › statement after dedicated histories …` still allows `fee` rows flagged `unknown_type`. It
  will need tightening once P2-API-8 is fixed.
- `18b-gate › Polygon native balances use the POL asset ID` (edited in `d9b6170`) no longer checks the
  MATIC→POL rename warning. The relative fixture puts the "MATIC era" after the real rename date, so no
  warning is expected against this mock. Real pre-September-2024 MATIC rows are not covered by an API test.
- The global price cache outlives a ledger wipe. `19-prices` asserts the CoinGecko request only on a fresh
  data dir, which is how the suite is meant to run.

---

## Round 1 (2026-11-17)

Run on 2026-11-17 against image `tax-tracker-app:local` rebuilt from `main` at `3baa51b`, compose project
`taxapi2` on port 3111 (`tests/api/phase2.env`), mock-sync on 11601, mock LLM on 11511.

```sh
node tools/mock-sync/server.mjs                         # MOCK_SYNC_PORT=11601
node tools/mock-llm/server.mjs --port 11511
WEIGHT_PROXY_PORT=11613 node tests/api/weight-proxy.mjs  # see P2-API-1
set -a && . tests/api/phase2.env && set +a
DATA_HOST_DIR=$(mktemp -d /private/tmp/taxapi2-XXXX) docker compose -p taxapi2 up -d --no-build
pnpm test:api
```

`phase2.env` uses `API_BASE_URL` because Vite overwrites `BASE_URL` with `/`; `lib.ts` now reads
`API_BASE_URL` first. Binance goes through `tests/api/weight-proxy.mjs`, a pass-through that adds
`x-sapi-used-*-weight-1m: 0`; without it the first Binance sync takes well over an hour (P2-API-1).

Confirmed-bug tests assert the correct behaviour and are left **failing** (no `it.fails`): none blocks
the run, because each later test in the same file does not depend on the bug.

**Result: 742 tests, 736 pass, 6 fail** (24 files, 33 minutes). The 6 failures are exactly the bug tests
below (P2-API-2, -3, -5, -6 ×2, -7). Phase 1 files: 341 tests, 338 pass.

| File                                            | Tests   | Pass    | Fail  |
| ----------------------------------------------- | ------- | ------- | ----- |
| `01-health-settings`                            | 34      | 34      | 0     |
| `02-imports`                                    | 36      | 35      | 1     |
| `03-edge-data`                                  | 14      | 13      | 1     |
| `04-recipes`                                    | 24      | 24      | 0     |
| `05-transactions`                               | 54      | 54      | 0     |
| `06-review`                                     | 11      | 11      | 0     |
| `07-reports`                                    | 29      | 29      | 0     |
| `08-exports`                                    | 19      | 19      | 0     |
| `09-auth (now also sweeps every Phase 2 route)` | 56      | 56      | 0     |
| `10-security`                                   | 32      | 32      | 0     |
| `11-research`                                   | 8       | 8       | 0     |
| `12-server-round2`                              | 13      | 12      | 1     |
| `13-round3`                                     | 11      | 11      | 0     |
| `14-vault`                                      | 41      | 41      | 0     |
| `15-providers-connections`                      | 74      | 74      | 0     |
| `16-sync-binance`                               | 42      | 41      | 1     |
| `17-sync-coindcx`                               | 13      | 13      | 0     |
| `18-sync-evm`                                   | 45      | 44      | 1     |
| `18b-gate`                                      | 32      | 32      | 0     |
| `19-prices`                                     | 20      | 20      | 0     |
| `20-import-kinds`                               | 54      | 54      | 0     |
| `21-pdf-snapshots`                              | 27      | 26      | 1     |
| `22-dedupe-supersede`                           | 16      | 16      | 0     |
| `23-phase2-security`                            | 37      | 37      | 0     |
| **Total**                                       | **742** | **736** | **6** |

## Bugs

### P2-API-1. Medium — a first Binance sync takes 80+ minutes

- **Endpoint:** `POST /api/connections/:id/sync` (Binance).
- **Steps:** new Binance connection against the mock with no proxy → sync → watch `/__requests`.
- **Expected:** a first sync of a small account finishes in minutes.
- **Actual:** `/sapi/v1/fiat/orders` is called exactly once a minute (timestamps 1794888567044 →
  1794888627066). The client budgets 90,000 UID weight against half of 180,000
  (`packages/sync/src/binance/client.ts` `budget()`/`notBefore()`), and walks 89-day windows from
  `FIRST_SYNC = 2017-07-01` for both `transactionType` 0 and 1: ~39 × 2 calls ≈ 78 minutes. With the pacing
  removed (weight proxy), a full sync still takes ~170 s: `convert/tradeFlow` and both Earn
  `rewardsRecord` streams walk 30-day windows from 2017 (115 calls each). Real Binance sends the weight
  header, so a real user sees the same hour-plus first sync.
- **Suggestion:** start the walk at the account's first activity (e.g. the earliest deposit/trade) rather
  than 2017, and spend the full weight budget on a first sync.
- **Test:** none automated (it would take over an hour); measured by hand. The suite avoids it with the
  weight proxy.

### P2-API-2. Low — an interrupted sync's import stays `pending_recipe` after a restart

- **Endpoint:** `GET /api/imports`, `GET /api/review`, report warnings.
- **Steps:** start a Binance sync → recreate the app container mid-sync → `GET /api/imports`.
- **Expected:** the job, the connection **and** its import are `failed` (spec §9: interrupted jobs become
  failed on boot; the in-process failure path already marks the import failed).
- **Actual:** job and connection are failed, but the import keeps `status: "pending_recipe"` (a file-recipe
  state). The report then says `Import … API sync …: 0 excluded rows; status pending_recipe`.
- **Test:** `16-sync-binance.test.ts › interrupted by a restart, then resumed › the interrupted sync's
  import is marked failed (not left pending)` (fails).

### P2-API-3. Medium — an EVM sync with incomplete history fails outright

- **Endpoint:** `POST /api/connections/:id/sync` (EVM), `GET /api/jobs/:id`.
- **Steps:** wallet A on Arbitrum (42161) with `options.providers: ["alchemy"]` (or only an Alchemy key
  configured) → sync.
- **Expected:** the documented Alchemy-on-Arbitrum limitation marks the internal stream `incomplete`; the
  job completes, the connection shows `lastSyncStatus: "incomplete"`, and the balance check is skipped with a
  notice (as Binance does for P2P/dust).
- **Actual:** the job is `failed` with "Cannot reconcile balances while explorer history is incomplete";
  `lastSyncStatus: "failed"`. A user whose only key for Arbitrum is Alchemy gets a failed sync every time.
  `connector.balances()` throws when history is incomplete and `apps/web/src/server/sync.ts` lets it fail
  the whole job.
- **Test:** `18-sync-evm.test.ts › provider choice does not change identities › Arbitrum through Alchemy
  alone is marked incomplete (internal transfers are not exposed)` (fails).

### P2-API-4. Low — no way to close a venue balance gap the API cannot fill

- **Endpoint:** `GET /api/connections/:id/balances`, `POST /api/transactions`.
- **Steps:** Binance sync where a P2P buy is older than six months (stream `binance:p2p:BUY` is
  `incomplete`: "import older orders from a file") → add the buy by hand → check the balances.
- **Expected:** some supported way to supply the missing event so the venue's balance check reconciles.
- **Actual:** manual transactions are always stored as `source: "manual"` (venue `manual`), so they never
  count toward the `binance` venue; there is no P2P file parser (catalogue: awaiting header samples).
  USDT stays at difference 5000. The gap is correctly explained by the incomplete flag, so this is a gap,
  not a wrong number.
- **Test:** none failing; `18b-gate.test.ts › Binance: zero differences except USDT…` documents it.

### P2-API-5. Low — importing the same PDF twice creates a second snapshot

- **Endpoint:** `POST /api/imports` (PDF), `GET /api/balances/snapshots`.
- **Steps:** upload the same Binance Account Statement PDF twice (same `fileSha256`).
- **Expected:** the second import is a duplicate (`rowsInserted: 0`, `rowsDuplicate: 3`) and there is one
  snapshot (AGENTS.md rule 7, idempotent imports).
- **Actual:** two imports, each `rowsInserted: 3, rowsDuplicate: 0`, and two identical snapshots.
- **Test:** `21-pdf-snapshots.test.ts › account statement snapshot › re-importing the same PDF is a
  duplicate, not a second snapshot` (fails).

### P2-API-6. Medium — a UTC-headed file imported as IST gets no warning at all

- **Endpoint:** `POST /api/imports`.
- **Steps:** import `binance-deposits.csv` (header `Date(UTC)`) or `tests/data/out/year-boundary.csv` with
  `timezone=IST`.
- **Expected:** spec §9: "Explicit file zones take precedence and conflicting selections produce import
  warnings" — the times stay UTC (they do) and the import carries a warning that UTC was used instead of IST,
  as Binance Order History already does ("Used +05:00 … instead of …").
- **Actual:** `timezoneSource: "file"`, `detectedTimezone: "UTC"`, `warnings: []`. Phase 1 flagged every row
  `ambiguous_timezone`; Phase 2 removed that flag but added nothing in its place, so the user's wrong choice
  is silently overridden. The importer itself emits no warning (`importFile` returns `warnings: []`).
- **Tests:** `02-imports.test.ts › a UTC-headed file imported as IST keeps UTC instants and warns about the
  conflicting selection`, `03-edge-data.test.ts › year-boundary.csv as IST: instants unchanged and the
  conflicting selection is warned` (both fail).

### P2-API-7. Low — one invalid row is now reported twice in the report

- **Endpoint:** `POST /api/reports/:taxYear/compute`, `GET /api/review`.
- **Steps:** import a Binance trade file with one unparsable row (`12-server-round2` "broken.csv") → compute.
- **Expected:** the problem appears once, as `import_incomplete` (the Phase 1 R2 rule: `parse_warning` only
  for source-interpretation issues, and the test asserts no report `parse_warning`).
- **Actual:** an extra import-level `parse_warning` "Unsupported sheets and invalid rows are listed in row
  errors and are excluded from calculations." also reaches the report and Review. Needs a lead decision if
  this is intended.
- **Test:** `12-server-round2.test.ts › CA verification and incomplete imports have distinct codes and
  appear in Review` (fails).

### Observations (no test, low priority)

- Binance dividend "BNB Vault rewards" (a standard Binance `enInfo`) is mapped as income with
  `unknown_type` "Unknown dividend description".
- A disposal with no acquisition history gets a `missing_inr_value` flag whose message is "Acquisition
  history or cost basis is unknown", which is a `missing_history` meaning under the price code.
- The spam row carries `suspected_spam` three times (three different reasons). Fine, but the UI should
  group them.
- `18-sync-evm › big_history` failed once in three runs with `fetch failed: other side closed` from the
  app (no restart, no OOM); it passed when rerun. Possibly a dropped keep-alive under load. Watch it.
- Every price fill retries `XRPUSDT` klines (400 invalid symbol) because a non-final miss is retried;
  harmless, one call per date range.

## Phase 1 tests updated for the Phase 2 contract

These Phase 1 assertions failed only because Phase 2 changed the documented behaviour on purpose
(`packages/importers/README.md`, `docs/SPEC-phase2.md` §1.1/§9). Each edit carries a comment in the test.
No golden tax case was touched.

| Test                                                      | Old assertion                                 | New assertion                                                        | Reason                                                                                                                                                   |
| --------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `02-imports › transaction statement …`                    | 2 inserted / 27 skipped / 3 errors            | 23 inserted / 9 skipped / 0 errors; re-import 23 duplicates          | a statement alone now rebuilds trades and moves; legs are skips kept in grouped raw; unknown operations are flagged `unknown_type` rows (catalogue §1.5) |
| `02-imports › a UTC-headed file imported as IST …`        | every row `ambiguous_timezone`                | file zone wins, plus a conflict warning                              | explicit UTC headers take precedence (importers README); the warning half fails → P2-API-6                                                               |
| `03-edge-data › year-boundary.csv as IST …`               | same as above                                 | same as above                                                        | same; fails → P2-API-6                                                                                                                                   |
| `02-imports › CoinDCX workbook` (×2)                      | 7 inserted, 3 errors (futures row an error)   | 8 inserted, 2 errors                                                 | futures rows are review-only ledger rows now                                                                                                             |
| `05-transactions` counts                                  | 16 rows, 7 CoinDCX, last page 1               | 17, 8, 2                                                             | the same extra CoinDCX futures row                                                                                                                       |
| `06-review › ambiguous_timezone` (+ resolve)              | from a UTC-headed withdrawal file read as IST | from a Binance order file with a bare `Time` and no offset           | only bare Binance times are ambiguous now                                                                                                                |
| `11-research › statement after the dedicated histories …` | only `income`                                 | `income`, the statement-only dust swap, and `unknown_type` fee rows  | ambiguous same-second groups are amount-free review rows; dust stays                                                                                     |
| `12-server-round2 › skip-only files …`                    | statement Deposit/Withdraw always skipped     | inserted when no dedicated history covers them; re-import duplicates | statement moves are superseded by dedicated histories inside their coverage instead of always skipped                                                    |

## Mock issues (tools/mock-sync)

- **M1. P2P fixture is outside the API window.** `P2P_BUY` is dated 2025-04-08. The client correctly limits
  C2C to the last six months of the **real** clock (2026-11-17), so the buy can never be synced and the
  Binance USDT balance is always 5000 off. The mock's data clock is pinned to 2026-04-01, but the client's
  windows follow wall time. Same two-clock effect: CoinGecko's 365-day limit hides every FY 2025-26 date
  before 2025-11-17. Either date the P2P buy within six months of "now" or let the app take an injected clock
  in test mode.
- **M2. CoinGecko `/coins/{id}/history` returns only `current_price.usd`.** The README says `{usd,inr}` and
  the real API includes `inr`; the app reads `inr`, so no CoinGecko price can ever be cached against the
  mock. `ripple` (no price series) answers `symbol: "usdt"` at a flat 1 USD.
- **M3. Klines have zero base volume** (`"0.00000000"`), so a VWAP price cannot be derived and the
  `marketPriceBasis: "vwap"` path never caches a price.
- **M4. No `X-SAPI-USED-*` weight headers.** The README says they are sent; only `X-MBX-USED-WEIGHT-1M`
  is. The client then self-counts weights (which exposes P2-API-1). Worked around by `weight-proxy.mjs`.
- **M5. The request log keeps only 500 entries**; a sync of ten wallets overflows it. Tests clear it
  before each check instead.

## Not covered

- **30-minute idle lock** — needs clock control.
- **The full 80-minute paced Binance sync** (P2-API-1) — measured by hand only.
- **CoinGecko price caching and VWAP values** — blocked by M2/M3; the requests themselves are asserted.
- **Blockscout's paid Base plan** and **Etherscan free → next provider fallback on a paid-only chain** —
  the paid Etherscan route and the provider_key_required paths are covered instead.
- **File↔API dedupe for CoinDCX** (and the TDS supplement from a file) — the mock's CoinDCX trades have no
  matching synthetic Excel export; Binance trades are covered in both orders.
- **Logout invalidating a running sync's vault access** — logout locking the vault is covered.
