# Phase 3 build spec: US stocks (broker CSV, SBI rates, LT/ST, dividends, Form 67, Schedule FA)

Extends `docs/SPEC.md` (still authoritative for everything not changed here) and preserves 100% backward
compatibility with Phases 0, 1, 2, and 4.

> This is a build spec, not tax advice. Every US-equity rule file has `sectionsVerified: false` until a
> Chartered Accountant signs off, and every report and export carries the "not tax advice" notice.

**Gate:** A user imports one or more US stock broker CSVs (through a library recipe or the recipe wizard),
computes a US Equity report for FY 2025-26 or Tax Year 2026-27, and gets:

1. Long-term (>24 months, 12.5%, no indexation) and Short-term (≤24 months, slab rate) capital gains with
   SBI TT buying rate provenance (`rate`, `rateDate`, `source`) on every converted figure and FIFO lot trail.
2. Dividend income (gross USD → INR) and US withholding tax (USD → INR) with a Form 67 worksheet.
3. A Schedule FA (Table A3) worksheet on the calendar year (Jan 1 – Dec 31), with explicit flags (never
   guessed values) when peak or year-end market prices are missing.
4. CSV and XLSX exports for each worksheet and a full workbook.
5. Complete isolation from VDA (crypto): VDA reports never include US equity rows, and US equity reports
   never include VDA rows.

No new runtime npm dependencies are expected (AGENTS.md rule 1).

---

## 1. Tax rules (`packages/rules`)

Two rule files under `packages/rules/data/india-us-equity/`:

- `2025-26.json` (Income-tax Act, 1961 — covers FY 2025-26 / AY 2026-27; Schedule FA calendar year `2025`)
- `2026-27.json` (Income-tax Act, 2025 — covers Tax Year 2026-27; Schedule FA calendar year `2026`)

Extend `UsEquityRulesSchema` (`packages/rules/src/schema.ts`):

```ts
export const UsEquityRulesSchema = CommonSchema.extend({
	scheduleFaCalendarYear: z.number().int().min(2020).max(2100),
	longTermHoldingMonths: z.number().int().positive(), // 24
	longTermRate: PositiveDecimalSchema, // "0.125"
	cess: NonNegativeDecimalSchema, // "0.04"
	surchargeCapLtcg: NonNegativeDecimalSchema, // "0.15" (15% surcharge cap on LTCG)
	indexation: z.literal(false),
	shortTermRate: z.literal("slab"),
	dividendRate: z.literal("slab"),
	usWithholdingDefault: PositiveDecimalSchema, // "0.25"
	fxRule: z.literal("sbi_tt_buying_last_day_of_previous_month"),
	lossSetOff: z.object({
		stclAgainst: z.array(z.enum(["stcg", "ltcg"])), // ["stcg", "ltcg"]
		ltclAgainst: z.array(z.enum(["ltcg"])), // ["ltcg"]
		carryForwardYears: z.number().int().positive(), // 8
	}),
	dtaa: z.object({
		countryName: z.string(), // "United States of America"
		countryCode: z.string(), // "2"
		dividendArticle: z.string(), // "Article 10(2)(b)"
	}),
	sections: z.object({
		ltcgTax: z.string(),
		stcgTax: z.string(),
		dividendIncome: z.string(),
		foreignTaxCredit: z.string(),
		foreignAssets: z.string(),
		currencyConversionRule: z.string(),
	}),
});
```

Section labels (both files set `sectionsVerified: false`):

| Key                      | `2025-26` (1961 Act)                             | `2026-27` (2025 Act)                            |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| `ltcgTax`                | `Section 112(1)(a)`                              | `Section 197 (foreign equity LTCG 12.5%)`       |
| `stcgTax`                | `Normal slab rates (Section 2(42A) ≤ 24 months)` | `Normal slab rates (≤ 24 months)`               |
| `dividendIncome`         | `Section 56(2)(i) (Income from Other Sources)`   | `Income from Other Sources (2025 Act)`          |
| `foreignTaxCredit`       | `Section 90 & Rule 128 (Form 67)`                | `Double taxation relief & Form 67 (2026 Rules)` |
| `foreignAssets`          | `Schedule FA (Table A3)`                         | `Schedule FA (Table A3)`                        |
| `currencyConversionRule` | `Rule 115`                                       | `Rule 206`                                      |

`loadRules("india-us-equity", taxYear)` must support both `"2025-26"` and `"2026-27"`.

---

## 2. Core schemas (`packages/core`)

### 2.1 Ledger transaction extensions (`packages/core/src/ledger.ts`)

Backward compatible — all existing VDA ledger rows parse identically:

- `AssetClassSchema = z.enum(["vda", "us_equity"])`
- Add to `TxTypeSchema`: `"foreign_tax"` (standalone foreign withholding tax rows such as Schwab `NRA Tax Adj` or IBKR `Withholding Tax`).
- Add to `ReviewCodeSchema`:
  - `"missing_market_price"` — Schedule FA peak or closing USD price not supplied.
  - `"unmatched_foreign_tax"` — standalone `foreign_tax` row could not be matched to a dividend, or exceeds gross dividend.
  - `"corporate_action"` — stock split, merger, spin-off, or other corporate action needing manual review.
- Add to `ManualVenueSchema`: `"us_broker"` (so manual US stock rows can carry `venue: "us_broker"` or `"manual"`).
- Add fields to `LedgerTxFieldsSchema`:
  - `assetClass: AssetClassSchema.default("vda")`
  - `dividendAsset: AssetSchema.optional()` — underlying equity ticker on `dividend` or `foreign_tax` rows (e.g. `"AAPL"`).
  - `withholdingTaxAmount: NonNegativeDecimalSchema.optional()` — foreign tax withheld inline on a `dividend` row (or amount on `foreign_tax`).
  - `withholdingTaxAsset: AssetSchema.optional()` — currency of `withholdingTaxAmount` (e.g. `"USD"`).
  - `entityName: z.string().optional()` — company/ETF name captured from broker export (e.g. `"APPLE INC"`).
- Validation rules in `LedgerTxSchema.superRefine`:
  - `dividend` requires `assetIn` and `amountIn` (gross dividend currency and amount, e.g. `USD` / `"9.24"`).
  - `foreign_tax` requires `assetOut` and `amountOut` (withheld tax currency and amount, e.g. `USD` / `"2.31"`).
  - `withholdingTaxAmount` and `withholdingTaxAsset` must either both be set or both be omitted.
- Include `assetClass`, `dividendAsset`, `withholdingTaxAmount`, `withholdingTaxAsset` in `transactionTaxInputs`.

### 2.2 Engine settings extensions (`packages/core/src/settings.ts`)

Add to `EngineSettingsSchema` and `EngineSettingsPatchSchema`:

| Setting                | Values                             | Default            | Rationale                                                                               |
| ---------------------- | ---------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `usEquityFeeTreatment` | `"include" \| "exclude"`           | `"include"`        | Under Indian capital gains law, brokerage/commission is deductible (unlike VDA).        |
| `usEquityFxBasis`      | `"prev_month_end" \| "trade_date"` | `"prev_month_end"` | Rule 115 / Rule 206 specifies SBI TT buying rate on the last day of the previous month. |

### 2.3 Recipe schema extensions (`packages/core/src/recipe.ts`)

Backward compatible — existing crypto recipes validate unchanged:

- `assetClass: AssetClassSchema.optional()` (defaults to `"vda"` when omitted)
- `defaultQuoteAsset: AssetSchema.optional()` (e.g. `"USD"` for US stock broker CSVs without a currency column)
- `defaultFeeAsset: AssetSchema.optional()` (e.g. `"USD"`)
- `dateAsOf: z.enum(["as_of", "first"]).optional()` (for Schwab `"MM/dd/yyyy as of MM/dd/yyyy"` dates; default `"as_of"` uses the effective date after `"as of"`)
- `columns`: add optional `withholdingTax`, `withholdingTaxAsset`, `description`, `currency`
- `sideMap`: extend enum values to `"buy" | "sell" | "deposit" | "withdrawal" | "income" | "dividend" | "foreign_tax" | "skip"`

### 2.4 US equity report & supporting schemas (`packages/core/src/us-equity.ts`)

Export from `@tax/core`:

- `EquityMetadataSchema`: `{ symbol: AssetSchema, entityName: z.string().min(1), entityAddress?: string, zipCode?: string, natureOfEntity?: string, countryName?: string, countryCode?: string }`
- `EquityCyPriceSchema`: `{ calendarYear: z.number().int(), symbol: AssetSchema, peakPriceUsd?: PositiveDecimalSchema, peakDate?: z.iso.date(), closingPriceUsd?: PositiveDecimalSchema, source?: string }`
  - Validation: if `peakPriceUsd` is set, `peakDate` must also be set and fall within `calendarYear` (`YYYY-01-01` .. `YYYY-12-31`).
