# Phase 2 sample payloads

Example responses copied from official docs on 2026-11-17, unless the file name says otherwise.
They are the vendors' illustrative values, not real accounts. See `../phase2-apis.md` for sources.

- `binance-*.json`: Binance developer docs (spot REST markdown on GitHub `binance/binance-spot-api-docs`,
  and developers.binance.com wallet / fiat / C2C pages). `binance-klines-BTCUSDT-1d-first.json` is a
  live public response from `data-api.binance.vision` (no key), the first BTCUSDT daily candle.
- `coindcx-*.json`: docs.coindcx.com. Note that amounts are JSON numbers, not strings.
- `etherscan-*.json`: docs.etherscan.io. `etherscan-empty-OBSERVED.json` is NOT in the current docs;
  it is the widely observed empty-history shape. Confirm against a live call before relying on the exact text.
- `coingecko-market_chart-range.json`: docs.coingecko.com (Demo API reference).
