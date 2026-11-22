# US stocks — Charles Schwab transactions CSV

verified: false

Matches the eight-column `Transactions` CSV that Schwab exports:

```
"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
```

`verified: false` means this layout has only been tested against the synthetic
sample in this folder, not against a live Schwab export. Check every imported
row against your own file before relying on the report.

## Exporting

1. Sign in at schwab.com and open **Accounts → History**.
2. Choose **Transactions**, set the date range to cover every year in which you
   held or sold the stock (not just the tax year), and choose **Export**.
3. Keep the CSV header exactly as exported. Do not add or rename columns.

## Rows

- **Buy / Sell** — `Quantity`, `Price` and `Amount` are read as USD. Schwab
  writes buys with a negative `Amount` and sells positive; the sign is read as
  a magnitude. `Fees & Comm` is the commission in USD and is kept separate
  from the gross proceeds (`Quantity × Price`), so the fee is not deducted
  twice.
- **Qualified Dividend / Cash Dividend** — mapped to dividend income. The
  `Amount` is the gross dividend in USD.
- **NRA Tax Adj** — mapped to a standalone `foreign_tax` row in USD, paired
  with the dividend on the same date and ticker and included in Form 67.
- **Wire Funds Received** — mapped to a USD cash deposit. Cash rows never
  create equity lots.

## Quirks

- `Date` uses `MM/dd/yyyy`. Rows such as `01/02/2026 as of 12/31/2025` are
  recorded on the **effective** date (`12/31/2025`), which is what Schwab uses
  for the dividend and withholding period. Change `dateAsOf` to `first` only
  if you want the posting date instead.
- Actions that are not in the list above (for example `Reinvest Shares`,
  `Stock Split`, `Journal`, `ADR Mgmt Fee`) are not mapped and appear as row
  errors. Delete those rows, map them in the recipe wizard, or extend the
  recipe before importing. Reinvested dividends need both the dividend and the
  matching buy to keep the lot history correct.
- Dates are date-only, so a trade is recorded on the stated calendar date in
  the timezone you pick when importing. A date-only row cannot tell you the
  exact IST time of a trade.
- `Description` is kept as the entity name for the Schedule FA worksheet.
- There is no per-row ID column, so the idempotency key is a hash of the whole
  row. Editing a cell creates a new row on re-import.

The sample is entirely synthetic: made-up quantities, prices and tickers, with
no real account or person data.