- `FxAppliedSchema`: `{ currency: string, rate: DecimalStringSchema, rateDate: z.iso.date(), source: string }`
- `UsEquityGainRowSchema`:
  - `asset`, `quantity`, `dateOfAcquisition` (nullable IST date), `dateOfTransfer` (IST date), `holdingDays` (number | null), `term` (`"long" | "short" | null`)
  - `costUsd` (nullable), `costFx` (`FxAppliedSchema | null`), `costInr` (nullable)
  - `considerationUsd` (nullable), `considerationFx` (`FxAppliedSchema | null`), `considerationInr` (nullable)
  - `feeUsd`, `feeInr` (nullable)
  - `gainInr` (nullable signed decimal — positive = gain, negative = loss)
  - `trail: TrailSchema`, `reviewFlags: ReviewFlagSchema[]`
- `UsEquityCapitalGainsSummarySchema`:
  - `shortTerm`: `{ considerationInr, costInr, grossGainInr, grossLossInr, netGainInr }`
  - `longTerm`: `{ considerationInr, costInr, grossGainInr, grossLossInr, netGainInr }`
  - `setOff`: `{ stclAgainstLtcgInr, netTaxableStcgInr, netTaxableLtcgInr, carryForwardStclInr, carryForwardLtclInr }`
  - `ltcgTax`: `{ taxableLtcgInr, rate, baseTaxInr, surchargeRateApplied, surchargeCapped: boolean, surchargeInr, cessInr, totalLtcgTaxInr, totalLtcgTaxRoundedInr }`
  - `stcgNote: string`
- `UsEquityDividendRowSchema`:
  - `txId`, `date` (IST date), `asset` (`AssetSchema | null`), `grossUsd`, `taxWithheldUsd`, `netUsd`
  - `fx` (`FxAppliedSchema | null`), `grossInr` (nullable), `taxWithheldInr` (nullable), `netInr` (nullable)
  - `withholdingRate` (nullable decimal ratio e.g. `"0.25"`), `trail: RawRefSchema[]`, `reviewFlags: ReviewFlagSchema[]`
- `Form67RowSchema`:
  - `countryName`, `countryCode`, `natureOfIncome`, `dtaaArticle`, `asset` (`AssetSchema | null`)
  - `foreignIncomeUsd`, `foreignIncomeInr`, `foreignTaxPaidUsd`, `foreignTaxPaidInr`, `maxCreditEligibleInr`
  - `effectiveForeignTaxRate` (nullable), `txIds: string[]`
- `ScheduleFaRowSchema`:
  - `slNo: number`, `countryName`, `countryCode`, `asset`, `entityName`, `entityAddress`, `zipCode`, `natureOfEntity`
  - `dateOfAcquiring` (nullable ISO date), `lotCount: number`
  - `openingQty`, `closingQty`, `maxQtyHeld`
  - `initialValueUsd` (nullable), `initialValueInr` (nullable), `initialFx` (`FxAppliedSchema | null`)
  - `peakPriceUsd` (nullable), `peakDate` (nullable), `peakValueUsd` (nullable), `peakValueInr` (nullable), `peakFx` (`FxAppliedSchema | null`)
  - `closingPriceUsd` (nullable), `closingValueUsd` (nullable), `closingValueInr` (nullable), `closingFx` (`FxAppliedSchema | null`)
  - `grossDividendsPaidUsd`, `grossDividendsPaidInr` (nullable)
  - `grossSaleProceedsUsd`, `grossSaleProceedsInr` (nullable)
  - `trail: RawRefSchema[]`, `reviewFlags: ReviewFlagSchema[]`
- `UsEquityReportSchema`:
  - `taxYear`, `act`, `calendarYear`
  - `generatedFrom`: `{ txCount, ruleFile, settings }`
  - `sectionsVerified`, `sections`, `dtaa`
  - `capitalGains`: `{ rows, summary }`
  - `dividends`: `{ rows, totals: { grossUsd, taxWithheldUsd, netUsd, grossInr, taxWithheldInr, netInr } }`
  - `form67`: `{ countryName, countryCode, dtaaArticle, rows, totals: { foreignIncomeUsd, foreignIncomeInr, foreignTaxPaidUsd, foreignTaxPaidInr, maxCreditEligibleInr }, notes: string[] }`
  - `scheduleFa`: `{ calendarYear, period: { start, end }, rows, notes: string[] }`
  - `balances: BalanceSchema[]`
  - `unresolved: UnresolvedSchema[]`
  - `excluded: ReportExcludedSchema[]`
  - `warnings: ReportWarningSchema[]`
  - `ledger: LedgerTxSchema[]`
  - `disclaimer: string`
  - `includesDemoData?: boolean`
  - `incomplete?: boolean`
  - `stale?: true`

### 2.5 API Contract (`packages/core/src/api/phase3.ts`)

Export and merge into `ApiContract` in `packages/core/src/api/index.ts`:

| Endpoint name               | Method & path                                  | Request / query                                                                                      | Response                                        |
| --------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `computeUsEquityReport`     | POST `/api/us-equity/reports/:taxYear/compute` | params `{taxYear}`                                                                                   | `UsEquityReport`                                |
| `getUsEquityReport`         | GET `/api/us-equity/reports/:taxYear`          | params `{taxYear}`, query `{allowStale?: boolean}`                                                   | `UsEquityReport` (or 404 `report_not_computed`) |
| `exportUsEquityReport`      | GET `/api/us-equity/reports/:taxYear/export`   | query `{format: "csv"\|"xlsx", kind: "capital-gains"\|"dividends"\|"form67"\|"schedule-fa"\|"full"}` | file download                                   |
| `getEquityMetadata`         | GET `/api/us-equity/metadata`                  | —                                                                                                    | `EquityMetadata[]`                              |
| `putEquityMetadata`         | PUT `/api/us-equity/metadata`                  | `EquityMetadata[]`                                                                                   | `EquityMetadata[]`                              |
| `getEquityPrices`           | GET `/api/us-equity/prices`                    | query `{calendarYear: number}`                                                                       | `EquityCyPrice[]`                               |
| `putEquityPrices`           | PUT `/api/us-equity/prices`                    | `{calendarYear: number, prices: EquityCyPrice[]}`                                                    | `EquityCyPrice[]`                               |
| `getUsEquityActualBalances` | GET `/api/us-equity/balances/actual`           | query `{taxYear}`                                                                                    | `ActualBalance[]`                               |
| `putUsEquityActualBalances` | PUT `/api/us-equity/balances/actual`           | query `{taxYear}`, body `ActualBalance[]`                                                            | `ActualBalance[]`                               |

Extend existing contracts:

- `ListTransactionsQuerySchema`: add optional `assetClass: z.enum(["all", "vda", "us_equity"]).optional()`.
- `CreateManualTransactionRequestSchema`: add optional `assetClass`, `dividendAsset`, `withholdingTaxAmount`, `withholdingTaxAsset`, `entityName`, and allow `type: "dividend"` and `type: "foreign_tax"`.

---

## 3. Tax engine (`packages/engine`)

### 3.1 VDA isolation

`computeVdaReport` and `computeHoldings` filter `transactions` to `(tx.assetClass ?? "vda") === "vda"` by default (`computeHoldings` accepts optional `assetClass?: AssetClass`, defaulting to `"vda"`). No VDA number changes.

### 3.2 Pure function `computeUsEquityReport`

```ts
export interface ComputeUsEquityInput {
	transactions: LedgerTx[];
	rules: UsEquityRules;
	settings: EngineSettings;
	taxYear: string;
	fx: FxLookup;
	actualBalances?: ActualBalance[];
	metadata?: EquityMetadata[];
	cyPrices?: EquityCyPrice[];
}
export function computeUsEquityReport(
	input: ComputeUsEquityInput,
): UsEquityReport;
```

Rules and invariants:

1. **Pure & deterministic.** No I/O, no network, no DB, no `Date.now()`. All money/share math uses `D` (`decimal.js`, 80 significant digits, `ROUND_HALF_UP` only at output).
2. **Filter & sort.** Filter `transactions` to `tx.assetClass === "us_equity"`. Reject duplicate `id` or `(source, sourceRef)`. Exclude rows with uncleared `suspected_spam` (record in `excluded`). Sort deterministically with `compareTransactions`.
3. **FX helper.**
   - `fxDateForEvent(istDateStr, basis)`:
     - `"prev_month_end"` → `lastDayOfPreviousMonth(istDateStr)` (Rule 115 / Rule 206).
     - `"trade_date"` → `istDateStr`.
   - Reject future `rateDate > requestedDate`. If FX lookup returns `null`, mark affected INR amounts `null` and emit `fx_unavailable` / `missing_inr_value` warning (never fabricate a rate!).
   - Helper `lastDayOfPreviousMonth(date)` lives in `@tax/core` (or pure inline helper in `@tax/engine`, zero dependency on `@tax/rates` file I/O).
4. **Holding period (exact calendar months).**
   - Given `acquiredIstDate` (`YYYY-MM-DD`) and `transferIstDate` (`YYYY-MM-DD`):
   - Compute `thresholdDate = addCalendarMonths(acquiredIstDate, rules.longTermHoldingMonths)` (clamping end-of-month, e.g. `2024-02-29` + 24 months → `2026-02-28`).
   - `term = transferIstDate > thresholdDate ? "long" : "short"`.
   - Held **strictly more than 24 months** (`>`) is Long-Term; **24 months or less** (`≤`) is Short-Term.
