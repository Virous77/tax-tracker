# Multichain EVM import and PDF import

Checked **2026-11-17**. Extends `phase2-apis.md §3` (Etherscan V2 request/response shapes, block-range walking, row keys,
classification, spam rules). That section is not repeated here.

Evidence labels: **OFFICIAL** = vendor docs on the date shown; **PROBE** = an unauthenticated request made from this
machine on 2026-11-17 against public endpoints with a well-known public address (no user data); **THIRD** = third party only;
**UNVERIFIED** = not confirmed.

Chains in scope (SPEC-phase2 §1): Ethereum **1**, Base **8453**, Arbitrum One **42161**, Polygon PoS **137**, BNB Smart Chain **56**.

## Sources

| Id  | Source (opened 2026-11-17)                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ES1 | Etherscan supported chains: <https://docs.etherscan.io/supported-chains>                                                                                                                                                                                                                                                                      |
| ES2 | Etherscan rate limits: <https://docs.etherscan.io/rate-limits>; plans and prices: <https://etherscan.io/apis>                                                                                                                                                                                                                                 |
| BS1 | Blockscout PRO API chain list and credit prices (live JSON): <https://api.blockscout.com/api/json/config>; chain registry <https://chains.blockscout.com/api/chains>                                                                                                                                                                          |
| BS2 | Blockscout docs: <https://docs.blockscout.com/devs/dev-portal>, <https://docs.blockscout.com/base-api>, <https://docs.blockscout.com/devs/migrate-from-etherscan>                                                                                                                                                                             |
| AL1 | Alchemy `alchemy_getAssetTransfers`: <https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers>, quickstart <https://www.alchemy.com/docs/reference/transfers-api-quickstart>                                                                                                                          |
| AL2 | Alchemy compute-unit costs: <https://www.alchemy.com/docs/reference/compute-unit-costs>; free tier (30M CU/month, 300 CU/s) from Alchemy's support page as indexed by search, and Orb's capture dated 2026-11-02 (THIRD)                                                                                                                      |
| RS1 | Routescan pricing <https://routescan.io/pricing>, Etherscan-compat guide <https://docs.routescan.io/getting-started/migrate-from-etherscan>                                                                                                                                                                                                   |
| NR1 | NodeReal `nr_getAssetTransfers` <https://docs.nodereal.io/reference/nr_getassettransfers>, `nr_getTransactionByAddress` <https://docs.nodereal.io/reference/nr_gettransactionbyaddress>, BscScan migration (updated 2025-12-14) <https://docs.nodereal.io/docs/migrating-from-bscscan>, pricing <https://nodereal.io/api-marketplace/bsc-rpc> |
| GR1 | GoldRush (Covalent) pricing: <https://goldrush.dev/pricing.md>                                                                                                                                                                                                                                                                                |
| MO1 | Moralis pricing: <https://docs.moralis.com/get-started/pricing>                                                                                                                                                                                                                                                                               |
| OP1 | OP Stack fees: <https://docs.optimism.io/stack/transactions/fees>; op-geth receipt fields: <https://docs.optimism.io/node-operators/reference/op-geth-json-rpc>                                                                                                                                                                               |
| AR1 | Arbitrum gas and L1 pricing: <https://docs.arbitrum.io/how-arbitrum-works/gas-fees>, <https://developer.arbitrum.io/arbos/l1-pricing>                                                                                                                                                                                                         |
| TL1 | Uniswap Labs Default token list v22.34.0, timestamp 2026-11-16T20:28:30Z: <https://tokens.uniswap.org>                                                                                                                                                                                                                                        |
| TL2 | PancakeSwap Extended token list v2.16.801, timestamp 2026-11-12T07:01:17Z: <https://tokens.pancakeswap.finance/pancakeswap-extended.json>                                                                                                                                                                                                     |
| TL3 | Circle USDC addresses: <https://developers.circle.com/stablecoins/usdc-contract-addresses>                                                                                                                                                                                                                                                    |
| PG1 | Polygon network config (official): <https://raw.githubusercontent.com/0xPolygon/static/master/network/mainnet/v1/index.json>                                                                                                                                                                                                                  |
| BB1 | Base contracts: <https://docs.base.org/base-chain/network-information/base-contracts>; Arbitrum contracts: <https://docs.arbitrum.io/build-decentralized-apps/reference/contract-addresses>                                                                                                                                                   |
| BNB | BNB Chain Fermi hard fork (0.45 s blocks, 2026-01-14): <https://www.bnbchain.org/en/blog/fermi-hard-fork-accelerates-bsc-to-0-45-second-block-times>                                                                                                                                                                                          |
| BN7 | Binance MATIC→POL completion (2024-09-13): <https://www.binance.com/en-AE/support/announcement/detail/619c4929fc3f4a0d9df7f9ae1d4519a5>                                                                                                                                                                                                       |
| NPM | npm registry metadata (`npm view … --json`), downloads API (week 2026-11-09 → 15), bulk advisory endpoint; tarballs of `unpdf@2.1.0` and `pdfjs-dist@6.5.438` unpacked (not installed) in a scratch folder to inspect contents                                                                                                                |

---

# Part 1. EVM chains

## 1.1 Who serves full address history for free

"Full history" = normal txs + internal txs + ERC-20 transfers + gas for each sent tx.

| Provider                                | Key                 | Ethereum 1                                                                        | Base 8453                                                | Arbitrum 42161                  | Polygon 137         | BSC 56                     |
| --------------------------------------- | ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------- | ------------------- | -------------------------- |
| **Etherscan V2**                        | free key            | ✔ free                                                                            | ✘ **paid only**                                          | ✔ free (shared community pool¹) | ✔ free              | ✘ **paid only**            |
| Etherscan V2                            | paid (Lite $49/mo+) | ✔                                                                                 | ✔                                                        | ✔                               | ✔                   | ✔ ("All supported chains") |
| **Blockscout PRO API**                  | free key (required) | ✔                                                                                 | ✘ **paid only** ("Base API access requires a paid plan") | ✔                               | ✔                   | ✘ **not indexed**          |
| **Alchemy** `alchemy_getAssetTransfers` | free key            | ✔ ext + int + erc20                                                               | ✔ ext + int + erc20                                      | ⚠ ext + erc20, **no internal**  | ✔ ext + int + erc20 | ✘ method not offered       |
| Routescan (Etherscan-compatible)        | keyless or free key | ⚠ answers but **returned empty history and balance 0 for a busy address** (PROBE) | ✘ "chain not supported" (PROBE)                          | ✘ (PROBE)                       | ✘ (PROBE)           | ✘ (PROBE)                  |
| **NodeReal** `nr_getAssetTransfers`     | free key            | ✔                                                                                 | ✘                                                        | ✘                               | ✘                   | ✔ ext + int + BEP-20       |
| GoldRush (Covalent)                     | —                   | 14-day trial only (25k credits), then $10/mo+ (GR1)                               |                                                          |                                 |                     |                            |
| Moralis                                 | —                   | "no self-serve free plan" (MO1); Starter $149/mo                                  |                                                          |                                 |                     |                            |

