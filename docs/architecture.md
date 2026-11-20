# Architecture

A pnpm monorepo of small TypeScript packages and two apps. The build specs (`docs/SPEC*.md`) are authoritative;
this page is the map.

## Packages

| Package                             | Job                                                                                                                                          | I/O                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `packages/core`                     | Zod schemas for the ledger row, recipe, settings, report and every HTTP endpoint; decimal and date helpers; the connector contract           | none                                 |
| `packages/rules`                    | One JSON rule file per regime and tax year (`data/india-vda/2025-26.json`, `2026-27.json`, `data/india-us-equity/2026-27.json`) and a loader | reads bundled JSON                   |
| `packages/rates`                    | Bundled SBI TT buying USD/INR rate table and a lookup (last published rate on or before a date)                                              | reads bundled CSV                    |
| `packages/engine`                   | The tax engine: transfer matching, valuation, FIFO lots, Schedule VDA rows, totals, TDS, income, holdings                                    | **none** (pure)                      |
| `packages/importers`                | Binance, CoinDCX and recipe-driven generic CSV/XLSX parsers, Binance PDF statements, cross-export reconciliation                             | none (bytes in, rows out)            |
| `packages/recipes`                  | Shared CSV recipes contributed by users                                                                                                      | none                                 |
| `packages/sync`                     | Read-only Binance and CoinDCX API connectors and the shared HTTP wrapper (timeouts, retries, no secrets in logs)                             | network, only when a sync is started |
| `packages/evm`                      | EVM wallet connector over Etherscan, Blockscout, Alchemy and NodeReal; chain and known-token data                                            | network, only when a sync is started |
| `packages/prices`                   | Binance klines and CoinGecko clients, a pure fill planner and a pure price lookup over the cache                                             | network, only for a requested fill   |
| `packages/vault`                    | Encrypted secret store (scrypt + AES-256-GCM) behind a storage port                                                                          | none (storage injected)              |
| `packages/db`                       | Drizzle + SQLite schema, migrations and repositories                                                                                         | the SQLite file                      |
| `apps/web`                          | Next.js 16 app: the UI, `/api` route handlers, an in-process job runner for syncs and price fills                                            | everything above                     |
| `apps/cli`                          | Runs importers and the engine from the terminal                                                                                              | files                                |
| `tools/mock-sync`, `tools/mock-llm` | Zero-dependency mock servers for the five upstream APIs and an OpenAI-compatible endpoint, used by tests                                     | local only                           |

Internal packages are named `@tax/<folder>` and consumed as `workspace:*`.

Outside the packages, `examples/` holds synthetic exchange exports for users to try the import path, and
`docs/research/export-samples/` holds the header samples each importer was built from.

## Data flow

```
 exchange file ──► importers ──┐
 exchange API  ──► sync ───────┼──► ledger rows (+ original raw row) ──► SQLite (db)
 wallet address ─► evm ────────┘           │  dedupe on source + sourceRef,
                                           │  cross-channel fingerprint
                                           ▼
 user edits / manual rows ───────────► ledger ──┐
 rules (JSON) · SBI rates · price cache ────────┼──► engine.computeVdaReport ──► report ──► UI / CSV / XLSX
 settings · actual balances ────────────────────┘                (stored, with its settings)
```

1. **Import.** A parser turns each source row into a `LedgerTx`: decimal strings for amounts, UTC timestamps, a
   `sourceRef` (the exchange's id, or a hash of the canonical row) and the untouched `raw` row. Rows it cannot read
   are kept as row errors or flagged rows, never dropped.
2. **Store.** The app writes ledger rows, raw rows and (for syncs) the cursor in one transaction. Re-importing is a
   no-op because `(source, sourceRef)` is unique. File and API rows for the same venue are matched by fingerprint.
3. **Compute.** The app loads all history up to the year end, the rule file for the year, the bundled FX table, the
   cached prices, settings and actual balances, and calls the engine. The engine returns the report; the app stores
   it with the settings used. Any later change to the ledger, settings or balances invalidates the stored report.
4. **Export.** CSV/XLSX files are rendered from the stored report and always start with the disclaimer and settings.
   The Schedule VDA, TDS and Income exports use human column titles; only the full export carries each row's JSON
   trail. A report with unresolved sales is marked incomplete in the UI and in every export.

## Engine purity

`packages/engine` has no I/O, no network, no database and no clock. FX rates and prices are passed in as pure
lookup functions; "now" is never read. The same input always gives the same output, which is what the golden
tests in `packages/engine/test/golden/` and `test/phase2-golden/` check. All arithmetic uses `decimal.js`; amounts
are never JS numbers. INR is rounded to two places only at output.

## Where tax rules live

Rates, cess, thresholds, the tax period and every section label are data in `packages/rules/data/`, one file per
regime and tax year, validated by a Zod schema. Engine and app code contain no rate, threshold or section number.
Tax interpretations that the law leaves open are **user settings** (`packages/core` `EngineSettings`), printed on
every report. Each rule file has `sectionsVerified: false` until a CA verifies it, and the report says so.

## Network boundary

Only `packages/sync`, `packages/evm`, `packages/prices` and the AI recipe helper in `apps/web` make outgoing
requests, and only from a job or request the user started. Base URLs come from environment variables, so tests
point them at the local mock servers. Computing a report reads only local data.
