# Phase 2 build spec: API sync, EVM import, price cache

Extends `docs/SPEC.md` (still authoritative for everything not changed here). The facts behind every
decision, including endpoints, payloads, limits and sources, are in `docs/research/phase2-apis.md`, and
official sample payloads are in `docs/research/phase2-samples/`. Read both before writing code.

**Gate:** after syncing a wallet address and an exchange account, the computed holdings for each asset match
what the chain and exchange report, and every difference is explained by a flag.

File import stays the main path. Sync is optional, read-only, and off until the user adds a connection.

## 1. Scope

| In                                                                                                                                                         | Out (later)                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Binance read-only sync (trades, deposits, withdrawals, convert, dust, dividends, fiat, P2P, balances)                                                      | Ed25519 Binance keys (HMAC only for now)           |
| CoinDCX sync: trades + balances only (the API has nothing else; Excel export stays required)                                                               | Margin, futures, options, Earn product positions   |
| EVM: Ethereum (1), Base (8453), Arbitrum (42161), Polygon (137), BNB Chain (56); chain config in data; providers per `docs/research/multichain-and-pdf.md` | Non-EVM chains                                     |
| Own-wallet transfer matching (exact tx hash first)                                                                                                         | DeFi decoding beyond "one token out, one token in" |
| Historical price cache (Binance public klines, CoinGecko Demo)                                                                                             | Paid price sources                                 |
| Encrypted secret vault                                                                                                                                     |                                                    |

## 1.1 Scope added 2026-11-17 (user request)

- **All core EVM chains** listed above. Mainnet ships first; the other chains follow once the provider research
  lands (`docs/research/multichain-and-pdf.md`). Native coins and known tokens share one asset id across chains
  (ETH on Base = ETH). This is a CA question.
- **Every export type** from Binance and CoinDCX (order history, trade history, statements, deposits/withdrawals,
  convert, P2P, earn, …), in CSV, XLSX and PDF where the venue offers them. Each type is one "report kind" in
  `packages/importers`. The catalogue is in `docs/research/export-catalogue.md`. Futures and margin are imported
  and flagged, never taxed.
- **Exports in other time zones.** Binance exports can be in any UTC offset (shown in the file name), so imports
  accept fixed offsets as well as IST and UTC.
- **Real files.** The user's real exports live in `data/real-exports/` (gitignored). Never copy their values
  anywhere.

## 2. Decisions on the research open questions

These defaults ship. Each one that is a tax question becomes a setting, printed on the report.

- **Market price basis:** new setting `marketPriceBasis: "close" | "vwap"`, default `close` = IST-day close of
  the `<COIN>USDT` daily kline (`timeZone=5:30`) × USD/INR per `usdtInrRate`. Marked "pending CA verification".
- **Stablecoins** are never assumed to equal 1 USD. USDT is valued by the existing `usdtInrRate` setting.
  Other stablecoins get a price like any other coin.
- **WETH wrap/unwrap, LP, bridges, multi-leg txs:** never classified. Each leg is recorded so the balances
  still reconcile, and each one is flagged `complex_onchain`.
- **Spam tokens** are flagged `suspected_spam` and left out of the engine (not income, no lots) until the user
  clears the flag.
- **DEX gas fees** go in `feeAsset/feeAmount` and follow the existing `feeTreatment` setting.
- **Vault:** a passphrase the user sets. Optional `SECRETS_PASSPHRASE` env var auto-unlocks at boot, documented
  as weaker.
- **Network calls are opt-in.** Price lookups are off until `prices.enabled = true` in Settings. A sync only
  runs when the user starts it. Computing a report never touches the network. It reads the cache only.

## 3. Packages and ownership

