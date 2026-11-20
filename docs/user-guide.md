# User guide

> **Pre-release. Not tax advice.** The tax rules are pending review by a Chartered Accountant (CA). No CA has
> approved them. Use the report as working papers and have a CA check it before you file.

This guide follows the app's menu: Overview, Import, Imports, Connections, Transactions, Review, Report and
Settings. Install first: see the [install guide](install.md).

- [1. First run](#1-first-run)
- [2. Which exports to download](#2-which-exports-to-download)
- [3. Importing a file](#3-importing-a-file)
- [4. Other CSVs: recipes and the AI wizard](#4-other-csvs-recipes-and-the-ai-wizard)
- [5. Connections: exchange sync and the key vault](#5-connections-exchange-sync-and-the-key-vault)
- [6. EVM wallets](#6-evm-wallets)
- [7. Price lookups](#7-price-lookups)
- [8. Transactions](#8-transactions)
- [9. Review codes](#9-review-codes)
- [10. Settings, and what a CA should check](#10-settings-and-what-a-ca-should-check)
- [11. The report and exports](#11-the-report-and-exports)
- [12. Balances and balance snapshots](#12-balances-and-balance-snapshots)
- [13. Command line](#13-command-line)

## Two words first

- **Tax year.** India's year runs 1 April to 31 March, in Indian time (IST). The app has two:
  - **2025-26**: financial year 2025-26 under the Income-tax Act 1961. This is what the ITR form labelled
    "AY 2026-27" covers.
  - **2026-27**: 1 April 2026 to 31 March 2027, the first tax year under the Income-tax Act 2025.

  "AY 2026-27" and "tax year 2026-27" are **different years**. Reports print the dates next to the label.
- **Ledger.** Every import and sync becomes rows in one common format (buy, sell, swap, deposit, withdrawal,
  income, gift, fee). The original row is always kept and can be opened from any transaction.

## 1. First run

1. **Notice.** The first visit shows a notice: what the tool does, that it is not tax advice, that the rules are
   pending CA review and that your data stays on your computer. Click **I understand** to continue. (Reports and
   exports through the API are not blocked by it.)
2. **Getting started checklist.** The Overview page shows five steps, each with a link and a done/not-done mark
   worked out from your data: choose the tax year and settings, import a file or connect an exchange, resolve
   Review items, open the report, export. You can dismiss it.
3. **Try with sample data.** To look around before using your own files, click **Try with sample data** on the
   Overview page. It loads a small, clearly fake history (Binance, CoinDCX and one EVM wallet) so you can see a
   complete report at once. While it is loaded a banner says **Sample data loaded** with a **Remove sample data**
   button, and the report and every export say **Includes sample data**. Remove it before you import your own
   files; removing it deletes only the sample imports and their rows.

## 2. Which exports to download

Import **all your history from the first trade**, not only the year you are filing: FIFO needs the earlier buys,
and a sale with no buy history is left out of the totals as unresolved. Overlapping files are fine; duplicates are
detected.

### Binance

The best set is: **Spot Trade History** + **Deposit history** + **Withdrawal history** + the **Transaction History
statement** (for everything that is not a spot fill: Convert, dust, Earn, airdrops, distributions, Binance Pay) +
**Convert history** if you use Convert.

| Export                                       | Where to find it (Binance website unless noted)                                                     | Notes                                                                                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Spot Trade History**                       | Orders → Spot Order → Trade History → Export Trade History                                          | Best source for trades: one row per fill, with fees. "All time" statements: 1 year per file, 5 per month, data from 2017-07-13.                                                                        |
| Spot Order History                           | Orders → Spot Order → Order History → Export. App: Trade → Spot → Orders → Order History → Download | One row per order and **no fee column**. Use only when Trade History is missing; rows are flagged for fee review. Older and asset-column layouts are also read.                                        |
| **Transaction History statement**            | Assets → Asset History → Export Transaction Records. Use "Customize" for more than 6 months         | The only export with Earn interest, staking, airdrops, dust conversion, Binance Pay, referral income and the MATIC→POL swap. CSV or XLSX. Trades in it are skipped when you also import Trade History. |
| **Deposit history** / **Withdrawal history** | Wallet → Transaction History → Deposit (or Withdraw) → Export                                       | Needed to match transfers to your own wallets. A legacy combined wallet history is also read.                                                                                                          |
| Convert history                              | Wallet → Transaction History → Convert History → Export (website only)                              | Custom range is at most 90 days per file.                                                                                                                                                              |
| Fiat history                                 | Wallet → Transaction History → Fiat tab                                                             | Fiat deposits and withdrawals.                                                                                                                                                                         |
| Futures trade and transaction history        | Orders → Futures Order → USDⓈ-M or COIN-M → Trade / Transaction History → Export                    | Imported and **flagged, never taxed** (see [Derivatives](#derivatives)).                                                                                                                               |
| **Account Statement** (PDF)                  | Wallet → Account Statement (website only)                                                           | A balance snapshot on one date, not transactions. Binance asks you to set an 8-digit password; enter it when importing. See [section 12](#12-balances-and-balance-snapshots).                          |

Not read yet, because no confirmed header sample exists: Binance P2P, margin, options, futures **order** history,
Buy Crypto (card) and standalone Earn exports. Earn rewards are covered by the Transaction History statement; for
P2P, use the generic CSV path ([section 4](#4-other-csvs-recipes-and-the-ai-wizard)) or [contribute a
recipe](../CONTRIBUTING.md#adding-a-csv-recipe).

**Time zones.** Binance writes the time zone only in the file name, for example
`Binance-Spot-Order-History-202611170145(UTC+5)-part1-of1.csv`. Keep the original file name: the app reads the
offset from it. If a file was renamed, you must tell the app the zone, and rows are flagged `ambiguous_timezone`.
Large exports are split into `part1-of2`, `part2-of2`; import every part.

Binance does not deduct Indian TDS, so Binance sales get a `tds_not_deducted` note.

### CoinDCX

| Export                          | Where to find it                                                                                                      | Notes                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trade Report** (XLSX)         | App → Profile → Generate Reports → Trade Report → choose financial year and quarter → emailed, usually within 4 hours | **Best source.** Sheets _Instant Orders_ and _Spot Orders_, one row per trade with fee and TDS in INR. Futures and options sheets are imported and flagged. |
| Order History (CSV)             | Web → Orders → Order History → Download CSV → choose period                                                           | One row per order, with fee and TDS. Joined to the Trade Report by Order ID, so importing both does not double count.                                       |
| TDS Certificate (Form 16A, PDF) | Profile → Generate Reports → TDS Certificate → per quarter                                                            | Recognised but **not imported yet**. Keep it for your records and your CA.                                                                                  |

Not read yet: CoinDCX Wallet History (deposits and withdrawals) and the TDS Summary report. If you moved coins in
or out of CoinDCX, add those transfers by hand or with a recipe. CoinDCX deducts 1% TDS; the credit comes from the
Trade Report or Order History, not from the API.

### Other exchanges and wallets

Any CSV or XLSX with one row per trade can be imported with a recipe ([section 4](#4-other-csvs-recipes-and-the-ai-wizard)).

## 3. Importing a file

On **Import**:

1. **Drop the file** (CSV, XLSX or PDF, up to 25 MB).
2. **File source.** _Auto-detect_ recognises Binance, CoinDCX and any file that matches a saved recipe. You can
   also pick _Binance_, _CoinDCX_ or _Other CSV / XLSX_. Files are recognised by their header row, never by the
   file extension.
3. **What time zone are the times in this file?** Choose **IST (+05:30)**, **UTC** or **Other offset** (a fixed
   `±HH:MM` up to ±14:00). This decides which tax year a trade falls in, which matters for trades near midnight on
   31 March. A zone stated in the file itself (a ` UTC` suffix in the header, or the Binance file-name offset)
   wins over your choice, and a conflict is shown as a warning.
4. For a password-protected PDF, enter its password. It is used once and never stored or logged.

The result shows rows read, inserted, duplicates, skipped, errors and warnings, per sheet, plus the report kind it
detected. Every row is accounted for: `read = inserted + duplicates + errors + skipped`. Skipped rows are
intentional (for example statement trades already covered by Trade History) and each has a reason.

**Imports** lists every file and sync. Open one to see per-sheet detail, row errors and skipped rows. Deleting an
import deletes its ledger rows and original rows, and restores any rows it had replaced. Manual edits on other
rows are kept.

**Importing the same file twice** changes nothing: rows are matched on their source and the exchange's own id
(or a hash of the original row). A file and an API sync of the same exchange are also matched, so trades are not
counted twice. Rows that are almost but not exactly the same are kept and flagged `possible_duplicate` for you to
decide.

### Derivatives

Futures, perpetuals and options rows (Binance USDⓈ-M/COIN-M, CoinDCX futures and options) are imported, kept and
flagged, but **not taxed**. Whether their profit is VDA income at 30% or business income is an open question for
your CA.

## 4. Other CSVs: recipes and the AI wizard

A **recipe** maps an unknown file's columns to the ledger: which column is the date, side, pair, amount, price,
total, fee, fee asset, TDS, id and transaction hash; the date format; how buys and sells are shown (a side column,
or negative amounts for sells); and which quote currencies to split pairs on (so `BTCINR` becomes BTC and INR).

When you import a file with no matching recipe, the wizard opens:

1. **Headers.** You see the file's headers and sample rows.
2. **Optional AI suggestion.** Click to preview the payload: the app shows **exactly** what will be sent (headers and
   up to 20 rows), the endpoint and the model, before anything leaves your machine. Then **Send & suggest
   recipe**. The reply is checked against the recipe schema; an invalid reply is rejected, never half-applied.
   You can skip this step and fill the form yourself.
3. **Edit the recipe** in the form: columns, date format, sign style, quote assets, side/type value mapping
   (**Auto-detect from sample** fills it from the data), and the file's time zone.
4. **Preview** 10 converted rows beside the originals, with checks: every date parses, every number parses, rows in
   equal rows out, and a warning if any balance would go negative (often a wrong sign style or missing history).
5. **Confirm**, and optionally save the recipe so the next file with the same headers imports automatically.

The AI only writes recipes. It never sees your full file and never computes tax. The default endpoint is a local
Ollama container ([install guide §6](install.md#6-optional-local-ai-with-ollama)). A cloud endpoint needs your own
key and a tick-box acknowledgement in Settings.

Shared recipes contributed by other users ship with the app in a recipe library; see
[CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-csv-recipe) to add one for an exchange you use.

## 5. Connections: exchange sync and the key vault

Sync is optional. File import stays the main path, and nothing is fetched until you add a connection and click
**Sync now**.

### The vault

Exchange and provider keys are encrypted before they are stored, with a passphrase only you know:

- **Set up** with a passphrase of at least 12 characters. **If you forget it, the keys cannot be recovered**: reset
  the vault and enter your keys again. Your imported history is not affected.
- **Unlock** to add keys or sync. The vault locks after 30 minutes idle, when you lock it, and on every restart.
- **Change passphrase** re-encrypts every key. **Reset** (type `RESET` to confirm) erases all stored keys and keeps
  connections and history.
- `SECRETS_PASSPHRASE` in `.env` unlocks the vault at startup. It is weaker; see the
  [install guide](install.md#3-configuration-env).

### Binance

1. On Binance: **API Management → Create API → System generated**, enable only **Enable Reading**. Leave trading and
   withdrawals off. (The dialog links to the page.)
2. In the app: **Connections → Add connection → Binance**, paste the key and secret.
3. The app checks the key straight away. A key that can trade or withdraw shows a **red warning**: delete it on
   Binance and create a read-only one.
4. **Sync now** fetches trades, deposits, withdrawals, Convert, dust, dividends, fiat, P2P and balances. Binance's
   trade API needs the trading pairs; add any it misses under **Extra trading pairs**.

### CoinDCX

CoinDCX keys **cannot be made read-only**. Turn on IP binding if you can and use a sub-account. The CoinDCX API
returns only trades and balances: no deposits, withdrawals or TDS. Keep importing the CoinDCX Trade Report for
those.

### Sync results

Progress updates live. Each sync appears as an import named like "Binance API sync 2026-11-17 10:02 IST" with a
**Synced** badge. A sync that stops part-way (rate limit, network) resumes from where it stopped next time. Each
connection shows a per-stream summary and a **balance check**: the balance the exchange reports beside the balance
your ledger implies. A difference is highlighted and shows a **Balance mismatch** badge; it usually means a missing
file or a missing transfer.

Deleting a connection deletes its keys and sync position, not its history. Deleting the sync import deletes the
history; the next sync fetches it again.

## 6. EVM wallets

**Connections → Add connection → EVM address**, choose the chain, paste a public address (never a private key
or seed phrase). The app reads public history through a block explorer API, which needs a free key. Add keys in the
**Provider keys** card (stored in the vault):

| Chain           | Providers the app tries, in order              | Key you need (minimum)                                                                                  |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Ethereum        | Etherscan → Blockscout → Alchemy               | A free Etherscan, Blockscout or Alchemy key                                                             |
| Polygon PoS     | Etherscan → Blockscout → Alchemy               | A free Etherscan, Blockscout or Alchemy key                                                             |
| Arbitrum One    | Etherscan → Blockscout → Alchemy               | Free Etherscan or Blockscout. Alchemy alone misses internal transfers, so the sync is marked incomplete |
| Base            | Alchemy → Etherscan (paid) → Blockscout (paid) | A **free Alchemy** key, or a paid Etherscan key                                                         |
| BNB Smart Chain | NodeReal → Etherscan (paid)                    | A **free NodeReal** key, or a paid Etherscan key                                                        |

A paid Etherscan key covers all five chains; mark its tier as _paid_ when you save it. If a chain has no usable key
the app tells you which providers would work.

What to expect:

- Native coins and well-known tokens share one asset id across chains (ETH on Base is ETH). Unknown tokens get an
  id like `ERC20:1:0X…` so a fake "USDT" never merges with real USDT.
- Gas fees are recorded as fees and follow your fee setting.
- Unsolicited and look-alike tokens are flagged `suspected_spam` and left out of the tax calculation until you clear
  the flag.
- Swaps, wraps, liquidity pools and bridges are not interpreted. Each leg is recorded so balances still add up, and
  the transaction is flagged `complex_onchain` for you to classify.
- A withdrawal from an exchange and a deposit to your wallet with the same transaction hash are matched as your own
  transfer, so cost basis moves with the coins.
- Transaction hashes link to the chain's explorer; nothing loads until you click.

## 7. Price lookups

Some rows have no rupee value of their own: an on-chain swap, a gas fee, an airdrop. Price lookups fill those from
historical daily prices.

Turn them on in **Settings → Price lookups** (off by default):

- **Enable historical market price lookups.** Prices come from Binance public daily candles
  (`data-api.binance.vision`, no key, history back to 2017) for `<COIN>USDT`, aligned to the IST day, then
  converted to rupees per your USDT/INR setting.
- **Use CoinGecko fallback** for coins Binance does not list. Needs a free CoinGecko Demo key in the Provider keys
  card and covers only the last 365 days.
- **Market price basis:** IST-day close (default) or IST-day volume-weighted average. A CA question.

Then on the **Report** page, **Fetch missing prices** fetches what the year needs and stores it locally. Prices are
also fetched after a sync you started, if lookups are on. Computing a report never goes online; it uses only stored
prices. Rows that still have no price keep a `missing_inr_value` flag.

## 8. Transactions

A filterable, paginated table of the whole ledger (by tax year, asset, type, source, flagged, free text). Click a row
to open it: the converted fields, the **original row exactly as imported**, flags, and the transaction hash. You can
change the type, the INR value, the venue (manual rows) and a note, and mark flags resolved. Edited rows are never
overwritten by a later re-import.

**Add manual transaction** covers what no export contains: a gift received, income, or a **missing buy** (the fix
for missing history). Manual rows can be deleted; imported rows cannot, only their import.

## 9. Review codes

The **Review** page groups every open problem by code, explains it and links to the fix. Codes from the report
appear after you compute it.

| Code                      | Title in the app                          | Severity | What it means and what to do                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing_history`         | Missing acquisition history               | Error    | A sell or swap used up more coins than your recorded buys. The uncovered part is **left out of the totals** and listed as unresolved, never given zero cost. Import earlier history or **Add missing buy**. Also raised for a negative year-end holding. |
| `missing_inr_value`       | Missing INR valuation                     | Error    | No rupee value and no USDT/USD price to work one out. Turn on price lookups and fetch prices, or enter the INR value by hand.                                                                                                                            |
| `unknown_type`            | Unrecognized transaction type             | Error    | The importer could not tell what kind of row this is. Open the original row and set the type. Derivatives rows carry this too, on purpose.                                                                                                               |
| `fx_unavailable`          | SBI FX reference rate unavailable         | Error    | No bundled SBI USD/INR rate on or before that date, so a USD/USDT amount could not be converted. Enter the INR value by hand.                                                                                                                            |
| `unmatched_transfer`      | Unmatched withdrawal or deposit           | Warning  | A withdrawal or deposit with no matching other side on another source within the match window. Import the other wallet or exchange, or check whether it was a sale or a gift.                                                                            |
| `ambiguous_transfer`      | Ambiguous self-transfer match             | Warning  | More than one deposit could match this withdrawal. Check the pair so the cost basis moves to the right place.                                                                                                                                            |
| `tds_not_deducted`        | TDS not deducted by platform              | Warning  | Sales on a platform that does not deduct Indian TDS (Binance). The report shows the TDS that may have been due; discuss it with your CA.                                                                                                                 |
| `ambiguous_timezone`      | Ambiguous timestamp timezone              | Warning  | The file did not state its time zone, so your choice was used. Check trades near midnight on 31 March / 1 April IST.                                                                                                                                     |
| `balance_mismatch`        | Computed vs actual balance mismatch       | Warning  | Your computed year-end balance differs from the actual balance you entered, a statement or an exchange. Usually a missing file, transfer or fee convention.                                                                                              |
| `parse_warning`           | Import parse warning                      | Warning  | The row was read with a fallback or an unusual format (for example long float-noise prices, or a CoinDCX file row adding TDS to an API row). Compare the original with the converted fields.                                                             |
| `fee_review_required`     | Fee treatment requires review             | Warning  | A fee needs checking: an order export with no fee column, a fee larger than the trade, an unusual fee coin, or a received amount larger than the sent amount.                                                                                            |
| `import_incomplete`       | Incomplete import or excluded rows        | Warning  | A file is waiting for a recipe, failed, or had row errors; or a sync did not finish. Finish those imports so no trades are missed.                                                                                                                       |
| `suspected_spam`          | Looks like a spam token                   | Warning  | An unsolicited or look-alike token. Left out of the calculation until you clear the flag.                                                                                                                                                                |
| `possible_duplicate`      | Possible duplicate of a file-imported row | Warning  | An API row almost matches a file row (or two exports overlap in a way the app could not settle). If both are the same trade, keep one.                                                                                                                   |
| `complex_onchain`         | Complex on-chain interaction              | Info     | A multi-leg contract call, bridge or wrap, or a derivatives row. Each leg is recorded; classify it yourself or ask your CA.                                                                                                                              |
| `ca_verification_pending` | Section numbers pending CA verification   | Info     | The section numbers printed on the report have not been verified by a CA. Shown for every tax year until they are.                                                                                                                                       |

Review also lists connections whose last sync failed or was incomplete, and tells you when a tax year's report has
not been computed (or needs recomputing after a change).

## 10. Settings, and what a CA should check

Each tax assumption that the law leaves open is a setting, explained in one line on the Settings page and printed
on every report and export. Changing one invalidates stored reports; recompute afterwards.

| Setting                        | Options (default **bold**)                                                             | Open question for your CA                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default tax year               | 2025-26, 2026-27                                                                       | Which year you are filing for (see [tax year](#two-words-first)).                                                                                                                                                           |
| Head of income                 | **Capital gains**, business                                                            | Which head your VDA income belongs under.                                                                                                                                                                                   |
| Fees                           | **Exclude**, include (add buy fees to cost, deduct sell fees from consideration)       | Only cost of acquisition is deductible. Whether a buy-side fee and its GST are part of that cost, and whether a sell-side fee can reduce consideration, is unsettled.                                                       |
| Lot pool                       | **Global FIFO across all wallets**, per-source FIFO                                    | No rule found prescribing either; FIFO itself is also a choice.                                                                                                                                                             |
| Lot method                     | **FIFO**                                                                               | As above.                                                                                                                                                                                                                   |
| USDT / USD-stablecoin INR rate | **Latest ledger USDT/INR trade, falling back to SBI TT**; always SBI TT buying USD/INR | No rule prescribes how to value VDA-to-VDA trades. Is the SBI USD rate acceptable for USDT given its usual premium in India? Trade-date rate, or the month-end-before date Rule 115/206 uses? Same method for buy and sale? |
| Income cost basis              | **₹0**, fair market value at receipt                                                   | Cost of staking, mining and airdrop coins when later sold.                                                                                                                                                                  |
| Surcharge                      | **0%**, 10%, 15%, 25%, 37%                                                             | Depends on your total income; the slabs under the 2025 Act were not verified.                                                                                                                                               |
| Specified person               | **Off**                                                                                | Raises the yearly TDS threshold from ₹10,000 to ₹50,000. The limit depends on the **payer**, while this setting is about you.                                                                                               |
| Transfer match window          | **72 hours**                                                                           | Practical, not legal.                                                                                                                                                                                                       |
| Transfer amount tolerance      | **0.01** (1%, for network fees)                                                        | Practical, not legal.                                                                                                                                                                                                       |
| Price lookups                  | **Off**; CoinGecko fallback **on**; market price basis **IST-day close**, VWAP         | Which market price is the fair value for an on-chain swap or receipt.                                                                                                                                                       |
| AI Recipe Assistant            | Base URL, model, key, cloud acknowledgement                                            | Not a tax setting.                                                                                                                                                                                                          |

Other points the report prints or the research lists for a CA (full detail, with sources, in
[docs/research/tax-open-questions.md](research/tax-open-questions.md)):

- **Section numbers.** The 2025 Act labels were read from mirrors of the Act, not the Gazette; the TDS threshold
  sits in a different table (s.393(4)) from the TDS rate. The report shows "pending CA verification" until a CA
  signs off.
- **Loss rows.** The app shows income as `max(consideration − cost, 0)` per row and lists losses separately; the
  ITR utility may want the signed difference.
- **One row per transfer or aggregated rows** in Schedule VDA: sources disagree. The app emits one row per sale per
  lot used.
- **TDS base:** gross or net of fees and GST (CoinDCX deducts on the net amount).
- **Futures, perpetuals and options:** VDA income or business income? Not taxed by the app.
- **MATIC→POL** redenomination: a transfer, or a continuation with the same cost and date?
- **Gifts:** the app never uses the gift's fair value as the donor's cost; sales of gifted coins stay unresolved
  until you add the acquisition history.
- **Crypto fees paid in a third coin:** whether paying a fee in BNB is itself a disposal. The app warns but does not
  add one.
- **Who must deduct TDS on a Binance P2P sale.**
- Cess, surcharge slabs and the gift threshold under the 2025 Act were not verified.

## 11. The report and exports

On **Report**, pick the tax year and click **Compute report** (or **Recompute report**). The Overview shows the headline figures: taxable income,
total tax (30% + surcharge + 4% cess), TDS credit, net payable and losses not set off.

The report contains:

- **Schedule VDA**: one row per sale per lot used, in the ITR's columns (date of acquisition, date of transfer, head
  of income, cost of acquisition, consideration received, income), plus asset and quantity. Click a row to open its
  **trail**: the report row → the ledger rows → the original imported rows, with the valuation source (trade price,
  USDT × USD/INR with the rate and date used, or a cached market price with its source and date).
- **Unresolved disposal slices**: sales with missing history or value. **Excluded from totals.**
- **Excluded transactions**: suspected spam and rows replaced by a better export.
- **TDS summary and Form 26AS / AIS reconciliation**: TDS per platform, whether the platform deducts, transfer
  value, TDS that may have been due, and a checklist to match against your Form 26AS and AIS.
- **Income and gifts**: staking, airdrops and other receipts with fair value, and gifts against the ₹50,000
  threshold. Listed separately, not taxed by the VDA calculation.
- **Year-end balances**, with actual-balance inputs and statements ([section 12](#12-balances-and-balance-snapshots)).
- **Prices** status with **Fetch missing prices** (disabled, with the reason, while lookups are off).
- **Engine settings used for this report**, the section labels with their **pending CA verification** badge, and
  report warnings.

Losses are shown but never reduce the tax: Indian VDA rules do not allow set-off.

**Exports.** Each of **Schedule VDA**, **TDS**, **Income** and **Full Report** downloads as CSV or XLSX. Every
export starts with the "not tax advice" notice, the settings used, the section references and their verification
status; it says **Includes sample data** when demo data is loaded. The full report adds totals, balances,
unresolved items, valuations, warnings and the ledger trail. Cells that look like spreadsheet formulas are
escaped.

## 12. Balances and balance snapshots

A good check on any tax report: does the computed year-end holding of each coin match what you actually held?

- **Actual balances.** In the report's _Year-End Balances_ section, type what each exchange or wallet showed on
  31 March. Differences become `balance_mismatch` items. The difference is always _actual − computed_, in coins.
- **Binance Account Statement (PDF).** Binance can generate a statement of your balances on one date (Wallet →
  Account Statement). Import the PDF like any other file, with its 8-digit password. It creates a **snapshot**, not
  transactions. The report's _Statements_ panel compares it with the computed balance. If the statement is dated
  at the tax year end (within 24 hours of 31 March IST), **Use as actual balances for** (the year) saves it as that year's actual balances. Choose
  "show all positions" when generating it; a statement with an aggregated "Others" line is rejected.
- **Exchange and wallet sync** stores the balances the exchange or chain reports and shows them beside the
  computed ones on the Connections page.

## 13. Command line

The engine also runs without the web app, for scripting or checking:

```sh
pnpm install && pnpm -r build
pnpm --filter @tax/cli exec node dist/index.js compute --ledger ledger.json --year 2026-27 --out report.json --csv vda.csv
```

`ledger.json` is an array of ledger rows (see `packages/core`). The web API also works without the browser; the
first-run notice is only a UI gate.
