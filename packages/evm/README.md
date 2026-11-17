# Explorer import

`@tax/evm` exports `evmConnector: Connector<EvmSyncOptions>`, `ExplorerProvider`, `ExplorerAdapter`,
`FallbackExplorer`, `createExplorer`, `walkBlocks`, `rawRowKeys`, `classifyTransactions`, token/unit
helpers, and `chains` / `chainConfig`. The explorer interface is independent of HTTP, authentication
and pagination internals: an Alchemy or Routescan adapter can translate its upstream model behind
`history`, `blockNumber`, `balance` and `tokenBalance` without changing the classifier.

Provider order is exactly the caller's `opts.providers`. Etherscan V2 and the unified Blockscout
API are implemented; outages and exhausted rate limits advance to the next provider. Authentication
and parameter errors remain errors. Blockscout credentials use the authorization header.

All native assets, decimal scales, explorer links, default provider suggestions and token filenames
come from `data/chains.json`. Ethereum, Base, Arbitrum One, Polygon PoS and BNB Smart Chain are
configured. Ethereum is the completed end-to-end implementation for this phase; additional free
provider adapters are a follow-up. Empty default-provider lists make no free-coverage promise.
All token ids include the chain. Native assets and verified tokens use plain symbols across chains,
so e.g. ETH on Base and Ethereum currently share lots; tax treatment requires CA review.
Polygon's native symbol is POL; MATIC is its historical naming alias. No automatic ledger rewrite
or migration of historical MATIC is performed.

History uses `offset=1000`, `page=1`, block overlap and the current block minus 64. Provider query
timeouts halve the range. A saturated single block stops with an incomplete notice and never
advances a cursor through unproven data. All three actions restart from their oldest cursor so a
crash between batch writes cannot split a transaction's classification. The first (`txlist`) batch
holds the grouped ledger rows; the other two batches persist their corresponding safe cursors.
Each raw object contains every original normal/internal/token row in that transaction, unchanged.

The classifier operates on the currently syncing address. Own transfers retain the sender's
withdrawal and receiver's deposit in their respective connections with a shared txHash. Native
refunds are netted before recognising a simple swap. One outgoing and one incoming asset initiated
by this address becomes a swap. Approvals and failed transactions retain gas as a fee. Complex
multi-asset transactions, wrap/unwrap, liquidity and bridge calls retain a flagged row for every
movement. Gas is charged once, only to its sender, and uses the configured native coin. Base and
Arbitrum gas carry `fee_review_required` because L1 data fees are not inferred.

`sourceRef = <hash>:<kind>:<syncing-address>#<ordinal>` is deliberately more specific than the
research's conflicting hash-only and hash/kind/ordinal examples: both own-address connections use
one `evm:<chainId>` source and otherwise collide. References are deterministic across providers and
provider ordering. Raw event identities preserve identical token-transfer multiplicities without
assuming undocumented log indexes.

Spam flags retain unsafe (`statusRep=2`), unsolicited unknown-contract and lookalike-symbol inbound
transfers. Zero-value token poisoning is preserved as an amount-free flagged review row because
ledger movement amounts must be positive. The connector contract supplies no CoinGecko resolution
port, so unknown unsolicited contracts conservatively remain flagged until reviewed. No token is
silently treated as income or merged with a known ticker.

Balances inventory the address's tokens from history, exclude suspected spam and query native/token
balances at the safe block. Recent unconfirmed movements prevent a balance comparison. A cursor
never replaces the token inventory: a full token-history scan reconstructs old contracts as needed.
Incomplete inventory/history prevents presenting a complete balance snapshot.

The shared mock accepts Blockscout keys only as a query parameter at implementation time; its
header authentication path is missing. Production uses the documented authorization header to
avoid query-string secrets. Adapter unit tests cover that header; shared-mock end-to-end tests use
Etherscan until the mock implements the documented Blockscout authentication option.