```
packages/core     connector.ts (DONE, the contract below), new schemas: API contract, settings, fingerprint
packages/vault    NEW  scrypt + AES-256-GCM secret store, node:crypto only, no DB access (takes a storage port)
packages/sync     NEW  http.ts (fetch wrapper), binance/, coindcx/  → implements Connector<…>
packages/evm      NEW  etherscan + blockscout adapters, block walker, classifier, known-token map → Connector<EvmSyncOptions>
packages/prices   NEW  klines + coingecko clients, asset→provider-id map, fill planner, pure priceLookup factory
packages/db       new tables + migrations + repositories
packages/engine   txHash transfer matching, venue pools, priceLookup valuation step, spam exclusion, computeHoldings
apps/web          /api routes, job runner for sync and price-fill jobs, vault session
tools/mock-sync   NEW  one zero-dependency Node mock server for all five upstream APIs
```

No new npm dependencies are expected. If one seems needed, stop and justify it (AGENTS.md rule 1).

### 3.1 Connector contract (`packages/core/src/connector.ts`, already in the repo)

`Connector<O>` has three methods:

- `sync(opts)` yields `StreamBatch {stream, rows, cursor, incomplete?}`;
- `balances(opts)` returns `FetchedBalance[]`;
- `checkKey(opts)` returns `KeyCheck {ok, readOnly, permissions, message}`.

A connector does HTTP but never touches the DB. The app persists each batch's rows and **then** its cursor, in one
DB transaction, so an interrupted sync resumes without loss or duplicates. Rows are
`Omit<LedgerTx, "id"|"importId">` with `raw` set to the untouched API row (numbers kept as their original
text, per research §0 "Numbers in JSON").

Exports:

- `@tax/sync`: `binanceConnector`, `coindcxConnector`;
- `@tax/evm`: `evmConnector`;
- each package also exports its pure mappers (`raw API row → LedgerTx`) for unit tests.

`ctx.baseUrls` keys and their production defaults:

- `binance` = `https://api.binance.com`
- `binanceData` = `https://data-api.binance.vision` (public market data)
- `coindcx` = `https://api.coindcx.com`
- `etherscan` = `https://api.etherscan.io/v2/api`
- `blockscout` = the default from research §3.3
- `coingecko` = `https://api.coingecko.com/api/v3`

The app reads overrides from env vars `BINANCE_API_BASE`, `BINANCE_DATA_BASE`, `COINDCX_API_BASE`,
`ETHERSCAN_API_BASE`, `BLOCKSCOUT_API_BASE` and `COINGECKO_API_BASE`.

### 3.2 HTTP wrapper (`packages/sync/src/http.ts`, also used by evm and prices)

The wrapper:

- applies a timeout of 30 s;
- retries with exponential backoff and jitter on 429 and 5xx, honouring `Retry-After`;
- treats Binance 418 as a hard stop that marks the stream `incomplete`;
- treats Etherscan `"Max rate limit reached"` (returned with HTTP 200) as a 429;
- keeps a per-host minimum interval, e.g. Etherscan free tier: 3 calls a second;
- parses JSON keeping number source text (reviver `context.source`).

It logs only `METHOD origin+pathname status ms`. It never logs keys, secrets, signatures, query strings or bodies.

Errors are typed:

- `UpstreamAuthError` (bad key or signature);
- `UpstreamRateLimitError`;
- `UpstreamClockError` (Binance -1021: resync the time offset from `/api/v3/time` once, then fail);
- `UpstreamError`.

## 4. Ledger mapping

- **Sources:** `binance-api`, `coindcx-api`, `evm:1`. **Venue** = source with `-api` stripped (`binance`,
  `coindcx`, `evm:1`). Every per-source setting uses the venue: `lotPool=per_source`, `tdsDeductedByPlatform`.
- **sourceRef:** the venue's own stable id. Binance trades: `trade:<symbol>:<id>`. Deposits: `deposit:<id>`.
  Withdrawals: `withdraw:<id>`, and so on, per research §1.5.
