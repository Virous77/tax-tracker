# Export formats: Binance and CoinDCX

Researched 2026-11-16. No real export file was available, so nothing here was checked against a file downloaded
from an account. The strongest evidence is open-source parsers that hard-code header strings.

Confidence labels: **verified** = exact strings read from a named source (parser code, test data, or the exchange's
own help page). **partial** = some strings verified, rest inferred. **unverified** = not found in any source; do not hard-code.

Fixtures: `packages/importers/test/fixtures/` (see its README).

## Sources

| Id  | Source                                                                                                                                                                                                                                                                                                                        | Used for                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| BT  | BittyTax Binance parser, commit `a221675` (2026-11-12): <https://github.com/BittyTax/BittyTax/blob/a221675875e07b137d8a96481eb3cee77cdcf192/src/bittytax/conv/parsers/binance.py>                                                                                                                                             | every Binance header list, status strings, pair splitting            |
| RK  | rotki Binance importer, commit `f695973` (2026-11-16): <https://github.com/rotki/rotki/blob/f69597352c96c68cc8563453ae9cf19a945ec7e2/rotkehlchen/data_import/importers/binance.py> and its test file <https://github.com/rotki/rotki/blob/develop/rotkehlchen/tests/data/binance_history.csv>                                 | statement header, date format, operation names, real-looking rows    |
| ME  | Unofficial statement docs: <https://github.com/marco-eckstein/binance-transaction-history-docs> (last push 2023-11)                                                                                                                                                                                                           | statement quirks, Account / Operation values                         |
| BF  | Binance FAQ "How to Download Spot Trading Transaction History Statement" (published 2022-04-26): <https://www.binance.com/en-JP/support/faq/how-to-download-spot-trading-transaction-history-statement-e4ff64f2533f4d23a0b3f8f17f510eab>                                                                                      | menu path, limits, time zone                                         |
| CH  | Third-party tool listing accepted Binance headers: <https://thecryptohub.io/tools/pnl-calculator/binance>                                                                                                                                                                                                                     | second witness for headers; one extra layout                         |
| SD  | Open-source CoinDCX parser, commit `a67e73d` (pushed 2026-07-25): <https://github.com/sanketdaru/india-crypto-tax-calculator/blob/a67e73ddd76a5462b30b3d5688177adad7ac0cc6/crypto_pnl_calculator.py> (+ `tests/`, `README.md`)                                                                                                | CoinDCX sheet names, header row, exact headers, variants             |
| CX  | CoinDCX help "Detailed Breakdown of your Trade Report": <https://support.coindcx.com/articles/reports/detailed-breakdown-of-your-trade-report/6a578b0fe6d375683a0b342d> and "How can I download my Trade Report?": <https://support.coindcx.com/articles/reports/how-can-i-download-my-trade-report/6a578aae440a197f3d13d676> | sheet list, column meanings (names there are descriptive, not exact) |
| KL  | Koinly bug reports: futures sheets (2025-02-11) <https://feedback.koinly.io/apicsv-issues-public/p/coindcx-csv-sheet-future-orders-inr-m-was-not-imported-sheet-futures-orders-usdt>, GST (2025-09-17) <https://feedback.koinly.io/apicsv-issues-public/p/coindcx-csv-gst-paid-on-trades-is-not-imported>                     | futures sheet names and headers, `TDS(in base currency)`             |
| CK  | CryptoKar import guide (updated 2026-08-21): <https://cryptokar.com/integrations/coindcx>                                                                                                                                                                                                                                     | current sheet list, per-quarter reports                              |
| KX  | KoinX CoinDCX guide: <https://www.koinx.com/integration/coindcx.md>                                                                                                                                                                                                                                                           | menu path, emailed Excel                                             |

Pages that could not be opened (HTTP 403): CoinDCX blog "how to download trade report", Cryptact's CoinDCX page, Koinly's CoinDCX page.
A Scribd copy of a real FY 2022-23 CoinDCX report was visible only as a search snippet.

---

## A. Binance

Shared facts:

- **No trade id, order id or row id in any spot export** (BT, RK, ME). ME: "a CSV file can contain multiple transactions that look identical".
- Times are UTC. BF: "The history is shown in UTC+0". Headers say `Date(UTC)`, `Date(UTC+0)` or `UTC_Time`.
  BT also accepts `Date(UTC+N)`, `Date(UTC-N)` and the literal `Date(UTCnull)` on fiat files, so **read the offset from the header**;
  anything other than UTC / UTC+0 should raise `ambiguous_timezone`.
