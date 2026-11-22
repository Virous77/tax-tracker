# Phase 0 engine

Build workspace dependencies with `pnpm -r build` before consuming package exports or running tests from a clean checkout. All packages export ESM JavaScript and declarations from `dist`; relative source imports use `.js`, including for Next.js `transpilePackages` consumers. `pnpm typecheck` checks tests as well as source.

```ts
import { EngineSettingsSchema } from "@tax/core";
import { loadRules } from "@tax/rules";
import { computeVdaReport } from "@tax/engine";

const report = computeVdaReport({
	transactions: ledger,
	rules: loadRules("india-vda", "2026-27"),
	settings: EngineSettingsSchema.parse({}),
	taxYear: "2026-27",
	fx: (currency, date) => null,
});
```

Supply the complete acquisition history, including earlier tax years. The engine consumes earlier disposals to establish opening holdings, emits Schedule VDA and TDS figures for the requested IST year, and ignores future transactions for calculations. Duplicate ledger ids or `(source, sourceRef)` keys are rejected; importers own deduplication. The function validates inputs, never mutates them, and performs no I/O. An injected FX lookup must return a positive decimal rate and a publication date on or before the requested date.

`LotBook` consumes proportional FIFO slices while retaining acquisition timestamps, original ledger order, and ledger references. Transfers preserve that order even when an older lot arrives after a newer local purchase. The lot primitive has no VDA rates, so equity holding-period logic can reuse it later. Unknown acquisition dates remain null; receipt order determines where unmatched deposits enter the queue.

All arithmetic uses a private decimal.js constructor with 80 significant digits and half-up rounding. INR strings round to two decimal places only at output; quantities retain their precision. Totals use the unrounded intermediate values, so summing displayed rows can differ by a paise. The nearest-rupee tax is rounded independently. Refund positions remain negative in `netPayable`.

The report includes the spec's fields plus `sections`, `valuations` (including included-fee FX provenance), `ledger`, row flags, and source/holding transaction ids. These additions allow every computed amount to be traced to ledger ids and raw data. An unknown platform's deduction status is `null`, rather than an assumed boolean. Clients should validate with `VdaReportSchema`.

## Public packages

- `@tax/core`: PascalCase Zod schemas with matching TypeScript types for ledger rows, recipes, settings, balances, report parts, and all HTTP endpoints. `D`, `parseDecimal`, `formatDecimal`, `roundInr`, `formatInr`, `istDate`, `taxYearOf`, `taxYearBounds`; `FxLookup`/`FxRateSchema`; `DISCLAIMER`. `@tax/core/api` exposes endpoint schemas and `ApiContract`, a method/path/request/response registry. `EngineSettingsPatchSchema` and `PutSettingsRequestSchema` intentionally do not apply defaults to omitted keys. Settings responses strip API secrets.
- `@tax/rules`: `VdaRulesSchema`, `UsEquityRulesSchema`, `loadRules(regime, taxYear)`, `listTaxYears()`. Values are cloned on load. Section verification stays false.
- `@tax/rates`: `createFxLookup`, `parseSbiCsv`, `loadSbiCsv`, `lastDayOfPreviousMonth`, `SBI_COLUMNS`, `FxRow`. CSV reading stays outside the engine. The archive's timestamped dates are reduced to calendar dates, zero TT quotes are unavailable observations, and the latest intraday observation wins. Tests inject small fixtures.
- `@tax/engine`: `computeVdaReport`, `ComputeVdaInput`, `LotBook`, lot types, `matchTransfers`, `compareTransactions`, `valueTransaction`.
- `@tax/cli`: binary `tax-tracker`; `main` and `scheduleVdaCsv`. Run locally with `pnpm --filter @tax/cli exec node dist/index.js compute --ledger ledger.json --year 2026-27 --out report.json --csv vda.csv`. JSON goes to stdout when `--out` is omitted. The import command is explicitly a Phase 1 stub. CSV contains the disclaimer, settings, section labels, and transaction ids, including unresolved rows with blank unknown amounts.

## Decisions requiring CA review

These are implementation interpretations of gaps in the supplied spec, not independently verified legal conclusions.