5. **FIFO lots & disposals (Tax Year: 1 April – 31 March IST).**
   - Process all transactions up to `bounds.endExclusiveUtc` chronologically (skipping cash-only `deposit`/`withdrawal` of fiat `USD`/`INR`/`EUR`/`GBP` from equity lots, while tracking stock transfers if any).
   - **Buy** of stock `S` (`assetIn = S`, `amountIn = qty`, `assetOut = "USD"`, `amountOut = grossUsd`):
     - If `settings.usEquityFeeTreatment === "include"` and `feeAsset === "USD"`, `totalCostUsd = grossUsd + feeUsd`; else `grossUsd`.
     - Look up USD/INR FX using `fxDateForEvent(istDate(tx.timestamp), settings.usEquityFxBasis)`.
     - Create FIFO lot carrying `qty`, `costUsd`, `costInr`, `acquiredAt`, `acquiredIstDate`, `txId`, `pool` (`global` or venue per `settings.lotPool`).
   - **Sell** of stock `S` (`assetOut = S`, `amountOut = qty`, `assetIn = "USD"`, `amountIn = proceedsUsd`):
     - Determine gross USD proceeds: if broker CSV put net proceeds in `amountIn` when `priceQuote` is present, check: `generic.ts` sets `amountIn = total` (or `price * qty`). Follow the ledger row's `amountIn` as gross consideration USD; if `usEquityFeeTreatment === "include"` and `feeAsset === "USD"`, subtract `feeUsd` from consideration USD (or record `feeUsd`/`feeInr` and compute `netConsideration = gross - fee`). To keep accounting crystal clear and consistent with `us-broker-schwab-like.csv` (where `4 * $312.40 = $1,249.60`, `Fees & Comm = $0.03`, `Amount = $1,249.57`), in `generic.ts` for trades:
       - If both `price` and `amount` (qty) are present AND `total` is present: if `|total| ≈ price * qty - fee` (net of fee), store gross `price * qty` in `amountIn`/`amountOut` and keep `feeAmount` separate so `usEquityFeeTreatment` (`include` vs `exclude`) works cleanly without double-deducting the fee! Document this clearly!
     - Consume lots FIFO. For disposals inside the requested tax year, emit one `UsEquityGainRow` per lot slice:
       - Split consideration and fee proportionally by slice quantity.
       - Convert disposal consideration (and fee) using `fxDateForEvent(istDate(tx.timestamp), settings.usEquityFxBasis)`.
       - `gainInr = considerationInr - costInr` (signed!).
       - If lots run out (`costInr === null` or missing FX), emit row with `null` values, add to `unresolved` with `missing_history` / `missing_inr_value`, exclude from resolved totals, and set `incomplete: true`.
6. **Capital loss set-off & LTCG tax (driven by `rules`).**
   - Sum resolved `shortTerm` rows: `grossGainInr` (sum of positive gains), `grossLossInr` (sum of abs of negative gains), `netGainInr = grossGainInr - grossLossInr`.
   - Sum resolved `longTerm` rows similarly.
   - Apply `rules.lossSetOff`:
     - If `shortTerm.netGainInr < 0` and `longTerm.netGainInr > 0` and `stclAgainst.includes("ltcg")`:
       `stclAgainstLtcg = min(abs(shortTerm.netGainInr), longTerm.netGainInr)`.
     - `netTaxableStcg = max(shortTerm.netGainInr, 0)`.
     - `netTaxableLtcg = max(longTerm.netGainInr - stclAgainstLtcg, 0)`.
     - `carryForwardStcl = max(abs(min(shortTerm.netGainInr, 0)) - stclAgainstLtcg, 0)`.
     - `carryForwardLtcl = abs(min(longTerm.netGainInr, 0))` (LTCL never offsets STCG!).
   - LTCG tax:
     - `baseTax = netTaxableLtcg * rules.longTermRate` (12.5%).
     - `surchargeRateApplied = min(settings.surchargeRate, rules.surchargeCapLtcg)` (capped at 15%); `surchargeCapped = D(settings.surchargeRate).gt(rules.surchargeCapLtcg)`.
     - `surcharge = baseTax * surchargeRateApplied`.
     - `cess = (baseTax + surcharge) * rules.cess` (4%).
     - `totalLtcgTax = baseTax + surcharge + cess`, `totalLtcgTaxRounded = totalLtcgTax.toFixed(0, ROUND_HALF_UP)`.