¹ From `phase2-apis.md §3.1`: since 2026-11-01 Arbitrum free-tier calls draw from a shared per-chain pool; when it runs dry the error is "Community Free API limit reached. Resets <time> UTC". ES1 (2026-11-17) still lists 42161 as "Free tier available".

Sources: ES1, ES2, BS1 (live chain map: 1 → eth.blockscout.com, 8453 → base.blockscout.com, 42161 → arbitrum.blockscout.com, 137 → polygon.blockscout.com, **56 → none**), BS2, AL1, RS1 + PROBE, NR1, GR1, MO1.

## 1.2 Recommended provider chain per network

The user brings their own keys (no shared project key, privacy rule 8). All keys are optional; the UI shows which chains each key unlocks.

| Chain          | 1st                                     | 2nd                   | 3rd                                         | Needs paid key?                                  |
| -------------- | --------------------------------------- | --------------------- | ------------------------------------------- | ------------------------------------------------ |
| Ethereum 1     | Etherscan V2 (free key)                 | Blockscout (free key) | Alchemy (free key)                          | no                                               |
| Polygon 137    | Etherscan V2 (free key)                 | Blockscout (free key) | Alchemy (free key)                          | no                                               |
| Arbitrum 42161 | Etherscan V2 (free key, community pool) | Blockscout (free key) | Alchemy (free; internal txs missing → flag) | no                                               |
| Base 8453      | **Alchemy (free key)**                  | Etherscan V2 **paid** | Blockscout **paid**                         | no if the user has an Alchemy key; otherwise yes |
| BSC 56         | **NodeReal (free key)**                 | Etherscan V2 **paid** | —                                           | no if the user has a NodeReal key; otherwise yes |

One paid Etherscan key (Lite, $49/month, ES2) covers all five chains with one adapter and is the simplest option for a user who wants it. Offer it as "one key for everything" next to the free combination "Etherscan + Alchemy + NodeReal".

Never use Routescan for these chains: on chain 1 it answered `status:"1"` with an empty list and a zero balance for a very active address (PROBE). Silent empty answers are worse than errors.

Adapter shape: two families.

- **Explorer family** (Etherscan V2, Blockscout, paid Etherscan): one parser, `phase2-apis.md §3.1–3.3`.
- **Transfers family** (Alchemy, NodeReal): JSON-RPC POST, `pageKey` paging, results grouped by `hash` into the same `(native, internal, token)` legs the classifier already uses (`phase2-apis.md §3.5`), plus one receipt per sent tx for gas.

## 1.3 Provider reference

### Etherscan V2

Shapes, paging, error strings: `phase2-apis.md §3.1–3.2`. Today's additions:

- Free: 3 calls/s, up to 100,000/day, hard stop at the cap (ES2). 46 chains free, 11 paid-only; 8453 and 56 "Paid tier only" (ES1).
- Paid plans (ES2): Lite $49 (5/s, 100k/day), Standard $199 (10/s, 200k/day, PRO endpoints), Advanced $299, Professional $399, Pro Plus $899. All paid plans cover "All supported chains".
- For **Base** (paid key): `txlist` has no L1 data fee. Fetch `module=proxy&action=eth_getTransactionReceipt&txhash=…` for each tx the user sent and add `l1Fee` (§1.8).

### Blockscout PRO API

- Base `https://api.blockscout.com/v2/api?chain_id=<id>&module=…&action=…`, key required on every tier (BS2). Credits: default **20** per call; REST v2 `addresses/:a/token-transfers` 30, `/internal-transactions` 40 (BS1, live JSON).
- Free: 100,000 credits/day → about 5,000 Etherscan-style calls/day; 5 RPS (`phase2-apis.md §3.3`).
- Chains: 1, 42161, 137 free; 8453 paid (Builder from $49/mo, BS2); 56 not served.

### Alchemy `alchemy_getAssetTransfers` (AL1)

POST `https://<network>.g.alchemy.com/v2/<key>`, networks `eth-mainnet`, `base-mainnet`, `arb-mainnet`, `polygon-mainnet`. 120 CU per call; `eth_getTransactionReceipt` 20 CU; `eth_getBlockReceipts` 20 CU (AL2). Free tier about **30M CU/month, 300 CU/s** (AL2, THIRD capture; one Alchemy docs table says 300M; either way ample).

