# mock-sync

One zero-dependency Node 24 server that stands in for every upstream the Phase 2 sync talks to:
Binance spot + wallet (`api.binance.com`), Binance public market data
(`data-api.binance.vision`), CoinDCX (`api.coindcx.com`), Etherscan V2, Blockscout's
Etherscan-compatible API, Alchemy's and NodeReal's JSON-RPC transfer APIs, and CoinGecko Demo.
Built on `node:http`, `node:crypto` and `node:url` only, so there is nothing to install.

It enforces the parts of each API that clients get wrong: Binance HMAC signatures over the query
string, `recvWindow`/timestamp checks, CoinDCX HMAC over the raw JSON body, Etherscan's
1,000-row cap and block walking, per-chain free/paid explorer coverage, Alchemy/NodeReal
`pageKey` paging and block windows, CoinGecko's 365-day history limit. The data is one coherent
fixture user across Binance, CoinDCX and five EVM chains, so a sync can be tested end to end and
the reported balances can be compared with what the ledger implies.

## Run it

```sh
node tools/mock-sync/server.mjs              # MOCK_SYNC_PORT or 11601
node tools/mock-sync/server.mjs --port 11700
```

It listens on `0.0.0.0`. On start it prints the base URLs to paste into the app:

```sh
BINANCE_API_BASE=http://127.0.0.1:11601/binance
BINANCE_DATA_BASE=http://127.0.0.1:11601/binance-data
COINDCX_API_BASE=http://127.0.0.1:11601/coindcx
ETHERSCAN_API_BASE=http://127.0.0.1:11601/etherscan
BLOCKSCOUT_API_BASE=http://127.0.0.1:11601/blockscout
ALCHEMY_API_BASE=http://127.0.0.1:11601/alchemy/{network}/v2
NODEREAL_API_BASE=http://127.0.0.1:11601/nodereal
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

It starts the server on a free port and, with its own BigInt arithmetic:

- replays the Binance events (withdrawals charge `amount + transactionFee`, Simple Earn
  subscriptions move spot → earn, the dividend feed is the only income) and asserts
  `/api/v3/account`, `get-funding-asset`, `getUserAsset`, both Simple Earn position routes, the
  dividend feed and every withdrawal→on-chain hash link;
- replays each of the five chains from raw transactions — external value, internal call value,
  gas, Base's `l1Fee` and token legs — and asserts the balances through Etherscan (free and paid
  keys), Blockscout's per-chain prefixes, Alchemy and NodeReal;
- asserts the transfer feeds leg by leg, including Alchemy `pageKey` paging with a two-row page,
  Base receipts carrying `l1Fee`, Arbitrum receipts carrying `gasUsedForL1`, and the documented
  absence of the internal category on Alchemy for Arbitrum;
- asserts the NodeReal 100,000-block window error, the scenario behaviour on each prefix, the
  kline coverage, and that no secret reaches the request log.

It exits non-zero with a list of differences. Etherscan and Blockscout calls are paced at ~3/s,
the real client's free-tier pace.

## Credentials

| Upstream   | Credential                                                                   |
| ---------- | ---------------------------------------------------------------------------- |
| Binance    | key `mock-binance-key`, secret `mock-binance-secret` (HMAC-SHA256)           |
| CoinDCX    | key `mock-dcx-key`, secret `mock-dcx-secret` (HMAC over the body)            |
| Etherscan  | free key `mock-etherscan-key` (chains 1, 137, 42161)                         |
| Etherscan  | paid key `mock-etherscan-paid-key` (adds 8453 Base and 56 BNB Smart Chain)   |
| Blockscout | header `authorization: mock-blockscout-key`, or `apikey=mock-blockscout-key` |
| Alchemy    | path key `mock-alchemy-key` in `/alchemy/<network>/v2/<key>`                 |
| NodeReal   | path key `mock-nodereal-key` in `/nodereal/<key>`                            |
| CoinGecko  | header `x-cg-demo-api-key: mock-coingecko-key`                               |

An unknown Binance key is `401 {"code":-2015,...}` (a key shorter than 8 characters is
`-2014`); a wrong signature is `400 {"code":-1022,...}`. CoinDCX answers `401` with
`{"code":401,"message":"Invalid credentials","status":"error"}` — that body is invented, the real
one is undocumented. An unknown explorer key is the `NOTOK "Invalid API Key"` envelope (after six
attempts in 30 s it switches to the documented "too many invalid attempts" text). An unknown
Alchemy/NodeReal key is `401` with a JSON-RPC error.

## Fixture user

All dates fall in FY 2025-26 except the Polygon MATIC-era pair, which is deliberately earlier so
the POL redenomination is covered. The story, in order:

| When (UTC)              | Event                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 2024-07-15              | MATIC era: 5 MATIC into wallet B on Polygon PoS.                                                                                                |
| 2024-08-01              | MATIC era: wallet B sends 2 MATIC.                                                                                                              |
| 2025-04-08              | P2P buy of 5,000 USDT for ₹4,42,500 (₹88.50/USDT). Lands in the **funding** wallet; 4,990 USDT is then moved to spot with an internal transfer. |
| 2025-04-15              | Buy 1.8 ETH on `ETHUSDT` in three fills: fees 0.0008 ETH, 1.75973 USDT, 0.751425 USDT.                                                          |
| 2025-05-02              | Withdraw 0.5 ETH to wallet A, `transactionFee` 0.0018 ETH charged **on top**: spot loses 0.5018 ETH and exactly 0.5 ETH arrives.                |
| 2025-05-20              | Withdraw 0.02 ETH to wallet A on **Base** (fee 0.0005), 250 USDT on **BSC** (fee 1) and 0.05 BNB on **BSC** (fee 0.0005).                       |
| 2025-05-20              | POL era: 14 POL into wallet B on Polygon PoS.                                                                                                   |
| 2025-06-02              | POL era: wallet B sends 4 POL.                                                                                                                  |
| 2025-06-10              | Wallet A swaps 0.2 ETH for 480 USDC on mainnet (gas 0.001420824 ETH).                                                                           |
| 2025-06-18              | Wallet A swaps 0.005 ETH for 12.5 USDC on Base (gas + `l1Fee`).                                                                                 |
| 2025-06-20              | Asset dividend: 0.06 BNB ("BNB Vault rewards").                                                                                                 |
| 2025-07-08              | 0.01 ETH into wallet A on Arbitrum One (gas money).                                                                                             |
| 2025-07-09              | Wallet A receives 100 USDC.e and 50 native USDC on Arbitrum One.                                                                                |
| 2025-07-30              | Wallet B is funded with 0.01 ETH from an outside address (gas money).                                                                           |
| 2025-08-14              | Wallet A sends 300 USDC to wallet B on mainnet (gas 0.000358463 ETH, paid by A).                                                                |
| 2025-08-20              | Wallet A sends 40 USDC.e on Arbitrum One.                                                                                                       |
| 2025-08-25              | Wallet A bridges 0.002 ETH from Base to Ethereum through `L2StandardBridge`.                                                                    |
| 2025-08-28              | Wallet A sends 20 native USDC on Arbitrum One.                                                                                                  |
| 2025-09-03              | Wallet A receives 50,000 lookalike "USDT" from a fake contract — spam.                                                                          |
| 2025-09-15              | Subscribe 100 USDT to Simple Earn flexible (spot → earn).                                                                                       |
| 2025-10-01              | Deposit 2.1 XRP to Binance from an outside exchange.                                                                                            |
| 2025-10-02              | Wallet A sends 25 USDT on BSC (gas 0.000153 BNB).                                                                                               |
| 2025-10-07              | Wallet A's mainnet swap fails (`isError=1`): gas 0.000345708 ETH, no value moved.                                                               |
| 2025-11-05              | Dust conversion: 2.1 XRP → 0.000132 BNB (net of 0.0000027 BNB service charge).                                                                  |
| 2025-11-19              | Wallet A approves USDC: gas 0.0003003065 ETH, nothing else moves.                                                                               |
| 2025-11-28              | Convert 25 USDT → 24.98 USDC.                                                                                                                   |
| 2025-12-01              | Simple Earn flexible reward: 0.42 USDT, credited to spot.                                                                                       |
| 2025-12-12              | Wallet B sends 120 USDC to the user's Binance deposit address.                                                                                  |
| 2026-01-20              | Sell 0.6 ETH for 1,776.60 USDT in two fills, fees 0.000078 BNB.                                                                                 |
| 2026-02-01              | Subscribe 0.02 ETH to Simple Earn locked (spot → earn, 120-day position).                                                                       |
| 2025-05-20 … 2025-11-03 | CoinDCX: four BTCINR/ETHINR trades (see `COINDCX_TRADES`).                                                                                      |

One Binance withdrawal (`100 USDT`, status `4`, processing) and one USDC deposit (status `0`,
pending) are in the histories on purpose: both are visible to the client and neither moves a
balance.

### Binance withdrawal semantics

Fixed by the fixture and asserted by `check-fixture.mjs`:

- `amount` is the quantity that **arrives** at `address`; `transactionFee` is charged **on top**.
  A 0.5 ETH withdrawal with a 0.0018 ETH fee removes 0.5018 ETH from spot and the on-chain
  transfer carries exactly 0.5 ETH. The dust conversion's `transferedAmount` is likewise net.
- Every status-`6` withdrawal's `txId` is the hash of a transaction in `CHAIN_TRANSACTIONS` for
  the network's chain (`ETH` → 1, `BASE` → 8453, `BSC` → 56), so the engine's hash matching has
  something real to match.
- A reward that changes a balance appears in `/sapi/v1/asset/assetDividend`; the Simple Earn
  rewards endpoints repeat it with a `dividendId` that points at the dividend row, for audit only.
  Income is counted once, from the dividend feed.
- Simple Earn positions (`/sapi/v1/simple-earn/{flexible,locked}/position`) count toward the
  total-wallet check. Subscriptions have no read endpoint, so they are recorded explicitly in
  `EARN_SUBSCRIPTIONS` and must agree with `BINANCE_EARN_POSITIONS`; the check script asserts it.

### Addresses

Mainnet and shared:

| Name                                             | Address                                      |
| ------------------------------------------------ | -------------------------------------------- |
| Wallet A                                         | `0x5a17c9e3b4d28f6019ca7b3e5d8f2a4c6b1e9d70` |
| Wallet B                                         | `0x9c4e2a7d1f83b650e4d9a2c5f7b1e8d3a6c0b459` |
| Binance deposit address                          | `0x3d7b4e2a9c1f0586b3e7a2d9c4f6018e5b2a7c43` |
| Binance hot wallet (mainnet withdrawals)         | `0xb71f3c8d92a45e6017ca9b3d5f8e2a4c60d1b9e7` |
| External funder (wallet B's gas)                 | `0x2b5f8e1c9d3a70465fe2b9c4d7a10f836c5e29b4` |
| DEX router (mainnet)                             | `0x7c2e9a4b6d1f8350a2c7e4b9d6f1038a5c2b7e40` |
| Spam sender                                      | `0x6f1d3b8e5a2c9074d6e3b1a8c5f2047d9b6e3a1c` |
| Spam token (lookalike "USDT", symbol USDT, 6 dp) | `0xdeadbeefcafebabe00112233445566778899aabb` |
| Big-history spam token (lookalike "USDC", 6 dp)  | `0xfacade000000000000000000000000000000c0de` |
| USDC (real mainnet contract)                     | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` |
| USDT (real mainnet contract)                     | `0xdac17f958d2ee523a2206206994597c13d831ec7` |