7. **Dividends & Form 67 (Tax Year: 1 April – 31 March IST).**
   - Collect all `dividend` and `foreign_tax` rows in the tax year.
   - Pair standalone `foreign_tax` rows with `dividend` rows sharing the same `dividendAsset` and IST date (1-to-1 or summing multiple tax rows for the same date+ticker, without double-counting if the `dividend` already has inline `withholdingTaxAmount`).
   - Any unpaired `foreign_tax` row is flagged `unmatched_foreign_tax` and still included in Form 67 foreign tax paid totals with a clear warning.
   - Convert gross dividend USD and tax withheld USD to INR using `fx("USD", lastDayOfPreviousMonth(istDate))` (Rule 115 / Rule 206 & Rule 128(6); or `trade_date` if `usEquityFxBasis === "trade_date"`).
   - Build `form67`: one row per ticker (or consolidated + per-ticker rows) plus totals, country `"United States of America"`, code `"2"`, DTAA `"Article 10(2)(b)"`, `maxCreditEligibleInr = totalTaxWithheldInr`, and clear filing notes.
8. **Schedule FA (Table A3) — Calendar Year (`rules.scheduleFaCalendarYear`, Jan 1 – Dec 31).**
   - Separate chronological replay / snapshot tracking over **Calendar Year** (`${cy}-01-01` to `${cy}-12-31` IST):
   - Include every equity ticker held at ANY moment during the calendar year (opening qty on Jan 1 > 0, OR bought during CY).
   - Per ticker:
     - `dateOfAcquiring`: earliest acquisition date among lots held at any time during the CY.
     - `openingQty` (start of Jan 1), `closingQty` (end of Dec 31), `maxQtyHeld` (highest share count held at any instant during CY).
     - `initialValueUsd` & `initialValueInr`: sum of cost of lots held during CY, converted using SBI TTBR on each lot's acquisition date (per CBDT Schedule FA guidance; if missing FX, `null` + warning).
     - `peakValue`: if user provided `cyPrices` entry with `peakPriceUsd` & `peakDate` for `(cy, symbol)`:
       - `qtyOnPeakDate` = share count held at end of `peakDate` (if 0, warn that `peakDate` is outside the holding window and use `maxQtyHeld`? Better: compute exact share count held on `peakDate`, and if 0 emit a `parse_warning`!).
       - `peakValueUsd = qtyOnPeakDate * peakPriceUsd`; `peakValueInr = peakValueUsd * sbiRate(peakDate)`.
       - If `peakPriceUsd` is NOT supplied: `peakValueUsd = null`, `peakValueInr = null`, emit `missing_market_price` warning! Never guess!
     - `closingBalance`:
       - If `closingQty === 0`: `closingValueUsd = "0.00"`, `closingValueInr = "0.00"` (fully exited — no closing price needed!).
       - Else if user provided `closingPriceUsd` for `(cy, symbol)`: `closingValueUsd = closingQty * closingPriceUsd`, `closingValueInr = closingValueUsd * sbiRate("${cy}-12-31")`.
       - Else: `closingValueUsd = null`, `closingValueInr = null`, emit `missing_market_price` warning! Never guess!
     - `grossDividendsPaidUsd` / `Inr`: sum of gross dividends received for that ticker during **Calendar Year** (`${cy}-01-01` .. `${cy}-12-31` IST), converted with Rule 115/206 SBI TTBR.
     - `grossSaleProceedsUsd` / `Inr`: sum of gross sale proceeds for that ticker during **Calendar Year**, converted with Rule 115/206 SBI TTBR.
     - Entity metadata: merge user-saved `metadata` over CSV `entityName` over fallback ticker, country from `rules.dtaa`, default `natureOfEntity: "Listed Company"`.
9. **Holdings & actual balances (Tax Year end).**
   - Compute year-end share holdings per US equity ticker (excluding cash `USD`/`INR`), compare against `actualBalances`, flag `balance_mismatch` / negative holding `missing_history`.

---

## 4. Importers & shared recipes (`packages/importers`, `packages/recipes`)

### 4.1 Importer fixes & enhancements (`packages/importers`)

1. **`numberString` (`values.ts`)**:
   - Support signed currency values (`"-$2.31"`, `"+$10.00"`, `"-$2,455.00"`) and parenthesised accounting negatives (`"($2.31)"` → `"-2.31"`).
2. **`parseTimestamp` (`values.ts`)**:
   - Support Schwab-style `"01/02/2026 as of 12/31/2025"` via optional `dateAsOf: "as_of" | "first"` (default `"as_of"` picks the second date `12/31/2025`; `"first"` picks `01/02/2026`).