Request (one direction per call; run twice, `fromAddress` then `toAddress`):

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "alchemy_getAssetTransfers",
	"params": [
		{
			"fromBlock": "0x0",
			"toBlock": "latest",
			"fromAddress": "0x<user>",
			"category": ["external", "internal", "erc20"],
			"withMetadata": true,
			"excludeZeroValue": false,
			"maxCount": "0x3e8",
			"order": "asc"
		}
	]
}
```

Response:

```json
{
	"result": {
		"pageKey": "<uuid or absent>",
		"transfers": [
			{
				"blockNum": "0x12a05f2",
				"uniqueId": "0x<hash>:log:5",
				"hash": "0x<hash>",
				"from": "0x…",
				"to": "0x…",
				"value": 1.5,
				"asset": "USDC",
				"category": "erc20",
				"rawContract": {
					"value": "0x16e360",
					"address": "0xa0b8…",
					"decimal": "0x6"
				},
				"metadata": { "blockTimestamp": "2026-01-02T10:00:00.000Z" }
			}
		]
	}
}
```

- `internal` is supported **only** on Ethereum, Polygon, Base (and Arc). Not on Arbitrum (AL1). On Arbitrum an ETH payout from a contract (e.g. a DEX sell to ETH) will be missing → the balance check fails → flag `import_incomplete` "internal transfers not available from this provider on Arbitrum; add an Etherscan or Blockscout key".
- **Never read `value`**: it is a JSON float. Use `rawContract.value` (hex integer) ÷ 10^`rawContract.decimal`. For `external`/`internal`, decimals = 18.
- `uniqueId` gives a stable per-leg id (`<hash>:log:<logIndex>` for tokens), better than the explorer's missing `logIndex` (`phase2-apis.md §3.6`). Keep it in `raw`, but keep the provider-neutral `sourceRef`.
- Page: up to 1,000 per page; `pageKey` expires after **10 minutes** (AL1): page straight through, never park a cursor.
- Gaps by design: no gas, no failed txs, no approvals (they move no asset), zero-value internal and `delegatecall` transfers excluded (AL1). Gas and those txs come from the completeness step (§1.9).
- `toBlock: "indexed"` returns cached data that may lag the head; use `latest` minus the safety margin from `phase2-apis.md §3.2`.

### NodeReal (BSC) (NR1)

POST `https://bsc-mainnet.nodereal.io/v1/<key>` (key in the URL path → redact URLs in logs). Supported chains: "BSC and ETH mainnet only".

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "nr_getAssetTransfers",
	"params": [
		{
			"category": ["external", "internal", "20"],
			"fromBlock": "0x47a1f00",
			"toBlock": "0x47ba5a0",
			"fromAddress": "0x<user>",
			"order": "asc",
			"maxCount": "0x3e8",
			"excludeZeroValue": false
		}
	]
}
```

- **Block window ≤ 100,000 blocks** when both bounds are set. BSC blocks are 0.45 s since the Fermi fork of 2026-01-14 (block 75,140,593; BNB), so a window is about 12.5 hours now and longer in earlier years. A full history from genesis is roughly 1,300+ windows per direction. At 300 CU/s free throughput that is minutes, not hours, but it is many calls. Use `nr_getAssetTransfersCount` first to skip empty ranges if it accepts wide ranges (**UNVERIFIED**).
- `maxCount` ≤ 1000, `pageKey` paging inside a window.
- Response transfers carry `category`, `blockNum`, `from`, `to`, `value` (**hex**), `asset`, `hash`, `contractAddress`, `decimal` (hex, may be null), a block timestamp (`blockTimeStamp` in the example, `blockTimestamp` in the field list: accept both), and for `external` only `gasPrice`, `gasUsed`, `receiptsStatus` (1/0). So gas comes back without receipt calls.
- Free: **10M CU/month, 300 CUPS** (NR1 pricing). Per-method CU cost not published (a third party says 50 for `nr_getAssetTransfers`, **UNVERIFIED**).
- `nr_getTransactionByAddress` has a **1,000-block** window: not useful for full history.

### Routescan (RS1, PROBE)

`https://api.routescan.io/v2/network/mainnet/evm/<chainId>/etherscan/api`. Free without key 2 calls/s and 10,000/day; free key 5/s and 100,000/day. PROBE on 2026-11-17: 56, 8453, 42161, 137 → `{"status":"0","message":"chain not supported"}`; chain 1 `txlist` and `balance` returned empty/0 for a busy public address. Not usable here.

### GoldRush (Covalent) and Moralis

Both dropped self-serve free tiers: GoldRush has a 14-day trial with 25,000 credits, then Vibe Coding $10/mo (10k credits, 4 RPS) or Professional $250/mo (GR1). Moralis: "There is no self-serve free plan"; Starter $149/mo with 2M CU (MO1); `getWalletHistory` 150 CU per chain (THIRD). Not recommended. They return decoded multi-chain histories but add a paid dependency and a second data model.

## 1.4 Native asset per chain

| Chain | Native      | Decimals | Asset id                                       |
| ----- | ----------- | -------- | ---------------------------------------------- |
| 1     | ETH         | 18       | `ETH`                                          |
| 8453  | ETH         | 18       | `ETH`                                          |
| 42161 | ETH         | 18       | `ETH`                                          |
| 137   | MATIC → POL | 18       | `MATIC` before the switch, `POL` after (below) |
| 56    | BNB         | 18       | `BNB`                                          |

**MATIC → POL.** POL replaced MATIC as Polygon PoS's native gas token on **2024-09-04** (about 12:00 UTC); balances on Polygon PoS converted 1:1 with no transaction (THIRD: The Block, CoinDesk; Polygon docs: "MATIC tokens stored on the Polygon PoS chain are automatically converted to POL at a 1:1 ratio"). The on-chain symbol changed later with the Ahmedabad upgrade, block 62,278,656 (2024-09-26, Polygon blog). Binance delisted MATIC pairs on 2024-09-10 and credited POL 1:1 on 2024-09-13 (BN7). On Ethereum, the MATIC ERC-20 (`0x7d1a…ebb0`) can be migrated to POL (`0x455e…c3f6`) via `PolygonMigrationProxy` `0x29e7df7b6a1b2b07b731457f499e1696c60e2c4e` (PG1).

Recommendation:

- Chain config: `native: [{ until: "2024-09-04T12:00:00Z", asset: "MATIC" }, { asset: "POL" }]`. A pre-switch deposit from Binance (MATIC) then matches the Binance withdrawal.
- At the switch, emit one synthetic `redenomination` event per Polygon address that held a balance: MATIC out, POL in, same quantity, **cost and acquisition dates carried over**, flagged for review with the CA question. Do the same for Binance's `Token Swap - Redenomination/Rebranding` rows and for `PolygonMigration` contract calls on Ethereum.
- If the engine has no carry-over event yet, the fallback is a `swap` at zero gain (consideration = carried cost), flagged. Never a taxable sale at FMV without the user's choice.

## 1.5 Same token across chains: one asset id or many?

Rule: **map a contract to a plain symbol only when the major exchanges credit a deposit of that contract as that symbol.** Then a Binance withdrawal of `USDT` over BSC matches the on-chain receipt of BSC-USD, and lots flow across. Everything else gets its own id so a swap between two versions stays visible.

