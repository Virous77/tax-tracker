# Export catalogue: every Binance and CoinDCX export

Checked **2026-11-17**. Extends `export-formats.md` (2026-11-16), which holds the verified header strings for Binance
Trade History, the Transaction History statement, deposits/withdrawals, convert, and the CoinDCX trade report sheets.
This file does not repeat those headers. It points to them as `EF §A1` and so on.

Evidence labels:

| Label          | Meaning                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FILE**       | Seen in the project owner's real export (`data/real-exports/`, gitignored). Only structure was read: header, column order, value _shapes_, enum values. No values copied. |
| **OFFICIAL**   | Read on the exchange's own help or API page on the date shown.                                                                                                            |
| **THIRD**      | Third-party guide or parser only.                                                                                                                                         |
| **UNVERIFIED** | Not confirmed anywhere. Do not hard-code. Detect by header and fall back to the generic recipe path.                                                                      |

Synthetic header samples: `docs/research/export-samples/`.

## Sources

| Id  | Source (all opened 2026-11-17)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BN1 | Binance FAQ "How to Download Spot Trading Transaction History Statement" (published 2022-04-26, **updated 2026-01-27**): <https://www.binance.com/en/support/faq/how-to-download-spot-trading-transaction-history-statement-e4ff64f2533f4d23a0b3f8f17f510eab>                                                                                                                                                                                                                               |
| BN2 | Binance FAQ "How to Generate Transaction History?" (published 2021-07-06, **updated 2025-11-27**): <https://www.binance.com/en/support/faq/how-to-generate-transaction-history-990afa0a0a9341f78e7a9298a9575163>                                                                                                                                                                                                                                                                            |
| BN3 | Binance FAQ "How to View My Spot Trading Activity" (published 2022-09-09, **updated 2026-01-27**): <https://www.binance.com/en/support/faq/how-to-view-my-spot-trading-activity-048b819aed8a4c35b202cba9f977537a>                                                                                                                                                                                                                                                                           |
| BN4 | Binance FAQ "How to Use Binance Account Statements" (au mirror updated 2025-03-14; en-JP mirror): <https://www.binance.com/au/support/faq/e12bc83ec9ba4e96a076d2b4a4419182>, <https://www.binance.com/en-JP/support/faq/detail/e12bc83ec9ba4e96a076d2b4a4419182>                                                                                                                                                                                                                            |
| BN5 | Binance FAQ "How to download the Binance Convert transaction history" (published 2025-04-25): <https://www.binance.com/en-JP/support/faq/detail/da04eeb582a247c7b68827d9d5d5c00c>                                                                                                                                                                                                                                                                                                           |
| BN6 | Binance P2P Merchant Portal FAQ (2021): <https://www.binance.com/en/support/faq/7159c97f2a83484688cc874710ac0266>                                                                                                                                                                                                                                                                                                                                                                           |
| BN7 | Binance announcement "Completed the Polygon (MATIC) token upgrade to POL" (2024-09-13): <https://www.binance.com/en-AE/support/announcement/detail/619c4929fc3f4a0d9df7f9ae1d4519a5>                                                                                                                                                                                                                                                                                                        |
| BN8 | Binance Tax blog: <https://www.binance.com/en-AU/blog/all/introducing-binance-tax-streamline-your-tax-season-experience-9208476713086961306>                                                                                                                                                                                                                                                                                                                                                |
| BNA | Binance futures API notes (download-id endpoints, 100/month shared quota): <https://www.binance.com/en-IN/support/announcement/binance-futures-historical-order-api-updates-6811b3e0da104d77b6fb178e053b887c>, <https://developers.binance.com/docs/derivatives/change-log>                                                                                                                                                                                                                 |
| CD1 | CoinDCX API docs (single page; `ecode`, pair format, order status enum): <https://docs.coindcx.com/>                                                                                                                                                                                                                                                                                                                                                                                        |
| CD2 | CoinDCX support, Reports category (13 articles, each "Updated 4 months ago", i.e. about July 2026): <https://support.coindcx.com/categories/reports/636a38961572471e0d2d0c21>. Read in particular: "How can I download my Trade Report?", "Detailed Breakdown of your Trade Report", "Which products are covered in the Trade Report?", "How can I download the TDS Summary Report?", "How can I download my TDS Certificate?", "Can CoinDCX provide my Tax Report in Excel or PDF format?" |
| KX  | KoinX Binance guide (July 2026): <https://www.koinx.com/integration/binance.md>. THIRD                                                                                                                                                                                                                                                                                                                                                                                                      |
| CL  | CoinLedger guides: Binance P2P <https://help.coinledger.io/en/articles/7174368-binance-p2p-trade-history-file-import-guide>, CoinDCX <https://help.coinledger.io/en/articles/6999470-coindcx-file-import-guide>. THIRD                                                                                                                                                                                                                                                                      |
| CR  | Cryptact Binance guide (futures transaction history): <https://support.cryptact.com/hc/en-us/articles/360002586991-How-to-get-trade-history-from-Binance-Global>. THIRD                                                                                                                                                                                                                                                                                                                     |
| KXT | KoinX "Does Binance report to the Income Tax Department?" (FY 2025-26): <https://www.koinx.com/in/blog/does-binance-report-to-income-tax-department>. THIRD                                                                                                                                                                                                                                                                                                                                 |

