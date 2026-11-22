# US stocks — Interactive Brokers (IBKR) trades CSV

verified: false

For the **Trades** section of an IBKR Activity Flex Query, with this header:

```
DateTime,Symbol,Description,Buy/Sell,Quantity,TradePrice,IBCommission,NetCash,Currency,TradeID
```

`verified: false` means this layout has only been tested against the synthetic
sample in this folder, not against a live IBKR export. Check every imported row
against your own file before relying on the report.

## Exporting

1. In IBKR Client Portal open **Performance & Reports → Flex Queries** and
   create an **Activity Flex Query**.
2. Add the **Trades** section and select exactly these fields: `DateTime`,
   `Symbol`, `Description`, `Buy/Sell`, `Quantity`, `TradePrice`,
   `IBCommission`, `NetCash`, `Currency`, `TradeID`.
3. Set the query's date range to cover every year in which you held or sold
   the stock, run it, and download the CSV.
4. Set the Flex Query time zone to **UTC** if you want the import to match the
   sample; otherwise select the same time zone when importing.

## Rows

- **BUY / SELL** — `Quantity` is the share count, `TradePrice` the per-share
  price in `Currency` (USD), and `NetCash` the cash amount including
  commission. `IBCommission` is negative in IBKR exports; the absolute value
  is stored as the fee, while `Quantity × TradePrice` is stored as the gross
  consideration, so the fee is not deducted twice.
- `Description` is kept as the entity name for the Schedule FA worksheet.
- `TradeID` is the idempotency key, so re-importing the same Flex Query does
  not duplicate transactions.

## Quirks

- This recipe maps only the **Trades** section. IBKR reports dividends,
  withholding tax and cash transfers in separate sections (for example
  `Dividends`, `Withholding Tax`, `Cash Transactions`), which have different
  headers. Import those with their own recipe, or add them manually as
  Dividend and Foreign Tax rows, so Form 67 is complete.
- `DateTime` is `yyyy-MM-dd HH:mm:ss` and carries no offset. Pick the same time
  zone that the Flex Query used when importing; IBKR defaults to the account's
  local time zone.
- Currency must be `USD` for the report's SBI TT buying-rate conversion. Rows
  in other currencies are still imported but need review.
- Corporate actions (splits, mergers, spin-offs) are not interpreted; review
  the Holdings tab and the review flags after importing.

The sample is entirely synthetic: made-up quantities, prices and trade IDs,
with no real account or person data.
