# Explorer import

`@tax/evm` exports `evmConnector`, the four provider adapters, `ExplorerProvider`,
`FallbackExplorer`, `createExplorer`, `walkBlocks`, `classifyTransactions`, chain/token helpers,
and the local `EvmOptions` / `ProviderConfig` types. Connectors do no database writes.

Provider order comes from `data/chains.json`, filtered to the caller's supplied keys:

| Chain                | Preferred → fallback                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| Ethereum (1)         | Etherscan free → Blockscout free → Alchemy free                                      |
| Polygon PoS (137)    | Etherscan free → Blockscout free → Alchemy free                                      |
| Arbitrum One (42161) | Etherscan free/community pool → Blockscout free → Alchemy free, incomplete internals |
| Base (8453)          | Alchemy free → Etherscan paid → Blockscout paid                                      |
| BNB Smart Chain (56) | NodeReal free → Etherscan paid                                                       |

Etherscan V2 uses `chainid` and its key in the query string. Blockscout uses the unified
`https://api.blockscout.com/v2/api`, `chain_id`, and the `authorization` header. The research
§1.3 deprecates the old keyless per-instance hosts; the free instances indexed by the unified
API are Ethereum, Arbitrum and Polygon. Base requires a paid Blockscout key; BSC is not indexed.
A user-supplied paid Etherscan key covers all five chains. A free key rejected on a paid-only
chain produces an explicit paid-plan message and tries the next provider. Rate limits, outages
and unsupported-chain/method responses also fail over; invalid credentials remain errors.

Each history cursor is `{ lastBlock, provider }`, with a separate provider per action. A provider
switch discards that action's collected pages and restarts from the last persisted safe block.
Resume prefers the recorded provider. The three actions start at the oldest persisted cursor
so an interrupted grouped write cannot split a swap. The first batch contains classified rows;
the other two persist the corresponding cursors. RPC page keys are consumed immediately and
never persisted (Alchemy keys expire after ten minutes).

Etherscan/Blockscout use `offset=1000`, `page=1`, block overlap and head minus 64. Range timeouts
halve the query range; a saturated single block stops without advancing past unproven data.
Alchemy requests external, internal and ERC-20 transfers in both directions, with metadata,
and reads integer `rawContract.value`, never the display float. NodeReal requests external,
internal and `20` categories, pages both directions and limits every window to 100,000 blocks.
It accepts both timestamp spellings and uses external-transfer gas fields when available.
Receipts identify token-only senders and supply gas otherwise. Original transfer objects and
receipts are retained in raw alongside the normalized explorer rows.

Transfer APIs omit approvals and failed transactions. Sent hashes are compared with
`eth_getTransactionCount` at the safe block (subtracting the pre-window count on resume).
Missing transactions or an unavailable completeness check mark the sync incomplete and keep
that stream's previous cursor. Alchemy on Arbitrum always marks internal history incomplete:
add Etherscan or Blockscout for complete coverage. Known movements are still retained.

Fee models are data-driven: Ethereum, Polygon and BSC use execution gas; Arbitrum uses
`gasUsed × effectiveGasPrice`, which already includes `gasUsedForL1`; Base uses that product
plus receipt `l1Fee`. Receipts are fetched for every Base explorer transaction the address sent.
An explicit `operatorFee` is added if present; unverified operator-fee parameters and a missing
`l1Fee` receive `fee_review_required`. Type `0x7e` deposits do not charge the recipient gas.
Gas is charged exactly once to its sender, including approvals and failed transactions.

Native ids are ETH (Ethereum/Base/Arbitrum), BNB (BSC), and POL (Polygon). Per the implementation
brief, Polygon's historical native MATIC maps to POL, preserves the reported symbol in raw, and
gets a rename/CA warning on the first historical row in each replayed batch. This deliberately
uses the brief's single-id rule rather than the research §1.4 synthetic carry-over event, which
needs an engine/core event contract. Separate MATIC and POL ERC-20 contracts on Ethereum retain
their separate ids. No historical source row is rewritten.

Known contracts share their verified asset id across chains: native USDC is USDC; bridged USDC.e
is USDC.E; Base USDbC is USDBC; WETH remains WETH. BSC USDT/USDC use 18 decimals; Binance-Peg
ETH/BTCB map to ETH/BTC. Other researched BSC pegged assets retain a `complex_onchain` identity
review note. Unknown tokens use `ERC20:<chainId>:<CONTRACT>` and never inherit a claimed ticker.
Polygon's native `0x…1010` ERC-20 alias is retained in raw but excluded from movement and balance
inventory, avoiding double-counted POL. Registry sources are in `data/README.md`.

Official bridge contracts are bundled per chain in `chains.json`. Known counterparties, Base
system deposits, bridge method names, L2 mint patterns and labelled CEX withdrawals receive
`complex_onchain`: "Possible bridge between chains". Every leg remains a deposit/withdrawal;
no sale, income or cross-chain match is invented. No verified third-party bridge registry or
CEX address registry was supplied by the research, so anonymous exchange senders cannot be
identified here. The app/engine can pair an exchange withdrawal TXID with an on-chain hash.

`sourceRef = <hash>:<kind>:<syncing-address>#<ordinal>` avoids collisions across two owned address
connections sharing `evm:<chainId>`. References are deterministic across providers for equivalent
legs. Unsafe, unsolicited unknown and lookalike-token receipts retain spam flags. Zero-value
poisoning is an amount-free review row. Own movements retain sender and receiver legs separately.

`balances()` reconstructs the complete token inventory, excludes spam/native aliases and queries
the same safe block. Alchemy's latest inventory uses `alchemy_getTokenBalances`; historical token
balances use block-pinned `eth_call balanceOf` because the inventory method has no block argument.
Incomplete history prevents a complete balance snapshot. The app compares these fetched balances
with its persisted ledger; the connector has no ledger-state input. Recent unconfirmed movements
also prevent a balance comparison. Contracts sharing an asset id are summed in the snapshot.

## Keys and base URL overrides

Keys belong in the app's encrypted vault, never in chain data or a shared project key:
`provider:etherscan`, `provider:blockscout`, `provider:alchemy`, `provider:nodereal`;
`provider:coingecko` remains the separate price key. `providerSecretSlots` exports the EVM slots.
The app owner must wire the two new slots into its vault/settings UI and connection builder.
Only explicit connector calls contact providers. No logging or telemetry is enabled.

`ctx.baseUrls.etherscan` and `.blockscout` override the complete explorer endpoint. `.alchemy`
defaults to `https://{network}.g.alchemy.com/v2`; `{network}` is replaced from chain data and
`/<encoded-api-key>` is appended. `.nodereal` defaults to
`https://bsc-mainnet.nodereal.io/v1` (Ethereum uses `eth-mainnet`), also appending the key.
For an in-process mock use `alchemy: "http://127.0.0.1:<port>/alchemy/{network}/v2"` and
`nodereal: "http://127.0.0.1:<port>/nodereal"`; the override stops before the key. Paths with
provider keys must never be logged.

Core is intentionally unchanged. The lead must extend `EvmProviderConfig.kind` to the exact union
`"etherscan" | "blockscout" | "alchemy" | "nodereal"` and add `tier?: "free" | "paid"` for
Etherscan. Until then the local structural types accept `kind: string`, while existing core
options remain assignable to the connector.
