# Phase 2 API research: exchange sync, EVM import, prices, secrets

Checked **2026-11-17** unless a row says otherwise. Sources are official vendor docs; where only a
third-party source exists it is marked **(third-party)**, and where nothing could be confirmed it is
marked **UNVERIFIED**. Example payloads copied from the docs are in `docs/research/phase2-samples/`.

Sources used:

| Vendor     | Source (all checked 2026-11-17)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binance    | `github.com/binance/binance-spot-api-docs` (`rest-api.md`, `errors.md`, `enums.md`, `faqs/api_key_types.md`, CHANGELOG "Last Updated 2026-11-11"); developers.binance.com pages: catalog `core-trading-wallet/api/rest-api/{capital,asset,account}`, `docs/convert/trade/Get-Convert-Trade-History`, `legacy-docs/fiat/rest-api/*`, `docs/c2c/rest-api/Get-C2C-Trade-History`, `docs/simple_earn/flexible-locked/history/*`; `developers.binance.com/en/docs/llms-full.txt` (changelogs) |
| CoinDCX    | `docs.coindcx.com` (single page, fetched in full)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Etherscan  | `docs.etherscan.io` (`/rate-limits`, `/common-error-messages`, `/supported-chains`, `/changelog`, `/api-reference/endpoint/{txlist,txlistinternal,tokentx,balance,balancemulti,tokenbalance,addresstokenbalance}`)                                                                                                                                                                                                                                                                       |
| Blockscout | `docs.blockscout.com` (`/devs/migrate-from-etherscan`, `/devs/blockscout-api`, `/devs/blockscout-api-responses-and-routes`, `/devs/dev-portal`, `/base-api`, `/devs/tax-calculator`, v12.0.0 breaking-changes page, `/openapi-specs/blockscout-rpc-api_2.yaml`)                                                                                                                                                                                                                          |
| CoinGecko  | `docs.coingecko.com` (`/demo/reference/{authentication,endpoint-overview,coins-id-history,coins-id-market-chart-range,coins-contract-address,coins-list}`, `/docs/errors-and-rate-limits`)                                                                                                                                                                                                                                                                                               |
| rotki      | `github.com/rotki/rotki` `rotkehlchen/exchanges/binance.py` (develop branch) for prior art                                                                                                                                                                                                                                                                                                                                                                                               |

---

## 0. Decisions in one table

| Topic                       | Decision                                                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP clients                | Own `fetch` + `node:crypto` clients. No ccxt, **no viem** (§3.8).                                                                                                                                                                                                    |
| Numbers in JSON             | CoinDCX and CoinGecko return amounts as JSON numbers. Parse with the `JSON.parse` reviver's `context.source` (works on Node 24.18.1, checked) and keep the digits as strings. Never let a float reach `decimal.js`.                                                  |
| `source` values             | `binance-api`, `coindcx-api`, `evm:<chainId>` (e.g. `evm:1`). File imports keep `binance` / `coindcx`. The (source, sourceRef) unique index gives idempotency inside each channel; a separate **event fingerprint** stops double counting across file vs API (§7.2). |
| Binance symbol discovery    | Candidate assets from every non-trade endpoint + balances + file-imported assets, crossed with `exchangeInfo`; user can add symbols; delisted pairs are a known gap caught by the balance check (§1.4).                                                              |
| CoinDCX API                 | Trades and balances only. **No spot deposit/withdrawal history and no TDS in the API**: the Excel export stays mandatory for CoinDCX (§2).                                                                                                                           |
| EVM provider                | Etherscan V2 (free key, chain 1 free) first; Blockscout API (free key) as second provider and for chains Etherscan's free tier excludes. Page with `offset=1000` and walk `startblock` (§3.2).                                                                       |
| Prices                      | Trade's own price first; then Binance public daily klines `<COIN>USDT` with `timeZone=5:30` (IST-aligned days, data from 2017-08-17, no key); then CoinGecko Demo (≤ 365 days); else `missing_inr_value` (§4).                                                       |
| Secrets                     | scrypt (N=2^17, r=8, p=1, maxmem 256 MiB) → AES-256-GCM, random 16-byte salt per vault and 12-byte IV per secret, AAD binds slot; forgotten passphrase = re-enter keys (§5).                                                                                         |
| New review codes (proposal) | `suspected_spam`, `possible_duplicate`. Everything else maps to existing codes (§7.4).                                                                                                                                                                               |

---

## 1. Binance (spot, read-only)

### 1.1 Base URL, signing, time

- Base: `https://api.binance.com` (also `api-gcp`, `api1`..`api4`; the docs say api1–4 "may give better performance but have less stability").
  Public market data only: `https://data-api.binance.vision`.
- Key header: `X-MBX-APIKEY: <apiKey>`.
- Signed (USER_DATA) requests add `timestamp` (ms or µs) and optional `recvWindow` (ms, default **5000**, max **60000**, up to 3 decimals), then `signature`.
- Signature payload = query string concatenated with the request body, no separator. Percent-encode non-ASCII before signing.
  HMAC-SHA256 with the secret, hex output (case-insensitive).
- Server rejects if `timestamp` is > 1000 ms ahead of server time, or `serverTime − timestamp > recvWindow` → `-1021`.
  Get the offset from `GET /api/v3/time` (`{"serverTime": <ms>}`, weight 1) before a sync and add it to local time.