- **EVM sourceRef:** `<hash>:<kind>:<ordinal>` per research §3.6.
- **Asset ids:**
  - Exchange tickers as-is.
  - EVM native = `ETH`.
  - ERC-20s in the bundled known-token map (`packages/evm/data/tokens-1.json`: contract → symbol, decimals) use
    the symbol: USDT, USDC, DAI, WETH, WBTC, LINK, UNI, AAVE, MATIC/POL, SHIB, PEPE and similar top tokens, with
    contracts copied from Etherscan's verified token pages.
  - Any other token is `ERC20:1:0X<UPPERCASE ADDRESS>`, with its claimed symbol kept in `raw`. A fake "USDT"
    never merges with real USDT lots.
- **CoinDCX API rows carry no TDS.** TDS credit still comes from the CoinDCX Excel export. The sync summary says so.

### 4.1 Cross-channel dedupe (file vs API)

1. **Fingerprint.** Add `eventFingerprint(tx): string | null` to core (pure), as in research §7.2:
   - trades: venue, UTC second, base, quote, side, normalised amounts;
   - moves: venue, asset, amount, lower-case tx hash, or the UTC minute when there is no hash.

   Store it in a new indexed `transactions.fingerprint` column. Backfill existing rows in the migration.
2. **Exact match.** When an API row's fingerprint equals a sibling-channel row's (`binance` ↔ `binance-api`,
   `coindcx` ↔ `coindcx-api`) that is not already linked:
   - do not insert a ledger row;
   - store the API raw row in `raw_rows` linked to the existing tx (new nullable `raw_rows.tx_id`);
   - count it as `rowsDuplicate`.

   Match as a multiset: each existing row absorbs at most one API row.
3. **Near match.** Same venue, asset and side, and within 2 s or with amounts within 1e-8: insert the row and
   flag it `possible_duplicate` with the other row's id in the message. Never delete automatically.
4. **File after API** goes through the same rules in reverse, inside the existing file-import path.
   **Implementation clarification:** an exact-matching CoinDCX file row may supply an explicit `tdsInr`
   missing from the earlier API-owned ledger row. Preserve its id/source/raw, link the file original,
   add a `parse_warning` naming the import supplying the credit, and never overwrite user edits or an
   existing deduction. Otherwise API-first dedupe would discard the only available TDS credit.

## 5. Engine changes (stay pure)

1. **Transfer matching.** First pass: a withdrawal and a deposit of the same asset whose `txHash` are equal
   (case-insensitive, `0x` optional) are matched regardless of source, window or tolerance. If the deposit
   amount is greater than the withdrawal amount, flag `fee_review_required`.
2. **Second pass:** the existing window/tolerance rule.
3. **Valuation** (SPEC §4 step 3) gains a step after the trade's own price: an injected pure
   `priceLookup(asset, date, basis) → {price, quote, source, sourceId, date, kind} | null`. A price in a USD
   quote is converted with `fx` per `usdtInrRate`. A hit gives `inrRateSource = "market_price_cache"`, and the
   report records the source and price date.
4. **Swaps with no INR or stable leg:** value the outgoing asset. The incoming cost is the same value.
5. **Income and gift FMV** use the same chain when `incomeCostBasis = fmv_at_receipt` or for the income section.
6. **Exclusions.** Rows with an uncleared `suspected_spam` flag are excluded from lots, disposals, income and
   holdings, and listed in a new `report.excluded` array: `{txId, reason}`.
7. **`computeHoldings({transactions, settings, asOf})`:** a pure function that returns
   `{asset, venue, quantity}[]`, used by the balance check.
8. **New golden tests:**
   - hash-matched Binance → wallet transfer with a network fee;
   - wallet → Binance by hash;
   - a swap valued from the price cache;
   - a spam token excluded;
   - per-venue pools treating `binance` and `binance-api` as one.

   Existing golden tests must stay unchanged and green.

## 6. Prices (`packages/prices`)

- **Order:**
  1. the trade's own price (engine);
  2. the cache, filled from Binance klines `<COIN>USDT` 1d, IST-aligned, data back to 2017-08-17, no key;
  3. CoinGecko Demo (needs a free key, last 365 days only) for assets with no Binance pair;
  4. `missing_inr_value`.
