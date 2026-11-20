# Synthetic exports

All trades, account details, addresses and transaction hashes are made up. Import each file separately on the Import page, then compute the FY 2025–26 report.

| File                                                                                 | Time zone | What it demonstrates                                                                                |
| ------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| [binance-spot-trade-history.SYNTHETIC.csv](binance-spot-trade-history.SYNTHETIC.csv) | UTC       | Spot fills, crypto-to-crypto swaps and fees charged in several assets.                              |
| [binance-deposit-history.SYNTHETIC.csv](binance-deposit-history.SYNTHETIC.csv)       | UTC       | A crypto deposit with a network and transaction hash.                                               |
| [binance-withdrawal-history.SYNTHETIC.csv](binance-withdrawal-history.SYNTHETIC.csv) | UTC       | A crypto withdrawal with a network fee.                                                             |
| [coindcx-trade-report.SYNTHETIC.csv](coindcx-trade-report.SYNTHETIC.csv)             | IST       | The Instant Orders sheet from a CoinDCX Trade Report, with an INR buy and sell and TDS on the sale. |
| [generic-unknown-exchange.SYNTHETIC.csv](generic-unknown-exchange.SYNTHETIC.csv)     | IST       | A made-up exchange format for trying the CSV recipe wizard.                                         |

For the generic file, choose **Other CSV / XLSX** and set these fields in the recipe wizard (the labels are the wizard's
own). Fill them in by hand, or let the optional AI suggest them and check against this table. Leave every other
column as **(None)**.

| Wizard field                               | Value                       |
| ------------------------------------------ | --------------------------- |
| Buy / Sell sign style                      | Separate side / type column |
| Date format                                | `yyyy-MM-dd HH:mm:ss`       |
| Known quote assets (for pair split)        | `INR`                       |
| What time zone are the times in this file? | IST (+05:30)                |
| Timestamp                                  | `Date`                      |
| Amount / Quantity                          | `Volume`                    |
| Side column                                | `Trade`                     |
| Trading Pair                               | `Market`                    |
| Unit Price                                 | `Price`                     |
| Total / Consideration                      | `Total`                     |
| Fee Amount                                 | `Fee`                       |
| Fee Asset                                  | `Fee Currency`              |
| TDS (INR)                                  | `TDS`                       |

The `Buy` and `Sell` values in `Trade` need no value mapping. Check the preview and confirm. If you leave the wizard
without confirming, the file stays on **Imports** marked **Needs recipe**: click **Map** to finish it, or delete it.

The wallet activity is deliberately unmatched so you can see how the Review page flags transfers for follow-up.