- Responses are in ms unless header `X-MBX-TIME-UNIT: MICROSECOND`.
- Key types: Ed25519 (Binance's recommendation), HMAC, RSA. **v1: HMAC** (user pastes key + secret). Optional later: the app generates an Ed25519 key pair with `crypto.generateKeyPairSync("ed25519")`, the user uploads only the public key, signature is base64 and must be URL-encoded. Same payload rules.

Worked example from the docs (verified locally with `node:crypto` on 2026-11-17):

```
secretKey  NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j
payload    symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559
signature  c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71
```

```ts
createHmac("sha256", secret).update(payload).digest("hex");
// GET https://api.binance.com/api/v3/myTrades?<payload>&signature=<hex>   header X-MBX-APIKEY
```

Use it as a unit test vector. (The doc example is an order; we never call order endpoints, see §1.6.)

### 1.2 Weights and rate limits

| Family      | Limit                                                                                                                                                              | Headers                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `/api/v3/*` | Per IP. `exchangeInfo.rateLimits` example: `REQUEST_WEIGHT` 6000 / 1 min, `RAW_REQUESTS` 61000 / 5 min. Read the live values from `exchangeInfo`, don't hard-code. | `X-MBX-USED-WEIGHT-1M` (pattern `X-MBX-USED-WEIGHT-(intervalNum)(letter)`) |
| `/sapi/*`   | Each endpoint has its **own** budget: 12000/min for IP-weighted, 180000/min for UID-weighted endpoints.                                                            | `X-SAPI-USED-IP-WEIGHT-1M`, `X-SAPI-USED-UID-WEIGHT-1M`                    |
| 429         | Rate limit broken. Body `{"code":-1003,...}`. Must back off; `Retry-After` (seconds) is sent.                                                                      |                                                                            |
| 418         | IP auto-banned for ignoring 429s. Bans scale **2 minutes → 3 days**. `Retry-After` = seconds until unban.                                                          |                                                                            |
| 403         | WAF rule violated.                                                                                                                                                 |                                                                            |
| 5xx         | Unknown status; retry with backoff for GETs.                                                                                                                       |                                                                            |

Client rule: track the used-weight header, keep under 50% of the limit, on 429 sleep `Retry-After` and halve the rate, on 418 stop the whole sync and show the unban time. Never retry a 4xx other than 429.

Errors are `{"code": <int>, "msg": "<text>"}`. Ones we must handle: `-1021` INVALID_TIMESTAMP, `-1022` INVALID_SIGNATURE,
`-2014` BAD_API_KEY_FMT, `-2015` REJECTED_MBX_KEY ("Invalid API-key, IP, or permissions for action"; rotki sees it with HTTP 401),
`-1121` "Invalid symbol." (delisted/unknown pair on `myTrades` → treat as "no trades", see §1.4), `-1003` TOO_MANY_REQUESTS.

### 1.3 Endpoints

All signed endpoints take `timestamp` (required) and `recvWindow` (optional) — omitted below. "Window" = max `endTime − startTime`.

| Purpose                     | Method & path                                             | Weight                                                         | Key params                                                                                                                                   | Window / limit / pagination                                                                                                                                                                          | History depth                                                                                    |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Spot fills                  | GET `/api/v3/myTrades`                                    | 20 (5 with `orderId`)                                          | `symbol` **required**, `orderId`, `startTime`, `endTime`, `fromId`, `limit`                                                                  | limit default 500, **max 1000**; start–end ≤ **24 h**; `fromId` returns ids ≥ fromId ascending. Allowed combos: symbol; +orderId; +startTime; +endTime; +fromId; +startTime+endTime; +orderId+fromId | Not documented. Assume full history; verify against the user's export.                           |
| Spot balances               | GET `/api/v3/account`                                     | 20                                                             | `omitZeroBalances` (default false)                                                                                                           | —                                                                                                                                                                                                    | current only                                                                                     |
| Funding-wallet balances     | **POST** `/sapi/v1/asset/get-funding-asset`               | not captured                                                   | `asset`, `needBtcValuation`                                                                                                                  | —                                                                                                                                                                                                    | current. P2P/fiat money lands here, so the balance check needs it.                               |
| All assets, any wallet      | **POST** `/sapi/v3/asset/getUserAsset`                    | IP 5                                                           | `asset`, `needBtcValuation`                                                                                                                  | returns only assets with positive balance                                                                                                                                                            | current                                                                                          |
| Coin/network metadata       | GET `/sapi/v1/capital/config/getall`                      | IP 10                                                          | —                                                                                                                                            | —                                                                                                                                                                                                    | current; has `contractAddress` per network (useful to map ETH-network coins to ERC-20 contracts) |
| Deposits                    | GET `/sapi/v1/capital/deposit/hisrec`                     | IP 1                                                           | `coin`, `status`, `startTime`, `endTime`, `offset`, `limit`, `txId`, `includeSource`                                                         | default window = last 90 days; window **< 90 days**; limit default/max **1000**; `offset` paging                                                                                                     | Not documented. rotki walks 89-day windows from 2017-07-14.                                      |
| Withdrawals                 | GET `/sapi/v1/capital/withdraw/history`                   | UID 18000 ("max 10 requests per second", changelog 2023-09-04) | `coin`, `withdrawOrderId`, `status`, `offset`, `limit`, `idList`, `startTime`, `endTime`                                                     | same 90-day rule; limit max 1000; `network` may be absent on old rows                                                                                                                                | as above                                                                                         |
| Convert                     | GET `/sapi/v1/convert/tradeFlow`                          | **UID 3000** (changelog 2022-08-18; docs page says 3000)       | `startTime` **req**, `endTime` **req**, `limit`                                                                                              | window ≤ **30 days**; limit default 100, max 1000; response has `moreData`                                                                                                                           | Not documented                                                                                   |
| Dust → BNB                  | GET `/sapi/v1/asset/dribblet`                             | IP 1                                                           | `accountType` (SPOT/MARGIN), `startTime`, `endTime`                                                                                          | **only the last 100 records**                                                                                                                                                                        | **only records after 2020-12-01**                                                                |
| Distributions               | GET `/sapi/v1/asset/assetDividend`                        | IP 10                                                          | `asset`, `startTime`, `endTime`, `limit`                                                                                                     | window ≤ **180 days**; limit default 20, max 500. No offset param documented: page by moving `endTime` back to the oldest `divTime` seen                                                             | Not documented                                                                                   |
| Fiat deposits/withdrawals   | GET `/sapi/v1/fiat/orders`                                | UID 90000 (changelog 2022-05-31; legacy page says 45000)       | `transactionType` **req** (0 deposit, 1 withdraw), `beginTime`, `endTime`, `page`, `rows`                                                    | default last 30 days; `rows` default 100, max 500; `page` from 1                                                                                                                                     | Not documented. rotki walks 89-day windows.                                                      |
| Fiat buy/sell crypto        | GET `/sapi/v1/fiat/payments`                              | IP 1                                                           | `transactionType` **req** (0 buy, 1 sell), `beginTime`, `endTime`, `page`, `rows`                                                            | as above                                                                                                                                                                                             | as above                                                                                         |
| P2P (C2C)                   | GET `/sapi/v1/c2c/orderMatch/listUserOrderHistory`        | IP 1                                                           | `tradeType` (BUY/SELL), `startTimestamp`, `endTimestamp`, `page`, `rows`                                                                     | window ≤ **30 days**; default last 30 days; rows default/max **100**                                                                                                                                 | **past 6 months only** (docs: "for all orders check c2c.binance.com/en/fiatOrder")               |
| Simple Earn flexible reward | GET `/sapi/v1/simple-earn/flexible/history/rewardsRecord` | IP 150                                                         | `type` (required per (third-party) SDK docs: BONUS, REALTIME, REWARDS, ALL), `asset`, `productId`, `startTime`, `endTime`, `current`, `size` | window ≤ **30 days** (error `-6021` "Query time range too large", per rotki); `size` default 10, max 100                                                                                             | Not documented                                                                                   |
| Simple Earn locked reward   | GET `/sapi/v1/simple-earn/locked/history/rewardsRecord`   | IP 150                                                         | `positionId`, `asset`, `startTime`, `endTime`, `current`, `size`                                                                             | same 30-day / 100 rules                                                                                                                                                                              | Not documented                                                                                   |
| Key check                   | GET `/sapi/v1/account/apiRestrictions`                    | IP 1                                                           | —                                                                                                                                            | —                                                                                                                                                                                                    | —                                                                                                |
| Symbols                     | GET `/api/v3/exchangeInfo` (public)                       | not captured                                                   | `symbols`, `permissions`, `symbolStatus` (TRADING, HALT, BREAK, CANCEL_ONLY), `showPermissionSets`                                           | —                                                                                                                                                                                                    | current symbols only                                                                             |
| Delist schedule             | GET `/sapi/v1/spot/delist-schedule` (MARKET_DATA)         | not captured                                                   | —                                                                                                                                            | —                                                                                                                                                                                                    | upcoming only                                                                                    |

Response shapes (field: type). Full doc examples are in `phase2-samples/`.

- **myTrades** → array of `{symbol: string, id: int, orderId: int, orderListId: int, price: string, qty: string, quoteQty: string, commission: string, commissionAsset: string, time: int(ms), isBuyer: bool, isMaker: bool, isBestMatch: bool}`.
  `isBuyer=true`: received `qty` base, paid `quoteQty` quote. Fee is `commission` in `commissionAsset` (often BNB, a third coin).
- **account** → `{..., accountType, balances: [{asset, free: string, locked: string}], permissions: string[], uid: int}`. Balance = free + locked.
- **deposit/hisrec** → array of `{id: string, amount: string, coin, network, status: int, address, addressTag, txId, insertTime: int, completeTime: int, transferType: int, confirmTimes: string, unlockConfirm: int, walletType: int, travelRuleStatus: int}`.
  Status: 0 pending, 1 success, 2 rejected, 6 credited but cannot withdraw, 7 wrong deposit, 8 waiting user confirm. Ingest **1 and 6** only. `completeTime` exists only for deposits after 2025-03-06.
- **withdraw/history** → array of `{id: string, amount: string, transactionFee: string, coin, status: int, address, txId, applyTime: "YYYY-MM-DD HH:mm:ss" (UTC string), network, transferType: int (1 internal, 0 external), withdrawOrderId?, info, confirmNo: int, walletType: int, txKey, completeTime?: string (only when status 6)}`.
  Status: 0 email sent, 2 awaiting approval, 3 rejected, 4 processing, 6 completed (docs list no 1/5). Ingest **6** only.
  Timestamp: use `applyTime` (precedes the on-chain tx, so the engine's "deposit after withdrawal" rule holds).
  Whether `amount` excludes `transactionFee` is **UNVERIFIED**; for ETH-network withdrawals the on-chain tx value settles it (§6.3).
- **convert/tradeFlow** → `{list: [{quoteId: string, orderId: int, orderStatus: string, fromAsset, fromAmount: string, toAsset, toAmount: string, ratio: string, inverseRatio: string, createTime: int}], startTime, endTime, limit, moreData: bool}`. Ingest `orderStatus = "SUCCESS"`. If `moreData`, split the window.
- **dribblet** → `{total: int, userAssetDribblets: [{operateTime, totalTransferedAmount, totalServiceChargeAmount, transId, userAssetDribbletDetails: [{transId, serviceChargeAmount, amount, operateTime, transferedAmount, fromAsset, targetAsset}]}]}`.
  One ledger swap per detail: out `amount` of `fromAsset`, in `transferedAmount` of BNB, fee `serviceChargeAmount` BNB. Whether `transferedAmount` is already net of the fee is **UNVERIFIED** (example: total 0.00132256 vs charge 0.00002699 ≈ 2%).
- **assetDividend** → `{rows: [{id: int, amount: string, asset, divTime: int, enInfo: string, tranId: int, direction: int}], total: int}`. `direction` is undocumented (example 1). Map `enInfo` to `incomeKind` with the same table as the file importer (`BINANCE_INCOME`), unknown text → `unknown_type`.
- **fiat/orders** → `{code: "000000", message, data: [{orderNo, fiatCurrency, indicatedAmount, amount, totalFee, method, status, createTime, updateTime}], total, success}`.
- **fiat/payments** → same envelope, items `{orderNo, sourceAmount (fiat), fiatCurrency, obtainAmount (crypto), cryptoCurrency, totalFee, price, status (Processing|Completed|Failed|Refunded), paymentMethod (only for buys), createTime, updateTime}`. rotki: when empty the API may **omit `data`** and send `{"code":"000000","message":"success","success":true,"total":0}`.
- **c2c** → same envelope, items `{orderNumber, advNo, tradeType, asset, fiat, fiatSymbol, amount (crypto), totalPrice (fiat), unitPrice, orderStatus, createTime, commission (crypto), counterPartNickName, payMethodName, additionalKycVerify, takerCommissionRate, takerCommission, takerAmount, advertisementRole}`.
  Ingest `COMPLETED` only. **Drop `counterPartNickName` from stored raw rows** (third-party personal data we do not need) — the only field we deliberately strip; note it in the raw row as `"counterPartNickName": "<removed>"`.
- **simple-earn locked rewards** → `{rows: [{positionId: int, time: int, asset, lockPeriod: string, amount: string, type: string}], total}`.
  Flexible rewards: fields `asset, rewards, projectId, type, time` per (third-party) SDK docs; the official page did not render. **UNVERIFIED**.
- **apiRestrictions** → `{ipRestrict, createTime, enableReading, enableWithdrawals, enableInternalTransfer, enableMargin, enableFutures, permitsUniversalTransfer, enableVanillaOptions, enableFixApiTrade, enableFixReadOnly, enableSpotAndMarginTrading, enablePortfolioMarginTrading}` (all bool except createTime).

Overlap warning: Simple Earn rewards may also appear in `assetDividend` (e.g. enInfo like "Simple Earn Flexible Interest"). Not confirmed either way. **Use `assetDividend` as the single income feed** and use Simple Earn history only to cross-check totals until a real account shows whether they overlap.

### 1.4 Rebuilding full history; symbol discovery

`myTrades` needs a symbol and Binance has ~thousands. rotki makes the **user pick pairs** (`binance_selected_trade_pairs`); it treats `-1121 Invalid symbol` as "delisted, no trades".

Recommended discovery (cheap and deterministic):

1. Fetch every non-trade stream first (deposits, withdrawals, convert, dust, dividends, fiat, P2P) and balances (spot + funding).
2. Candidate assets = assets in all of those + assets already in the ledger from Binance file imports.
3. Candidate symbols = `exchangeInfo` symbols (with `permissions=["SPOT","MARGIN","LEVERAGED"]` default and `symbolStatus` unset) whose base **and** quote are both candidates. A coin bought with USDT and sold for USDT shows up because USDT is a candidate from the deposit that funded it.
4. Plus symbols the user adds by hand (UI: "Add pairs Binance did not list").
5. Per symbol: `fromId=0, limit=1000`, then `fromId = lastId + 1` until fewer than 1000 rows. One call per empty symbol, weight 20 → budget 150 calls/min.

Gaps this cannot close: a pair removed from `exchangeInfo` (delisted) where the coin also left no other trace. The balance check (§7.3) and the file import are the backstop. Never invent trades.

### 1.5 Mapping to LedgerTx

| Stream       | `type` / fields                                                                                                                                                                    | `sourceRef` (`source = binance-api`) |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| myTrades     | quote is fiat (INR/USD/EUR/...) → buy/sell, else swap. In/out by `isBuyer`. `priceQuote {asset: quote, price}` as the file importer does (`tradePriceQuote`). Fee from commission. | `trade:<symbol>:<id>`                |
| deposit      | deposit, `txHash = txId`, `chain = network`                                                                                                                                        | `deposit:<id>`                       |
| withdrawal   | withdrawal, fee = `transactionFee` in `coin`, `txHash`, `chain`                                                                                                                    | `withdraw:<id>`                      |
| convert      | swap (fiat on either side → buy/sell)                                                                                                                                              | `convert:<orderId>`                  |
| dust         | swap each detail → BNB                                                                                                                                                             | `dust:<transId>:<detail.transId>`    |
| dividend     | income + incomeKind                                                                                                                                                                | `dividend:<id>`                      |
| fiat order   | deposit/withdrawal of fiat (no tax effect, kept for balance check)                                                                                                                 | `fiat:<orderNo>`                     |
| fiat payment | buy (0) or sell (1); `inrValue` = `sourceAmount` when `fiatCurrency = INR` with `inrRateSource = trade_inr`                                                                        | `fiatpay:<orderNo>`                  |
| P2P          | BUY → buy, SELL → sell; `inrValue = totalPrice` when `fiat = INR`; fee = `commission` in `asset`                                                                                   | `p2p:<orderNumber>`                  |

### 1.6 Read-only key

- "After creating the API key, the default restrictions is `Enable Reading`." (Binance docs). Withdrawals can only be turned on in the UI.
- User steps: Binance → Account → API Management → Create API → "System generated" (HMAC) → name it → leave **only "Enable Reading"** ticked → optionally restrict to the server's IP → copy key and secret (secret is shown once).
- On save and before every sync: call `GET /sapi/v1/account/apiRestrictions`. **Refuse the key** if any of `enableWithdrawals`, `enableSpotAndMarginTrading`, `enableMargin`, `enableFutures`, `enableInternalTransfer`, `permitsUniversalTransfer`, `enableVanillaOptions`, `enablePortfolioMarginTrading`, `enableFixApiTrade` is true. Require `enableReading`.
- The client has a hard-coded allow-list of paths (the table in §1.3 + `/api/v3/time`). Two are POST (`get-funding-asset`, `getUserAsset`); both are USER_DATA reads.

### 1.7 Known gaps

- Dust log: last 100 records, after 2020-12-01 only.
- P2P: last 6 months only. For Indian users P2P is the usual INR on-ramp, so older P2P must come from the file export or manual entry.
- Delisted pairs: not in `exchangeInfo`; `myTrades` may return `-1121`.
- History depth of myTrades, deposits, withdrawals, convert, dividends: not documented.
- Futures, margin, options, Earn subscription/redemption moves, sub-accounts, Binance Pay, gift cards, card spend: out of scope; their effect shows up as a balance mismatch.
- Margin/funding/earn internal transfers are not taxable events; Phase 2 does not fetch `/sapi/v1/asset/transfer`, so balances must be compared as **total across wallets** (spot + funding + earn positions), not per wallet.

---

## 2. CoinDCX

The docs are official (docs.coindcx.com, a single Slate page) but **thin**: no per-endpoint rate limits for reads, no pagination contract beyond `from_id`, no timestamp tolerance, no error body format, no key-permission description.

### 2.1 Base, auth

- Base `https://api.coindcx.com`. Public candles live on `https://public.coindcx.com`.
- "All the Authenticated API calls use POST method. Parameters are to be passed as JSON in the request body."
- Body must contain `timestamp` (ms). Tolerance: "rejected ... if this timestamp deviates too much from the server's time" — the amount is **not documented**.
- `X-AUTH-SIGNATURE = hex(HMAC-SHA256(secret, jsonBody))`, `X-AUTH-APIKEY = key`, `Content-Type: application/json`.
- **Sign the exact bytes you send.** Serialize once (`JSON.stringify`, no spaces — the Python sample uses `separators=(',', ':')`), sign that string, send that string.

Test vector (computed by us with `node:crypto`, not from the docs; secret is fake):

```
secret  test-secret-not-real
body    {"timestamp":1763337600000}
sig     07136e2197650fb56cc542c9dc7d948d268ba545b7e1ce42fecebf8ae37b0e2f
body    {"from_id":0,"limit":500,"sort":"asc","timestamp":1763337600000}
sig     e51d36fbcd01d5069b16f0991e71ceef385f86f0f9a7c7d8573b1a09070f6185
```

### 2.2 Endpoints we use

| Purpose       | Method & path                               | Params                                                                                                                                                                                                                       | Response                                                                                                                                                           |
| ------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trade history | POST `/exchange/v1/orders/trade_history`    | `timestamp` req; `limit` (default 500, **max 500**); `from_id` ("Trade ID after which you want the data"); `sort` asc/desc (default asc); `from_timestamp`, `to_timestamp` (ms; default all history); `symbol` (default all) | array of `{id: int, order_id: string, side: "buy"/"sell", fee_amount: number, ecode: string, quantity: number, price: number, symbol: string, timestamp: int(ms)}` |
| Balances      | POST `/exchange/v1/users/balances`          | `timestamp`                                                                                                                                                                                                                  | array of `{currency, balance: number, locked_balance: number}`                                                                                                     |
| User id       | POST `/exchange/v1/users/info`              | `timestamp`                                                                                                                                                                                                                  | array with `{coindcx_id, first_name, last_name, mobile_number, email}` — **do not store**; call only if needed to show "connected as"                              |
| Markets       | GET `/exchange/v1/markets_details` (public) | —                                                                                                                                                                                                                            | array of `{coindcx_name, base_currency_short_name, target_currency_short_name, symbol, ecode, pair, status, ...}`                                                  |

Pagination: `sort=asc`, `from_id = last id`, `limit=500`, repeat until < 500 rows. Whether `from_id` is exclusive is unclear ("after which"); dedupe on `id` either way.

Splitting `symbol`: use `markets_details`. CoinDCX naming is inverted: **`target_currency_short_name` is the asset traded, `base_currency_short_name` is the quote** (e.g. XTZBTC: target XTZ, base BTC). Delisted markets may be missing from `markets_details`; fall back to `splitPair` with known quotes and add `parse_warning`.

`ecode`: exchange code (`I` = CoinDCX INR market, `B` = Binance-routed market, `KC`, ...). Keep in raw.

Fee asset: **not stated**. Assume quote currency only with a `parse_warning`, as the file importer does when GST is not separated.

### 2.3 Not available via API (surprises)

- **No spot deposit or withdrawal history endpoint.** Only futures-wallet transactions and sub-account transfers exist.
- **No TDS and no GST per trade** in `trade_history`. TDS credit drives `netPayable` and the 26AS check, so the **Excel export remains required** for CoinDCX. API sync is a supplement (quick fresh trades, balance check), never a replacement.
- Rate limits are listed only for order endpoints (e.g. Create Order 2000/60 s, Active Order 300/60 s). Reads are undocumented: use ≤ 1 request/second, back off on 429.
- Errors: generic table only (400, 401 "Your API key is wrong", 404, 429, 500, 503). Body format undocumented; store the text.

### 2.4 "Read-only" on CoinDCX

- Every authenticated call is a POST, including reads. There is no HTTP-method-level way to keep a key read-only, and the official docs say nothing about permission scopes. Third-party guides describe API Dashboard → Create → name → IP-binding → OTP, and say to choose read-only "if offered" — **UNVERIFIED** whether CoinDCX offers it.
- Consequence: a leaked CoinDCX key may be able to trade. Our defence is code: the CoinDCX client only knows the three POST paths above and refuses any other path; the UI tells the user to bind the key to the server IP and to tick read-only if the dashboard offers it.
- No permission-check endpoint exists, so we cannot verify scope like Binance's `apiRestrictions`.

### 2.5 Dedupe against the CoinDCX file

The file importer uses the export's `Trade ID` as `sourceRef`. Whether the API `id` (example `252949810`) is the same number as the export's `Trade ID` is **UNVERIFIED**. Until a real export and API call are compared, use `source = coindcx-api`, `sourceRef = trade:<id>`, and the fingerprint match (§7.2), which treats an equal id as a strong match.

---

## 3. EVM

### 3.1 Etherscan API V2

- Base: `https://api.etherscan.io/v2/api?chainid=<id>&module=...&action=...&apikey=<key>`. One key for all chains. Key in the query string only (no header option documented) → redact URLs in logs.
- Free tier: **3 calls/second, 100,000 calls/day**, "selected chains only". Since **2026-11-03** requests are blocked once the daily cap is reached (free tier has no overage).
- Free-tier chains (supported-chains page): Ethereum (1), Polygon (137), Arbitrum One (42161), Linea (59144), Celo (42220), ... **Paid only: BNB Smart Chain (56), Base (8453), OP Mainnet (10), Avalanche C-Chain (43114).**
  Arbitrum (since 2026-11-01), Linea, Celo, Katana use a **shared community pool** per chain: error "Community Free API limit reached. Resets <time> UTC ...".
- **1,000-records limit**: changelog "Reduced Maximum Records Per Request on the Free API Tier", effective **2026-07-01**: "reduced from 10,000 to 1,000" for txlist, txlistinternal, tokentx, tokennfttx, token1155tx, getlogs, and others.
  The wording does not say whether `page × offset` is capped at 1,000 (the old 10,000 rule was a window over page × offset). Design so it does not matter: always `page=1`.
- `txlistinternal` by **block range** became a PRO endpoint on 2026-07-01. We only use the by-address form.

| action                | Params (all also need `chainid`, `module=account`, `apikey`)             | Result items                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `txlist`              | `address`, `startblock`, `endblock`, `page`, `offset`, `sort` (asc/desc) | `blockNumber, blockHash, timeStamp (s), hash, nonce, transactionIndex, from, to, value (wei), gas, gasPrice (wei, "price paid per unit"), input, methodId, functionName, contractAddress, cumulativeGasUsed, txreceipt_status ("1"/"0"/"" pre-Byzantium), gasUsed, confirmations, isError ("0"/"1")` — all strings |
| `txlistinternal`      | same                                                                     | `blockNumber, timeStamp, hash, from, to, value, contractAddress, input, type (call/create/...), gas, gasUsed, traceId, isError, errCode`                                                                                                                                                                           |
| `tokentx`             | same + optional `contractaddress`                                        | `blockNumber, timeStamp, hash, nonce, blockHash, from, contractAddress, to, value (raw units), tokenName, tokenSymbol, tokenDecimal, statusRep, transactionIndex, gas, gasPrice, gasUsed, cumulativeGasUsed, input ("deprecated"), methodId, functionName, confirmations`. **No `logIndex`.**                      |
| `balance`             | `address`, `tag=latest` (or hex block within last 128)                   | `result`: wei string                                                                                                                                                                                                                                                                                               |
| `balancemulti`        | `address` = comma list, **max 20**, `tag`                                | `[{account, balance}]`                                                                                                                                                                                                                                                                                             |
| `tokenbalance`        | `contractaddress`, `address`, `tag`                                      | `result`: raw units string                                                                                                                                                                                                                                                                                         |
| `addresstokenbalance` | PRO (Standard plan+), 2 calls/s                                          | not usable on free tier                                                                                                                                                                                                                                                                                            |

`statusRep` on tokentx: `"0"` unknown, `"1"` neutral ("does not guarantee safety"), `"2"` unsafe.

Envelope and errors (all with **HTTP 200**):

```json
{"status":"1","message":"OK","result":[...]}
{"status":"0","message":"NOTOK","result":"Max rate limit reached, please use API Key for higher rate limit"}
{"status":"0","message":"NOTOK","result":"Invalid API Key"}
```

Documented `result` strings for `status:"0"`: "Missing or unsupported chainid parameter (required for v2 api), ...", "Invalid API Key", "Too many invalid api key attempts, please try again later" (> 5 in 30 s → IP throttled 30 s), "Max rate limit reached, ...", "Error! Missing Or invalid Action name", "Error! Invalid address format", "Query Timeout occured. Please select a smaller result dataset", "Unexpected err, timeout occurred or server too busy. Please try again later", "Free API access is not supported for this chain. ...", "Community Free API limit reached. Resets ... UTC ...".
Empty history: the docs only say "status 0 can indicate ... a valid request that returned no records". The widely observed shape `{"status":"0","message":"No transactions found","result":[]}` is **not in the current docs**. Rule: `status "0"` **and** `result` is an array → empty page, success. `status "0"` and `result` is a string → error; classify by substring (`rate limit` → back off 1 s and retry; `Timeout` → halve the block range; everything else → fail the stream).

### 3.2 Paging past the cap: block-range walking

Per (address, action):

```
cursor = stored lastBlock ?? 0
loop:
  GET ...&startblock=cursor&endblock=latestSafeBlock&page=1&offset=1000&sort=asc
  rows = result (dedupe by row key, §3.6)
  if rows.length < 1000: done; store cursor = max blockNumber seen
  else if every row has the same blockNumber: stop, flag import_incomplete ("more than 1000 records in one block")
  else: cursor = last row's blockNumber   (same block again: rows of that block may be split across pages)
```

`latestSafeBlock` = current block − 64 (≈ 2 epochs) so re-orgs do not change stored rows; get the current block from `module=proxy&action=eth_blockNumber`. The next sync starts at the stored cursor (overlap of one block is deduped).

Budget for one mainnet address with ~2,000 txs: three streams × ~3 pages ≈ 10 calls. At 3/s and 100k/day this is never the bottleneck.

### 3.3 Blockscout as the second provider

- New unified API: `https://api.blockscout.com/v2/api?chain_id=<id>&module=account&action=txlist&...&apikey=proapi_<key>`
  (note **`chain_id`** with underscore) or path form `https://api.blockscout.com/<id>/api?module=...`. "Same modules and actions" as Etherscan.
- **A key is now required on every tier.** "In previous per-instance routes API keys were optional for the free tier, but they are required for all tiers." Per-instance hosts (`eth.blockscout.com/api`) are deprecated.
- Auth: `apikey` query param **or** `authorization` header (prefer the header).
- Free: **100,000 credits/day, 5 RPS**. Etherscan-style RPC calls cost **20 credits** each regardless of result size → **~5,000 calls/day**. Exhausted credits → requests fail until daily reset.
  Headers: `x-credits-remaining`, `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` (ms).
- Chains: docs say "Free-tier access is available on all supported chains", but the Base page says "**Base API access requires a paid plan**". Treat Base as paid on both providers. OP Mainnet (10) is listed as free on Blockscout and paid on Etherscan. BNB Smart Chain (56) is **not on Blockscout**.
- Blockscout's OpenAPI for `tokentx` also has no `logIndex`. Same row-key rule (§3.6).
- Blockscout v12.0.0 (2026-10-07) is rolling out with breaking changes, mostly in contract/ETH-RPC endpoints, not in `txlist`/`tokentx`. Re-check before shipping.
- REST v2 (`/api/v2/addresses/{a}/transactions` etc., keyset pagination via `next_page_params`, 50 items/page, 30–40 credits for token/internal) exists but costs more and is shaped differently; use the Etherscan-compatible RPC API so one parser serves both.

Provider choice per chain: Ethereum → Etherscan (fallback Blockscout). OP → Blockscout. Base/BSC → needs a paid key; show "not available on free tier".

### 3.4 Gas fee

- Fee (wei) = `gasUsed × gasPrice` from the `txlist` row. Etherscan documents `gasPrice` as "price paid per unit of gas", i.e. the effective price after EIP-1559 (receipt `effectiveGasPrice`). Convert with decimal.js: `÷ 10^18` → ETH.
- Charged only when `from` is one of the user's addresses. Charged **even when `isError = "1"`** (failed tx: no value moved, gas still spent).
- L2s (OP stack, Arbitrum) add L1 data fees not captured by `gasUsed × gasPrice`. Out of scope for mainnet v1; on L2s flag `fee_review_required`.
- Ledger: gas for a pure approve / failed tx → a `fee` row (asset ETH). Gas for a transfer or swap → `feeAsset/feeAmount` on that row. Whether gas is deductible is the existing `feeTreatment` setting.

### 3.5 Classifying a transaction (v1 scope)

Group the three streams by `hash`. Let **U** = the set of the user's addresses on that chain (all own addresses together, so a move between two own addresses nets to zero). For each asset compute net = Σ in to U − Σ out of U:

- native out: `txlist.value` when `from ∈ U` and `isError = "0"`;
- native in: `txlist.value` when `to ∈ U` (and `isError = "0"`), plus `txlistinternal.value` where `to ∈ U` and `isError = "0"`; native out also from internal rows with `from ∈ U`;
- tokens: each `tokentx` row, `+value` if `to ∈ U`, `−value` if `from ∈ U` (both → 0).

Then:

| Pattern (after netting, ignoring gas)                                                                     | Initiator (`txlist.from`) | Ledger                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| nothing                                                                                                   | in U                      | `fee` (approve, failed tx, self-transfer between own addresses)                              |
| one asset negative                                                                                        | in U                      | `withdrawal` (matched later to an exchange deposit or flagged `unmatched_transfer`)          |
| one asset positive                                                                                        | not in U                  | `deposit` (subject to spam rules, §3.7)                                                      |
| one asset positive                                                                                        | in U                      | `deposit` + flag `complex_onchain` (claim, unstake, airdrop claim, bridge-in: not guessable) |
| exactly one asset negative and one positive                                                               | in U                      | `swap` (out = negative, in = positive), fee = gas                                            |
| anything else (≥ 2 out or ≥ 2 in, NFTs, value in a tx not sent by U that also takes tokens out of U, ...) | any                       | one `unknown_type` row holding all legs in `raw`, flag `complex_onchain`                     |

Notes:

- ETH → WETH (or back) is structurally a simple swap. Whether wrapping is a taxable transfer is a CA question; default: treat as swap, add `complex_onchain` note "wrap/unwrap" when the contract is WETH (`0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`).
- Inbound value in a tx not sent by U where U also loses tokens = someone used an allowance (e.g. a permit/transferFrom drain, or a DEX aggregator relayer). Flag, never swap.
- A swap's INR value comes from prices (§4); there is no trade price on chain.

### 3.6 Row keys (sourceRef) for EVM

`source = evm:<chainId>`. The sourceRef must be the same from Etherscan and Blockscout, so it cannot use `logIndex` (absent on both) or provider ids.

- One ledger row per **(hash, classification leg)**: `sourceRef = <hash lowercase>` for a single-row tx; `<hash>:fee` for a separate gas row; `<hash>:<n>` only if a tx ever needs several rows.
- Raw rows (rule 6) are stored per provider row with key `tx:<hash>`, `int:<hash>:<traceId>`, `erc20:<hash>:<contract>:<from>:<to>:<value>#<ordinal>` where ordinal counts identical tuples in that tx (same idea as `sourceReferences()` in `packages/importers/src/values.ts`).

### 3.7 Spam and address poisoning

Treat as `suspected_spam` (proposed new review code) and **exclude from the engine by default**, never income:

- inbound token where `statusRep = "2"`;
- inbound token transfer with `value = "0"` (address-poisoning pattern);
- inbound token, tx not sent by U, contract not in the known-token map and not resolvable to a CoinGecko id (§4.3);
- token symbol equal to a known symbol (USDT, USDC, ETH, ...) but contract not the known contract (lookalike).

Asset ids: known contracts (small JSON map per chain in `packages/evm`, e.g. USDT `0xdac17f958d2ee523a2206206994597c13d831ec7`, USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`, WETH, DAI, WBTC) get the plain symbol so they share lots with exchange balances. Every other token gets `ERC20:<chainId>:<CONTRACT UPPERCASE WITHOUT 0x>` (fits `AssetSchema` `^[A-Z0-9][A-Z0-9._:-]*$`) and keeps its `tokenSymbol` in raw. This stops a fake "USDT" from merging with real USDT lots. The user can map a contract to a symbol in the UI.

### 3.8 Current balances for the balance check (no indexer)

- ETH: `balancemulti` (≤ 20 addresses per call) or `balance`, `tag=latest`.
- ERC-20: `tokenbalance` for every contract that appears in that address's `tokentx` history (1 call each), excluding `suspected_spam`.
- Compare with computed holdings at the same block: compute ledger holdings up to `latestSafeBlock`'s timestamp, and query balances at `tag=latest` only if no new tx touched U since that block (re-check `txlist` from the cursor); otherwise sync again first. Mismatch → `balance_mismatch` (existing).

### 3.9 viem: not needed

Everything above is HTTP GET + JSON with string integers. What we would otherwise use viem for:

- wei/units → `decimal.js` `div(10^decimals)` (and the precision rule forbids `number`/`bigint` formatting helpers anyway);
- address checks → lowercase + `/^0x[0-9a-f]{40}$/`; we never need EIP-55 checksums for matching;
- `balanceOf` via JSON-RPC (if ever needed) → `data = "0x70a08231" + address.slice(2).padStart(64,"0")`, one line.

Recommendation: **own adapter** (`EvmProvider` interface with `txlist`, `txlistinternal`, `tokentx`, `balance`, `tokenbalance`, `blockNumber`; two implementations differing in base URL, chain param name and auth). ~200 lines, zero dependencies. Revisit viem only if we start decoding calldata/logs ourselves (Phase 3+ DeFi), which v1 explicitly sends to review.

---

## 4. Prices

### 4.1 CoinGecko Demo

- Root `https://api.coingecko.com/api/v3/`. Key header **`x-cg-demo-api-key`** (or query `x_cg_demo_api_key`; avoid, it leaks into logs). A Pro key on this root fails with `10010/10011`.
- Rate: **Demo 100 calls/min**; keyless use is allowed with IP-based shared limits. All requests count, including 4xx/5xx. Each HTTP 200 uses 1 credit of the monthly quota (quota size per plan page, not checked).
- **Historical data on Demo: past 365 days only** (both endpoints below). Full range needs Analyst plan.
- `GET /coins/{id}/history?date=dd-mm-yyyy&localization=false` → snapshot at **00:00:00 UTC** of that date. Price at `market_data.current_price.<vs>` (e.g. `inr`, `usd`). Last completed UTC day available after 00:50 UTC next day. Values "may be revised for up to 2 days".
- `GET /coins/{id}/market_chart/range?vs_currency=inr&from=YYYY-MM-DD&to=YYYY-MM-DD&interval=daily&precision=full` → `{prices: [[ms, number]], market_caps, total_volumes}`. Auto granularity: > 90 days → daily (00:00 UTC). `interval=hourly` allows any 100 days per request. Prices are JSON numbers → parse with the source-text reviver.
- ID mapping: `GET /coins/list?include_platform=true` (one call, full list, `[{id, symbol, name, platforms: {ethereum: "0x..."}}]`); `GET /coins/{platform}/contract/{address}` (e.g. platform `ethereum`). Symbols collide (many coins share a symbol): map exchange tickers through a small curated table (BTC→bitcoin, ETH→ethereum, USDT→tether, ...), EVM tokens by contract; anything ambiguous → ask the user, never pick the first match.
- Errors: 401 missing/invalid key, 429, `10002` missing key, `10005` plan restricted (e.g. > 365 days), `10010/10011` wrong key type for root URL, `10014` invalid parameter; `1020` CDN block.

### 4.2 Second source: Binance public klines (recommended)

`GET https://data-api.binance.vision/api/v3/klines` (no key, weight 2; `api.binance.com` also works).

| Param       | Value                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------- |
| `symbol`    | `<COIN>USDT` (e.g. BTCUSDT). Fall back to `<COIN>BTC` × BTCUSDT for coins with no USDT pair. |
| `interval`  | `1d`                                                                                         |
| `startTime` | ms; returns candles whose open time ≥ startTime                                              |
| `endTime`   | ms                                                                                           |
| `timeZone`  | **`5:30`** → candles aligned to IST midnight. `startTime`/`endTime` are still UTC.           |
| `limit`     | default 500, **max 1000** (≈ 2.7 years of daily candles per call)                            |

Response: arrays `[openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, "0"]`; prices are **strings**.

Checked live on 2026-11-17:

- BTCUSDT and ETHUSDT first daily candle: open time `1502928000000` = **2017-08-17 00:00 UTC**.
- `timeZone=5:30`, startTime 2025-01-01T00:00Z → first candle opens `1735756200000` = 2025-01-01T18:30Z = **2025-01-02 00:00 IST**. Works.
- No INR pairs (`USDTINR` → `-1121 Invalid symbol`). INR comes from USD/INR (SBI TT, `packages/rates`) per the `usdtInrRate` setting.
- **Ticker reuse**: `LUNAUSDT` returns current data for the post-2022 LUNA; the original LUNA trades as LUNC. A ticker is not a stable identity over time. Keep a small rename table (LUNA→LUNC before 2022-05-28, etc.) and flag prices for renamed tickers.
- Delisted pairs → `-1121`, no history. Fall back to CoinGecko (≤ 365 days) or manual.

Alternatives:

- **CryptoCompare / CoinDesk Data**: several (third-party) sources report the free tier was retired on 2026-05-21 and keyless calls now get 401; one source still describes a free personal plan. Not checked against CoinDesk's own pages. Do not plan on it.
- Binance bulk files on `data.binance.vision` (daily CSV zips) are an offline option for very large backfills; not needed.

### 4.3 Valuation order (SPEC §4 step 3)

For each taxable leg, first hit wins; record `inrRateSource`, the price source, the date basis and the rate date.

1. Trade's own INR value (`trade_inr`): CoinDCX INR pairs, P2P/fiat payments in INR.
2. Trade's own USDT/USDC price × USD/INR per `usdtInrRate` (`trade_usdt_x_usd_inr`).
3. Crypto-to-crypto trade with no stable leg: value the **outgoing** asset from the cache (step 4), since it is the consideration; the incoming asset's cost = same value (SPEC: swap is sell A at V, buy B with cost V).
4. Price cache (`market_price_cache`): Binance kline close for `<COIN>USDT` (IST day of the event) × USD/INR for that date.
5. CoinGecko `inr` price for the date (only ≤ 365 days back on Demo).
6. Nothing → `missing_inr_value`. Never assume a stablecoin is exactly 1 USD without saying so; USDT itself is valued by the existing `usdtInrRate` setting.

The engine stays pure: a pre-compute step outside `packages/engine` lists every (asset, date) the engine will need, fills the cache, then passes a pure `priceLookup(asset, date) → {price, quote, source, date} | null` alongside `fx`.

### 4.4 Cache key and which daily price

Proposed `price_cache` (the current table's key `(asset, date, quote)` has no source and no day basis; change it):

```
price_cache(
  source      TEXT  -- "binance_klines" | "coingecko"
  source_id   TEXT  -- "BTCUSDT" | "bitcoin" | "ethereum:0xa0b8..." (provider's own id, not our ticker)
  quote       TEXT  -- "USDT" | "INR" | "USD"
  day_basis   TEXT  -- "IST" | "UTC"
  date        TEXT  -- YYYY-MM-DD in day_basis
  kind        TEXT  -- "close" | "snapshot_00utc"
  price       TEXT  -- decimal string from source text
  final       INT   -- 0 until the day is ≥ 3 days old (CoinGecko revises up to 2 days; today's kline is still open)
  fetched_at  TEXT
  PRIMARY KEY (source, source_id, quote, day_basis, date, kind)
)
```

Plus an `asset_price_ids(asset, chain?, source, source_id)` table so our ledger asset maps explicitly to a provider id.

- **Date basis: IST.** The tax year and the user's mental model are IST; Binance klines can be IST-aligned, so the "price on 1 April" is the IST day. CoinGecko only offers 00:00 UTC (= 05:30 IST) snapshots; store them as `day_basis = UTC`, `kind = snapshot_00utc`, and say so on the report.
- **Which price: default IST-day close.** Alternatives: the day's open, a (high+low)/2 or VWAP average (`quoteVolume / volume` from the same kline), or the 1-hour candle containing the event (more precise; one extra call per event, data back to 2017). This is a **CA question**; make it a setting (`marketPriceBasis: close | vwap | hourly_close`) printed on the report.

---

## 5. Secrets at rest (node:crypto only)

Stored secrets: Binance key+secret, CoinDCX key+secret, Etherscan / Blockscout / CoinGecko keys, optional AI key (already a setting).

Design:

- User sets a **vault passphrase** (min 12 chars) the first time they save any secret.
- KDF: `scryptSync(passphrase.normalize("NFC"), salt, 32, { N: 2**17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })`. N=2^17 takes ≈ 250 ms on this machine (2^15: ≈ 63 ms). **`maxmem` must be raised**: the default (32 MiB) rejects N=2^17 with "memory limit exceeded" (checked). Use the async `scrypt` so the event loop is not blocked.
- Salt: 16 random bytes per vault, stored with the params: `secrets_vault {v:1, kdf:"scrypt", N, r, p, salt, check}`.
- `check` = AES-GCM encryption of a fixed string; decrypting it verifies the passphrase without touching real secrets.
- Each secret: fresh 12-byte random IV, AES-256-GCM, 16-byte tag, **AAD = `"tax-tracker:v1:" + secretId + ":" + kind`** so a ciphertext copied into another row fails to decrypt. Store `{v, iv, ct, tag}` base64 in a `secrets` table, never in `settings` JSON that the API returns.
- Change passphrase = decrypt all, re-encrypt with new salt, in one DB transaction.
- Unlock: `POST /api/secrets/unlock {passphrase}` keeps the derived key in process memory with an idle timeout (e.g. 30 min) and drops it on logout/restart. Sync jobs run only while unlocked, or the user types the passphrase when starting a sync. For unattended Docker use, an optional `SECRETS_PASSPHRASE` env var, documented as weaker (anyone who can read the container env can decrypt).
- **Forgotten passphrase**: secrets are unrecoverable by design. UI offers "Reset vault": deletes all stored keys; the user creates new read-only keys at the exchange. Ledger, imports and reports are unaffected (they are not encrypted).
- Never log: API keys, secrets, signatures, signed URLs, request bodies to CoinDCX, `X-MBX-APIKEY` / `X-AUTH-*` / `x-cg-demo-api-key` / `authorization` headers. Etherscan and Blockscout keys travel in the URL: the HTTP wrapper logs `URL.origin + pathname` only. Error objects returned to the UI are built from status + vendor error code/message, never from the request. API responses return `{binanceKeySet: true}`-style booleans, like `apiKeySet` today.
- Keys are zeroed from buffers after use where practical (`buffer.fill(0)`); JS strings cannot be wiped, so keep secrets in Buffers inside the vault module.

Threat model (short):

| Threat                                                                                     | Covered?                                                                                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `.db` file copied, backed up to cloud, or shared for debugging                             | Yes: secrets need the passphrase; scrypt slows guessing.                                                        |
| Someone with UI access while the vault is unlocked                                         | Partly: they can run a sync but never read keys back (API never returns them). Use `APP_PASSWORD`.              |
| Malware / root on the host while unlocked, or a malicious dependency in the server process | No. Mitigated by read-only keys (Binance verified via `apiRestrictions`), IP-bound keys, and the pnpm cooldown. |
| Weak passphrase                                                                            | Partly: length rule; scrypt cost.                                                                               |
| CoinDCX key with trade rights leaked                                                       | Not preventable by us (§2.4); client path allow-list limits our own code only.                                  |

---

## 6. Mock-server notes

A mock per vendor that reproduces these is enough to test every client path. "Same as docs" = shapes in `phase2-samples/`.

### 6.1 Binance

- Verify `X-MBX-APIKEY` and the HMAC over the **raw query string as received** (before `&signature=`) + body. Wrong → HTTP 400 `{"code":-1022,"msg":"Signature for this request is not valid."}`. Unknown key → HTTP 401 `{"code":-2015,"msg":"Invalid API-key, IP, or permissions for action."}`. Malformed key → `-2014`.
- Timestamp: mock server time adjustable; `timestamp > now + 1000` or `now − timestamp > recvWindow` (default 5000, max 60000; `recvWindow > 60000` → 400 error) → HTTP 400 `{"code":-1021,"msg":"Timestamp for this request is outside of the recvWindow."}`. Provide `GET /api/v3/time`.
- Weight: send `X-MBX-USED-WEIGHT-1M` / `X-SAPI-USED-IP-WEIGHT-1M`; a switch to return 429 with `Retry-After: 2` and `{"code":-1003,"msg":"Too much request weight used; ..."}`; after N ignored 429s return 418 with `Retry-After`.
- myTrades: `symbol` missing → 400 `-1102`; unknown/delisted symbol → `-1121 Invalid symbol.`; `fromId` ≥ semantics; exactly 1000 rows then a short page; empty array for a symbol with no trades; start–end > 24 h → 400 error (code and text not documented; the mock may use any `{code, msg}` and the client must surface it, not retry).
- deposit/withdraw: window ≥ 90 days → 400 error (text undocumented); default window 90 days when no times; `offset`/`limit` paging with a page of exactly 1000; mixed statuses (pending 0 and success 1; withdraw 4 and 6); withdraw row without `network`; `completeTime` absent on old deposits.
- convert: `moreData: true` on a full page; window > 30 days → error; `orderStatus` other than SUCCESS.
- dribblet: `total` > returned rows (100-cap); empty `{"total":0,"userAssetDribblets":[]}`.
- assetDividend: window > 180 days → error; `limit` 500 cap; empty `{"rows":[],"total":0}`.
- fiat/c2c: envelope `{"code":"000000","message":"success","data":[...],"total":n,"success":true}`; the **empty case without `data`**; c2c window > 30 days → error; `rows` > 100.
- simple-earn: window > 30 days → `-6021` "Query time range too large".
- apiRestrictions: one fixture read-only, one with `enableSpotAndMarginTrading: true` (client must refuse).
- klines (public): 1000-row cap, `timeZone=5:30` alignment, `-1121` for an unknown symbol, string prices.

### 6.2 CoinDCX

- Verify `X-AUTH-APIKEY` and `X-AUTH-SIGNATURE` = HMAC-SHA256 hex of the **raw body bytes**. Wrong → HTTP 401 (body text undocumented; use `{"code":401,"message":"Invalid credentials","status":"error"}` and mark it as invented).
- Missing/stale `timestamp` (choose a tolerance, e.g. 10 s, and make it configurable since the real one is unknown) → 4xx.
- trade_history: `limit` > 500 → clamp or 400; `from_id` paging with a full page of 500 then a short page; empty `[]`; numbers as JSON numbers with ≥ 17 significant digits (to prove the client keeps digits); a symbol missing from `markets_details`.
- balances: JSON numbers; zero and locked balances.
- 429 with no documented headers.

### 6.3 Etherscan / Blockscout

- Always HTTP 200. Success `{"status":"1","message":"OK","result":[...]}`.
- Empty: `{"status":"0","message":"No transactions found","result":[]}`.
- **Rate limit with HTTP 200**: `{"status":"0","message":"NOTOK","result":"Max rate limit reached, please use API Key for higher rate limit"}` when > 3 calls in a second (5 for Blockscout).
- Invalid key `"Invalid API Key"`; after 5 bad keys in 30 s `"Too many invalid api key attempts, please try again later"`.
- Missing `chainid` (Etherscan) / `chain_id` (Blockscout) → missing-chain message; unsupported free chain (8453) → "Free API access is not supported for this chain...".
- Paging: return at most 1000 rows for `offset=1000`; respect `startblock`/`endblock`; fixture with > 1000 rows where a block is split across pages; fixture where 1000+ rows share a block (client must flag, not loop forever).
- `"Query Timeout occured. Please select a smaller result dataset"` for a configured large range.
- A failed tx (`isError "1"`) with gas; a tx with internal ETH in; a two-token swap; an approve; a zero-value poisoning transfer; a `statusRep "2"` token; a lookalike "USDT" contract; a withdrawal from a Binance hot wallet whose `hash` equals a fixture Binance withdrawal `txId`.
- Blockscout: headers `x-credits-remaining` decreasing by 20 per call; exhausted → error (shape undocumented).

### 6.4 CoinGecko

- Header `x-cg-demo-api-key`; missing → 401 `10002`; Pro root mismatch → `10011`.
- `date` older than 365 days → error `10005` (plan restricted; exact body undocumented: `{"error_code":10005, ...}` mark as invented).
- 429 after 100 calls/min.
- `market_chart/range` daily points at 00:00 UTC, float prices with long fractions.
- `/coins/list?include_platform=true` with two coins sharing a symbol.

---

## 7. Recommended architecture

### 7.1 Modules

```
packages/sync            pure-ish clients + mappers (I/O allowed, no DB)
  src/http.ts            fetch wrapper: timeouts, retry/backoff, Retry-After, redacted logging, JSON-with-source-text parse
  src/binance/{client,sign,streams,map}.ts
  src/coindcx/{client,sign,map}.ts
packages/evm             provider adapter (etherscan, blockscout), block walker, classifier (§3.5), known-token map
packages/prices          klines + coingecko clients, id map, cache fill planner; exports pure priceLookup factory
packages/vault           scrypt/AES-GCM secret store (node:crypto only)
packages/db              new tables: connections, sync_cursors, secrets, price_cache (reshaped), asset_price_ids
apps/web                 /api/connections, /api/secrets, sync jobs in the existing job runner
```

Mappers are pure functions `rawApiRow → LedgerTx`, unit-tested with the sample payloads, so the vendor-specific code that touches tax numbers is testable without HTTP.

### 7.2 Source, sourceRef and cross-channel dedupe

Facts from `packages/importers`:

- Binance file trades and wallet rows: the exports have **no trade id**, so `sourceRef = sha256(canonical(raw))#<ordinal>`; the wallet importer does not use `TXID` as the ref either.
- CoinDCX file: `sourceRef = Trade ID` / `Transaction ID`.
- DB: unique `(source, source_ref)`.

So reusing `source = "binance"` for API rows would **not** dedupe (hash vs numeric id) and would make the hash-ordinal scheme fragile. Recommendation:

1. Separate sources: `binance-api`, `coindcx-api`, `evm:<chainId>`. Within a channel, the unique index makes re-syncs idempotent (rule 7).
2. Every row from any channel gets an **event fingerprint** (new indexed column, computed by a pure function in `@tax/core`):
   - trade: `trade|<venue>|<UTC second>|<base>|<quote>|<side>|<qty normalised>|<quote qty normalised>`
   - deposit/withdrawal: `move|<venue>|<asset>|<amount>|<txHash lowercase>` when a hash exists, else `move|<venue>|<asset>|<amount>|<UTC minute>`
   - `<venue>` is `binance` for both `binance` and `binance-api`.
3. On insert of an API row: if a row from the sibling channel has the same fingerprint, do not insert a second ledger row; store the API raw row linked to the existing ledger row (`raw_rows` keeps it; rule 6) and count it as a duplicate in the sync summary. Match as a **multiset**: two identical file rows (`#0`, `#1`) consume two API fills, a third API fill is inserted.
4. Partial matches (same second, asset, side but amounts differ in the last digit; or one file row vs several API fills that sum to it — Binance exports may aggregate fills, **UNVERIFIED**) → insert and flag `possible_duplicate` for the user to resolve. Never auto-delete.
5. Whichever channel arrived first owns the ledger row. Deleting that import releases linked raw rows from the other channel; the next sync re-inserts them.

Engine change (small, pure): in transfer matching, try **exact `txHash` equality** (case-insensitive, `0x` optional) between a withdrawal and a deposit before the window/amount heuristic. Binance withdrawal `txId` ↔ EVM `hash`, EVM `hash` ↔ Binance deposit `txId`. This makes exchange ↔ own-wallet matching certain and keeps amount tolerance for the fee check only. Current `matchTransfers` also requires `deposit.source !== withdrawal.source`, which is why own-address ↔ own-address moves must be netted inside the EVM classifier (§3.5) rather than emitted as a withdrawal/deposit pair under the same `evm:1` source.

### 7.3 Incremental sync cursors

`sync_cursors(connection_id, stream, cursor_json, updated_at)`; `stream` examples: `binance:myTrades:BTCUSDT`, `binance:deposits`, `evm:1:0xabc:tokentx`.

| Stream                                         | Cursor                                              | Re-query overlap                                                           |
| ---------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| Binance myTrades per symbol                    | last trade `id`                                     | none (ids are final)                                                       |
| Binance deposits/withdrawals                   | end of last fully processed window                  | 7 days back, and never past the oldest still-pending row (status 0/4) seen |
| Binance convert / dividend / fiat / c2c / earn | end of last window                                  | 3 days                                                                     |
| Binance dust                                   | none: always fetch the 100 latest; dedupe           | —                                                                          |
| CoinDCX trades                                 | last `id`                                           | none                                                                       |
| EVM per address per action                     | last block ≤ `latestSafeBlock`                      | the cursor block itself                                                    |
| Prices                                         | none: cache rows with `final=1` are never refetched | non-final rows refetched                                                   |

A sync run is recorded like an import (reuse `imports` with a `kind: "file" | "api_sync"` column, `file_name` = "Binance API sync 2026-11-17 10:02"), so the existing delete-import flow works. Deleting a sync import also resets that connection's cursors.

Balance check after each sync: Binance spot `account` + funding (`get-funding-asset`) + Earn positions; CoinDCX `users/balances`; EVM §3.8. Feed into `actual_balances` as a **separate, labelled** source (`actual` typed by the user stays authoritative), compare at sync time, raise `balance_mismatch` with the asset and difference.

### 7.4 Flags to raise

| Situation                                                                                            | Code                                                              |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Sell/swap with no prior lots (e.g. delisted pair never fetched)                                      | `missing_history` (engine, existing)                              |
| No price from trade, cache or CoinGecko                                                              | `missing_inr_value`                                               |
| Unknown `enInfo` / Earn type / CoinDCX `ecode` or fee asset unknown                                  | `unknown_type` / `parse_warning`                                  |
| Withdrawal/deposit with no counterpart (hash or window)                                              | `unmatched_transfer`; several candidates → `ambiguous_transfer`   |
| Binance sell (platform TDS not deducted)                                                             | `tds_not_deducted` (existing rule)                                |
| Computed ≠ fetched balance                                                                           | `balance_mismatch`                                                |
| Stream cut short (1000 rows in one block, 418 ban, window error, P2P > 6 months, dust > 100 records) | `import_incomplete`                                               |
| Anything outside v1 EVM patterns; WETH wrap; L2 fees                                                 | `complex_onchain` / `fee_review_required`                         |
| Price from a renamed ticker or a CoinGecko UTC snapshot used for an IST date                         | `parse_warning` with the source named                             |
| **Proposed**: spam/poisoning token                                                                   | `suspected_spam` (excluded from engine until the user accepts it) |
| **Proposed**: file vs API near-duplicate                                                             | `possible_duplicate`                                              |

---

## 8. Surprises and changes found

1. **CoinDCX API has no deposit/withdrawal history and no TDS/GST per trade.** File import stays mandatory for CoinDCX.
2. **Etherscan free tier**: 1,000 records/request since 2026-07-01; daily cap (100k) hard-blocks since 2026-11-03; Base, OP, BSC, Avalanche are paid-only; Arbitrum/Linea/Celo use a shared community pool that can run dry for everyone.
3. **Blockscout per-instance keyless API is deprecated**; the unified API needs a key on every tier (free = 100k credits/day ≈ 5,000 calls). Its own docs contradict each other on Base (free "all chains" vs "Base requires a paid plan"). No BNB Smart Chain.
4. **Neither Etherscan nor Blockscout documents `logIndex` on `tokentx`**, so token-transfer row keys need an ordinal scheme.
5. **Binance P2P API only covers 6 months; dust log only 100 records after 2020-12-01.**
6. Binance now recommends **Ed25519** keys over HMAC.
7. Binance weights changed over time and pages disagree: Convert history is UID 3000 (not 100); fiat orders is UID 90000 per changelog vs 45000 on the legacy page.
8. **CoinGecko Demo** is now 100 calls/min (was 30) and a keyless tier exists; 365-day history cap still applies.
9. **Binance klines accept `timeZone=5:30`**, giving IST-aligned daily candles from 2017-08-17. No INR pairs. Tickers get reused (LUNA).
10. **CryptoCompare/CoinDesk free tier reportedly retired 2026-05-21** (third-party reports).
11. CoinDCX and CoinGecko send amounts as JSON floats; Node 24's `JSON.parse` reviver `context.source` keeps the original digits (checked).
12. Default scrypt `maxmem` rejects N=2^17; must be raised.

## 9. Open questions

For the user / to verify with a real account:

1. Is the CoinDCX API trade `id` the same number as the Excel `Trade ID`? (Decides whether CoinDCX can dedupe by id.)
2. Does the Binance trade-history export have one row per fill (like `myTrades`) or per order? (Decides whether fingerprint matching is 1:1.)
3. Does Binance withdrawal `amount` exclude `transactionFee`? Does dust `transferedAmount` exclude `serviceChargeAmount`?
4. Do Simple Earn rewards also appear in `assetDividend`? (Double-count risk.)
5. How far back do `myTrades`, deposit/withdraw, convert and dividend history really go for an account opened in 2017–2019?
6. Does the CoinDCX API dashboard offer a read-only scope today?
7. Which EVM chains beyond Ethereum matter? Base/BSC need a paid Etherscan/Blockscout key.
8. Is a vault passphrase acceptable UX, or is an env-var key for Docker the default?

For a CA:

1. Market price basis for income FMV and for valuing crypto-to-crypto swaps with no stable leg: IST-day close, day VWAP, or price at the hour of the event? Is a USDT price × SBI TT USD/INR acceptable as "INR value"?
2. Is ETH ↔ WETH wrapping a transfer (taxable swap) or a non-event?
3. Are unsolicited airdrops / spam tokens income on receipt, or nothing until sold (cost zero)? Default here: excluded until the user accepts them, then treated per `incomeCostBasis`.
4. Are on-chain gas fees part of cost of acquisition when buying via a DEX swap? (Today `feeTreatment=exclude`.)
5. Is P2P USDT bought with INR a "buy" at the INR price paid (cost = INR paid)? Assumed yes.
