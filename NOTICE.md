# Notices

tax-tracker is licensed under [AGPL-3.0-only](LICENSE). It bundles some third-party data and depends on
open-source packages that keep their own licences. This file lists the bundled data and its sources.

## Not legal or tax advice

The tax rule files in `packages/rules/data/`, the research notes in `docs/research/` and every report the app
produces are **not legal or tax advice**. The rules are an interpretation of the Income-tax Act 1961, the
Income-tax Act 2025 and related rules, pending review by a Chartered Accountant. Section labels were read from
public mirrors of the Acts, not the Gazette. Verify everything with a qualified professional before filing.

## SBI USD/INR reference rates

`packages/rates/data/SBI_REFERENCE_RATES_USD.csv` is an unmodified copy of a file from **SBI FX RateKeeper**
(<https://github.com/sahilgupta/sbi-fx-ratekeeper>), MIT licence, Copyright (c) 2022 Sahil Gupta. The full licence
text, the pinned commit, checksum and known gaps are in
[packages/rates/data/README.md](packages/rates/data/README.md).

Data collected and published by Sahil Gupta and contributors of SBI FX RateKeeper. Upstream credits for data before
December 2022: Shivam Khandelwal (`skbly7/sbi-tt-rates-historical`), the forex rate card archives of Maneesh K. Singh
& Co., and the Internet Archive Wayback Machine. The underlying rates are published by State Bank of India. This
project is not affiliated with or endorsed by SBI, and the copy has not been re-checked against SBI's own sheets.

## EVM chain and token data

`packages/evm/data/chains.json` and `tokens-<chainId>.json` contain contract addresses, decimals and symbols
transcribed from these public sources (details and dates in
[packages/evm/data/README.md](packages/evm/data/README.md)):

- Uniswap Default token list (<https://tokens.uniswap.org>)
- PancakeSwap Extended token list (<https://tokens.pancakeswap.finance/pancakeswap-extended.json>)
- Circle USDC contract addresses (<https://developers.circle.com/stablecoins/usdc-contract-addresses>)
- Base, Arbitrum and Polygon official contract and network documentation
- Blockscout and Etherscan supported-chain documentation

Listing a token is an identity mapping, not an endorsement.

## Research samples

- `docs/research/phase2-samples/` holds illustrative API responses copied from the public documentation of Binance,
  CoinDCX, Etherscan and CoinGecko, plus one public Binance market-data response. They are the vendors' example
  values, not real accounts. Sources are listed in that folder's README and in `docs/research/phase2-apis.md`.
- `docs/research/export-samples/` holds export header rows with **invented** values.
- Quotations in `docs/research/` from statutes, CBDT documents and exchange help pages are short excerpts for
  reference, each with its source link.

## Trademarks

Binance, CoinDCX, Etherscan, Blockscout, Alchemy, NodeReal, CoinGecko, Ollama and other names are trademarks of
their owners. tax-tracker is an independent project, not affiliated with or endorsed by any of them.

## Software dependencies

Runtime and development dependencies are listed in each `package.json` and `pnpm-lock.yaml`, and are used under
their own licences (for example `pdfjs-dist`, Apache-2.0). The Docker image is based on the official Node.js image.
The Contributor Covenant in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) is used under CC BY 4.0.