1. Transfer matching requires a later timestamp and a different source; same-time or same-source moves require review. A pair is inferred by the specified quantity/window rule. Multiple eligible pairs are warned for review. Lots are unavailable in transit and retain their original acquisition date when deposited. Matches are limited to history through year end; a deposit in the next year does not backfill a prior-year balance.
2. A transfer's network-fee quantity reduces carried basis proportionally when fees are excluded. When included, the entire withdrawn basis carries into the received quantity. An explicit fee already represented by the withdrawal/deposit difference is not debited twice.
3. A swap's fee is deducted from its disposal consideration once; its acquired lot uses the gross swap value. Adding the same fee to the incoming cost would deduct it twice. Acquisitions funded with a VDA also dispose that funding VDA, regardless of whether the input type says `buy` or `swap`.
4. Separately specified trading fees debit coin holdings, including fees in a third coin. Same-coin gross/net conventions must be checked against the source export. Crypto fees receive a warning because whether fee payment is a separate VDA disposal needs CA confirmation; this implementation does not add a guessed disposal. Unvalued fees with `include` make the affected tax leg unresolved. With `exclude`, unknown fee value does not block the trade.
5. Gift FMV is separate receipt information and is never silently used as donor acquisition cost. The spec has no donor-basis field or gift-basis setting, so gift lots have unknown basis; subsequent sales remain unresolved until acquisition history is corrected. `incomeCostBasis` applies to income receipts only. Gift totals are the subtotal of valued receipts; missing FMVs are flagged and must be resolved before assessing the threshold or exemptions.
6. The latest already-recorded stablecoin/INR trade supplies the ledger stablecoin rate; there is no lookahead. The rate's ledger id/date is printed. With `sbi_usd_tt`, the injected USD rate is used. USD-denominated price quotes always use USD FX. Supported USD stablecoins follow the selected USD/INR convention; depeg and market-value treatment still need CA approval.
7. TDS thresholds use aggregate gross yearly VDA transfers across sources; once exceeded, the indicative amount uses the full gross transfer value on sources other than CoinDCX. It is not subtracted from recorded TDS or added to tax payable. Missing transfer values make this estimate incomplete and are flagged. CoinDCX is true, Binance false, other sources unknown with a warning; payer-specific obligations and thresholds need CA review.
8. Missing-history and missing-value slices contribute neither consideration nor cost, gains, losses, or tax to resolved totals. They remain visible in Schedule VDA and `unresolved`. Recorded yearly TDS credit is retained even when the related disposal is unresolved. Unpriced receipt FMV is null, while an explicit zero income basis remains a user-selected assumption.
9. Standalone `transfer` rows lack a destination source in the ledger schema; they are flagged and never create a guessed acquired lot. Legacy dividend rows classified as VDA are flagged as outside the VDA calculation.

The 20 golden folders contain hand arithmetic, input, and expected values. Fee treatment, income basis, lot pool, specified-person status, Acts, and FX settlement have multiple variants. The additional settlement variant in case 05 was hand-written to exercise the USDT disposal leg explicitly, expanding coverage rather than changing an expectation to accommodate engine output. Rule sources and all cases remain pending CA sign-off; Phase 0's CA approval gate is not claimed complete.

## US equity engine

Call `computeUsEquityReport` with a complete ledger, `loadRules("india-us-equity", taxYear)`, parsed settings, and an injected SBI USD/INR TT buying rate lookup. Optional `metadata`, `cyPrices`, and `actualBalances` provide Schedule FA and reconciliation inputs. Legacy rows without `assetClass` are VDA. US equity and VDA reports use independent ledgers and holding pools.

The CLI accepts JSON arrays for `--metadata` and `--prices`. This example writes the report and a Schedule FA CSV. Omit `--csv-kind` to include capital gains, dividends, Form 67, and Schedule FA in one CSV.

```sh
pnpm --filter @tax/cli exec node dist/index.js compute --regime us-equity \
  --ledger ledger.json --year 2026-27 --metadata metadata.json --prices prices.json \
  --out equity.json --csv schedule-fa.csv --csv-kind schedule-fa
```

### US equity interpretations for CA review

- FIFO uses the IST acquisition and transfer dates. A sale on the clamped anniversary stays short-term. The report shows short-term gains and dividends for slab assessment and computes tax on resolved long-term gains. Carry-forward figures are current-year residual losses subject to filing eligibility.
- Broker trade legs contain gross USD amounts. The recipe importer restores gross where the cash total matches the price, quantity, and fee within two cents. With fees included, USD brokerage increases purchase basis or reduces sale consideration. Other fee currencies require review. FX uses the chosen basis for each trade, dividend, and withholding event and accepts the last available SBI publication on or before that date.
- Same-date withholding is assigned only when the ticker and candidate dividend are unambiguous, with source agreement preferred. Exact inline duplicates are counted once. Unmatched recorded tax stays visible in the Form 67 worksheet. Potential overlaps leave the combined amount and credit ceiling unresolved. The worksheet ceiling reflects foreign tax paid and requires review against the Indian tax attributable to that income and the treaty.
- Schedule FA groups holdings by ticker across sources. Opening lots contribute their remaining cost after earlier sales. Buys during the calendar year contribute their acquisition cost. Initial INR values use each acquisition date’s rate, with per-lot FX details where rates differ. Peak value uses the recorded price and shares held at the close of the supplied date. Year-end value uses December 31 holdings and exchange rate. Confirm whether the supplied peak observation captures the highest reportable holding value. The report uses gross sale and dividend cash flows and flags absent market prices. Ask a CA whether foreign crypto exchange accounts need separate disclosure.
- Exact, unambiguous share transfers carry cost and dates across venues. Schedule FA treats those shares as continuously owned. Unmatched deposits have unknown basis. Corporate actions flagged in the ledger require review before entering adjusted lots.

Both rule years carry `sectionsVerified: false`. The US equity golden fixtures document the arithmetic behind their expectations.