| Case                                                                                                                                       | Asset id                                             | Why                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ETH native on 1, 8453, 42161                                                                                                               | `ETH`                                                | Same asset; exchanges credit "ETH" on each network. SPEC-phase2 §1.1 already decided this (CA question kept). |
| WETH (1: `0xc02a…6cc2`, 8453: `0x4200…0006`, 42161: `0x82af…bab1`, 137: `0x7ceb…f619`)                                                     | `WETH`                                               | Wrap/unwrap stays a visible, flagged `complex_onchain` swap (SPEC-phase2 §2).                                 |
| Binance-Peg ETH on BSC `0x2170…33f8` (Uniswap list calls it WETH; PancakeSwap "Binance Pegged ETH")                                        | `ETH`                                                | Binance's ETH-on-BEP20 withdrawals deliver this token.                                                        |
| BTCB on BSC `0x7130…ad9c`                                                                                                                  | `BTC`                                                | Binance's BTC-on-BEP20 withdrawals deliver BTCB. Same logic.                                                  |
| WBTC, cbBTC, tBTC                                                                                                                          | `WBTC`, `CBBTC`, `TBTC`                              | Different issuers; exchanges list them as separate coins.                                                     |
| Native USDC (Circle, TL3) on 1, 8453, 42161, 137                                                                                           | `USDC`                                               | Same issuer.                                                                                                  |
| USDC on BSC `0x8ac7…580d` (Binance-Peg, **18 decimals**)                                                                                   | `USDC`                                               | Credited as USDC by Binance.                                                                                  |
| Bridged USDC.e on Arbitrum `0xff97…5cc8`, Polygon `0x2791…4174`; USDbC on Base `0xd9aa…b6ca`                                               | `USDC.E`, `USDBC` (`AssetSchema` allows `.`)         | Bridge-issued claims, not Circle USDC; swapping USDC.e → USDC is a real transfer. Price them like USDC.       |
| USDT: Ethereum `0xdac1…1ec7`; Polygon `0xc213…8e8f`; Arbitrum USDT0 `0xfd08…cbb9`; Base `0xfde4…9bb2`; BSC `0x5539…7955` (**18 decimals**) | `USDT`                                               | Exchanges credit all of these as USDT on the matching network.                                                |
| POL ERC-20 on Ethereum / Arbitrum, MATIC ERC-20 on Ethereum / BSC                                                                          | `POL` / `MATIC`                                      | §1.4.                                                                                                         |
| Everything not in the known list                                                                                                           | `ERC20:<chainId>:<CONTRACT>` (`phase2-apis.md §3.7`) | Stops look-alikes merging into real lots.                                                                     |

Decimals always come from the known-token table (or `tokenDecimal` on the transfer row), never assumed: BSC USDT and USDC use 18, everywhere else 6.

CA question (Q6): **Is moving ETH from Ethereum to Base or Arbitrum (via the official bridge or by withdrawing from an exchange to an L2) a transfer of a VDA, or does the user still hold the same asset?** Our default treats it as the same asset (one `ETH` lot pool, the move is a self-transfer with cost and date carried). Related: is a bridged token (USDC.e) the same VDA as the native one, and is wrapping ETH→WETH a transfer?

## 1.6 Known-token lists (top ~20 per chain)

Addresses below are copied from **TL1** (Uniswap Default list, 2026-11-16) unless marked TL2 (PancakeSwap Extended, 2026-11-12). USDC rows cross-checked against Circle (TL3, matches on 1/8453/42161/137). Tether's own page lists only Ethereum among these chains. Ship them as `packages/evm/data/tokens-<chainId>.json` (the format of the existing `tokens-1.json`). Refresh by re-downloading TL1/TL2 and diffing; never auto-merge.

**Ethereum (1)**: existing `packages/evm/data/tokens-1.json` already matches TL1 for USDT, USDC, DAI, WETH, WBTC, LINK, UNI, AAVE, MATIC, SHIB, PEPE, STETH, LDO, GRT, CRV. Add:

| Symbol | Address                                      | Dec |
| ------ | -------------------------------------------- | --- |
| POL    | `0x455e53cbb86018ac2b8092fdcd39d8444affc3f6` | 18  |
| ARB    | `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1` | 18  |
| CBBTC  | `0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf` | 8   |
| MKR    | `0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2` | 18  |
| SKY    | `0x56072c95faa701256059aa122697b133aded9279` | 18  |
| USDS   | `0xdc035d45d973e3ec169d2276ddab16f1e407384f` | 18  |
| ENA    | `0x57e114b691db790c35207b2e685d4a43181e6061` | 18  |
| ONDO   | `0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3` | 18  |
| PYUSD  | `0x6c3ea9036406852006290770bedfcaba0e23a0e8` | 6   |
| FET    | `0xaea46a60368a7bd060eec7df8cba43b7ef41ad85` | 18  |
| RNDR   | `0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24` | 18  |
| CBETH  | `0xbe9895146f7af43049ca1c1ae358b0541ea49704` | 18  |

**Base (8453)**

| Symbol | Address                                      | Dec | Note                |
| ------ | -------------------------------------------- | --- | ------------------- |
| USDC   | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | 6   | Circle native (TL3) |
| USDBC  | `0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca` | 6   | bridged USDC        |
| USDT   | `0xfde4c96c8593536e31f229ea8f37b2ada2699bb2` | 6   |                     |
| DAI    | `0x50c5725949a6f0c72e6c4a641f24049a917db0cb` | 18  |                     |
| WETH   | `0x4200000000000000000000000000000000000006` | 18  | predeploy (BB1)     |
| CBBTC  | `0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf` | 8   |                     |
| CBETH  | `0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22` | 18  |                     |
| AERO   | `0x940181a94a35a4569e4529a3cdfb74e38fd98631` | 18  |                     |
| UNI    | `0xc3de830ea07524a0761646a6a4e4be0e114a3c83` | 18  |                     |
| AAVE   | `0x63706e401c06ac8513145b7687a14804d17f814b` | 18  |                     |
| PEPE   | `0xb4fde59a779991bfb6a52253b51947828b982be3` | 18  |                     |
| CRV    | `0x8ee73c484a26e0a5df2ee2a4960b789967dd0415` | 18  |                     |
| GRT    | `0x0f4d237b09cb37d207ba60353dc254d4530d4df1` | 18  |                     |
| FET    | `0x74f804b4140ee70830b3eef4e690325841575f89` | 18  |                     |
| COMP   | `0x9e1028f5f1d5ede59748ffcee5532509976840e0` | 18  |                     |
| SNX    | `0x22e6966b799c4d5b13be962e1d117b56327fda66` | 18  |                     |
| EURC   | `0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42` | 6   |                     |
| TBTC   | `0x236aa50979d5f3de3bd1eeb40e81137f22ab794b` | 18  |                     |

