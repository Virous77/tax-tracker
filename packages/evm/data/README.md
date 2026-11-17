# Bundled chain and token identity data

`chains.json` contains native identities, fee models, provider order, Alchemy network names,
Polygon rename metadata/native aliases and the official bridge contracts from research §1.7.
`tokens-<chainId>.json` contains only the contract addresses and decimal scales transcribed from
`docs/research/multichain-and-pdf.md §1.6`, checked there on 2026-11-17. Existing Ethereum entries
are retained. Token identities are an allow-list, not an endorsement.

Sources:

- [Uniswap Default token list](https://tokens.uniswap.org), v22.34.0, 2026-11-16:
  Ethereum, Base, Arbitrum, Polygon and applicable BSC entries.
- [PancakeSwap Extended token list](https://tokens.pancakeswap.finance/pancakeswap-extended.json),
  v2.16.801, 2026-11-12: BSC entries, including BTCB, CAKE and FDUSD.
- [Circle USDC contracts](https://developers.circle.com/stablecoins/usdc-contract-addresses):
  native USDC cross-check for Ethereum, Base, Arbitrum and Polygon.
- [Base official contracts](https://docs.base.org/base-chain/network-information/base-contracts).
- [Arbitrum official contracts](https://docs.arbitrum.io/build-decentralized-apps/reference/contract-addresses).
- [Polygon official network configuration](https://raw.githubusercontent.com/0xPolygon/static/master/network/mainnet/v1/index.json).
- [Blockscout indexed chains and plans](https://api.blockscout.com/api/json/config).
- [Etherscan supported chains](https://docs.etherscan.io/supported-chains).

Refresh by downloading the lists and reviewing a diff, never auto-merging. Symbols are ledger
asset ids: bridged USDC.e is USDC.E, USDbC is USDBC, Arbitrum USDT0 is USDT, BSC Binance-Peg ETH
is ETH and BTCB is BTC. WETH stays WETH. BSC USDT and USDC are 18 decimals. Other BSC pegged
identities explicitly carry a review note because exchange-credit equivalence is unverified.
Old BSC TRX contracts are unlisted and therefore keep their contract id. Polygon's native alias
`0x0000000000000000000000000000000000001010` is excluded from token movements to prevent a
second native POL credit. Ethereum MATIC and POL remain separate contracts and assets.

Polygon historical native MATIC maps to POL per the implementation brief, with a rename/CA
warning and its provider-reported symbol retained in raw. This overrides the research's proposed
synthetic carry-over event until the lead chooses an engine event contract for that alternative.