- **Cache:** reshape `price_cache` and add `asset_price_ids` exactly as research §4.4 describes. `final = 0`
  until the date is 3 or more days old. Final rows are never fetched again.
- **Fill planner (pure):** from the ledger, list every `(asset, IST date)` the engine will need for one tax
  year and that the trade itself does not price. Subtract the cache. Group into ranged calls (klines take
  `startTime`/`endTime`, up to 1000 days a call).
- **`priceLookupFromCache(rows)`** is a pure factory the web app passes to the engine.
- **Gaps:** the job records any missing assets and dates. The report shows them through the existing
  `missing_inr_value` flags.

## 7. Vault (`packages/vault`)

Build it per research §5:

- scrypt N=2^17, r=8, p=1, maxmem 256 MiB, run async;
- AES-256-GCM with a 12-byte IV per secret;
- AAD `tax-tracker:v1:<secretId>:<kind>`;
- a `check` blob to verify the passphrase.

Storage goes through a small port interface, so the package has no DB dependency. The derived key is kept in
memory only, in a Buffer. The vault locks after 30 minutes idle, on lock, and on restart.

Operations:

- `setup(passphrase ≥ 12 chars)`, `unlock`, `lock`, `changePassphrase` (re-encrypts in one transaction);
- `reset` (deletes all secrets, needs the exact body `{confirm:"RESET"}`);
- `put(secretId, kind, value)`, `get(secretId)` (server-internal only), `has(secretId)`, `delete(secretId)`.

`SECRETS_PASSPHRASE`, when set, unlocks at boot (it sets the vault up on first boot).

The existing AI `apiKey` stays where it is for now (out of scope).

## 8. Database

New tables and columns (Drizzle migrations):

- `vault_meta (id=1, json)`
- `secrets (id, kind, iv, ct, tag, created_at)`
- `connections (id, kind binance|coindcx|evm, label, chain_id?, address?, options_json, created_at, last_sync_at?, last_sync_status?, last_sync_error?)`:
  - options: `{extraSymbols?: string[], providers?: ("etherscan"|"blockscout")[]}`;
  - exchange key secret ids: `conn:<id>:key`, `conn:<id>:secret`;
  - provider keys are global: `provider:etherscan`, `provider:blockscout`, `provider:coingecko`.
- `sync_cursors (connection_id, stream, cursor_json, updated_at)`, PK `(connection_id, stream)`
- `fetched_balances (connection_id, asset, wallet, amount, fetched_at)`
- `imports`: add `kind file|api_sync` (default file) and `connection_id?`. A sync run is an import row named like
  "Binance API sync 2026-11-17 10:02 IST". Deleting a sync import deletes its txs and raw rows and resets that
  connection's cursors (the next sync refetches).
- `transactions`: add `fingerprint` (indexed).
- `raw_rows`: add `tx_id?`.
- `price_cache` reshaped, plus a new `asset_price_ids`.
- Deleting a connection deletes its secrets, cursors and fetched balances. It does **not** delete ledger rows;
  those go when the user deletes the sync imports.

## 9. HTTP API (Zod schemas in `packages/core/src/api/`)

Errors use the existing envelope. New codes:

- `vault_locked` (423);
- `vault_not_initialized` (409);
- `wrong_passphrase` (401);
- `sync_running` (409);
- `upstream_auth` (502, with the vendor message);
- `upstream_unavailable` (502).