**Arbitrum One (42161)**

| Symbol | Address                                      | Dec | Note                |
| ------ | -------------------------------------------- | --- | ------------------- |
| USDC   | `0xaf88d065e77c8cc2239327c5edb3a432268e5831` | 6   | Circle native (TL3) |
| USDC.E | `0xff970a61a04b1ca14834a43f5de4533ebddb5cc8` | 6   | bridged             |
| USDT   | `0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9` | 6   | TL1 symbol `USDT0`  |
| DAI    | `0xda10009cbd5d07dd0cecc66161fc93d7c9000da1` | 18  |                     |
| WETH   | `0x82af49447d8a07e3bd95bd0d56f35241523fbab1` | 18  |                     |
| WBTC   | `0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f` | 8   |                     |
| CBBTC  | `0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf` | 8   |                     |
| ARB    | `0x912ce59144191c1204e64559fe8253a0e49e6548` | 18  |                     |
| LINK   | `0xf97f4df75117a78c1a5a0dbb814af92458539fb4` | 18  |                     |
| UNI    | `0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0` | 18  |                     |
| AAVE   | `0xba5ddd1f9d7f570dc94a51479a000e3bce967196` | 18  |                     |
| GMX    | `0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a` | 18  |                     |
| PEPE   | `0x35e6a59f786d9266c7961ea28c7b768b33959cbb` | 18  |                     |
| LDO    | `0x13ad51ed4f1b7e9dc168d8a00cb3f4ddd85efa60` | 18  |                     |
| CRV    | `0x11cdb42b0eb46d95f990bedd4695a6e3fa034978` | 18  |                     |
| GRT    | `0x9623063377ad1b27544c965ccd7342f7ea7e88c7` | 18  |                     |
| POL    | `0x044d8e7f3a17751d521efea8ccf9282268fe08cc` | 18  |                     |

**Polygon PoS (137)**

| Symbol | Address                                                           | Dec | Note                                          |
| ------ | ----------------------------------------------------------------- | --- | --------------------------------------------- |
| POL    | native; ERC-20 alias `0x0000000000000000000000000000000000001010` | 18  | TL1 still labels it `MATIC`; §1.4             |
| WPOL   | `0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270`                      | 18  | TL1 still says `WMATIC`; renamed in Ahmedabad |
| USDC   | `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`                      | 6   | Circle native (TL3)                           |
| USDC.E | `0x2791bca1f2de4661ed88a30c99a7a9449aa84174`                      | 6   | PoS-bridged                                   |
| USDT   | `0xc2132d05d31c914a87c6611c10748aeb04b58e8f`                      | 6   |                                               |
| DAI    | `0x8f3cf7ad23cd3cadbd9735aff958023239c6a063`                      | 18  |                                               |
| WETH   | `0x7ceb23fd6bc0add59e62ac25578270cff1b9f619`                      | 18  |                                               |
| WBTC   | `0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6`                      | 8   |                                               |
| LINK   | `0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39`                      | 18  |                                               |
| UNI    | `0xb33eaad8d922b1083446dc23f610c2567fb5180f`                      | 18  |                                               |
| AAVE   | `0xd6df932a45c0f255f85145f286ea0b292b21c90b`                      | 18  |                                               |
| CRV    | `0x172370d5cd63279efa6d502dab29171933a610af`                      | 18  |                                               |
| LDO    | `0xc3c7d422809852031b44ab29eec9f1eff2a58756`                      | 18  |                                               |
| SHIB   | `0x6f8a06447ff6fcf75d803135a7de15ce88c1d4ec`                      | 18  |                                               |
| SAND   | `0xbbba073c31bf03b8acf7c28ef0738decf3695683`                      | 18  |                                               |
| MANA   | `0xa1c57f48f0deb89f569dfbe6e2b7f46d33606fd4`                      | 18  |                                               |
| GRT    | `0x5fe2b58c013d7601147dcdd68c143a77499f5531`                      | 18  |                                               |
| EURC   | `0x8a037dbca8134ffc72c362e394e35e0cad618f85`                      | 6   |                                               |

The `0x…1010` alias emits ERC-20 `Transfer` logs for native moves on some explorers. Drop `tokentx` rows for that contract, or native POL is counted twice.

**BNB Smart Chain (56)**. Mostly TL2 (TL1 has no BTCB, CAKE, FDUSD).