3. **`convertRecipeRow` & `applyRecipe` (`generic.ts`)**:
   - Set `tx.assetClass = recipe.assetClass ?? "vda"`.
   - Propagate `entityName` when `recipe.columns.description` is mapped and non-empty.
   - Support `defaultQuoteAsset` (e.g. `"USD"`) when `pair` and `quoteAsset` are absent, and `defaultFeeAsset` (e.g. `"USD"`) when `feeAmount` is present and `feeAsset` column is absent.
   - For trades (`buy`/`sell`) when both `price` and `total` are given and `feeAmount > 0`:
     - Compute `grossFromPrice = D(price).mul(amount)`. If `|total|` equals `grossFromPrice - fee` (on sell) or `grossFromPrice + fee` (on buy) within `0.02`, store `grossFromPrice` as trade total so `feeAmount` is not double-counted when `usEquityFeeTreatment = "include"`.
   - Support `side === "dividend"`:
     - `tx.type = "dividend"`, `tx.assetIn = quote || "USD"`, `tx.amountIn = abs(total || amount)`, `tx.dividendAsset = base || undefined`.
     - If `withholdingTax` column is non-empty and > 0: `tx.withholdingTaxAmount = abs(val)`, `tx.withholdingTaxAsset = withholdingTaxAsset || quote || "USD"`.
   - Support `side === "foreign_tax"`:
     - `tx.type = "foreign_tax"`, `tx.assetOut = quote || "USD"`, `tx.amountOut = abs(total || amount)`, `tx.dividendAsset = base || undefined`, `tx.withholdingTaxAmount = tx.amountOut`, `tx.withholdingTaxAsset = tx.assetOut`.
   - Support `side === "deposit" | "withdrawal"` for cash rows with blank `Symbol` (e.g. `"Wire Funds Received"`): fall back to `quote || defaultQuoteAsset` as asset and `total` if `amount` is empty.
   - Support `side === "skip"`: record in `skippedRows` with reason so `rowsRead === rowsInserted + rowsDuplicate + rowsError + rowsSkipped` always holds.
   - Zero-fee cells (`""`, `"0"`, `"$0.00"`) omit `feeAmount`/`feeAsset` cleanly instead of failing on missing `feeAsset`.

### 4.2 Library recipes (`packages/recipes/library/`)

Add 3 synthetic, test-checked US broker recipes (all `verified: false`, `sample.csv` ≤ 20 rows, `expected.json`, `README.md`, checked by `pnpm recipes:check`):

1. `us-stocks-generic-v1`: Generic US Stocks CSV (`Date,Action,Symbol,Company,Quantity,Price,Fee,Total,Tax Withheld,Currency,ID`)
2. `us-stocks-schwab-v1`: Charles Schwab Transactions CSV (`Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount`) matching `packages/importers/test/fixtures/us-broker-schwab-like.csv`
3. `us-stocks-ibkr-v1`: Interactive Brokers Activity/Trades CSV (`DateTime,Symbol,Description,Buy/Sell,Quantity,TradePrice,IBCommission,NetCash,Currency`)

Also add synthetic sample files in `examples/` (`us-stocks-schwab-sample.SYNTHETIC.csv` and `us-stocks-generic-sample.SYNTHETIC.csv`).

---

## 5. Database (`packages/db`)

New migration `0010_phase3_us_equity.sql`:

- `ALTER TABLE transactions ADD COLUMN asset_class TEXT NOT NULL DEFAULT 'vda';`
- `ALTER TABLE transactions ADD COLUMN dividend_asset TEXT;`
- `ALTER TABLE transactions ADD COLUMN withholding_tax_amount TEXT;`
- `ALTER TABLE transactions ADD COLUMN withholding_tax_asset TEXT;`
- `ALTER TABLE transactions ADD COLUMN entity_name TEXT;`
- `CREATE INDEX transactions_asset_class ON transactions(asset_class);`
- `CREATE TABLE us_equity_reports (id TEXT PRIMARY KEY, tax_year TEXT NOT NULL, computed_at TEXT NOT NULL, settings_json TEXT NOT NULL, report_json TEXT NOT NULL);`
- `CREATE TABLE us_equity_report_invalidations (tax_year TEXT PRIMARY KEY, invalidated_at TEXT NOT NULL, cause TEXT NOT NULL);`
- `CREATE TABLE equity_metadata (symbol TEXT PRIMARY KEY, entity_name TEXT NOT NULL, entity_address TEXT, zip_code TEXT, nature_of_entity TEXT, country_name TEXT, country_code TEXT);`
- `CREATE TABLE equity_cy_prices (calendar_year INTEGER NOT NULL, symbol TEXT NOT NULL, peak_price_usd TEXT, peak_date TEXT, closing_price_usd TEXT, source TEXT, PRIMARY KEY (calendar_year, symbol));`
- `CREATE TABLE us_equity_actual_balances (tax_year TEXT NOT NULL, asset TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', amount TEXT NOT NULL, PRIMARY KEY (tax_year, asset, source));`

