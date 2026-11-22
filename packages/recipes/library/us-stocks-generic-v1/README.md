# US stocks — generic broker CSV

verified: false

A plain, broker-agnostic US stock layout for anyone whose broker is not listed
in the library. Save or export a CSV with the exact header shown in
[sample.csv](sample.csv):

```
Date,Action,Symbol,Company,Quantity,Price,Fee,Total,Tax Withheld,Currency,ID
```

`verified: false` means this layout has only been tested against the synthetic
sample in this folder, not against a real broker export. Check every imported
row against your own file before relying on the report.

## Rows

- **Buy / Sell** — `Symbol` is the ticker, `Quantity` the share count, `Price`
  the per-share USD price and `Total` the broker's cash amount. Buys are
  commonly negative (`-1721.70`); the sign is read as a magnitude. `Fee` is the
  commission in USD (leave it blank or `0` when there is none).
- **Dividend** — put the gross dividend in `Total` and the US tax withheld in
  `Tax Withheld` (25% is the usual DTAA Article 10(2)(b) rate). Leave
  `Quantity`, `Price` and `Fee` blank. The withheld amount is paired with the
  dividend automatically.
- **Cash Deposit** — leave `Symbol`, `Company`, `Quantity`, `Price` and `Fee`
  blank and put the USD amount in `Total`. Cash rows never create equity lots.

## Quirks

- `Total` may include or exclude the commission. When it equals
  `Quantity × Price` plus the fee (buy) or minus the fee (sell) within $0.02,
  Tax Tracker stores the gross consideration and keeps the fee in a separate
  field, so the US Stocks fee setting is not applied twice.
- Dates are date-only (`yyyy-MM-dd`). They are treated as calendar dates in the
  timezone you pick when importing; use the timezone your broker reports in.
  A date-only row cannot tell you the exact IST time of a trade.
- `Company` is kept as the entity name for the Schedule FA worksheet. Keep the
  broker's name rather than a personal note.
- `ID` is optional but recommended: it is the idempotency key. Without it a
  hash of the whole row is used, so editing a cell creates a new row on
  re-import.
- Every row keeps its original cells in the ledger, and re-importing the same
  file does not duplicate transactions.

The sample is entirely synthetic: made-up quantities, prices and IDs, with no
real account, person or broker data.
