# mock-sync

One zero-dependency Node 24 server that stands in for every upstream the Phase 2 sync talks to:
Binance spot + wallet (`api.binance.com`), Binance public market data
(`data-api.binance.vision`), CoinDCX (`api.coindcx.com`), Etherscan V2, Blockscout's
Etherscan-compatible API and CoinGecko Demo. Built on `node:http`, `node:crypto` and `node:url`
only, so there is nothing to install.

It enforces the parts of each API that clients get wrong: Binance HMAC signatures over the query
string, `recvWindow`/timestamp checks, CoinDCX HMAC over the raw JSON body, Etherscan's
1,000-row cap and block walking, CoinGecko's 365-day history limit. The data is one coherent
fixture user, so a sync can be tested end to end and the reported balances can be compared with
what the ledger implies.

## Run it

```sh
node tools/mock-sync/server.mjs              # MOCK_SYNC_PORT or 11601
node tools/mock-sync/server.mjs --port 11700
```

It listens on `0.0.0.0`. On start it prints the six base URLs to paste into the app:

```sh
BINANCE_API_BASE=http://127.0.0.1:11601/binance
BINANCE_DATA_BASE=http://127.0.0.1:11601/binance-data
COINDCX_API_BASE=http://127.0.0.1:11601/coindcx
ETHERSCAN_API_BASE=http://127.0.0.1:11601/etherscan
BLOCKSCOUT_API_BASE=http://127.0.0.1:11601/blockscout
COINGECKO_API_BASE=http://127.0.0.1:11601/coingecko/api/v3
```

Inside Docker Compose use `host.docker.internal` instead of `127.0.0.1` (add
`extra_hosts: ["host.docker.internal:host-gateway"]` on Linux).

### From a test

```js
import { startMockSync } from "../tools/mock-sync/server.mjs";

const mock = await startMockSync({ port: 0 }); // port 0 = a free port
// mock.url → "http://127.0.0.1:<port>"
await mock.close();
```

`startMockSync` resets the scenario, the pinned clock and the request log by default; pass
`{ reset: false }` to keep them.

### Check the fixture

```sh
node tools/mock-sync/check-fixture.mjs
```

It starts the server on a free port, replays every fixture event with its own BigInt arithmetic,
fetches `/api/v3/account`, `get-funding-asset`, `getUserAsset`, CoinDCX balances and the Etherscan
balance/tokenbalance endpoints, asserts the hash links and the kline coverage, and exits non-zero
with a list of differences. It paces Etherscan calls at 3/s like the real client.

## Credentials

| Upstream   | Credential                                                         |
| ---------- | ------------------------------------------------------------------ |
| Binance    | key `mock-binance-key`, secret `mock-binance-secret` (HMAC-SHA256) |
| CoinDCX    | key `mock-dcx-key`, secret `mock-dcx-secret` (HMAC over the body)  |
| Etherscan  | `apikey=mock-etherscan-key`                                        |
| Blockscout | `apikey=mock-blockscout-key`                                       |
| CoinGecko  | header `x-cg-demo-api-key: mock-coingecko-key`                     |

An unknown Binance key is `401 {"code":-2015,...}` (a key shorter than 8 characters is
`-2014`); a wrong signature is `400 {"code":-1022,...}`. CoinDCX answers `401` with
`{"code":401,"message":"Invalid credentials","status":"error"}` — that body is invented, the real
one is undocumented.

## Fixture user

All dates fall in FY 2025-26. The story, in order:

| When (UTC)              | Event                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-04-08              | P2P buy of 5,000 USDT for ₹4,42,500 (₹88.50/USDT). Lands in the **funding** wallet; 4,990 USDT is then moved to spot with an internal transfer. |
| 2025-04-15              | Buy 1.8 ETH on `ETHUSDT` in three fills: fees 0.0008 ETH, 1.75973 USDT, 0.751425 USDT.                                                          |
| 2025-05-02              | Withdraw 0.5 ETH to wallet A, fee 0.0018 ETH, so 0.4982 ETH arrives on chain.                                                                   |
| 2025-06-10              | Wallet A swaps 0.2 ETH for 480 USDC in one transaction (gas 0.001420824 ETH).                                                                   |
| 2025-06-20              | Asset dividend: 0.06 BNB ("BNB Vault rewards").                                                                                                 |
| 2025-07-30              | Wallet B is funded with 0.01 ETH from an outside address (gas money).                                                                           |
| 2025-08-14              | Wallet A sends 300 USDC to wallet B (gas 0.000358463 ETH, paid by A).                                                                           |
| 2025-09-03              | Wallet A receives 50,000 lookalike "USDT" from a fake contract — spam.                                                                          |
| 2025-10-01              | Deposit 2.1 XRP to Binance from an outside exchange.                                                                                            |
| 2025-10-07              | Wallet A's swap fails (`isError=1`): gas 0.000345708 ETH, no value moved.                                                                       |
| 2025-11-05              | Dust conversion: 2.1 XRP → 0.000132 BNB (net of 0.0000027 BNB service charge).                                                                  |
| 2025-11-19              | Wallet A approves USDC: gas 0.0003003065 ETH, nothing else moves.                                                                               |
| 2025-11-28              | Convert 25 USDT → 24.98 USDC.                                                                                                                   |
| 2025-12-01              | Simple Earn reward: 0.42 USDT (credited to spot).                                                                                               |
| 2025-12-12              | Wallet B sends 120 USDC to the user's Binance deposit address.                                                                                  |
| 2026-01-20              | Sell 0.6 ETH for 1,776.60 USDT in two fills, fees 0.000078 BNB.                                                                                 |
| 2025-05-20 … 2025-11-03 | CoinDCX: four BTCINR/ETHINR trades (see `COINDCX_TRADES`).                                                                                      |

One Binance withdrawal (`100 USDT`, status `4`, processing) and one USDC deposit (status `0`,
pending) are in the histories on purpose: both are visible to the client and neither moves a
balance.

### Addresses