| Symbol | Address                                      | Dec   | Note                                                                                                   |
| ------ | -------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| USDT   | `0x55d398326f99059ff775485246999027b3197955` | 18    | "Binance Pegged USDT" (TL1 + TL2)                                                                      |
| USDC   | `0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d` | 18    | Binance-Peg (TL1 + TL2)                                                                                |
| FDUSD  | `0xc5f0f7b66764f6ec8c8dff7ba683102295e16409` | 18    | TL2                                                                                                    |
| USD1   | `0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d` | 18    | TL2                                                                                                    |
| WBNB   | `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c` | 18    |                                                                                                        |
| ETH    | `0x2170ed0880ac9a755fd29b2688956bd959f933f8` | 18    | Binance-Peg ETH (§1.5)                                                                                 |
| BTC    | `0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c` | 18    | BTCB (§1.5)                                                                                            |
| CAKE   | `0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82` | 18    | TL2                                                                                                    |
| XRP    | `0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe` | 18    | TL2, Binance-Peg                                                                                       |
| ADA    | `0x3ee2200efb3400fabb9aacf31297cbdd1d435d47` | 18    | TL2, Binance-Peg                                                                                       |
| DOGE   | `0xba2ae424d960c26247dd6c32edc70b295c744c43` | **8** | TL2                                                                                                    |
| DOT    | `0x7083609fce4d1d8dc0c979aab8c869ea2c873402` | 18    | TL2                                                                                                    |
| LTC    | `0x4338665cbb7b2485a8855a139b75d5e34ab0db94` | 18    | TL2                                                                                                    |
| LINK   | `0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd` | 18    |                                                                                                        |
| SOL    | `0x570a5d26f7765ecb712c0924e4de545b89fd43df` | 18    | TL2 (TL1 lists a different Wormhole SOL; keep TL2's)                                                   |
| AVAX   | `0x1ce0c2827e2ef14d5c4f29a091d735a204794041` | 18    | TL2                                                                                                    |
| SHIB   | `0x2859e4544c4bb03966803b044a93563bd2d0dd4d` | 18    | TL2                                                                                                    |
| TRX    | `0xce7de646e7208a4ef112cb6ed5038fa6cc6b12e3` | **6** | TL2 "Tron V2"; TL2 also lists an old 18-dp TRX `0x85ea…4d5b`: map the old one to `ERC20:56:…` and flag |
| DAI    | `0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3` | 18    |                                                                                                        |
| BUSD   | `0xe9e7cea3dedca5984780bafc599bd69add087d56` | 18    | discontinued; still in old histories                                                                   |

Binance-Peg tokens on BSC (XRP, ADA, DOT, …) map to the plain symbol only if Binance credits deposits of them as that coin. That is true for USDT, USDC, ETH, BTC (BTCB) per Binance network lists (**UNVERIFIED** for the rest; default the rest to plain symbols with a `complex_onchain` note "pegged token" until checked).

## 1.7 Bridges

Default: **flag only.** Record every leg (SPEC-phase2 §2), flag `complex_onchain` with the note "bridge", never classify as income or sale. Then try to pair legs so the user can confirm in one click.

Detection, in order:

1. **Official bridge contracts** (counterparty of the user's tx or of the token transfer):

   | Bridge       | L1 (Ethereum) contracts                                                                                                                                                                                                                                                                                                                            | L2 side                                                                                                                                                       | Source |
   | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
   | Base         | L1StandardBridge `0x3154cf16ccdb4c6d922629664174b904d80f2c35`, OptimismPortal `0x49048044d57e1c92a77f79988d21fa8faf74e97e`, L1CrossDomainMessenger `0x866e82a600a1414e583f7f13623f1ac5d58b0afa`                                                                                                                                                    | L2StandardBridge `0x4200000000000000000000000000000000000010`; deposits arrive as **type `0x7e`** system txs                                                  | BB1    |
   | Arbitrum One | Bridge `0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a`, Delayed Inbox `0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f`, Outbox `0x0b9857ae2d4a3dbe74ffe1d7df045bb7f96e4840`, L1 Gateway Router `0x72ce9c846789fdb6fc1f34ac4ad25dd9ef7031ef`, L1 ERC20 Gateway `0xa3a7b6f88361f48403514059f1f16c8e78d60eec`                                                | L2 Gateway Router `0x5288c571fd7ad117bea99bf60fe0846c4e84f933`, L2 ERC20 Gateway `0x09e9222e96e7b4ae2a407b98d48e330053351eee`, ArbSys `0x…0064` (withdrawals) | BB1    |
   | Polygon PoS  | RootChainManagerProxy `0xa0c68c638235ee32657e8f720a23cec1bfc77c77`, ERC20PredicateProxy `0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf`, EtherPredicateProxy `0x8484ef722627bf18ca5ae6bcf031c23e6e922b30`, Plasma DepositManagerProxy `0x401f6c983ea34274ec46f84d70b31c151321188b`, WithdrawManagerProxy `0x2a88696e0ffa76baa1338f2c74497cc013495922` | ChildChainManagerProxy `0xa6fa4fb5f76172d178d61b04b0ecd319c5d1c0aa`; deposits are minted by state sync (no user tx on Polygon)                                | PG1    |
   | BSC          | No official Ethereum↔BSC bridge in service (Binance Bridge closed); users move via Binance withdrawals                                                                                                                                                                                                                                             | —                                                                                                                                                             | —      |

2. **Inbound with no user-sent tx on the L2** (type `0x7e` on Base, retryable redeem on Arbitrum, state-sync mint on Polygon): an L1→L2 deposit. Pair with an outbound to the bridge on chain 1 within 1 hour, same asset, amount within fees.
3. **Third-party bridges** (Across, Stargate, Relay, Hop, Synapse, LI.FI, …): keep a small, versioned contract list per chain in `packages/evm/data/bridges-<chainId>.json`; anything else that looks like "asset out on chain A, same asset in on chain B within 1 hour, amount within 1%" becomes a **suggested** pair, never automatic.
4. **CEX withdrawals that land on L2s**: matched by tx hash against the exchange's withdrawal `TXID` (`phase2-apis.md §7.2`). No bridge logic needed. This is the common Indian-user path (Binance → Arbitrum/Base/BSC).

## 1.8 L2 gas: is `gasUsed × effectiveGasPrice` the whole fee?

| Chain          | Total fee paid by sender                                                   | Extra field                                                                                                                                                            | Evidence                                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ethereum 1     | `gasUsed × effectiveGasPrice` (explorer `gasPrice` is the effective price) | —                                                                                                                                                                      | `phase2-apis.md §3.4`                                                                                                                                                                                                 |
| Polygon 137    | `gasUsed × effectiveGasPrice`                                              | —                                                                                                                                                                      | EIP-1559 L1-style chain, no data fee                                                                                                                                                                                  |
| BSC 56         | `gasUsed × gasPrice`                                                       | —                                                                                                                                                                      | no data fee                                                                                                                                                                                                           |
| Arbitrum 42161 | **`gasUsed × effectiveGasPrice`** already includes the L1 part             | `gasUsedForL1` is a **component of** `gasUsed` (the L1 "poster fee" expressed in L2 gas units). Do not add it                                                          | AR1: total = "child chain basefee × (child chain gas used + parent chain calldata charge)"; PROBE: 3 receipts from the head block on 2026-11-17, `gasUsedForL1` 210/607/411 vs `gasUsed` 61,011/174,854/38,118        |
| Base 8453      | **`gasUsed × effectiveGasPrice + l1Fee`** (+ operator fee where enabled)   | Receipt has `l1Fee` (wei), `l1GasUsed`, `l1GasPrice`, `l1BaseFeeScalar`, `l1BlobBaseFee`, `l1BlobBaseFeeScalar`, `daFootprintGasScalar`. Not in explorer `txlist` rows | OP1: "totalFee = operatorFee + gasUsed * (baseFee + priorityFee) + l1Fee"; PROBE: Base receipts carry `l1Fee` ≈ 1.3e9 wei next to `gasUsed × effectiveGasPrice` ≈ 4.9e12–4.9e13 wei, no `operatorFee*` fields present |

Implementation:

- Base: fetch a receipt (`eth_getTransactionReceipt`, 20 CU on Alchemy; `module=proxy` on paid Etherscan) for every tx **sent** by the user and add `l1Fee`. If a receipt also carries operator-fee fields (`operatorFeeScalar`, `operatorFeeConstant`; post-Isthmus chains), add the operator fee (formula changed in the Jovian upgrade per OP1; take the exact formula from the OP specs when it first appears, **UNVERIFIED** here). Base receipts had no operator-fee fields on 2026-11-17 (PROBE). Unknown extra fee fields → `fee_review_required`.
- Type `0x7e` (deposit) txs on Base have `effectiveGasPrice = 0` and are not paid by the user (PROBE).
- Arbitrum: no receipt needed with Etherscan/Blockscout `txlist`; with Alchemy, one receipt per sent tx for gas anyway.
- Sizes are small (L1 fee about 0.003–0.03% of the total in the probe), but the balance check is exact, so leaving `l1Fee` out guarantees a `balance_mismatch` on every Base wallet.

## 1.9 Completeness check (all providers)

Transfer APIs skip approvals and failed txs, and explorer free tiers can be capped. Before marking a sync complete:

1. `eth_getTransactionCount(address, latestSafeBlock)` = number of txs the address **sent**. Compare with the count of distinct sent hashes found. Fewer → fetch the missing ones (explorer `txlist`, or walk receipts by block) or flag `import_incomplete` with "N sent transactions not found (their gas is missing)".
2. Compare computed native and token balances with `eth_getBalance` / `balanceOf` at the same block (`phase2-apis.md §3.8`).

---

# Part 2. PDF import without heavy dependencies

## 2.1 What we would parse

| PDF                                | Content                                                          | Encrypted?                                                 | Value                                   |
| ---------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| Binance Account Statement          | balance snapshot per wallet on one date (export-catalogue §1.10) | **Always**: Binance makes the user set an 8-digit password | opening/closing balances; balance check |
| CoinDCX Form 16A (TRACES)          | TDS deducted and deposited per quarter                           | usually not (UNVERIFIED for CoinDCX)                       | TDS reconciliation                      |
| Binance / CoinDCX transaction PDFs | none found                                                       | —                                                          | —                                       |

So the PDF need is narrow: text tables, born-digital, sometimes AES-encrypted. No OCR.

## 2.2 Options (npm metadata checked 2026-11-17; cooldown cut-off 2026-11-07)

| Package                  | Latest (published)                          | Installable under cooldown | Licence                           | Runtime deps                                                                  | Install scripts | Unpacked size       | Weekly downloads | Maintainers | Notes                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------- | -------------------------- | --------------------------------- | ----------------------------------------------------------------------------- | --------------- | ------------------- | ---------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pdfjs-dist** (Mozilla) | 6.5.438 (2026-11-01)                        | **6.5.438**                | Apache-2.0                        | 0; **optional** `@napi-rs/canvas ^1.0.13` (native, per-platform)              | none            | 37.6 MB / 570 files | 58.1M            | 5           | Engines `>=22.13.0 \|\| >=24`. `legacy/build/pdf.mjs` 1.1 MB + worker 2.4 MB is all we load. Monthly releases. Only advisory: GHSA-wgrm-67xf-hhpq (`<=4.1.392`, arbitrary JS via fonts); current is clean |
| **unpdf** (UnJS)         | 2.2.1 (2026-11-15)                          | **2.1.0** (2026-10-30)     | MIT (+ bundled pdf.js Apache-2.0) | 0; optional peer `@napi-rs/canvas`                                            | none            | 3.2 MB / 177 files  | 11.9M            | **1**       | Bundles a "serverless" pdf.js **6.4.299** (checked in the tarball). `extractText`, `extractTextItems`, `getDocumentProxy`. Engines `>=24`. 5 releases in 3 weeks                                          |
| pdf-parse                | 2.4.5 (2025-10-20); then 1.1.4 (2025-10-29) | 1.1.4                      | Apache-2.0                        | 2.x: `pdfjs-dist 5.4.296` + **`@napi-rs/canvas 0.1.80` as a hard dependency** | `prepare` only  | 21.3 MB             | 13.3M            | 1           | New maintainer since 2025 (original 1.1.1 dated 2018 was abandoned). 2.x drags a native canvas in; 1.x embeds an ancient pdf.js. Avoid                                                                    |
| pdf2json                 | 4.1.1 (2026-11-06)                          | 4.1.1                      | Apache-2.0                        | 0                                                                             | none            | 11.9 MB / 12 files  | 0.6M             | 1           | Own fork of an old pdf.js; positions in its own units; slower to get fixes                                                                                                                                |
| Own extractor            | —                                           | —                          | ours                              | 0 (`node:zlib`, `node:crypto`)                                                | —               | —                   | —                | —           | §2.4                                                                                                                                                                                                      |

## 2.3 Recommendation: `pdfjs-dist@6.5.438`, legacy build, text only

- First-party Mozilla code, 5 maintainers, the most-used PDF engine in JS, no install script, zero required runtime deps. The size is on disk only. At runtime we import two files.
- Add to `pnpm-workspace.yaml`: `ignoredOptionalDependencies: ["@napi-rs/canvas"]` so the native canvas binary is never downloaded. We never render pages. (The key exists in pnpm 9.x/10.x; confirm on the repo's pnpm version before relying on it.) This tightens supply chain, it does not weaken it.
- Use it in `packages/importers` only, in the Node build: `import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"`, `getDocument({ data, password, isEvalSupported: false, disableFontFace: true, useSystemFonts: false })`, then `page.getTextContent()` per page. The worker runs in-process on Node.
- **Alternative:** `unpdf@2.1.0` (zero deps, 3.2 MB, nicer API). It is a single-maintainer re-bundle of pdf.js that trails Mozilla by a release. The same trust question we raised for `@e965/xlsx` in `libraries.md` applies. Choose it only if the Docker image size of pdfjs-dist's traced files becomes a problem.
- Not pdf-parse (native canvas as a hard dependency in 2.x). Not pdf2json (forked engine).

## 2.4 Writing our own extractor: realistic?

What a born-digital statement PDF needs, and how big each piece is:

| Piece                                                                                                                                     | Needed for Binance/TRACES PDFs?                  | Effort                             |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| xref table **and** xref streams / object streams (PDF 1.5+)                                                                               | yes (modern generators use object streams)       | medium                             |
| FlateDecode (`node:zlib.inflateSync`), predictors (PNG predictor on xref streams)                                                         | yes                                              | small                              |
| Content-stream tokenizer; `BT/ET`, `Tf`, `Tm`, `Td`, `TD`, `T*`, `Tj`, `TJ`, `'`, `"`, `cm`, `q/Q` with a graphics-state stack            | yes                                              | medium                             |
| Fonts: Type0/CID with `Identity-H` and a **ToUnicode CMap** (`bfchar`, `bfrange`); simple fonts with `/Differences`                       | yes (embedded subset fonts are the norm)         | medium                             |
| Glyph widths (`W` arrays, `Widths`) to place each next glyph                                                                              | yes, for column positions                        | medium                             |
| **Encryption**: Standard security handler R4 (RC4/AES-128) and **R6 (AES-256, SHA-256/384/512 "hardened" key derivation, Algorithm 2.B)** | yes for Binance: every PDF is password-protected | large and easy to get subtly wrong |
| Form XObjects, inline images, broken xref recovery                                                                                        | sometimes                                        | medium                             |

Estimate: 1,500–2,500 lines plus a corpus of real PDFs to test against, and ongoing fixes whenever a generator changes. The encryption piece alone is where homemade parsers usually fail. **Not worth it** when a zero-dependency, Apache-licensed engine from Mozilla does all of it. Revisit only if pdf.js ever gains required native deps.

## 2.5 Rebuilding table rows from positioned text

`getTextContent()` returns items `{ str, transform: [a, b, c, d, e, f], width, height, hasEOL }`. `e, f` = x, y in PDF points, origin bottom-left.

1. Per page, drop empty `str`. Normalise to `x = e`, `y = pageHeight − f`. Ignore rotated items (`b ≠ 0`).
2. **Lines:** sort by `y`, then cluster items whose `y` differs by less than ~40% of the median font height (`height` or `√(a² + b²)`).
3. **Words:** within a line, sort by `x`. Merge neighbours when the gap is less than ~25% of the font height (pdf.js often splits a word into several items).
4. **Columns:** find the table's header line by matching known header words (`Coin`, `Amount`, …). Each header cell gives an x-interval. Assign every later cell to the column whose interval overlaps it most. Right-aligned numbers: use the cell's right edge (`x + width`).
5. **Rows that wrap** (a long name on two lines): a line with no value in the key numeric column belongs to the row above.
6. **Page breaks:** repeated header lines on each page are skipped; a footer band (page numbers, "Generated on …") is cut by y-range.
7. Keep every reconstructed row with its page number and bounding box in `raw` (rule 6), so a reviewer can find it in the PDF.
8. Numbers: strip thousands separators, keep the digits as a decimal string, never `parseFloat`.

## 2.6 Failure modes and what the importer does

| Failure                                              | Detect                                                                            | Action                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Password-protected** (every Binance PDF)           | pdf.js throws `PasswordException` (`NEED_PASSWORD` = 1, `INCORRECT_PASSWORD` = 2) | Ask for the password in the upload dialog; pass it once; **never store or log it**. Wrong twice → stop with a clear message |
| Owner-password only (printing/copy restricted)       | opens without a password                                                          | proceed; extraction is allowed by pdf.js                                                                                    |
| **Scanned / image-only PDF**                         | pages with images but no text items                                               | reject: "this PDF has no text layer"; no OCR (would need large deps and guesses)                                            |
| Text without a usable ToUnicode map (garbage glyphs) | high share of characters outside printable ranges, or header words not found      | reject with `parse_warning`; ask for the CSV/XLSX equivalent                                                                |
| Layout changed (headers not found)                   | header matching fails                                                             | fail the file, keep raw text for a bug report the user can choose to share                                                  |
| Table split across pages                             | repeated headers                                                                  | §2.5 step 6                                                                                                                 |
| Hostile PDF (JS, huge streams)                       | —                                                                                 | `isEvalSupported: false`, no rendering, input cap (e.g. 25 MB like the XLSX reader), time limit per file                    |

---

## Open questions

For the user:

1. Which API keys are you willing to create: Etherscan (free), Alchemy (free), NodeReal (free), or one paid Etherscan key? This decides whether Base and BSC work out of the box.
2. A redacted Binance Account Statement PDF (and its password, entered locally) to fix the table columns.
3. Do you hold any of: USDC.e / USDbC, Binance-Peg tokens other than USDT/USDC/ETH/BTCB, MATIC on Ethereum? These decide how much of §1.5 matters now.

For a CA (numbering continues from `export-catalogue.md §5`):

- **Q6** Moving ETH between Ethereum and an L2 (official bridge or exchange withdrawal to the L2): same VDA, or a transfer? Same for bridged stablecoins (USDC.e vs USDC) and wrapping (ETH → WETH).
- **Q7** MATIC → POL automatic 1:1 conversion on Polygon PoS (no user action) and Binance's swap: a transfer at FMV, or the same holding with cost and date carried?
- **Q8** Are L2 data fees (Base `l1Fee`) treated like ordinary gas under the `feeTreatment` setting?

To verify at build time:

- NodeReal: CU cost per `nr_getAssetTransfers` call, and whether `nr_getAssetTransfersCount` accepts ranges wider than 100,000 blocks.
- Alchemy: whether failed txs ever appear in `external` transfers (assume not).
- pnpm: `ignoredOptionalDependencies` on the installed pnpm version.