Base (8453):

| Name                                | Address                                      |
| ----------------------------------- | -------------------------------------------- |
| Binance Base hot wallet             | `0xc1a7f4e9b2d6805317c4a9e6b3d85027a1c6f9e4` |
| Base DEX router                     | `0x2f9b6d3e8a1c74052e6b9d3f8a2c71e5b6049d3a` |
| `L2StandardBridge` (real predeploy) | `0x4200000000000000000000000000000000000010` |
| USDC (real Base contract, 6 dp)     | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` |

Arbitrum One (42161):

| Name                                       | Address                                      |
| ------------------------------------------ | -------------------------------------------- |
| Arbitrum funder                            | `0x8f2c5b7e1a9d3406c8e2f5b7a1d9c3e60482f7b1` |
| Arbitrum recipient                         | `0x4a8e1c7d2f9b53064e1a8c5d7f2b9e3064c8a1d5` |
| Arbitrum router                            | `0x6c3d9f1e7a2b5408163c9d7e2a5b8f1064c2e9d3` |
| Native USDC (real Arbitrum contract, 6 dp) | `0xaf88d065e77c8cc2239327c5edb3a432268e5831` |
| Bridged USDC.e (real contract, 6 dp)       | `0xff970a61a04b1ca14834a43f5de4533ebddb5cc8` |

Polygon PoS (137):

| Name              | Address                                      |
| ----------------- | -------------------------------------------- |
| Polygon funder    | `0x7d3b9e5c1a8f24067b4d9e2c6a1f85037c2e9b4d` |
| Polygon recipient | `0xb2e6f9d4c1a85037e2b6d9f4a1c87036e5b2d9c4` |

BNB Smart Chain (56):

| Name                                       | Address                                      |
| ------------------------------------------ | -------------------------------------------- |
| Binance BSC hot wallet                     | `0xe4a1c9d7b3f2608419d5c7e2a9b4f60318d2c5e7` |
| BSC recipient                              | `0x1f7a3c9e5b2d84061a7c9e3f5b8d2046a1c7e9b3` |
| Binance-Peg BSC-USD (real contract, 18 dp) | `0x55d398326f99059ff775485246999027b3197955` |

Every address except the token, bridge and predeploy contracts is invented; hashes are
`sha256("tax-tracker/mock-sync/<label>")`.

### Hashes that must match

Mainnet:

| Link                                                    | Hash                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| Binance withdrawal `txId` = wallet A's incoming 0.5 ETH | `0x54384b38e97e03d44bc1158616ccd431c3db3bdadd7f69c7f0066a948f1a529d` |
| Wallet B's outgoing USDC tx = Binance deposit `txId`    | `0xce63aebf5339e600280ac09344f3337e6506e3387a2d7b53e69d3923ff07645c` |
| Wallet A → wallet B USDC                                | `0xc9b4a25df76a3251030f5c50ca3888b61e011432319d8c984897d8289cc7295e` |
| Wallet A ETH → USDC swap                                | `0xde70126bef21b4af3f2c56263037c6ea64651fd39150c9018f728ff064d1b31d` |
| Spam transfer into wallet A                             | `0x49ee4f71773ace339a85a076743a985ac3cd74061492ab43abde3bb14e7e162f` |
| Failed swap (gas only)                                  | `0x4250c7dd03dd53cad203886c33e225ed55fc198e8a062899afab1ebf27b61d6a` |
| USDC approve (gas only)                                 | `0xdb520e2ef24fb7d776b7755dba1ea7d2fcde8383620e3dea37530c683b009320` |
| Wallet B gas funding                                    | `0x2ac5ae6ce91d41cbf317f8b314cd1f6700a586b4996d31a9845d65c63ce9bc9e` |
| XRP deposit to Binance                                  | `0x46670512f2eeb5091d19ff13bcae87d34c87ee55ab747e1af9a2cb30c4ec1058` |
| Pending USDC deposit (status 0)                         | `0x1337c5ae06fc22901cda54a90fc5576b8eabc0ae275f471ec7eef24b59f83dae` |

Base (8453):

| Link                                            | Hash                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Binance withdrawal `txId` = wallet A's Base ETH | `0x773006ac7f9871986ffc3a6a24053788da45131399700e0583e6d4859b66c086` |
| Base ETH → USDC swap                            | `0x4175ab429d1f9915ae7eeb75184c75bb66560288af72cd201ae03a23b7ac84a5` |
| Base → Ethereum bridge (`bridgeETH`)            | `0xa5be56b86cbd89d5534d3390cf0ddfa5c9ec3f5ffcb1d36c9b7c98aff0cd939e` |

Arbitrum One (42161):

| Link                          | Hash                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| 0.01 ETH into wallet A        | `0x76a33c02974b9c09de5f93718088a0b08185943e45adc04864d3981d15a903b2` |
| 100 USDC.e into wallet A      | `0x1cc21d3bbb00ab2fdc181bca8a2f2b3f7e21a581ef599ed6e24c12a2b1963e79` |
| 50 native USDC into wallet A  | `0x5d7160cfb5c968eb1cadd0cee532e545b7e2eb4075cd4177efe33d9cfa3d3365` |
| Wallet A sends 40 USDC.e      | `0x8ff4685af440b223da1356678c9336141e856eb3c10f4b09bbc405623dbf5960` |
| Wallet A sends 20 native USDC | `0xf256fa30ee75683100668d20099e368db0d53cfe6b71378a17838ae060ab51c0` |
| 10 USDC.e → 0.0035 ETH swap   | `0x6dd3c5188167de8eeaa7046b60880ceddfef462458c07cb79ca9019a23fb71a1` |

Polygon PoS (137):

| Link                   | Hash                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| MATIC era: 5 MATIC in  | `0xe71bc7ce4b5c12bd820c9a32a83a79dc626dfb65f1fccb2033f7af06a2a0c832` |
| MATIC era: 2 MATIC out | `0x6b21bf0f2447f11901ce772688db6b52156a26f7ffdd7a3f4836c36056ec13d5` |
| POL era: 14 POL in     | `0x7b4bef3bcf95e2e4ccb6e420f8edcfd11942da1fcfdfacfce4d225be5d56bb48` |
| POL era: 4 POL out     | `0xdc785ccbe2ee8b8c2b97b8a63f91729578d17f89ee061a78ad8917e8dcddae0e` |

BNB Smart Chain (56):

| Link                                        | Hash                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------- |
| Binance withdrawal `txId` = 250 USDT on BSC | `0x4d495f1618bf5b00b493bbb75d50b6cf99b4495ce0d28076c75a3e469b92389a` |
| Binance withdrawal `txId` = 0.05 BNB on BSC | `0x4d526d59e6385800539ecc3b6023f94ccb30649c430660f57c3e867d34d9b999` |
| Wallet A sends 25 USDT on BSC               | `0x9990e527f68dc007b1ac0625d1c4be9093b211953f8bd71bb4098857230f3e00` |

### Expected final balances (normal scenario)

Binance spot (`GET /api/v3/account`):

| Asset | Free                                                |
| ----- | --------------------------------------------------- |
| USDT  | 1867.43384500                                       |
| ETH   | 0.65690000                                          |
| BNB   | 0.00955400                                          |
| USDC  | 144.98000000                                        |
| XRP   | 0.00000000 (hidden unless `omitZeroBalances=false`) |

Binance funding (`POST /sapi/v1/asset/get-funding-asset`): `USDT 10.00000000`.

Simple Earn (`/sapi/v1/simple-earn/{flexible,locked}/position`): `USDT 100.00000000` flexible,
`ETH 0.02000000` locked. `getUserAsset` returns spot + funding + earn per asset.

EVM balances, per chain, including gas and Base's `l1Fee`:

| Chain              | Wallet          | Balance                                                                                      |
| ------------------ | --------------- | -------------------------------------------------------------------------------------------- |
| 1 Ethereum         | A `0x5a17…9d70` | `0.2975746985` ETH (`297574698500000000` wei)                                                |
| 1 Ethereum         | B `0x9c4e…b459` | `0.0097306` ETH (`9730600000000000` wei)                                                     |
| 1 Ethereum         | A               | USDC `180.000000` (`180000000`); lookalike USDT `50000000000` raw units (spam)               |
| 1 Ethereum         | B               | USDC `180.000000` (`180000000`)                                                              |
| 8453 Base          | A               | `0.0129985655095` ETH (`12998565509500000` wei); USDC `12.500000` (`12500000`)               |
| 42161 Arbitrum     | A               | `0.0134975` ETH (`13497500000000000` wei); USDC.e `50.000000`; USDC `30.000000`              |
| 137 Polygon PoS    | B               | `12.99874` POL (`12998740000000000000` wei)                                                  |
| 56 BNB Smart Chain | A               | `0.049847` BNB (`49847000000000000` wei); USDT `225.000000` (`225000000000000000000`, 18 dp) |

Wallet A holds nothing on Polygon PoS and wallet B holds nothing on Base, Arbitrum or BSC, so
those rows are omitted; `balancemulti` reports native balances for both wallets in one call.

CoinDCX (`POST /exchange/v1/users/balances`): BTC `0.0005`, ETH `0.08`, INR `0`. The INR wallet is
funded outside the sync (bank transfer) and only pays for the trades; fiat is not a ledger asset.

Every number above is what replaying the events gives, including fees: the ETH buys net 1.7992
ETH, the two withdrawals burn 0.5018 + 0.0205 ETH, the sell leaves 0.6569; the BNB balance is the
dividend plus the dust conversion minus the withdrawal fee and the sell fees; the earn
subscriptions move 100 USDT and 0.02 ETH out of spot. `check-fixture.mjs` asserts exactly this,
on every chain and through every provider.

## Routes

### Binance — `/binance` (api.binance.com)

| Method | Path                                                  | Notes                                                                                               |
| ------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/api/v3/time`                                        | real server clock, `+60 s` under `clock_skew`                                                       |
| GET    | `/api/v3/exchangeInfo`                                | `symbols` filter; `ETHBTC` is `BREAK`                                                               |
| GET    | `/api/v3/klines`                                      | see the klines section                                                                              |
| GET    | `/api/v3/myTrades`                                    | `symbol` required, `fromId`/`limit`/`startTime`/`endTime`, 24 h window, limit ≤ 1000, ids ascending |
| GET    | `/api/v3/account`                                     | `omitZeroBalances`; spot wallet only                                                                |
| POST   | `/sapi/v1/asset/get-funding-asset`                    | `asset`                                                                                             |
| POST   | `/sapi/v3/asset/getUserAsset`                         | `asset`; spot + funding + earn                                                                      |
| GET    | `/sapi/v1/capital/config/getall`                      | per-coin networks with `contractAddress` (ETH/BASE, USDC/ETH+BASE, USDT/ETH+BSC, BNB/BSC)           |
| GET    | `/sapi/v1/capital/deposit/hisrec`                     | `coin`, `status`, `startTime`, `endTime`, `offset`, `limit`, `txId`; 90-day window                  |
| GET    | `/sapi/v1/capital/withdraw/history`                   | `coin`, `status`, `idList`, `offset`, `limit`, `startTime`, `endTime`; 90-day window                |
| GET    | `/sapi/v1/convert/tradeFlow`                          | `startTime`+`endTime` required, 30-day window, `moreData`                                           |
| GET    | `/sapi/v1/asset/dribblet`                             | last 100 records                                                                                    |
| GET    | `/sapi/v1/asset/assetDividend`                        | 180-day window, `limit` ≤ 500; the only income feed                                                 |
| GET    | `/sapi/v1/fiat/orders`                                | `transactionType` required, `page`/`rows`                                                           |
| GET    | `/sapi/v1/fiat/payments`                              | empty answer omits `data` (real quirk)                                                              |
| GET    | `/sapi/v1/c2c/orderMatch/listUserOrderHistory`        | `tradeType`, 30-day window, `rows` ≤ 100                                                            |
| GET    | `/sapi/v1/simple-earn/flexible/history/rewardsRecord` | `type` required, 30-day window (`-6021`), `size` ≤ 100; audit copy of the USDT dividend             |
| GET    | `/sapi/v1/simple-earn/locked/history/rewardsRecord`   | same, empty                                                                                         |
| GET    | `/sapi/v1/simple-earn/flexible/position`              | `asset`, `current`, `size` ≤ 100; `totalAmount` is the holding                                      |
| GET    | `/sapi/v1/simple-earn/locked/position`                | same, `amount` is the holding                                                                       |
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
`GET /etherscan?chainid=1&module=account&action=txlist&address=0x…&startblock=0&endblock=24700000&page=1&offset=1000&sort=asc&apikey=mock-etherscan-key`.