| Name                                             | Address                                      |
| ------------------------------------------------ | -------------------------------------------- |
| Wallet A                                         | `0x5a17c9e3b4d28f6019ca7b3e5d8f2a4c6b1e9d70` |
| Wallet B                                         | `0x9c4e2a7d1f83b650e4d9a2c5f7b1e8d3a6c0b459` |
| Binance deposit address                          | `0x3d7b4e2a9c1f0586b3e7a2d9c4f6018e5b2a7c43` |
| Binance hot wallet (withdrawal source)           | `0xb71f3c8d92a45e6017ca9b3d5f8e2a4c60d1b9e7` |
| External funder (wallet B's gas)                 | `0x2b5f8e1c9d3a70465fe2b9c4d7a10f836c5e29b4` |
| DEX router                                       | `0x7c2e9a4b6d1f8350a2c7e4b9d6f1038a5c2b7e40` |
| Spam sender                                      | `0x6f1d3b8e5a2c9074d6e3b1a8c5f2047d9b6e3a1c` |
| Spam token (lookalike "USDT", symbol USDT, 6 dp) | `0xdeadbeefcafebabe00112233445566778899aabb` |
| Big-history spam token (lookalike "USDC", 6 dp)  | `0xfacade000000000000000000000000000000c0de` |
| USDC (real mainnet contract)                     | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` |
| USDT (real mainnet contract)                     | `0xdac17f958d2ee523a2206206994597c13d831ec7` |

All of them, hashes included, are invented; hashes are `sha256("tax-tracker/mock-sync/<label>")`.

### Hashes that must match

| Link                                                   | Hash                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| Binance withdrawal `txId` = wallet A's incoming ETH tx | `0x54384b38e97e03d44bc1158616ccd431c3db3bdadd7f69c7f0066a948f1a529d` |
| Wallet B's outgoing USDC tx = Binance deposit `txId`   | `0xce63aebf5339e600280ac09344f3337e6506e3387a2d7b53e69d3923ff07645c` |
| Wallet A → wallet B USDC                               | `0xc9b4a25df76a3251030f5c50ca3888b61e011432319d8c984897d8289cc7295e` |
| Wallet A ETH → USDC swap                               | `0xde70126bef21b4af3f2c56263037c6ea64651fd39150c9018f728ff064d1b31d` |
| Spam transfer into wallet A                            | `0x49ee4f71773ace339a85a076743a985ac3cd74061492ab43abde3bb14e7e162f` |
| Failed swap (gas only)                                 | `0x4250c7dd03dd53cad203886c33e225ed55fc198e8a062899afab1ebf27b61d6a` |
| USDC approve (gas only)                                | `0xdb520e2ef24fb7d776b7755dba1ea7d2fcde8383620e3dea37530c683b009320` |
| Wallet B gas funding                                   | `0x2ac5ae6ce91d41cbf317f8b314cd1f6700a586b4996d31a9845d65c63ce9bc9e` |
| XRP deposit to Binance                                 | `0x46670512f2eeb5091d19ff13bcae87d34c87ee55ab747e1af9a2cb30c4ec1058` |
| Pending USDC deposit (status 0)                        | `0x1337c5ae06fc22901cda54a90fc5576b8eabc0ae275f471ec7eef24b59f83dae` |

### Expected final balances (normal scenario)

Binance spot (`GET /api/v3/account`):

| Asset | Free                                                |
| ----- | --------------------------------------------------- |
| USDT  | 2218.43384500                                       |
| ETH   | 0.69920000                                          |
| BNB   | 0.06005400                                          |
| USDC  | 144.98000000                                        |
| XRP   | 0.00000000 (hidden unless `omitZeroBalances=false`) |

Binance funding (`POST /sapi/v1/asset/get-funding-asset`): `USDT 10.00000000`.
`getUserAsset` returns both wallets added together.

| Wallet          | ETH                                     | USDC                     |
| --------------- | --------------------------------------- | ------------------------ |
| A `0x5a17…9d70` | 0.2957746985 (`295774698500000000` wei) | 180.000000 (`180000000`) |
| B `0x9c4e…b459` | 0.0097306 (`9730600000000000` wei)      | 180.000000 (`180000000`) |

Wallet A also holds `50000000000` raw units of the lookalike USDT contract: spam, excluded from
holdings. `balancemulti` reports the two ETH balances in one call.

CoinDCX (`POST /exchange/v1/users/balances`): BTC `0.0005`, ETH `0.08`, INR `0`. The INR wallet is
funded outside the sync (bank transfer) and only pays for the trades; fiat is not a ledger asset.

Every number above is what replaying the events gives, including fees: the ETH buys net 1.7992
ETH, the withdrawal burns 0.0018, the sell leaves 0.6992; the BNB balance is the dividend plus the
dust conversion minus the sell fees. `check-fixture.mjs` asserts exactly this.

## Routes

### Binance — `/binance` (api.binance.com)

| Method | Path                                                  | Notes                                                                                               |
| ------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/api/v3/time`                                        | real server clock, `+60 s` under `clock_skew`                                                       |
| GET    | `/api/v3/exchangeInfo`                                | `symbols` filter; `ETHBTC` is `BREAK`                                                               |
| GET    | `/api/v3/klines`                                      | see the klines section                                                                              |
| GET    | `/api/v3/myTrades`                                    | `symbol` required, `fromId`/`limit`/`startTime`/`endTime`, 24 h window, limit ≤ 1000, ids ascending |
| GET    | `/api/v3/account`                                     | `omitZeroBalances`                                                                                  |
| POST   | `/sapi/v1/asset/get-funding-asset`                    | `asset`                                                                                             |
| POST   | `/sapi/v3/asset/getUserAsset`                         | `asset`                                                                                             |
| GET    | `/sapi/v1/capital/config/getall`                      | per-coin networks with `contractAddress`                                                            |
| GET    | `/sapi/v1/capital/deposit/hisrec`                     | `coin`, `status`, `startTime`, `endTime`, `offset`, `limit`, `txId`; 90-day window                  |
| GET    | `/sapi/v1/capital/withdraw/history`                   | `coin`, `status`, `idList`, `offset`, `limit`, `startTime`, `endTime`; 90-day window                |
| GET    | `/sapi/v1/convert/tradeFlow`                          | `startTime`+`endTime` required, 30-day window, `moreData`                                           |
| GET    | `/sapi/v1/asset/dribblet`                             | last 100 records                                                                                    |
| GET    | `/sapi/v1/asset/assetDividend`                        | 180-day window, `limit` ≤ 500                                                                       |
| GET    | `/sapi/v1/fiat/orders`                                | `transactionType` required, `page`/`rows`                                                           |
| GET    | `/sapi/v1/fiat/payments`                              | empty answer omits `data` (real quirk)                                                              |
| GET    | `/sapi/v1/c2c/orderMatch/listUserOrderHistory`        | `tradeType`, 30-day window, `rows` ≤ 100                                                            |
| GET    | `/sapi/v1/simple-earn/flexible/history/rewardsRecord` | `type` required, 30-day window (`-6021`), `size` ≤ 100                                              |
| GET    | `/sapi/v1/simple-earn/locked/history/rewardsRecord`   | same, empty                                                                                         |
| GET    | `/sapi/v1/account/apiRestrictions`                    | read-only key; `trading_key` flips spot trading on                                                  |
| GET    | `/sapi/v1/spot/delist-schedule`                       | empty                                                                                               |

Signed requests need `X-MBX-APIKEY`, `timestamp` and `signature = HMAC-SHA256(secret, query+body)`
in hex. `recvWindow` defaults to 5000 and is capped at 60000. Too old/too far ahead →
`400 {"code":-1021,...}`, wrong signature → `-1022`, bad key → `-2015`/`-2014`. Weight headers
(`X-MBX-USED-WEIGHT-1M`, `X-SAPI-...`) are sent. Coded errors for the request mistakes the
research lists: `-1102` missing parameter, `-1121` invalid symbol, `-1127` window too wide,
`-1128` invalid parameter combination, `-1130` invalid parameter value.

### Binance public data — `/binance-data` (data-api.binance.vision)

`GET /api/v3/klines` with `symbol`, `interval=1d`, `startTime`, `endTime`, `limit` (≤ 1000),
`timeZone`. `timeZone=5:30` opens each candle at IST midnight, otherwise UTC midnight. Prices are
strings with 8 decimals; the payload is Binance's array form. `ETHUSDT`, `BTCUSDT` and `BNBUSDT`
have one candle for every day of FY 2025-26; the series starts on 2024-01-01 and stops at the
pinned "now". Prices come from a deterministic trend + wobble, so the same day always gives the
same close.

### CoinDCX — `/coindcx` (api.coindcx.com)

| Method | Path                                | Notes                                                  |
| ------ | ----------------------------------- | ------------------------------------------------------ |
| POST   | `/exchange/v1/orders/trade_history` | `limit` ≤ 500, `from_id`, `sort`, `symbol`, timestamps |
| POST   | `/exchange/v1/users/balances`       | JSON numbers, includes a zero INR row                  |
| POST   | `/exchange/v1/users/info`           | connected-as helper                                    |
| GET    | `/exchange/v1/markets_details`      | public, note the inverted base/target naming           |

Every authenticated call is a POST whose exact body bytes are signed:
`X-AUTH-APIKEY`, `X-AUTH-SIGNATURE = hex(HMAC-SHA256(secret, rawBody))`, and a `timestamp`
within 10 s of the server clock (the real tolerance is undocumented; this one is a choice).

### Etherscan — `/etherscan`, Blockscout — `/blockscout`

Etherscan's base URL is the prefix itself, so a request looks like
`GET /etherscan?chainid=1&module=account&action=txlist&address=0x…&startblock=0&endblock=99999999&page=1&offset=1000&sort=asc&apikey=mock-etherscan-key`.
Blockscout uses the same shape with `chain_id` (both spellings are accepted) and
`apikey=mock-blockscout-key`, and adds `x-credits-remaining` (−20 per call), `x-ratelimit-*`
headers.

| `module` / `action`          | Notes                                              |
| ---------------------------- | -------------------------------------------------- |
| `account` / `txlist`         | `startblock`, `endblock`, `page`, `offset`, `sort` |
| `account` / `txlistinternal` | by address; one internal call on the swap          |
| `account` / `tokentx`        | optional `contractaddress`, no `logIndex`          |
| `account` / `balance`        | `tag=latest`, wei string                           |
| `account` / `balancemulti`   | up to 20 addresses                                 |
| `account` / `tokenbalance`   | `contractaddress`, raw units                       |
| `proxy` / `eth_blockNumber`  | latest block, `0x…`                                |

Rules that matter: at most **1,000 rows per request** even with `offset=1000`; `page × offset >
10000` returns `{"status":"0","message":"NOTOK","result":"Result window is too large, PageNo x
Offset size must be less than or equal to 10000"}`; empty history is `{"status":"0","message":"No
transactions found","result":[]}`; every error is HTTP 200 with `NOTOK`. `chainid` is required
(the real missing-chain text), and `8453/56/10/43114` answer "Free API access is not supported for
this chain." Requests are limited to 3/s (Etherscan) and 5/s (Blockscout); over the limit you get
the `Max rate limit reached…` NOTOK body so the client's 200-is-429 rule is exercised.

### CoinGecko — `/coingecko/api/v3`

| Method | Path                                | Notes                                                           |
| ------ | ----------------------------------- | --------------------------------------------------------------- |
| GET    | `/coins/list?include_platform=true` | includes two coins with the `USDC` symbol                       |
| GET    | `/coins/{id}/history`               | `date=dd-mm-yyyy`, `market_data.current_price.{usd,inr}`        |
| GET    | `/coins/{id}/market_chart/range`    | `vs_currency=usd\|inr`, `from`, `to`, daily points at 00:00 UTC |

`bitcoin`, `ethereum`, `binancecoin`, `usd-coin`, `tether` and `ripple` exist. A missing or wrong
`x-cg-demo-api-key` is `401` / `10002`. A date older than 365 days before the pinned "now" is
`401` / `10005` (the body text is invented; the code and the 365-day rule are real). Over 100
calls a minute → `429`.

## Control endpoints

| Method | Path          | Purpose                                                          |
| ------ | ------------- | ---------------------------------------------------------------- |
| GET    | `/__control`  | current scenario, pinned `now`, pending one-shot flags           |
| POST   | `/__control`  | `{"scenario": "..."}`, `{"now": "2026-04-01T00:00:00Z"}` or both |
| GET    | `/__requests` | recent requests: `{method, path, params, status}`                |
| DELETE | `/__requests` | clear the log                                                    |

`/__requests` keeps the last 500 calls and replaces the value of `apikey`, `signature`, `api_key`
and `x_cg_demo_api_key` with `***`, so tests can assert pagination and that no secret leaked.

### Scenarios

| Scenario                   | Behaviour                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normal`                   | the fixture user above                                                                                                                                           |
| `empty`                    | every history endpoint returns nothing, every balance is zero; prices stay                                                                                       |
| `rate_limit_once`          | the next upstream call (any vendor) gets `429` + `Retry-After: 1`, then the scenario returns to `normal`                                                         |
| `ban_418`                  | every Binance call gets `418` with a ban-until message and `Retry-After: 120`                                                                                    |
| `bad_signature`            | every signed Binance call fails `-1022`, even with a correct signature                                                                                           |
| `clock_skew`               | `/api/v3/time` (and the timestamp check) run 60 s ahead; a client that ignores `/time` gets `-1021`                                                              |
| `etherscan_rate_limit_200` | the next Etherscan/Blockscout call gets HTTP 200 `NOTOK "Max rate limit reached…"`, then normal                                                                  |
| `upstream_500_once`        | the next upstream call gets a vendor-shaped 500, then normal                                                                                                     |
| `trading_key`              | `apiRestrictions` reports `enableSpotAndMarginTrading: true` (the client must refuse)                                                                            |
| `big_history`              | wallet A gets 3,050 extra lookalike-USDC transfers, one per block from 22,900,000, so the client must walk blocks; their sum (3,050.000000) is the token balance |
| `drift`                    | wallet B's USDC `tokenbalance` is 0.5 higher than its history, to exercise `balance_mismatch`                                                                    |

One-shot scenarios flip themselves back to `normal` once they fire, so `GET /__control` always
shows what will happen next. Setting a scenario clears the pending flags and the rate-limit
windows.

### Two clocks

- **HTTP clock** (`/api/v3/time`, Binance `timestamp`, CoinDCX `timestamp`) is the real clock,
  plus 60 s under `clock_skew`. A client that signs with its own time works in `normal`.
- **Data clock** (`state.now`, pinned to `2026-04-01T00:00:00Z`) decides which klines exist, the
  CoinGecko 365-day limit and the default window of every history call. Pinning it keeps price
  answers deterministic and puts the whole FY inside CoinGecko's window. Change it with
  `POST /__control {"now": "..."}`.

## Known gaps

- Etherscan's 3/s and Blockscout's 5/s limits share one one-second window in the mock; use one
  provider at a time, as the app does.
- Blockscout credit exhaustion (100k credits/day) is counted in the headers but is not enforced as
  an error, because the real error shape is undocumented.
- CoinDCX amounts are short decimals: the long-fraction case (≥ 17 significant digits) from the
  research notes is not in the fixture.
- No `module=logs`, no `eth_getBlockByNumber`, no NFT/1155 transfers, no Binance margin/futures,
  no Simple Earn positions (research §1.7 puts them out of scope) and no `/coins/{id}/contract/{address}`.
- Binance `myTrades` has no documented history depth, so the mock returns the whole fixture.
- The vendor error texts that the research marks UNVERIFIED are invented here and marked as such
  above (`-1127`/`-1128`/`-1130` messages, CoinDCX's 401 body, CoinGecko `10005`, the oversized
  `page × offset` text). Codes and HTTP statuses follow the documented behaviour.

## Files

- `server.mjs` — the server and its CLI;
- `fixtures.mjs` — the fixture user, the payloads built from it and the balances those events imply;
- `check-fixture.mjs` — the independent replay that asserts every balance and hash link.