- Date format `YYYY-MM-DD HH:MM:SS` (RK uses `'%Y-%m-%d %H:%M:%S'` for the statement). Deposit/withdrawal files have also shipped
  `YY-MM-DD HH:MM:SS`; BT prefixes `20` when the value starts with two digits and a dash.
- Pairs are written with no separator: `BTCUSDT`, `ETHBTC`. Split by known quote suffix (BT's list includes
  `USDT USDC FDUSD BUSD TUSD DAI BTC ETH BNB TRY EUR ...`). A few pairs are ambiguous by suffix (BT special-cases `USDTUSD`, `BNBUSD`, `ADAEUR`...).
- Files may arrive as `.xlsx` or `.csv` depending on the page and date; detect by header strings, not by extension. **unverified** which pages give which.

### A1. Spot Trade History — current layout — verified (BT, CH)

Path (BF): Orders → Spot Order → Trade History → Export Trade History. "Within 6 months" (max 6 months and 10,000 rows per export)
or "All time" (generated statement; 5 statements per month; link kept 7 days).

```
Date(UTC),Pair,Side,Price,Executed,Amount,Fee
```

| Column      | Content                                                         | Example                |
| ----------- | --------------------------------------------------------------- | ---------------------- |
| `Date(UTC)` | fill time                                                       | `2025-06-15 03:12:44`  |
| `Pair`      | base+quote, no separator                                        | `BTCUSDT`              |
| `Side`      | `BUY` / `SELL` (upper case)                                     | `BUY`                  |
| `Price`     | quote per base, number only                                     | `105000.00`            |
| `Executed`  | base quantity **with the symbol glued on**                      | `0.0100000000BTC`      |
| `Amount`    | quote total with symbol; thousands commas occur (BT strips `,`) | `"1,050.00000000USDT"` |
| `Fee`       | fee quantity with the fee coin's symbol; any coin               | `0.0001588200BNB`      |

- One row per fill; a partially filled order is several rows with the same second.
- Splitting number from symbol: BT's fallback regex `(\d+|\d+\.\d+)(\w+)$` breaks on symbols that start with a digit (`1INCH`, `1000SATS`).
  Safer: get base and quote from `Pair`, then strip that known suffix from `Executed` / `Amount`. `Fee` can be a third coin, so it needs
  the longest-known-symbol match and a `parse_warning` when the split is not unique.
- Number of decimals and row order (newest first in the fixture) are **unverified**.

### A2. Spot Trade History — older layout — verified (BT)

```
Date(UTC),Market,Type,Price,Amount,Total,Fee,Fee Coin
```

`Type` is `BUY`/`SELL`; `Amount` = base quantity, `Total` = quote total, both plain numbers; fee coin in its own column.

### A3. Spot Trade History — third layout — unverified (CH only)

```
Date(UTC),Pair,Base Asset,Quote Asset,Type,Price,Amount,Total,Fee,Fee Coin
```

Support by aliasing A2's columns if a user file shows it.

### A4. Transaction History statement — verified (BT, RK, ME, CH)

Path: Orders (or Assets) → Transaction History → Export Transaction Records. One-year range per export per third-party guides (**unverified**).

```
User_ID,UTC_Time,Account,Operation,Coin,Change,Remark
```

Variant without the first column (BT): `UTC_Time,Account,Operation,Coin,Change,Remark`.

