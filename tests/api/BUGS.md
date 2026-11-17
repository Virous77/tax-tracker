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
