# Synthetic exports

All trades, account details, addresses and transaction hashes are made up. Import each file separately on the Import page, then compute the FY 2025–26 report.

| File                                                                                 | Time zone | What it demonstrates                                                                                       |
| ------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------- |
| [binance-spot-trade-history.SYNTHETIC.csv](binance-spot-trade-history.SYNTHETIC.csv) | UTC       | Spot fills, crypto-to-crypto swaps and fees charged in several assets.                                     |
| [binance-deposit-history.SYNTHETIC.csv](binance-deposit-history.SYNTHETIC.csv)       | UTC       | A crypto deposit with a network and transaction hash.                                                      |
| [binance-withdrawal-history.SYNTHETIC.csv](binance-withdrawal-history.SYNTHETIC.csv) | UTC       | A crypto withdrawal with a network fee.                                                                    |
| [coindcx-trade-report.SYNTHETIC.csv](coindcx-trade-report.SYNTHETIC.csv)             | IST       | The Instant Orders sheet from a CoinDCX Trade Report, with an INR buy and sell and TDS on the sale.        |
| [generic-unknown-exchange.SYNTHETIC.csv](generic-unknown-exchange.SYNTHETIC.csv)     | IST       | A made-up exchange format for trying the CSV recipe wizard.                                                |
| [us-stocks-schwab-sample.SYNTHETIC.csv](us-stocks-schwab-sample.SYNTHETIC.csv)       | UTC       | Schwab-style US stock buys, long- and short-term sales, dividends with NRA withholding, and 2025 holdings. |
| [us-stocks-generic-sample.SYNTHETIC.csv](us-stocks-generic-sample.SYNTHETIC.csv)     | UTC       | Generic US stock layout with buys, sales, a USD cash deposit and dividends with inline US tax withheld.    |

For the generic file, choose **Other CSV / XLSX** and set these fields in the recipe wizard (the labels are the wizard's
own). The wizard pre-fills its own guess (for example the side column and the quote assets); check each field
against this table and correct it, or let the optional AI suggest them and check those too. Leave every other
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

## US stock samples

Both files match the US Stocks library recipes by their exact headers, so they need no column mapping. On the Import page
choose **Other CSV / XLSX** (or **Auto-detect**), upload the file, and keep the time zone at **UTC**. Import one or both,
then open **US Stocks** and compute the FY 2025–26 or Tax Year 2026–27 report.

- [us-stocks-schwab-sample.SYNTHETIC.csv](us-stocks-schwab-sample.SYNTHETIC.csv) has 15 rows spanning 2023–2026: buys,
  a long-term and a short-term sale, cash and qualified dividends with matching `NRA Tax Adj` withholding, an
  `as of` dividend date, and holdings that produce a Schedule FA (CY 2025) worksheet.
- [us-stocks-generic-sample.SYNTHETIC.csv](us-stocks-generic-sample.SYNTHETIC.csv) has 11 rows in the generic layout:
  buys, long- and short-term sales, a USD cash deposit, and dividends with 25% US tax withheld inline.

Neither file contains 2025 market prices. Enter the Schedule FA peak and 31 December closing prices on the
**US Stocks → Schedule FA** tab before filing, or leave the missing-price flags in place for follow-up.