Blockscout answers both shapes:

- `GET /blockscout?chain_id=1&module=…&action=…&…` with `authorization: mock-blockscout-key`
  (Etherscan's V2 style; `apikey=` is accepted too), and
- `GET /blockscout/<chainId>/api?module=…&action=…&…` — the per-chain prefix form.

| `module` / `action`                   | Notes                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `account` / `txlist`                  | `startblock`, `endblock` (default: the chain head), `page`, `offset`, `sort`              |
| `account` / `txlistinternal`          | by address; the swap leg on mainnet and Arbitrum                                          |
| `account` / `tokentx`                 | optional `contractaddress`, no `logIndex`                                                 |
| `account` / `balance`                 | `tag=latest`, wei string                                                                  |
| `account` / `balancemulti`            | up to 20 addresses                                                                        |
| `account` / `tokenbalance`            | `contractaddress`, raw units                                                              |
| `proxy` / `eth_blockNumber`           | latest block, `0x…`                                                                       |
| `proxy` / `eth_getTransactionReceipt` | full receipt; Base carries `l1Fee` and the L1 gas fields, Arbitrum carries `gasUsedForL1` |

Chain coverage and credentials:

| Chain              |  Head block | Etherscan free key | Etherscan paid key | Blockscout         |
| ------------------ | ----------: | ------------------ | ------------------ | ------------------ |
| 1 Ethereum         |  24,700,000 | yes                | yes                | yes                |
| 8453 Base          |  40,100,000 | no                 | yes                | paid plan required |
| 42161 Arbitrum     | 420,000,000 | yes                | yes                | yes                |
| 137 Polygon PoS    |  78,000,000 | yes                | yes                | yes                |
| 56 BNB Smart Chain |  75,400,000 | no                 | yes                | not indexed        |

A free key on 8453/56 answers `{"status":"0","message":"NOTOK","result":"Free API access is not
supported for this chain. Please upgrade your plan to access this chain."}`; Blockscout's Base is
`"Base API access requires a paid plan."` and BSC is `"Chain is not indexed by Blockscout."`.

Rules that matter: at most **1,000 rows per request** even with `offset=1000`; `page × offset >
10000` returns `{"status":"0","message":"NOTOK","result":"Result window is too large, PageNo x
Offset size must be less than or equal to 10000"}`; empty history is `{"status":"0","message":"No
transactions found","result":[]}`; every error is HTTP 200 with `NOTOK`. `chainid` (Etherscan) /
`chain_id` (Blockscout) is required — the real missing-chain text otherwise. Requests are limited
to 3/s (Etherscan) and 5/s (Blockscout); over the limit you get the `Max rate limit reached…`
NOTOK body so the client's 200-is-429 rule is exercised. Blockscout adds `x-credits-remaining`
(−20 per call) and `x-ratelimit-*` headers.

### Alchemy — `/alchemy/<network>/v2/<key>`

`POST /alchemy/eth-mainnet/v2/mock-alchemy-key` with a JSON-RPC body
`{"jsonrpc":"2.0","id":1,"method":"…","params":[…]}`. An unknown key is `401` + JSON-RPC error.

| Network           | Chain |
| ----------------- | ----- |
| `eth-mainnet`     | 1     |
| `base-mainnet`    | 8453  |
| `arb-mainnet`     | 42161 |
| `polygon-mainnet` | 137   |

| Method                      | Notes                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alchemy_getAssetTransfers` | one direction per call (`fromAddress` or `toAddress`), `category` (`external`/`internal`/`erc20`), `fromBlock`/`toBlock`, `maxCount` ≤ 1000 (clamped), `excludeZeroValue`, `withMetadata`, `order`, `pageKey` |
| `eth_getTransactionReceipt` | Base adds `l1Fee`, `l1GasUsed`, `l1GasPrice` and the scalar fields; Arbitrum adds `gasUsedForL1`                                                                                                              |
| `eth_getBalance`            | hex wei                                                                                                                                                                                                       |
| `alchemy_getTokenBalances`  | explicit contract list, or the address's inventory when the list is omitted; zero balances omitted then                                                                                                       |
| `eth_getTransactionCount`   | hex nonce count                                                                                                                                                                                               |
| `eth_call`                  | `balanceOf(address)` only                                                                                                                                                                                     |
| `eth_blockNumber`           | the chain head in hex                                                                                                                                                                                         |

`pageKey` values are opaque, single-use for their exact query, and expire after ten minutes
(invented; the real TTL is undocumented). **Arbitrum limitation:** the `internal` category is
silently dropped, so the router → wallet internal swap leg is invisible through Alchemy and only
Etherscan/Blockscout expose it.

### NodeReal — `/nodereal/<key>`

`POST /nodereal/mock-nodereal-key`, BSC only (Ethereum is accepted, BSC is the fixture chain). Same
JSON-RPC envelope; an unknown key is `401`.

| Method                                        | Notes                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `nr_getAssetTransfers`                        | `category` (`external`/`internal`/`20`), one direction, `pageKey`, `maxCount`; refuses a block range above **100,000 blocks** |
| `nr_getAssetTransfersCount`                   | `{count}` in hex for the same filters                                                                                         |
| `nr_getTransactionByAddress`                  | `{transactions:[…]}`, refuses a block range above **1,000 blocks**                                                            |
| `eth_getBalance`                              | hex wei                                                                                                                       |
| `eth_getTransactionReceipt`                   | full receipt                                                                                                                  |
| `eth_call`                                    | `balanceOf(address)` only                                                                                                     |
| `eth_getTransactionCount` / `eth_blockNumber` | hex counters                                                                                                                  |

NodeReal sends native values as hex strings and token amounts as hex in `value` (the research
marks this difference from Alchemy); `decimal` is hex for tokens and `null` for native.

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
and `x_cg_demo_api_key` with `***`, and the key segment of `/alchemy/<network>/v2/<key>` and
`/nodereal/<key>` with `***`, so tests can assert pagination and that no secret leaked.

### Scenarios

| Scenario                   | Behaviour                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normal`                   | the fixture user above                                                                                                                                                      |
| `empty`                    | every history endpoint returns nothing, every balance is zero; prices stay                                                                                                  |
| `rate_limit_once`          | the next upstream call (any vendor) gets `429` + `Retry-After: 1`, then the scenario returns to `normal`                                                                    |
| `ban_418`                  | every Binance call gets `418` with a ban-until message and `Retry-After: 120`                                                                                               |
| `bad_signature`            | every signed Binance call fails `-1022`, even with a correct signature                                                                                                      |
| `clock_skew`               | `/api/v3/time` (and the timestamp check) run 60 s ahead; a client that ignores `/time` gets `-1021`                                                                         |
| `etherscan_rate_limit_200` | the next Etherscan/Blockscout call gets HTTP 200 `NOTOK "Max rate limit reached…"`, then normal                                                                             |
| `upstream_500_once`        | the next upstream call gets a vendor-shaped 500, then normal                                                                                                                |
| `trading_key`              | `apiRestrictions` reports `enableSpotAndMarginTrading: true` (the client must refuse)                                                                                       |
| `big_history`              | wallet A gets 3,050 extra lookalike-USDC transfers on mainnet, one per block from 22,900,000, so the client must walk blocks; their sum (3,050.000000) is the token balance |
| `drift`                    | mainnet wallet B's USDC `tokenbalance` is 0.5 higher than its history; no other chain moves, to exercise `balance_mismatch`                                                 |

The scenarios apply to every prefix: `empty` zeroes explorer balances, Alchemy/NodeReal
`eth_getBalance` and transfer feeds; `upstream_500_once` and `rate_limit_once` fire on whichever
vendor is called next with that vendor's own error shape. One-shot scenarios flip themselves back
to `normal` once they fire, so `GET /__control` always shows what will happen next. Setting a
scenario clears the pending flags, the rate-limit windows and the outstanding `pageKey`s.

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
  no `/coins/{id}/contract/{address}`, and no `eth_getLogs`/`eth_getCode`.
- Binance `myTrades` has no documented history depth, so the mock returns the whole fixture.
- Alchemy serves four networks (no BSC) and NodeReal serves BSC only, exactly as the research
  says; a chain with neither key is unreachable, by design.

### Shapes that had to be guessed

These are invented because the research does not record the real bytes. Each is marked
`GUESSED` next to the code that emits it:

- Blockscout's unindexed-chain text `"Chain is not indexed by Blockscout."`, its missing-key text
  `"Missing/Invalid API Key"`, and its Base paid-plan text `"Base API access requires a paid
  plan."`.
- Alchemy `pageKey` format (a UUID-shaped `sha256` digest) and its ten-minute lifetime; the real
  keys are opaque and their TTL is not published.
- Alchemy's rule that a zero balance is omitted from the inventory form of
  `alchemy_getTokenBalances` (kept when an explicit contract list is passed).
- Alchemy and NodeReal vendor-level `429`/`500` JSON-RPC bodies (`code 429` / `-32005` /
  `-32603` messages).
- Alchemy returning an empty `transfers` array (rather than an error) when only the `internal`
  category is requested on Arbitrum.
- NodeReal `nr_getAssetTransfersCount` (`{count:"0x…"}`), `nr_getTransactionByAddress`
  (`{transactions:[…]}`) and its page-key field name.
- The exact block-window error text for NodeReal (the 100,000-block limit and the smaller 1,000
  for transaction lookups are real; the wording is ours).
- `maxCount` being clamped to 1,000 instead of rejected.

## Files

- `server.mjs` — the server and its CLI;
- `fixtures.mjs` — the fixture user, the payloads built from it and the balances those events imply;
- `check-fixture.mjs` — the independent replay that asserts every balance and hash link on every
  chain and through every provider.