| Method & path                       | Body / query                                                       | Response                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/api/vault`                    |                                                                    | `{initialized, unlocked, autoUnlock:boolean, idleLockMinutes}`                                                                       |
| POST `/api/vault/setup`             | `{passphrase}`                                                     | vault status (unlocked)                                                                                                              |
| POST `/api/vault/unlock` / `lock`   | `{passphrase}` / –                                                 | vault status                                                                                                                         |
| POST `/api/vault/change-passphrase` | `{current, next}`                                                  | vault status                                                                                                                         |
| POST `/api/vault/reset`             | `{confirm:"RESET"}`                                                | vault status (not initialized), connections keep existing but show `keySet:false`                                                    |
| GET `/api/providers`                |                                                                    | `{etherscan:{keySet}, blockscout:{keySet}, coingecko:{keySet}}`                                                                      |
| PUT / DELETE `/api/providers/:name` | `{apiKey}`                                                         | same as GET (needs the vault unlocked)                                                                                               |
| GET `/api/connections`              |                                                                    | `Connection[]`: `{id, kind, label, chainId?, address?, options, keySet, lastSyncAt, lastSyncStatus, lastSyncError, running:boolean}` |
| POST `/api/connections`             | `{kind, label, apiKey?, apiSecret?, address?, chainId?, options?}` | `Connection` (exchange kinds need the vault unlocked; EVM addresses are validated and lower-cased; duplicate → 409)                  |
| PATCH `/api/connections/:id`        | `{label?, options?, apiKey?, apiSecret?}`                          | `Connection`                                                                                                                         |
| DELETE `/api/connections/:id`       |                                                                    | 204                                                                                                                                  |
| POST `/api/connections/:id/check`   |                                                                    | `KeyCheck` (a key that can trade or withdraw → `ok:true, readOnly:false`, and the UI warns loudly)                                   |
| POST `/api/connections/:id/sync`    |                                                                    | 202 `{jobId}`                                                                                                                        |
| GET `/api/connections/:id/balances` |                                                                    | `{fetchedAt, rows:[{asset, fetched, computed, difference, flagged}]}`, where computed = `computeHoldings` for that venue/address now |
| GET `/api/jobs/:id`                 |                                                                    | `{id, kind:"sync"                                                                                                                    | "price_fill", status, progress?, result?: SyncSummary | PriceFillSummary, error?}` |
| GET `/api/prices/status`            | `taxYear`                                                          | `{enabled, needed, cached, missing:[{asset, date}], sources:{binanceKlines:true, coingecko:{keySet}}}`                               |
| POST `/api/prices/fill`             | `{taxYear}`                                                        | 202 `{jobId}` (`prices.enabled` must be true, otherwise 409 `prices_disabled`)                                                       |

- **`SyncSummary`:** `{importId, streams:[{stream, rowsFetched, rowsInserted, rowsDuplicate, rowsFlagged, incomplete?}], balanceCheck:[{asset, fetched, computed, difference}], notices:string[]}`.
- **`PriceFillSummary`:** `{requested, fetched, fromCache, missing:[{asset,date}]}`.
- **Settings** gain `prices:{enabled:boolean (default false), coingeckoFallback:boolean (default true)}` and
  `marketPriceBasis`. A change to `marketPriceBasis` invalidates reports, the same way an `engine` change does.
- **Sync jobs:** run in the existing in-process job runner, one per connection at a time. After a sync finishes:
  - `balances()` is stored;
  - the ledger change invalidates reports (existing rule);
  - if prices are enabled, a price fill runs for the affected tax years.
- **Review:** GET `/api/review` gains the two new codes (already in `ReviewCodeSchema` and the UI's
  `review-codes.ts`) and a `connections` group listing failed or incomplete last syncs.

## 10. UI

1. **Connections**, a new page in the nav:
   - **Vault card:** set up, unlock, lock, change passphrase, reset with a typed confirm. Explain in plain words
     that a forgotten passphrase means re-entering keys.
   - **Add connection:** Binance, CoinDCX or Ethereum address.
     - The key form says **"Create a read-only key"**, with a short how-to and a link to the venue's
       API-management page.
     - CoinDCX shows a warning that its keys cannot be made read-only, so the user should turn on IP binding
       and use a sub-account if they can.
     - After saving, the app runs `check` automatically and shows `readOnly:false` as a red warning.
   - **Connection list:** last sync time and status, a "Sync now" button with live progress (poll `/api/jobs/:id`
     every second while running), the summary per stream, and the balance check table (fetched vs computed,
     differences highlighted).
   - **Binance "Extra trading pairs"** input.
   - **Provider keys card:** Etherscan, Blockscout and CoinGecko, each with a link to get a free key.
2. **Settings:** a "Price lookups" section with the enable toggle, a CoinGecko fallback toggle and
   `marketPriceBasis`, each with a one-line why. The text says exactly which hosts will be contacted.
3. **Report:**
   - a "Prices" status line with a "Fetch missing prices" button (disabled with a reason while prices are off);
   - the `excluded` list (spam);
   - the price source shown in the trail drawer for `market_price_cache` rows.
4. **Imports list:** sync imports show a "Synced" badge and the connection label.
5. **Transactions:**
   - a source filter that includes the new sources;
   - the tx hash shown, linked to the explorer (the user clicks; nothing loads by itself).

## 11. Mock server (`tools/mock-sync/server.mjs`)

Zero dependencies, `node:http` only. One port (`MOCK_SYNC_PORT`, default 11601), with path prefixes `/binance`,
`/binance-data`, `/coindcx`, `/etherscan`, `/blockscout` and `/coingecko`. The mock:

- **Verifies signatures for real.** Binance HMAC over the query string, and CoinDCX HMAC over the body, using
  the fixed test credentials below.
- **Checks timestamps** against `recvWindow` (error -1021).
- **Pages exactly** like the real APIs: Etherscan's 1000-row cap with block walking, Binance limits and time
  windows, and CoinDCX `from_id`.
- **Supports `POST /__control {scenario}` to switch behaviour:** `normal`, `empty`, `rate_limit_once` (one 429
  with Retry-After, then normal), `ban_418`, `bad_signature`, `clock_skew`, `etherscan_rate_limit_200`,
  `upstream_500_once`, `trading_key` (apiRestrictions says trade is enabled) and `big_history` (more than 3,000
  token transfers, to force block walking). `GET /__requests` returns the request log, minus secrets, so tests
  can assert pagination and that no key leaked into URLs where it shouldn't.
- **Uses one coherent fixture user:**
  - buys ETH on Binance with USDT, after a P2P INR→USDT buy;
  - withdraws ETH to wallet A, `txId` = the hash of the wallet-A incoming tx;
  - wallet A swaps ETH→USDC on a DEX (one out, one in);
  - wallet A sends USDC to wallet B (own);
  - wallet A receives a spam token;
  - wallet B sends USDC back to Binance (deposit `txId` matches);
  - sells on Binance.

  CoinDCX gets a few INR trades. Klines give daily prices for every asset and date used. Final balances from
  `account`, `users/balances` and the explorer balance endpoints **equal** what the ledger implies, so the gate
  is testable. A `drift` scenario adds one unexplained 0.5 USDC to wallet B to test the mismatch path.
- Test credentials: Binance key `mock-binance-key` / secret `mock-binance-secret`. CoinDCX `mock-dcx-key` /
  `mock-dcx-secret`. Etherscan, Blockscout and CoinGecko keys `mock-*-key`. Wallets A and B are fixed addresses
  listed in `tools/mock-sync/README.md`.

## 12. Testing expectations

- **Unit tests** for every pure mapper against the research samples, the classifier, the fingerprint, the
  planner, the vault (wrong passphrase, tampered ciphertext, AAD swap), and the engine golden additions.
- **Integration:** `packages/sync` and `packages/evm` tests run against the mock server, started in-process.
- **API tests** (`tests/api`) against Docker with `*_API_BASE` pointing at the mock on `host.docker.internal`.
  Cover every endpoint and error code above, every mock scenario, resume after interruption, re-sync
  idempotency, file-then-API and API-then-file dedupe, and the balance gate.
- **E2E** (`tests/e2e`) for the Connections page, the vault flows, a sync with live progress, the balance table,
  the price toggle and fetch, and the spam exclusion on the report.