Not reachable (HTTP 403): CoinDCX blog pages "how-to-download-coindcx-trade-report" and "how-to-download-crypto-tds-report". Their search snippets are quoted below as THIRD.

---

## 0. Answer first

| Venue   | Best source for tax (fees, one row per fill)                                                                                                                                                                                                                       | Supplementary                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Binance | **Spot Trade History** (`EF §A1`) for trades, plus **Deposit** and **Withdrawal history** (`EF §A5/A6`), plus the **Transaction History statement** (`EF §A4`) for anything that is not a spot fill (convert, dust, earn, airdrops, …), plus **P2P order history** | **Spot Order History** (one row per order, **no fee column**). Use it only when Trade History is missing, and flag every row `fee_review_required`.                                        |
| CoinDCX | **Trade Report** XLSX (`EF §B1–B4`): `Instant Orders` and `Spot Orders` sheets. One row per trade id, fee and TDS in INR.                                                                                                                                          | **Order History CSV** (one row per order, with fee and TDS). **TDS Summary Report** (Excel) and **Form 16A** (PDF) to reconcile TDS. **Wallet History** CSVs for deposits and withdrawals. |

Neither venue offers a transaction-level PDF that adds anything the CSV/XLSX lacks (§1.10, §2.7).

---

## 1. Binance

### 1.1 Facts shared by every Binance export

- **Time zone.** Generated ("All time") statements are "shown in UTC+0" (BN1, OFFICIAL). The app's quick export ("Within 6 months") lets the user pick "the time period, format, and fields to include" (BN2, OFFICIAL, updated 2025-11-27). The owner's real Order History file was exported at **UTC+5**. The offset appears **only in the file name**: the header just says `Time` (FILE).
- **File name pattern** (FILE, one example): `Binance-Spot-Order-History-202611170145(UTC+5)-part1-of1.csv`, i.e. `Binance-<Product>-<Kind>-<yyyyMMddHHmm>(UTC<±H>)-part<N>-of<M>.csv`. The timestamp is the generation time in the chosen offset. `partN-ofM` means a large export was split. Import all parts. Dedupe absorbs any overlap.
  - Parse the offset with `\(UTC([+-]\d{1,2})(?::?(\d{2}))?\)`. Half-hour offsets (`UTC+5:30`) were not seen and may not be offered (**UNVERIFIED**). That would explain why the owner picked UTC+5 rather than IST.
  - If a user renames the file, the offset is lost. No offset in the name and none in the header → raise `ambiguous_timezone` and ask. Never assume UTC for a file whose header says only `Time`.
- **Quotas** (OFFICIAL): Spot Trade/Order "All time" statements: 5 per month, max 1 year per statement, data from **2017-07-13** (BN1). Quick export: max 6 months, max 10,000 rows (BN1). Transaction History statements: "15 - 40" per month (BN2). Download links expire after **7 days** (BN1, BN2).
- **BOM.** The real CSV starts with `EF BB BF` (FILE). The existing CSV reader strips it.
- **Formats.** Website "All time" spot statements are CSV (BN1). The app quick export offers a format choice whose options are not listed (BN2; **UNVERIFIED** whether XLSX or PDF is among them). Third-party guides mention XLSX for the Transaction History statement (KX, THIRD). Detect by header, never by extension (`EF §A`).
- **Footnote superscripts in headers.** `Type¹`, `Executed²`, `Trading total³` (FILE). The file contains no footnote text (no trailer rows). Normalise headers by stripping `¹²³⁴⁵⁶⁷⁸⁹⁰` and `*` before matching.
- **Units in cells.** Quantities carry their asset glued on, with no space: `0.5BTC`, `123.5CVX` (FILE and `EF §A1`). Convert history uses a space instead: `"0.5 BTC"` (`EF §A7`).

### 1.2 Catalogue

"Row" = what one row represents. "Range" = max range per export / how far back. Header references point to `EF` sections or to the subsections below.

