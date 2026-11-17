# Export samples (synthetic)

Header rows copied from real exports; every value below the header is invented. See `../export-catalogue.md`.

| File                                                                     | Export                            | Notes                                                                                                          |
| ------------------------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Binance-Spot-Order-History-202601021200(UTC+5)-part1-of1.SYNTHETIC.csv` | Binance Spot Order History (§1.3) | UTF-8 BOM, superscripts in headers, duplicate `Time`, units glued to amounts, UTC offset only in the file name |
| `coindcx-order-history.SYNTHETIC.csv`                                    | CoinDCX Order History (§2.2)      | Explicit ` UTC` suffix; fee 0.5% of gross; TDS 1% of (gross − fee)                                             |
