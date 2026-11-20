# Synthetic exports

These files are adapted from the [synthetic importer fixtures](../packages/importers/test/fixtures/README.md). All trades, account details, addresses and transaction hashes are made up. Import each file separately on the Import page, then compute the FY 2025–26 report.

| File                                                                                 | Time zone | What it demonstrates                                                                                |
| ------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| [binance-spot-trade-history.SYNTHETIC.csv](binance-spot-trade-history.SYNTHETIC.csv) | UTC       | Spot fills, crypto-to-crypto swaps and fees charged in several assets.                              |
| [binance-deposit-history.SYNTHETIC.csv](binance-deposit-history.SYNTHETIC.csv)       | UTC       | A crypto deposit with a network and transaction hash.                                               |
| [binance-withdrawal-history.SYNTHETIC.csv](binance-withdrawal-history.SYNTHETIC.csv) | UTC       | A crypto withdrawal with a network fee.                                                             |
| [coindcx-trade-report.SYNTHETIC.csv](coindcx-trade-report.SYNTHETIC.csv)             | IST       | The Instant Orders sheet from a CoinDCX Trade Report, with an INR buy and sell and TDS on the sale. |
| [generic-unknown-exchange.SYNTHETIC.csv](generic-unknown-exchange.SYNTHETIC.csv)     | IST       | A made-up exchange format for trying the CSV recipe wizard.                                         |

For the generic file, choose **Other CSV** and configure these mappings in the recipe wizard. You can fill them in by hand.

| Recipe field       | CSV column or setting |
| ------------------ | --------------------- |
| Date and time      | `Date`                |
| Date format        | `yyyy-MM-dd HH:mm:ss` |
| Buy/sell side      | `Trade`               |
| Sign style         | Side column           |
| Trading pair       | `Market`              |
| Known quote assets | `INR`                 |
| Quantity           | `Volume`              |
| Unit price         | `Price`               |
| Total              | `Total`               |
| Fee asset          | `Fee Currency`        |
| Fee amount         | `Fee`                 |
| TDS                | `TDS`                 |

The wallet activity is deliberately unmatched so you can see how the Review page flags transfers for follow-up.