| #   | Export                                                     | UI path (web unless noted)                                                                                                       | Formats                                                                             | Range / history                                                                                                                    | Row                                    | Fee / TDS                                                          | Header                     | Role for tax                                                                                                                                  |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Spot Order History**                                     | Orders → Spot Order → Order History → Export; app: Trade → Spot → Orders → Order History → Download (BN1, BN3)                   | CSV (FILE); others UNVERIFIED                                                       | 6 months quick / 1 year generated; from 2017-07-13                                                                                 | one **order**                          | **none**                                                           | §1.3 (FILE)                | supplementary                                                                                                                                 |
| 2   | **Spot Trade History**                                     | Orders → Spot Order → Trade History → Export Trade History (BN1)                                                                 | CSV (BN1)                                                                           | same as #1                                                                                                                         | one **fill**                           | `Fee` with asset glued on, any coin (often BNB)                    | `EF §A1–A3`                | **primary for spot**                                                                                                                          |
| 3   | **Transaction History statement**                          | Assets → Asset History → Export Transaction Records; "Customize" for > 6 months (BN2)                                            | CSV or XLSX (THIRD; KX says keep the Excel)                                         | any range in pieces; 15–40 statements/month (BN2); since 2017 (KX)                                                                 | one **balance change**                 | fee is its own row (`Transaction Fee`)                             | `EF §A4`                   | **primary for non-trade events**; trades only if #2 missing                                                                                   |
| 4   | Deposit history (crypto)                                   | Wallet → Transaction History → Deposit → Export (THIRD)                                                                          | CSV (BittyTax, `EF §A5`)                                                            | UNVERIFIED (third parties say 3 months per export)                                                                                 | one deposit                            | none                                                               | `EF §A5`                   | primary                                                                                                                                       |
| 5   | Withdrawal history (crypto)                                | Wallet → Transaction History → Withdraw → Export (THIRD)                                                                         | CSV                                                                                 | UNVERIFIED                                                                                                                         | one withdrawal                         | `Fee`, same coin as `Amount`                                       | `EF §A6`                   | primary                                                                                                                                       |
| 6   | Convert history                                            | Wallet → Transaction History → Convert History → Export; **website only** (BN5)                                                  | file format not stated (BN5); CSV seen by BittyTax                                  | presets 7/30/90 days; **custom max 90 days** (BN5)                                                                                 | one conversion                         | none shown; spread is in the price                                 | `EF §A7`                   | primary for Convert (also in #3 as `Binance Convert`)                                                                                         |
| 7   | P2P order history                                          | P2P → Orders → All Orders → filters → Export (CL, THIRD; merchant FAQ BN6 says CSV)                                              | CSV                                                                                 | UNVERIFIED                                                                                                                         | one P2P order                          | maker/taker commission (API: `commission`, `takerCommission`)      | §1.7 (UNVERIFIED)          | **primary**: P2P is **not** in #3 (KX, THIRD)                                                                                                 |
| 8   | Fiat deposit/withdrawal, Buy Crypto (card)                 | Wallet → Transaction History → Fiat / Buy Crypto tabs (THIRD)                                                                    | CSV (BittyTax)                                                                      | UNVERIFIED                                                                                                                         | one payment                            | `Fee` in fiat                                                      | `EF §A6` (fiat line)       | primary (Indian users rarely have INR fiat rails on Binance)                                                                                  |
| 9   | Earn / staking rewards                                     | Asset History → Earn → Advanced Earn / Simple Earn → export (KX, THIRD)                                                          | UNVERIFIED                                                                          | UNVERIFIED                                                                                                                         | one reward or subscription             | none                                                               | UNVERIFIED                 | supplementary; #3 already has every reward row                                                                                                |
| 10  | Distribution / airdrop                                     | Wallet → Transaction History → Distribution (UI only)                                                                            | no export found                                                                     | —                                                                                                                                  | —                                      | —                                                                  | —                          | use #3 (`Distribution`, `Airdrop Assets`, …)                                                                                                  |
| 11  | Dust → BNB                                                 | Wallet → Convert Small Balance to BNB → history (UI only)                                                                        | no export found                                                                     | —                                                                                                                                  | —                                      | —                                                                  | —                          | use #3 (`Small assets exchange BNB`)                                                                                                          |
| 12  | USDⓈ-M / COIN-M futures: order, trade, transaction history | Orders → Futures Order → USDⓈ-M or COIN-M → Order / Trade / Transaction History → Export; "Beyond 3 months – Custom" (CR, THIRD) | Excel or CSV (CR, THIRD)                                                            | UI: custom ranges; API: COIN-M trades 3 months; download-id endpoints, **100 per month shared** between UI and API (BNA, OFFICIAL) | order / fill / balance event           | fee per fill in trade history; funding fees in transaction history | `EF §A7` (CH and BittyTax) | **import and flag, never tax** (§3)                                                                                                           |
| 13  | Margin (cross / isolated) order and trade history          | Orders → Margin Order → Order / Trade History → Export (THIRD)                                                                   | UNVERIFIED                                                                          | UNVERIFIED                                                                                                                         | order / fill                           | fee per fill; interest in #3                                       | UNVERIFIED                 | import and flag (§3)                                                                                                                          |
| 14  | Binance Pay                                                | Pay → History (app)                                                                                                              | no export found                                                                     | —                                                                                                                                  | —                                      | —                                                                  | —                          | use #3 (`Binance Pay` operations; names UNVERIFIED)                                                                                           |
| 15  | **Account Statement**                                      | Wallet → Account Statement; website only (BN4)                                                                                   | **PDF only**, or image; emailed PDF in English; **8-digit password required** (BN4) | one date per statement, up to 1 year back; older via VIP Portal → Report Center (BN4); 40/month (en-JP)                            | **balance snapshot**, not transactions | n/a                                                                | §1.10                      | balance check only                                                                                                                            |
| 16  | Binance Tax reports                                        | tax.binance.com (country-limited)                                                                                                | report downloads (format UNVERIFIED)                                                | per tax year                                                                                                                       | gains / income / transactions          | —                                                                  | UNVERIFIED                 | **not for India**: launched for France, Canada, South Africa (BN8 + press, 2023); India availability UNVERIFIED, and it applies foreign rules |

### 1.3 Spot Order History CSV (FILE)

```
Time,OrderNo,Pair,Type¹,Side,Order Price,Order Amount,Time,Executed²,Average Price,Trading total³,Status
```

| #   | Header           | Shape seen                               | Meaning                                                                                                                             |
| --- | ---------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `Time`           | `yyyy-MM-dd HH:mm:ss`                    | order created, in the file-name offset                                                                                              |
| 1   | `OrderNo`        | 8–11 digit integer                       | Binance order id. The **only** Binance spot export with an id (`EF §A` notes the others have none)                                  |
| 2   | `Pair`           | `BTCUSDT` style                          | no separator                                                                                                                        |
| 3   | `Type¹`          | `Limit`, `Stop-Limit`                    | other values (`Market`, `Limit-Maker`, `Take-Profit-Limit`, OCO legs) **UNVERIFIED**                                                |
| 4   | `Side`           | `BUY`, `SELL`                            |                                                                                                                                     |
| 5   | `Order Price`    | plain decimal                            | limit price (quote per base)                                                                                                        |
| 6   | `Order Amount`   | decimal + **base** symbol                | ordered quantity                                                                                                                    |
| 7   | `Time`           | `yyyy-MM-dd HH:mm:ss`                    | **duplicate header name.** Last update (final fill or cancel). Always ≥ column 0. Usually equal to it. Read columns by **position** |
| 8   | `Executed²`      | decimal + base symbol                    | filled quantity; `0` on cancelled orders                                                                                            |
| 9   | `Average Price`  | plain decimal; `0` on cancelled          | volume-weighted fill price                                                                                                          |
| 10  | `Trading total³` | decimal + **quote** symbol, up to 8 dp   | quote amount actually traded                                                                                                        |
| 11  | `Status`         | `FILLED`, `PARTIALLY_FILLED`, `CANCELED` | US spelling. API enum also has `NEW`, `PENDING_CANCEL`, `REJECTED`, `EXPIRED`, `EXPIRED_IN_MATCH`; not seen in files                |

Rules for the importer:

- Base symbol = suffix of `Executed²`; quote symbol = suffix of `Trading total³`. They matched `Pair` on every row of the sample. Use them to split `Pair`; no quote-suffix list needed.
- Rows sorted newest first. No thousands separators seen.
- `CANCELED` with `Executed = 0` → keep as raw, no ledger effect. `PARTIALLY_FILLED` with `Executed > 0` → a trade for the executed part (the remainder was cancelled or is still open).
- **No fee column.** The fee is invisible here (it can be in BNB, the base or the quote). Each imported order gets `fee_review_required`. Prefer Trade History.
- `sourceRef` = `OrderNo`.

### 1.4 Spot Trade History

Headers, splitting and gaps: `EF §A1–A3`. Added today:

- One row per fill, with fee and fee asset (BN3: "Trade history shows a record of your filled orders … check transaction fees and your role as market maker or taker").
- The app quick export lets the user pick fields (BN2). A layout with an order id or a maker/taker column may therefore exist. **UNVERIFIED**: ask for a header of a fresh Trade History export.

### 1.5 Transaction History statement

`EF §A4`. Added today (BN2, OFFICIAL 2025-11-27): Assets → Asset History → hover the export icon → Export Transaction Records. Under 6 months: preset range plus account, sub-account and coin filters. Over 6 months: "Customize". Several statements are needed for long histories. Status column shows progress; SMS/email when ready.

This is the only export that contains Earn interest, staking, airdrops/distributions, dust conversion, Binance Pay, referral income and futures/margin balance movements. It is also the **only** place the MATIC→POL swap of 2024-09-10/13 appears (BN7; operation `Token Swap - Redenomination/Rebranding`, `EF §A4`).

### 1.6 Deposits and withdrawals

Headers in `EF §A5/A6`. `TXID` is the join key to on-chain rows (`phase2-apis.md §7.2`). Statuses besides `Completed`: UNVERIFIED.

### 1.7 P2P

No official or open-source CSV header found. The API sample (`phase2-samples/binance-c2c-listUserOrderHistory.json`) shows the fields the file probably carries: `orderNumber`, `tradeType` (BUY/SELL), `asset`, `fiat`, `amount`, `totalPrice`, `unitPrice`, `orderStatus` (`COMPLETED`, …), `createTime`, `commission`, `takerCommission`, `counterPartNickName` (masked `***`), `advertisementRole`. Treat the CSV as **UNVERIFIED** until a real header is supplied.

Tax note: Binance does not deduct 194S TDS on P2P or spot for Indian users; the buyer carries the deduction duty (KXT, THIRD). The ledger should not expect a TDS field from Binance.

### 1.8 Futures, margin, options

Formats only (§3 has the tax question).

- USDⓈ-M trade history: `Date(UTC),Pair,Side,Price,Quantity,Amount,Fee,Realized Profit` (CH via `EF §A7`, THIRD).
- Futures transaction history: `Date(UTC),type,Amount,Asset,Symbol,Transaction ID`, types such as `REALIZED_PNL`, `FUNDING_FEE`, `COMMISSION`, `TRANSFER` (BittyTax via `EF §A7`; type strings UNVERIFIED).
- Order history: one row per order, no fee; same shape question as §1.3.
- Options: Data Type → Transaction History → Options; 1 year per file (KX, THIRD).
- Margin: headers UNVERIFIED. Interest and loan rows also appear in the statement (`EF §A4` "out of scope").

### 1.9 Overlap and double-count rules (Binance)

A ✔ means the same economic event appears in both files.

| ↓ file A / file B →  | Order Hist. | Trade Hist.           | Statement             | Deposit / Withdraw | Convert | P2P                  | Futures files          |
| -------------------- | ----------- | --------------------- | --------------------- | ------------------ | ------- | -------------------- | ---------------------- |
| **Order History**    | —           | ✔ (1 order = n fills) | ✔ (2–3 rows per fill) |                    |         |                      |                        |
| **Trade History**    | ✔           | —                     | ✔                     |                    |         |                      |                        |
| **Statement**        | ✔           | ✔                     | —                     | ✔                  | ✔       | ✘ (P2P is not in it) | ✔ (balance moves only) |
| **Deposit/Withdraw** |             |                       | ✔                     | —                  |         | ✘                    |                        |
| **Convert**          |             |                       | ✔ (`Binance Convert`) |                    | —       |                      |                        |

Rules:

1. **Trade History wins over Order History.** If both cover a period, drop Order History rows whose fills are present. Match an order to fills by `Pair`, `Side`, fill times within `[Time, Time₂]` (after offset conversion), and Σ fill quantity = `Executed²`. On a mismatch, keep both and raise `possible_duplicate`.
2. **The statement never adds trades, deposits, withdrawals or converts when the dedicated file covers that period** (as `EF §A8` and BittyTax's default). It adds only operations no other file carries.
3. Coverage is per (file kind, date range). Store each imported file's min/max time so rule 1–2 can be applied by period, not globally.
4. The cross-channel event fingerprint in `phase2-apis.md §7.2` (venue, UTC second, base, quote, side, amounts) catches API-synced vs file-imported duplicates. Order History rows need a looser fingerprint (time window, Σ quantity) because they aggregate fills.

No separate exports were found for Launchpool, Megadrop, Binance Card or Gift Card; they appear only in the statement.
Binance NFT has its own export (<https://www.binance.com/en/support/faq/how-to-view-and-export-transaction-history-on-binance-nft-f17f2e8724fb4bc6a405bf893bced436>), out of scope.

### 1.10 Binance PDFs

| Document                    | Content                                                                                                                                                                                                                                                                                                                                                                                                                          | Password                                                                                                                   | Adds anything over CSV?                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account Statement (BN4)     | Snapshot **on one date**: overview (date, user id, account type, wallets, total value in BTC and a chosen currency), per-wallet balances (Spot, Funding, Earn, Margin debt/equity, Futures positions/unrealised P&L), Earn income over the holding period. **Top 5 assets only, rest as "Others"**, or all positions if chosen. Shows the BTC→USDT rate for that date. "If a PDF exceeds 10,000 records, the download may fail." | **Yes. The user must set an 8-digit password on every PDF export** (BN4, OFFICIAL). Assume every Binance PDF is encrypted. | **Yes, one thing:** an exchange-attested balance at a date, e.g. 31 March. Useful for the balance check and the opening balance of a year. No transactions, no cost. |
| Transaction / trade history | No PDF variant documented. The app quick export's format list is UNVERIFIED (BN2).                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                          | —                                                                                                                                                                    |
| Tax report (Binance Tax)    | Not available for India as far as found (BN8).                                                                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                          | —                                                                                                                                                                    |

Expected table layout of the account statement (from BN4's description; no sample PDF seen, so **UNVERIFIED** in detail): a header block of label/value pairs, then one table per wallet with columns like `Coin | Amount | Value (BTC) | Value (<fiat>)`. The parser should find the statement date and each wallet table and emit `balance_snapshot` rows (asset, amount, wallet, date). Ask the owner for a redacted sample to fix the column names.

---

## 2. CoinDCX

### 2.1 Pair, market and exchange code (OFFICIAL CD1 + FILE)

CD1 defines `pair` as "a string created by (ecode, target_currency_short_name, base_currency_short_name)": examples `B-BTC_USDT`, `I-BTC_INR`, `KC-XYZ_USDT`.

| Prefix / `Exchange Code` | Meaning                                                                    | Evidence                                    |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------- |
| `I`                      | "Internal (INR pairs)": CoinDCX's own INR order book                       | OFFICIAL CD1 ("`I` = Internal (INR pairs)") |
| `B`                      | "Binance": a crypto/crypto market that CoinDCX routes to Binance liquidity | OFFICIAL CD1 ("`B` = Binance")              |
| `KC`                     | listed in the enum (`I, B, G, KC`) without meaning; likely KuCoin-routed   | **UNVERIFIED**                              |
| `G`                      | listed without meaning                                                     | **UNVERIFIED**                              |

`target` = the coin bought or sold (quantity asset); `base` = the price asset, which is the **opposite** of the usual meaning (same trap as the trade report, `EF §B4`). In `I-USDT_INR`, USDT is traded and INR is the price. `Market` (`USDTINR`) is the same pair with no separator. Always split `Pair`.

Tax relevance of the code: none directly (a `B` trade is still a CoinDCX trade for the user). Keep it in `raw`. It explains why `B` markets have USDT quote prices and no INR TDS column of their own.

### 2.2 Order History CSV (FILE + CL)

Path: web → Orders → Order History → Download CSV → choose period; file arrives "in 5 minutes" (CL, THIRD). Older sub-tabs: Margin History, Insta History, Futures History, Conversion History, each with its own CSV (`EF §B7`, UNVERIFIED headers).

```
Order ID,Market,Pair,Total Quantity,Remaining Quantity,Price Per Unit,Avg Price,Fee Amount,Total Tds INR,Side,Order Type,Status,Exchange Code,Created At,Updated At
```

| Header               | Shape seen                                       | Meaning                                                                                                                         |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `Order ID`           | 8-digit integer                                  | order id; same id as `Spot Orders.Order ID` in the trade report                                                                 |
| `Market`             | `USDTINR`                                        |                                                                                                                                 |
| `Pair`               | `I-USDT_INR`                                     | §2.1                                                                                                                            |
| `Total Quantity`     | decimal                                          | ordered quantity, target asset                                                                                                  |
| `Remaining Quantity` | `0` on filled rows                               | executed = total − remaining                                                                                                    |
| `Price Per Unit`     | decimal (integer-looking for market orders)      | limit price (CD1: "the limit price, where applicable")                                                                          |
| `Avg Price`          | decimal with **float noise** (`…99999999999999`) | average fill price. Up to 16 dp of binary-float residue: parse as decimal, never round silently; add `parse_warning` if > 10 dp |
| `Fee Amount`         | decimal                                          | fee charged so far (CD1). On INR sells it is in **INR** (quote)                                                                 |
| `Total Tds INR`      | decimal                                          | TDS in INR                                                                                                                      |
| `Side`               | `sell` (lower case)                              | `buy` also exists (CD1)                                                                                                         |
| `Order Type`         | `limit_order`, `market_order`                    | CD1 also lists stop variants                                                                                                    |
| `Status`             | `filled`                                         | CD1 enum: `init`, `open`, `partially_filled`, `filled`, `partially_cancelled`, `cancelled`, `rejected`                          |
| `Exchange Code`      | `I`                                              | §2.1                                                                                                                            |
| `Created At`         | `yyyy-MM-dd HH:mm:ss UTC`                        | **explicit UTC suffix**: no time-zone question for this file                                                                    |
| `Updated At`         | same                                             | last fill / cancel                                                                                                              |

What the numbers showed (ratios only, sell orders in one file):

- `Fee Amount ÷ (Total Quantity × Avg Price)` = **0.50%** on some rows and **0.59%** on others. 0.59% = 0.50% × 1.18, i.e. **18% GST included in the fee**. The fee column is fee **plus** GST on at least some rows, and there is no separate GST column. Store `feeAmount` as given. Leave `gstInr` unset, add a note "fee may include GST" (CA question Q4).
- `Total Tds INR ÷ (gross − fee)` = **1.000%** on every row. TDS is charged on the **net** sale consideration, after the fee.
- No BOM, comma-separated, no quoting needed.

Row = one **order**, not one fill. A partially filled order appears once with its average price.

### 2.3 Trade Report (XLSX, emailed)

Path (OFFICIAL CD2): app → Profile → Generate Reports → Trade Report → choose **Financial Year and Quarter** → submit → emailed "typically within 4 hours". File format not stated on the page; it is an `.xlsx` (`EF §B1`).

Covers "Spot Trading, Insta, Futures, Options, Global Futures & Web3 Transactions" (CD2). Sheets and columns: `EF §B2–B5`. CD2's "Detailed Breakdown" (data as of 2023-05-01, page updated about July 2026) names four sections: **Insta Orders**, **Spot Orders**, **For Futures Orders & Global Futures**, **For Options**. The options columns are new:

`Position ID, Option Contract, Base Currency, Side, Position Size (Qty), Entry Time, Exit Time, Avg Entry Price (USDT), Avg Exit Price (USDT), Delivery Price, Entry Fee (INR), Exit Fee (INR), Delivery Fee (INR), Net P&L (INR)` (descriptive names, not exact headers: **UNVERIFIED** spelling).

Time zone not stated (CD2). The Order History CSV says UTC explicitly; the trade report may differ. Keep the per-file time-zone question for the XLSX.

Not in the trade report: deposits, withdrawals, Earn, airdrops.

### 2.4 TDS Summary Report (Excel)

Path (OFFICIAL CD2): Profile → Generate Reports → TDS Summary Report → financial year → "Download the Summary Report in Excel format". Columns **UNVERIFIED**. Expected: per-transaction or per-month TDS with PAN and quarter. Use: reconcile Σ `tdsInr` from imported trades against CoinDCX's own total for the year, and against Form 26AS/AIS. Import as a **reconciliation-only** report kind (no ledger rows), flagging any gap as `balance_mismatch`-style warning on TDS.

### 2.5 TDS Certificate (Form 16A, PDF)

Path (OFFICIAL CD2): Profile → Generate Reports → TDS Certificate → financial year → download per **quarter**, as **PDF**. Form 16A is generated by the government's TRACES system, so its layout is standard across all deductors: deductor TAN/PAN, deductee PAN, period, a table of amount paid/credited and tax deducted per date or per quarter, and challan/BSR details (layout from the TRACES format generally; no CoinDCX sample seen: **UNVERIFIED**). Password protection: TRACES Form 16A PDFs are usually not encrypted, but some deductors re-issue them with a password (**UNVERIFIED** for CoinDCX).

Adds over CSV/XLSX: the deposited TDS per quarter as filed with the government. That is what Schedule TDS needs. Useful as a cross-check, not a transaction source.

### 2.6 Deposits and withdrawals (Wallet History CSV)

Path (THIRD, KoinX and TaxNodes): Orders → Order History → left menu **Wallet History** → DEPOSITS / WITHDRAWALS → Download CSV. Columns **UNVERIFIED** (whether a tx hash is included is unknown). The CoinDCX API has no spot deposit/withdrawal history (`phase2-apis.md §2.3`), so this CSV is the only source. Ask the owner for a header.

### 2.7 Other CoinDCX documents

| Document                          | Status                                                                                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tax report / P&L                  | Generated by **KoinX**, not CoinDCX; formats "set by KoinX and can vary" (CD2, OFFICIAL). CoinDCX "does not currently provide a separate P&L statement" (CoinDCX blog snippet, THIRD). Not an import source.                                 |
| Earn / Lend                       | No export found. Not in the trade report's product list (CD2). **UNVERIFIED** whether rewards appear anywhere downloadable.                                                                                                                  |
| Futures (INR-M, USDT-M), Options  | Sheets in the trade report (`EF §B5`, §2.3). Import and flag (§3).                                                                                                                                                                           |
| Older multi-tab account statement | FY 2022-23 era sheets `Margin Orders`, `Future Orders`, `Crypto Dep&Wdl,Airdrop,Staking`, `Others` (`EF §B2`, from a search snippet). If a user has one, it is the **only** CoinDCX file with deposits and airdrops; columns **UNVERIFIED**. |
| PDFs                              | Only Form 16A. No transaction PDF.                                                                                                                                                                                                           |

### 2.8 Overlap and double-count rules (CoinDCX)

| ↓ A / B →                | Order History CSV | Trade Report: Spot Orders     | Trade Report: Instant Orders                             | API trades (`phase2-apis §2`)       | TDS Summary / 16A |
| ------------------------ | ----------------- | ----------------------------- | -------------------------------------------------------- | ----------------------------------- | ----------------- |
| **Order History CSV**    | —                 | ✔ join on `Order ID` (1 → n)  | ✘ (Insta is a separate product; its ids are `Trade ID`s) | ✔ join on order id                  | totals only       |
| **Spot Orders sheet**    | ✔                 | — (quarter files can overlap) | ✘                                                        | ✔ join on trade id                  | totals only       |
| **Instant Orders sheet** | ✘                 | ✘                             | —                                                        | UNVERIFIED (API may not list Insta) | totals only       |

Rules:

1. If a trade report covers the period, Order History rows whose `Order ID` appears in `Spot Orders` are dropped (the report has per-fill rows and INR values for USDT pairs).
2. Order History rows with no match stay, flagged `possible_duplicate` only if a fingerprint match exists.
3. TDS documents never create ledger rows.

---

## 3. Futures and margin: the CA question

We import these rows, keep them in `raw`, show them, and flag them. We do not compute tax on them yet.

Question for the CA (Q1 below): **Is profit or loss on crypto futures / perpetuals (Binance USDⓈ-M and COIN-M, CoinDCX INR-M and USDT-M) and crypto options**

- (a) income from transfer of a VDA, taxed at the flat VDA rate with no set-off of losses (sec 115BBH of the 1961 Act; the equivalent section of the Income-tax Act 2025 from 1 April 2026),
- (b) non-speculative or speculative business income under the normal slabs (the 43(5) speculative-transaction definition and its exclusions),
- (c) something that depends on settlement asset: INR-settled vs USDT-settled vs coin-settled?

Points of view found (all THIRD, 2025–2026: taxguru, tax2win, KoinX, CoinSwitch): some argue a derivative is a contract, not the underlying VDA, so 115BBH does not reach it and slab rates apply; others take the conservative line that crypto F&O gains are VDA income at 30%. **No CBDT circular** settles it as of 2026-11-17. Further sub-questions: Is a USDT-margined settlement a VDA-for-VDA transfer each time P&L is realised? Does 194S TDS apply per contract (some Indian exchanges deduct it)? Are funding fees and margin interest deductible under either head?

Until answered: the engine excludes these rows from Schedule VDA, shows their totals in a separate "Derivatives (not computed)" panel, and the report prints the open question.

---

## 4. Report kinds to add to `packages/importers`

| Report kind id                             | Detect by                                                    | Ledger effect                      | Flags by default                       |
| ------------------------------------------ | ------------------------------------------------------------ | ---------------------------------- | -------------------------------------- |
| `binance.spot-order-history`               | header §1.3 (after stripping superscripts), duplicate `Time` | trades from `Executed > 0` rows    | `fee_review_required`                  |
| `binance.spot-trade-history`               | `EF §A1–A3`                                                  | trades                             | —                                      |
| `binance.statement`                        | `EF §A4`                                                     | non-trade events; trades if alone  | `unknown_type` for new operation names |
| `binance.deposits` / `binance.withdrawals` | `EF §A5/A6`                                                  | transfers                          | —                                      |
| `binance.convert`                          | `EF §A7`                                                     | swaps                              | —                                      |
| `binance.p2p`                              | header TBD (§1.7)                                            | buys/sells vs INR                  | —                                      |
| `binance.futures.*`, `binance.margin.*`    | `EF §A7` / TBD                                               | raw only                           | `unknown_type` + derivatives note      |
| `binance.account-statement-pdf`            | PDF text contains the statement header                       | balance snapshots only             | —                                      |
| `coindcx.order-history`                    | header §2.2                                                  | trades                             | `possible_duplicate` vs trade report   |
| `coindcx.trade-report`                     | sheets `EF §B2`                                              | trades (Instant, Spot); others raw | derivatives sheets flagged             |
| `coindcx.tds-summary`                      | header TBD                                                   | none (reconciliation)              | TDS gap warning                        |
| `coindcx.form16a-pdf`                      | PDF text "FORM NO. 16A" (TRACES)                             | none (reconciliation)              | TDS gap warning                        |
| `coindcx.wallet-history`                   | header TBD                                                   | transfers                          | —                                      |

Every kind needs a fixed-offset time zone (§1.1) in addition to IST and UTC (SPEC-phase2 §1.1).

---

## 5. Open questions

For the owner (each needs one redacted header row or a screenshot of the export dialog):

1. Binance Trade History export from the **app** with all fields ticked: does it add an order id or maker/taker column?
2. Does the Binance export dialog offer `UTC+5:30`? Which formats (CSV / XLSX / PDF) does it list?
3. Binance P2P order export header.
4. Binance Account Statement PDF: one page with numbers blacked out, to fix the table columns.
5. CoinDCX Wallet History (deposits, withdrawals) CSV headers; does it carry a tx hash?
6. CoinDCX TDS Summary Report columns.
7. CoinDCX Order History CSV with a **buy** row: is the fee then in INR or in the coin?

For a CA:

- **Q1** Futures / perpetuals / options on crypto: VDA (115BBH) or business income? (§3)
- **Q2** Binance MATIC → POL 1:1 swap (2024-09): transfer of a VDA (gain at FMV) or a continuation with the same cost and date?
- **Q3** Exchange fees: deductible from consideration? (115BBH allows only cost of acquisition; the app already has a `feeTreatment` setting.)
- **Q4** CoinDCX fee includes 18% GST: is the GST part treated the same as the fee?
- **Q5** TDS on CoinDCX is on net consideration (after fee). Should the reported "consideration" for the 194S reconciliation be gross or net?