Invalidation rules:

- Ledger changes affecting `us_equity` rows, settings changes (`usEquityFeeTreatment`, `usEquityFxBasis`, `lotPool`, `surchargeRate`), equity metadata saves, CY price saves, and US equity actual balance saves invalidate `us_equity_reports` (setting `us_equity_report_invalidations`).
- Changing US equity metadata / CY prices / US equity balances does NOT invalidate VDA reports, and changing VDA-only settings does NOT invalidate US equity reports.

---

## 6. Server & Exports (`apps/web/src/server`, `apps/web/src/app/api`)

- Implement `apps/web/src/server/us-equity.ts` and `apps/web/src/server/us-equity-exports.ts`.
- Wire all Phase 3 endpoints in `apps/web/src/server/http.ts` and Next.js App Router route handlers under `apps/web/src/app/api/us-equity/**`.
- Exports (`GET /api/us-equity/reports/:taxYear/export`):
  - `format=csv|xlsx`
  - `kind=capital-gains|dividends|form67|schedule-fa|full`
  - Every export includes disclaimer, tax year, act, calendar year (for Schedule FA), settings used, section labels, and `"Section numbers pending CA verification"`.
  - Formula-injection protection (`safeCell`) on every cell.
- Update `apps/web/src/server/ai/index.ts` so AI recipe suggestions understand `assetClass: "us_equity"`, `defaultQuoteAsset`, `dividend`, `foreign_tax`, `withholdingTax`, `description`.
- Update `apps/web/src/server/review.ts` (or `report-review.ts`) to surface US equity warnings in `/api/review` as well.
- Update `apps/cli`: `tax-tracker compute --ledger ... --year ... [--regime vda|us-equity] [--out ...] [--csv ...]`.

---

## 7. Web UI (`apps/web`)

Match the existing calm, number-dense, accessible design system (light + dark, mobile-responsive, custom `Select`, Indian number grouping for INR, `$` formatting for USD, footer disclaimer).

1. **Navigation (`AppShell.tsx`)**: Add **US Stocks** (`/us-stocks`) in sidebar & mobile nav.
2. **US Stocks screen (`/us-stocks`)**:
   - Tax-year switcher (shared), Compute/Recompute button (non-wrapping label), stale banner, pending CA verification notice.
   - Empty state when no US equity transactions exist (with link to `/import` and guidance on Schwab / IBKR / Generic US Stocks CSVs).
   - Summary KPI cards: LTCG Tax (12.5% + surcharge + cess), Net LTCG, Net STCG (slab), Gross Dividends (INR), Form 67 Foreign Tax Paid (INR), Schedule FA Holdings (`CY YYYY`).
   - Tabs:
     - **Capital Gains**: LT/ST disposal table (Ticker, Qty, Acquired, Sold, Holding Days, LT/ST badge, Cost USD/INR + SBI rate/date, Proceeds USD/INR + SBI rate/date, Gain/Loss INR, Trail drawer) + Loss Set-Off & LTCG Tax breakdown card.
     - **Dividends & Form 67**: Dividend rows table (Date, Ticker, Gross USD/INR, Tax Withheld USD/INR, SBI rate/date) + Form 67 Worksheet table & filing checklist.
     - **Schedule FA (CY YYYY)**: Table A3 with all 12 ITR columns, inline form/drawer to enter/edit **Peak Price (USD) + Peak Date**, **Dec 31 Closing Price (USD)**, and **Entity Metadata** (Entity Name, Address, ZIP, Nature of Entity), with Save & Recompute action.
     - **Holdings**: Year-end share balances with editable Actual Balance inputs & Save.
   - Export bar: CSV & XLSX downloads for Capital Gains, Dividends, Form 67, Schedule FA, and Full Workbook.
3. **Overview (`/`)**: When US equity data or a computed US equity report exists, show a concise **US Stocks** summary section linking to `/us-stocks`.
4. **Import (`/import`)**: Recipe wizard exposes `Asset class` (`Crypto (VDA)` / `US Stocks`), `Default quote currency` (e.g. `USD`), `Withholding tax` column, `Description / Entity name` column, and `dividend` / `foreign_tax` / `skip` side mappings.
5. **Transactions (`/transactions`)**: Add Asset Class filter (`All` / `Crypto (VDA)` / `US Stocks`), show a subtle `US Stocks` badge on equity rows, and support manual US stock Buy, Sell, Dividend (with US tax withheld), and Foreign Tax entries in `AddManualTxDrawer`.
6. **Settings (`/settings`)**: Add **US Stocks** settings card with one-line explanations for `usEquityFeeTreatment` and `usEquityFxBasis`.