| Column      | Content                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User_ID`   | numeric account id (personal data: keep in `raw`, never log)                                                                                         |
| `UTC_Time`  | `YYYY-MM-DD HH:MM:SS`                                                                                                                                |
| `Account`   | `Spot`, `Earn`, `Funding`, `Cross Margin`, `Isolated Margin`, `USD-MFutures` / `USDT-Futures` / `USD-M Futures`, `Coin-M Futures`, `Pool`, `Savings` |
| `Operation` | free text, see below                                                                                                                                 |
| `Coin`      | symbol                                                                                                                                               |
| `Change`    | **signed** quantity: positive = received, negative = left                                                                                            |
| `Remark`    | usually empty                                                                                                                                        |

- **One balance change per row.** A trade is 2–3 rows with the same `UTC_Time`: e.g. `Transaction Buy` (+base), `Transaction Spend` (−quote),
  `Transaction Fee` (−fee coin). The importer must group rows by timestamp to rebuild a trade.
- `Change` can be in scientific notation in the wild (RK test data: `-3.605E-05`). decimal.js parses that; a hand-written number regex would not.
- Rows can be out of order by about a second and cells can be empty (ME, RK test data).
- Quoting of fields is **unverified** (the fixture quotes every field; a real CSV parser handles both).

Operation names seen in BT / RK / ME, grouped by what they mean for the ledger:

| Ledger meaning                                     | `Operation` values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| trade legs                                         | `Transaction Buy`, `Transaction Spend`, `Transaction Fee`, `Transaction Sold`, `Transaction Revenue`, `Transaction Related`; older: `Buy`, `Sell`, `Fee`                                                                                                                                                                                                                                                                                                                                                                        |
| swap-like pairs (+one coin, −another, same second) | `Binance Convert`, `Small assets exchange BNB` / `Small Assets Exchange BNB`, `BNB Fee Deduction`, `ETH 2.0 Staking` (ETH→BETH), `Stablecoins Auto-Conversion`, `Asset Conversion Transfer`, `Large OTC trading`, `Buy Crypto With Card`                                                                                                                                                                                                                                                                                        |
| deposit / withdrawal                               | `Deposit`, `Withdraw`, `Fiat Deposit`, `Fiat Withdraw`, `Fiat Withdrawal`, `Send`, `Buy Crypto`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| income: interest                                   | `Simple Earn Flexible Interest`, `Savings Interest`, `Savings distribution`, `Pool Distribution`, `Launchpool Interest`                                                                                                                                                                                                                                                                                                                                                                                                         |
| income: staking                                    | `Staking Rewards`, `ETH 2.0 Staking Rewards`, `Simple Earn Locked Rewards`, `POS savings interest`, `BNB Vault Rewards`, `Swap Farming Rewards`, `Liquid Swap rewards`                                                                                                                                                                                                                                                                                                                                                          |
| income: airdrop                                    | `Airdrop Assets`, `Distribution` (if positive), `Simple Earn Flexible Airdrop`, `HODLer Airdrops Distribution`, `Launchpool Airdrop`, `Megadrop Rewards`, `Cash Voucher distribution`, `Campaign Related Reward`                                                                                                                                                                                                                                                                                                                |
| income: referral                                   | `Commission Rebate`, `Commission History`, `Referral Kickback`, `Referral Commission`, `Referrer rebates`, `Commission Fee Shared With You`                                                                                                                                                                                                                                                                                                                                                                                     |
| income: mining                                     | `Super BNB Mining`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| internal move, not taxable                         | `transfer_in`, `transfer_out`, `Transfer Between Main and Funding Wallet`, `Transfer Between Spot Account and UM Futures Account`, `Transfer Between Spot Account and CM Futures Account`, `Transfer Between Main Account/Futures and Margin Account`, `Simple Earn Flexible Subscription` / `Redemption`, `Simple Earn Locked Subscription` / `Redemption`, `Staking Purchase` / `Redemption`, `POS savings purchase` / `redemption`, `Savings purchase`, `Savings Principal redemption`, `Launchpool Subscription/Redemption` |
| out of scope (flag `unknown_type`)                 | futures (`Realized Profit and Loss`, `Funding Fee`), margin and loan operations, `Token Swap - Redenomination/Rebranding`, `Binance Card Spending`, `Crypto Box`, and **any name not in this table**                                                                                                                                                                                                                                                                                                                            |

The list is open-ended; Binance adds names without notice (ME saw new ones appear in Nov 2023). Unknown names must become
`unknown_type` rows, never be dropped.

Known gaps in the statement (ME): fees on fiat purchases are missing; staking rewards may be aggregated; P2P is a separate export.

### A5. Deposit History (crypto) — verified (BT)

```
Date(UTC+0),Coin,Network,Amount,Address,TXID,Status
```

### A6. Withdrawal History (crypto) — verified (BT)

```
Date(UTC+0),Coin,Network,Amount,Fee,Address,TXID,Status
```

- `Status` = `Completed` is the only value BT imports; other values exist (**unverified** which). Keep non-completed rows as raw rows with a flag, no balance effect.
- `Fee` is in the same coin as `Amount` (BT). Whether `Amount` is before or after the fee is **unverified**; BT treats `Amount` as the quantity
  sent and `Fee` as extra. The statement's `Withdraw` row should then equal `−(Amount + Fee)`; use that to cross-check on a real file.
- `Network` uses Binance codes (`BTC`, `ETH`, `BSC`, `TRX`, ...). `TXID` is the on-chain hash; internal/off-chain transfers carry a non-hash text (**unverified** wording).
- The only way to tell A5 from A6 is the `Fee` column.

Older combined layout (BT) — same header for both files, so **the file name decides** (`deposit` / `withdraw` in the name):

```
Date(UTC),Coin,Network,Amount,TransactionFee,Address,TXID,SourceAddress,PaymentID,Status
Date(UTC),Coin,Amount,TransactionFee,Address,TXID,SourceAddress,PaymentID,Status
Date,Coin,Amount,TransactionFee,Address,TXID,SourceAddress,PaymentID,Status
```

Fiat deposit/withdrawal (BT): `Date(UTC…),Coin,Amount,Status,Payment Method,Indicated Amount,Fee,Order ID`, status `Successful`.

### A7. Other Binance files

| File                  | Header                                                                                                                                                                    | Confidence                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Convert history       | `Date,Pair,Type,Sell,Buy,Price,Inverse Price,Date Updated,Status` (also with `Wallet` after `Date`); `Sell`/`Buy` cells are `"0.5 BTC"` with a space; status `Successful` | verified (BT)                                                                                               |
| USDⓈ-M futures trades | `Date(UTC),Pair,Side,Price,Quantity,Amount,Fee,Realized Profit`                                                                                                           | CH only                                                                                                     |
| Futures transactions  | `Date(UTC),type,Amount,Asset,Symbol,Transaction ID`                                                                                                                       | verified (BT); out of scope                                                                                 |
| **P2P order history** | not found in any source                                                                                                                                                   | **unverified** — matters in India: P2P is how many users turn INR into USDT, and it is not in the statement |

### A8. Overlap between Binance files

The statement (A4) repeats what A1/A2 and A5/A6 contain. BT has a switch (`binance_statements_only`) and by default **skips** trade,
deposit, withdrawal and convert operations in the statement. Recommended for us:

1. Phase 1 importer: A1, A2, A5, A6 (what SPEC §6 names).
2. Statement importer: import only operations that the other files cannot give (income, dust conversion, convert), unless the user
   says "the statement is my only file", in which case rebuild trades by timestamp grouping.
3. Dedupe cannot rely on ids. `sourceRef` = sha256 of the canonical row **plus an ordinal among identical rows**
   (`<hash>#0`, `<hash>#1`), otherwise two real identical fills collapse into one (fixture: 2026-05-10). The ordinal is stable
   across overlapping exports because identical rows share one timestamp and land in the same export together.
