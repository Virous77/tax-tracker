# Importer fixtures

Every file here is **synthetic**: made-up trades for a made-up person, written to match the real export layouts
as far as they could be verified. What is verified and what is guessed is in `docs/research/export-formats.md`.
Addresses and transaction hashes are fake and will not pass checksum validation.

## One story across the files

A user buys USDT and BTC on CoinDCX (times in IST), moves USDT to Binance, trades there (times in UTC),
and sells on both around midnight IST on 31 March 2026.

| When (as written in the file)                   | Where                           | What                                               | Why it is here                                                         |
| ----------------------------------------------- | ------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| 2025-06-10 11:15:22                             | CoinDCX Instant Orders          | buy 2000 USDT for INR                              | INR buy, fee in INR                                                    |
| 2025-06-12 09:30:05 and :07                     | CoinDCX Spot Orders             | buy 0.006 + 0.004 BTC, one Order ID, two Trade IDs | partial fills                                                          |
| 2025-06-14 20:05:10 IST                         | CoinDCX dep/wdl sheet           | withdraw 1800 USDT, fee 1                          | transfer out                                                           |
| 2025-06-14 14:41:33 UTC                         | Binance deposits + statement    | deposit 1799 USDT, same tx hash                    | matching deposit 6 min later, 1 USDT less                              |
| 2025-06-15 03:12:44                             | Binance                         | buy 0.01 + 0.002 BTC with USDT, fee in BTC         | USDT→BTC swap, partial fills, `"1,050.00000000USDT"` with a comma      |
| 2025-07-03 14:59:05                             | CoinDCX Spot Orders             | buy 0.02 ETH with USDT                             | USDT pair on CoinDCX, **TDS on a buy** (USDT is the asset transferred) |
| 2025-08-20 10:05:01                             | Binance                         | buy 0.1 BNB                                        | fee in BNB                                                             |
| 2025-09-01, 2025-10-05, 2025-11-18              | Binance statement only          | interest `1.234E-05`, airdrop, dust→BNB            | income rows, scientific notation                                       |
| 2025-12-02 16:45:30                             | Binance                         | buy 0.05 ETH with USDT, **fee in BNB**             | fee in a third coin                                                    |
| 2026-01-11 07:20:15                             | Binance withdrawals + statement | withdraw 0.003 BTC, fee 0.00002                    | withdrawal with no matching deposit                                    |
| 2026-02-02 02:02:02                             | Binance statement only          | `Some Future Operation`                            | unknown operation → flag, never drop                                   |
| 2026-02-14 19:40:03                             | CoinDCX Instant Orders          | sell 100 USDT for INR, TDS 90.74                   | sell with TDS                                                          |
| 2026-03-31 18:29:58 and 18:30:02 UTC            | Binance                         | sell 0.004 and 0.002 BTC for USDT                  | BTC→USDT; IST 23:59:58 (tax year 2025-26) and 00:00:02 (2026-27)       |
| 2026-03-31 23:58:40 and 2026-04-01 00:00:35 IST | CoinDCX Spot Orders             | sell 0.003 and 0.002 BTC for INR, one Order ID     | same straddle on an Indian exchange, with TDS                          |
| 2026-05-10 09:00:00                             | Binance                         | two **identical** rows: sell 0.01 ETH              | rows with no id that are equal byte for byte; both are real            |
| 2026-06-01 05:10:00                             | Binance deposits + statement    | deposit 0.001 BTC                                  | deposit with no history                                                |

## Files

| File                                        | Layout                                             | Rows          | Notes                                                                             |
| ------------------------------------------- | -------------------------------------------------- | ------------- | --------------------------------------------------------------------------------- |
| `binance-trade-history.csv`                 | Spot Trade History, amount and coin in one cell    | 8             | newest first; no trade id column                                                  |
| `binance-trade-history-fee-coin-layout.csv` | older Spot Trade History with `Fee Coin`           | 2             | same two trades as above in the other header variant                              |
| `binance-transaction-statement.csv`         | Transaction History statement                      | 32            | every field quoted; one balance change per row; no ids                            |
| `binance-deposits.csv`                      | Deposit History (crypto)                           | 2             |                                                                                   |
| `binance-deposits-2digit-year.csv`          | Deposit History, `YY-MM-DD` date variant           | 1             | `24-11-03 09:15:42` means 2024-11-03                                              |
| `binance-withdrawals.csv`                   | Withdrawal History (crypto)                        | 1             |                                                                                   |
| `coindcx-report.xlsx`                       | CoinDCX Trade Report, 4 sheets                     | 2 + 5 + 1 + 2 | built from `coindcx-report/`                                                      |
| `coindcx-report/*.csv`, `sheets.json`       | one CSV per sheet + manifest                       |               | source of the workbook; header on row 9                                           |
| `generic-unknown-exchange.csv`              | made-up Indian exchange (WazirX-like), side column | 6             | IST, `yyyy-MM-dd HH:mm:ss`; for the AI recipe path                                |
| `generic-signed-amounts.csv`                | made-up exchange, sells as negative quantity       | 4             | IST, `dd-MM-yyyy HH:mm`; Indian digit grouping `"95,00,000.00"`; has an id column |
| `us-broker-schwab-like.csv`                 | US broker (Schwab-like)                            | 9             | `MM/DD/YYYY`, `$1,249.57`, `-$2.31`, `01/02/2026 as of 12/31/2025`; Phase 3       |

The Binance statement and the Binance trade/deposit/withdrawal files describe **the same activity twice**.
Importing both must not double the ledger (see "Overlap" in `docs/research/export-formats.md`).

## Rebuilding the workbook

```sh
python3 -I docs/research/scripts/build_coindcx_xlsx.py
```

Standard library only; output is byte-for-byte reproducible
(SHA-256 `508e9f701376f68b80e8d95b088c04d2ff068e6df74011e8685373667856c386`).
Edit the CSVs or `sheets.json`, re-run, commit both.

In the workbook, dates and ids are text cells and amounts are numeric cells. Whether real CoinDCX files store dates
as text or as Excel serial numbers is not verified; the importer should accept both.

## What the CoinDCX sheets are for

| Sheet                            | Status                        | Importer test should assert                                                                 |
| -------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| `Instant Orders`                 | headers verified              | 2 ledger rows, TDS 90.74 on the sell, none on the buy                                       |
| `Spot Orders`                    | headers verified              | 5 ledger rows; ETHUSDT buy is a swap with TDS 72.18; two rows on either side of 1 April IST |
| `Futures Orders (USDT-M)`        | partly verified, out of scope | reported as a skipped sheet with its row count, not silently ignored                        |
| `Crypto Dep&Wdl,Airdrop,Staking` | **headers invented**          | unknown layout is surfaced (recipe needed or sheet reported), never guessed                 |

Rows 1–8 of each sheet are invented placeholders for the real report's metadata and notes. Find the header row by
scanning for known header names, not by a fixed row number.