4. Use a different `source` suffix per file kind only if cross-file dedupe is done some other way; a trade in A1 and the same trade in A4 hash differently.

---

## B. CoinDCX

### B1. How the file is obtained — verified (CX, CK, KX)

App: Profile → Generate Reports → Trade Report → pick financial year and quarter(s) → emailed, "typically within 4 hours".
One Excel file (`.xlsx`) with one sheet per product. Reports are per financial year (KX: "From Q1 – Q4") or per quarter (CK),
so a user uploads several files; an order near a quarter boundary could appear in two files, which dedupe must absorb.

Third-party guides repeat: do not open and re-save the file in Excel ("changes the dates", CK).

### B2. Sheets

| Sheet name (exact)                                                           | Content                           | Confidence                                                                                            |
| ---------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Instant Orders`                                                             | INR quick buy/sell                | name verified (SD, Scribd snippet); CX and CK call it "Insta Orders" in prose                         |
| `Spot Orders`                                                                | spot fills, INR and crypto-quoted | name verified (SD, Scribd snippet)                                                                    |
| `Future Orders (INR-M)`                                                      | futures P&L, INR margined         | name verified (KL, Feb 2025). Note singular "Future"                                                  |
| `Futures Orders (USDT-M)`                                                    | futures P&L, USDT margined        | name verified (KL, Feb 2025)                                                                          |
| options sheet                                                                | options positions                 | exists (CX, CK); exact name unverified (a CoinDCX page says "Options (INR-M)")                        |
| Web3 sheet                                                                   | Web3 trades                       | exists per CK; name unverified                                                                        |
| `Margin Orders`, `Future Orders`, `Crypto Dep&Wdl,Airdrop,Staking`, `Others` | older report (FY 2022-23)         | names from a search snippet of one real file; columns unverified; **not** listed in 2026 descriptions |

**There is no deposits tab, withdrawals tab or TDS tab in the current report as described by CX and CK.** TDS is a column on the
trade sheets. The TDS certificate (Form 16A) is a separate quarterly PDF. Deposits and withdrawals come, per an older KoinX guide,
from Orders → Order History → Wallet History → DEPOSITS / WITHDRAWALS → Download CSV; that CSV's columns are **unverified**.
SPEC §6 ("trades, deposits, withdrawals, TDS…") should be read as: Instant Orders + Spot Orders now, everything else reported as skipped.

Header position — verified (SD): rows 1–6 report metadata, rows 7–8 notes, **header on row 9**, data from row 10. The text of rows 1–8 is unverified.
Scan for the header row instead of trusting the number.

### B3. `Instant Orders` — verified (SD code + tests)

```
Trade ID | Crypto | Trade Completion time | Side (Buy/Sell) | Avg Buying/Selling Price(in INR) | Quantity |
Gross Amount Paid/Received by the user(in INR) | Fees(in INR) | Net Amount Paid/Received by the user(in INR) | *TDS(in INR)
```

Shipped variants of the same columns (SD: "CoinDCX has shipped several header variants"):

| Column | Variant 1               | Variant 2          |
| ------ | ----------------------- | ------------------ |
| id     | `Trade ID`              | `Transaction ID`   |
| time   | `Trade Completion time` | `Transaction time` |
| TDS    | `*TDS(in INR)`          | `**TDS(in INR)`    |

Which variant is newest is not certain (SD's tests call variant 2 "current"; CX's prose still says Trade ID / Trade Completion Time).
Match headers after lower-casing and removing whitespace and `*`, as SD does. The fixture uses variant 2.

- `Crypto` is a bare symbol (`USDT`, `BTC`); the other side is always INR.
- `Side (Buy/Sell)`: `Buy` / `Sell`; casing varies (`buy` seen in SD tests) → compare case-insensitively.
- Buy: net = gross + fees. Sell: net = gross − fees. TDS cell is empty on buys.

### B4. `Spot Orders` — verified (SD code + tests; `TDS(in base currency)` also in KL)

```
Order ID | Trade ID | Crypto Pair | Base currency | Trade Completion time | Side (Buy/Sell) |
Avg Buying/Selling Price(in base currency) | Quantity | Gross Amount Paid/Received by the user(in base currency) |
Fees(in base currency) | Net Amount Paid/Received by the user(in base currency) |
*Net Amount Paid/Received by the user (in INR) | **TDS(in base currency) | **TDS (in INR)
```

| Point                                        | Detail                                                                                                                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Base currency" means the quote currency** | `INR` for `BTCINR`, `USDT` for `ETHUSDT`. It is the currency amounts are expressed in, the opposite of the usual meaning of "base".                                                                                                     |
| Ids                                          | `Order ID` + `Trade ID`; one order can have several trade ids (partial fills, CX). `sourceRef` = `Trade ID`.                                                                                                                            |
| Pair spelling                                | SD accepts `BTCINR`, `BTC-USDT`, `BTC/USDT`, `BTC_USDT`; CX prose writes `BTC/INR`. Which one real files use is not settled. Split using the `Base currency` cell as the known suffix.                                                  |
| INR pairs                                    | amounts are rupees; `*Net … (in INR)` equals the net amount.                                                                                                                                                                            |
| USDT (crypto-quoted) pairs                   | amounts are in USDT; `*Net … (in INR)` is an INR value of the **net** amount (CX: "approximate INR equivalent"). Implied rate = net INR ÷ net base; gross INR = gross base × that rate.                                                 |
| TDS                                          | 1% on the asset given up. On INR-pair **sells** it is in INR. On USDT-pair **buys** it is charged too (USDT is the VDA transferred), shown in USDT and INR (SD test row: net 80.2 USDT → TDS 0.802 USDT, 72.18 INR). Empty on INR buys. |
| Fees                                         | in the quote currency; added on buys, subtracted on sells.                                                                                                                                                                              |
| Blank numeric cells                          | treat as absent, not zero-with-meaning.                                                                                                                                                                                                 |

**GST:** no GST column is verified on any sheet. Whether `Fees` includes 18% GST is unverified (KL has a user report titled "GST paid on trades is
not imported" but it names no GST column). The importer cannot fill `gstInr` from this file; leave it unset.

**Time zone:** not stated in any source. IST is likely for an Indian exchange but unverified → keep the per-file question (SPEC §6).

**Cell types:** whether dates are text or Excel date serials is unverified. Numbers are numeric cells, i.e. IEEE doubles in the file:
read the cell's stored text and parse it as a decimal string (see `libraries.md`, XLSX).

### B5. Futures sheets — partial (KL + CX), out of scope

Exact (KL): `Gross P&L for this transaction(in INR)`, `Net P&L for this transaction(in INR)`, `Fees(in INR)` on `Future Orders (INR-M)`;
the same with `(in USDT)` on `Futures Orders (USDT-M)`. Descriptive only (CX): Transaction ID, Crypto Pair, Base Currency, Transaction Time,
Type of Transaction, Gross P&L, USDT Settlement Amount (INR), Fees, Net P&L. Futures P&L is not a VDA transfer row; report the sheet and its row count as skipped.

### B6. Mapping to the ledger

| Export row                   | LedgerTx                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Instant buy of X             | `buy`, `assetIn=X`, `assetOut=INR`, `amountOut=gross`, `inrValue=gross`, `feeAsset=INR`                                                    |
| Instant / spot INR sell of X | `sell`, `assetOut=X`, `assetIn=INR`, `inrValue=gross`, `tdsInr` from the TDS (INR) column                                                  |
| Spot buy on a USDT pair      | `swap`, `assetOut=USDT` (gross), `assetIn=X`, `priceQuote={USDT, price}`, `inrValue` from the implied rate, `tdsInr` from `**TDS (in INR)` |
| Spot sell on a USDT pair     | `swap`, `assetOut=X`, `assetIn=USDT`                                                                                                       |

Open point for the engine owner: the INR figure CoinDCX prints for USDT pairs is the trade's own INR value, so `inrRateSource="trade_inr"`
fits best, but it is derived from the net amount.

### B7. Older CoinDCX exports — unverified

Web: Orders → Order History / Margin History / Insta History / Futures History / Conversion History → Download CSV (ClearTax guide
screenshots dated 2023-01-11; CoinLedger guide 2024-08-05). Different CSV layouts, not found in any parser. Send them through the generic recipe path.

---

## C. Other fixtures

| Fixture                        | Basis                                                                                                                                                                                                                          | Confidence                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `generic-unknown-exchange.csv` | shaped like WazirX's "Exchange Trades" report (Date, Market, Price, Volume, Total, Trade, Fee Currency, Fee, TDS) from memory                                                                                                  | low; it only needs to be a plausible unknown layout                                                                 |
| `generic-signed-amounts.csv`   | invented: negative quantity = sell, separate coin / quote columns, Indian digit grouping                                                                                                                                       | invented on purpose                                                                                                 |
| `us-broker-schwab-like.csv`    | Schwab transactions export header `"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"` (matches a third-party importer's expected format: <https://www.allinvestview.com/how-to-import/schwab/>) | medium for the header; action names (`Qualified Dividend`, `NRA Tax Adj`) and the `as of` date form are from memory |

Recipe gaps these files expose (SPEC §6 `Recipe` has no field for them): a header row that is not row 1 (CoinDCX), thousands separators
and currency signs in numbers (`"95,00,000.00"`, `$1,249.57`, `-$2.31`), a quantity with the symbol glued on (Binance A1),
a dividend / tax-withheld action (broker), and a date like `01/02/2026 as of 12/31/2025`.

## D. What this means for the importers

1. Detect by header strings (after trimming, lower-casing, dropping `*`), never by file name or extension — except Binance's old combined deposit/withdrawal layout, where only the file name tells them apart; ask the user if the name does not say.
2. No ids on Binance: hash + ordinal for `sourceRef` (A8.3). CoinDCX: `Trade ID` / `Transaction ID`.
3. Binance statement is optional and overlapping; default to skipping its trade/deposit/withdraw rows.
4. CoinDCX: import `Instant Orders` and `Spot Orders`; list every other sheet as skipped with a row count.
5. Transfers out of CoinDCX are not in the trade report. Without the wallet-history CSV, the matching Binance deposit will be `unmatched_transfer`.
6. Ask one real user (the project owner) for a redacted header row of each file to close the unverified items: Binance trade history decimals and order, withdrawal `Amount` vs `Fee`, P2P export, CoinDCX rows 1–8, pair spelling, date cell type, time zone, wallet-history CSV.
