# Build spec

Source plan: `docs/plan.pdf`.
This file turns that plan into decisions an engineer can build from. Where the plan left a choice
open (the "questions for a CA"), the default chosen here is a **user setting**, shown in the UI and
printed on every report, so a CA can change it without a code change.

> This is a build spec, not tax advice. Every report carries a "not tax advice" notice.

## 0. Scope of the current build

| Phase | Content                                                                                                                                                | Status                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 0     | core schemas, rule files (FY 2025-26 under 1961 Act, tax year 2026-27 under 2025 Act), engine, golden tests, CLI                                       | build now                                       |
| 1     | Binance + CoinDCX export importers, generic CSV via AI recipe, SQLite, web screens (import, review, transactions, Schedule VDA report, export), Docker | build now                                       |
| 2     | read-only Binance/CoinDCX API sync, EVM address import, price cache                                                                                    | later                                           |
| 3     | US stocks (broker CSV, SBI rates, LT/ST, dividends, Form 67, Schedule FA)                                                                              | later; engine and schemas must already allow it |
| 4     | public release polish                                                                                                                                  | later                                           |

## 1. Tax year and time

- India tax year runs **1 April – 31 March, in IST (Asia/Kolkata)**. Store timestamps as UTC ISO strings;
  convert to IST only to decide the tax year and to print dates.
- Tax year ids: `"2025-26"` (financial year 2025-26, Income-tax Act 1961) and `"2026-27"` (first tax year
  under Income-tax Act 2025). Schedule FA uses the **calendar year** (Phase 3).

## 2. Ledger transaction (packages/core)

One common format. Importers only write it; the engine only reads it.

```ts
type TxType =
	| "buy"
	| "sell"
	| "swap"
	| "deposit"
	| "withdrawal"
	| "transfer"
	| "income"
	| "gift"
	| "dividend"
	| "fee";
type IncomeKind =
	| "staking"
	| "mining"
	| "airdrop"
	| "referral"
	| "interest"
	| "other";

interface LedgerTx {
	id: string; // uuid
	source: string; // "binance" | "coindcx" | "csv:<recipeId>" | "manual" | "evm:<chain>"
	sourceRef: string; // exchange's own id, or a stable hash of the raw row; unique per source
	importId: string | null;
	timestamp: string; // UTC ISO-8601
	type: TxType;
	incomeKind?: IncomeKind; // only when type = income
	assetIn?: string;
	amountIn?: string; // what arrived (upper-case symbol, decimal string > 0)
	assetOut?: string;
	amountOut?: string; // what left
	feeAsset?: string;
	feeAmount?: string;
	gstInr?: string; // GST on the fee, kept apart
	inrValue?: string; // rupee value of the transaction (consideration for sells)
	inrRateSource?: InrRateSource;
	priceQuote?: { asset: string; price: string }; // the trade's own price, e.g. {asset:"USDT", price:"64000"}
	tdsInr?: string; // TDS the platform deducted on this row
	txHash?: string;
	chain?: string;
	raw: unknown; // untouched original row (object)
	reviewFlags: ReviewFlag[]; // empty = clean
	userNote?: string;
}
type InrRateSource =
	| "trade_inr"
	| "trade_usdt_x_usd_inr"
	| "market_price_cache"
	| "manual"
	| "fmv_receipt";
interface ReviewFlag {
	code: ReviewCode;
	message: string;
}
type ReviewCode =
	| "missing_history"
	| "missing_inr_value"
	| "unknown_type"
	| "unmatched_transfer"
	| "tds_not_deducted"
	| "ambiguous_timezone"
	| "balance_mismatch"
	| "parse_warning"
	| "complex_onchain";
```

Validation (Zod): `buy` needs assetIn/amountIn and either assetOut/amountOut (the quote spent) or inrValue;
`sell` needs assetOut/amountOut; `swap` needs both sides; `deposit`/`income`/`gift` need assetIn;
`withdrawal` needs assetOut. Amounts are positive decimal strings. Export `parseDecimal`, `D` helpers wrapping decimal.js.

A trading pair like `BTCINR` or `BTC/USDT`: a **buy** of BTC with INR is `assetIn=BTC, assetOut=INR`.
A crypto-to-crypto trade (BTC→ETH, or BTC→USDT) is a **swap**: taxable disposal of the out side.
USDT is a VDA; selling BTC for USDT is a transfer of BTC, and buying BTC with USDT is a transfer of USDT.

## 3. Rule files (packages/rules)

One JSON file per regime + year, validated by a Zod schema, loaded by id.

```
packages/rules/data/india-vda/2025-26.json
packages/rules/data/india-vda/2026-27.json
packages/rules/data/india-us-equity/2026-27.json   (Phase 3; create the file now with known values)
```

`india-vda` fields: `taxYear`, `act` ("Income-tax Act, 1961" / "Income-tax Act, 2025"),
`period {start:"2026-04-01", end:"2027-03-31", timezone:"Asia/Kolkata"}`, `rate: "0.30"`, `cess: "0.04"`,
`surchargeSlabs` (informational; the applied surcharge is a user setting), `lossSetOff: false`,
`lossCarryForward: false`, `deductions: ["cost_of_acquisition"]`,
`tds {rate:"0.01", thresholdInr:"10000", specifiedPersonThresholdInr:"50000"}`,
`giftThresholdInr: "50000"`, `sections` (labels printed on reports):

| key                    | 2025-26 (1961 Act) | 2026-27 (2025 Act)                 |
| ---------------------- | ------------------ | ---------------------------------- |
| vdaTax                 | Section 115BBH     | Section 194, table serial 4        |
| vdaTds                 | Section 194S       | Section 393(1), table serial 8(vi) |
| vdaDefinition          | Section 2(47A)     | Section 2(111)                     |
| platformReporting      | Section 285BAA     | Section 509                        |
| currencyConversionRule | Rule 115           | Rule 206                           |

Add `sectionsVerified: false` and `sources: [...]`. The report shows "section numbers pending CA verification"
while `sectionsVerified` is false.

`india-us-equity`: `longTermHoldingMonths: 24`, `longTermRate: "0.125"`, `indexation: false`,
`shortTermRate: "slab"`, `dividendRate: "slab"`, `usWithholdingDefault: "0.25"`,
`fxRule: "sbi_tt_buying_last_day_of_previous_month"`.

## 4. Engine (packages/engine)

Pure function:

```ts
computeVdaReport(input: { transactions: LedgerTx[]; rules: VdaRules; settings: EngineSettings;
                          taxYear: string; actualBalances?: ActualBalance[]; fx: FxLookup }): VdaReport
```

`fx` is an injected pure lookup `(currency, date) => {rate, rateDate, source} | null` (backed by packages/rates).

### Settings (each one printed on the report)

| setting                    | values                                        | default                                         |
| -------------------------- | --------------------------------------------- | ----------------------------------------------- |
| `feeTreatment`             | `exclude` \| `include`                        | `exclude` (law allows only cost of acquisition) |
| `lotMethod`                | `FIFO`                                        | `FIFO`                                          |
| `lotPool`                  | `global` \| `per_source`                      | `global`                                        |
| `usdtInrRate`              | `sbi_usd_tt` \| `ledger_usdt_inr`             | `ledger_usdt_inr` falling back to `sbi_usd_tt`  |
| `incomeCostBasis`          | `zero` \| `fmv_at_receipt`                    | `zero` (conservative)                           |
| `headOfIncome`             | `capital_gains` \| `business`                 | `capital_gains`                                 |
| `surchargeRate`            | `"0"`, `"0.10"`, `"0.15"`, `"0.25"`, `"0.37"` | `"0"`                                           |
| `specifiedPerson`          | boolean                                       | false                                           |
| `transferMatchWindowHours` | number                                        | 72                                              |
| `transferAmountTolerance`  | decimal string fraction                       | `"0.01"` (1%, for network fees)                 |

### Steps

1. Validate and sort all rows by timestamp (stable; tie-break by source then sourceRef).
2. **Transfer matching.** A `withdrawal` of asset A and a later `deposit` of A within the window, with
   `deposit.amount` between `withdrawal.amount × (1 − tolerance)` and `withdrawal.amount`, form one
   moved pair. Lots move with the coins (cost basis carries). The difference is a fee in that asset
   (reduces quantity; not deductible unless `feeTreatment=include`). Unmatched withdrawals/deposits
   get `unmatched_transfer` flags; an unmatched deposit with no history behaves like missing history
   when later sold.
3. **Valuation** of every taxable leg, in order: trade's own INR value/price → trade's USDT (or other
   USD stablecoin) price × USD/INR (per `usdtInrRate`) → nothing → flag `missing_inr_value`.
   Record `inrRateSource` and, for FX, the rate and rate date used.
4. **Lots.** Every acquisition (buy, swap-in, income, gift-in, matched deposit carrying lots) makes a lot:
   `{asset, qty, costInr, acquiredAt, txId, pool}`. Income lots cost `0` or FMV per `incomeCostBasis`.
5. **Disposals.** Every sell and swap-out consumes lots FIFO. One **Schedule VDA row per (disposal × lot consumed)**:
   `{dateOfAcquisition, dateOfTransfer, headOfIncome, asset, quantity, costOfAcquisition,
   considerationReceived, income: max(consideration − cost, 0), loss: max(cost − consideration, 0),
   trail: {disposalTxId, lotTxIds[], rawRefs[]}}`. Consideration is split across lots in proportion to quantity.
   If lots run out, the uncovered quantity produces a row with `costOfAcquisition: null` and flag
   `missing_history`; such rows are **excluded from totals** and reported in `unresolved`.
   A swap is two legs: sell A at rupee value V, buy B with cost V.
   With `feeTreatment=include`, buy-side fee+GST (in INR) is added to lot cost and sell-side fee+GST
   reduces consideration.
6. **Rules.** `taxableIncome = Σ income`. `baseTax = taxableIncome × rate`;
   `surcharge = baseTax × surchargeRate`; `cess = (baseTax + surcharge) × cess`;
   `totalTax = baseTax + surcharge + cess`. Losses are reported (`lossesNotSetOff`) but never reduce tax.
7. **TDS.** `tdsCredit = Σ tdsInr` of rows in the year. Per source: `tdsDeductedByPlatform` (CoinDCX true,
   Binance false). Sells on a non-deducting source get `tds_not_deducted` warnings plus a computed
   "TDS that may have been due" figure (1% of consideration when yearly transfers exceed the threshold).
   `netPayable = totalTax − tdsCredit`. Show a Form 26AS/AIS matching checklist per source.
8. **Income section.** Income-type receipts (staking, airdrop, etc.) and gifts listed separately with FMV,
   not taxed by the VDA calc; gifts summed against `giftThresholdInr` with a note when exceeded.
9. **Balances.** Holdings per asset (and per source when `lotPool=per_source`) at year end. Compared with
   `actualBalances` the user typed; differences → `balance_mismatch`. Any negative holding → `missing_history`.
10. **Trail.** Every number in the report links back to ledger ids, which link to raw rows.

Rounding: keep full precision internally; round INR to 2 dp only for output (ROUND_HALF_UP). Also output
`totalTaxRounded` to the nearest rupee.

### Report shape

```ts
interface VdaReport {
	taxYear;
	act;
	generatedFrom: { txCount; ruleFile; settings };
	sectionsVerified: boolean;
	scheduleVdaRows: ScheduleVdaRow[];
	totals: {
		consideration;
		cost;
		taxableIncome;
		lossesNotSetOff;
		baseTax;
		surcharge;
		cess;
		totalTax;
		totalTaxRounded;
		tdsCredit;
		netPayable;
	};
	tds: {
		bySource: {
			source;
			deductedByPlatform;
			tdsInr;
			transferValueInr;
			possiblyDueInr;
		}[];
		checklist: string[];
	};
	income: { rows: IncomeRow[]; giftsTotalInr; giftsOverThreshold: boolean };
	balances: { asset; source?; computed; actual?; difference? }[];
	unresolved: { txId; asset; quantity; reason: ReviewCode }[];
	warnings: ReviewFlag[];
	disclaimer: string;
}
```

### Golden tests

`packages/engine/test/golden/<nn>-<name>/{input.json,expected.json,README.md}` — about 20 cases,
each README shows the hand arithmetic. Required cases:

1. Plan's worked example: buy 1 ETH ₹2,00,000, sell ₹2,50,000 → income 50,000, tax 15,600, TDS 2,500, net 13,100.
2. Same plus a ₹30,000 loss on another coin → tax still 15,600, loss shown.
3. FIFO across three buys and two partial sells. 4. Swap BTC→ETH then sell ETH. 5. USDT-priced trades
   valued via USD/INR. 6. Fee exclude vs include (two cases). 7. Own-wallet transfer with network fee.
4. Unmatched withdrawal. 9. Sell with no history → unresolved, excluded. 10. Staking income cost zero vs FMV.
5. Gift over threshold. 12. Trades straddling 31 March / 1 April IST (UTC 18:29 vs 18:31). 13. Surcharge 15%.
6. Binance sell → tds_not_deducted warning. 15. Per-source vs global pool. 16. Tiny amounts (1e-8) no precision loss.
7. 2025-26 vs 2026-27 rule file labels. 18. Balance mismatch. 19. Dust sell producing zero income. 20. Duplicate-free re-run determinism.

## 5. Rates (packages/rates)

Bundle SBI TT buying USD/INR daily rates (source: community repo `sbi-fx-ratekeeper`, MIT; keep its licence
and attribution in `packages/rates/data/README.md`). Lookup returns the last published rate **on or before**
the date and says which date was used. `lastDayOfPreviousMonth(date)` helper for the US-equity rule.

## 6. Importers (packages/importers)

Common interface:

```ts
interface Importer {
	id: "binance" | "coindcx" | "generic";
	detect(file: InputFile): boolean; // by headers/sheet names
	parse(
		file: InputFile,
		opts: { timezone: "IST" | "UTC"; recipe?: Recipe },
	): ImportResult;
}
interface ImportResult {
	transactions: LedgerTx[];
	rowsRead: number;
	warnings: ReviewFlag[];
	sheets?: { name: string; rowsRead: number }[];
}
```

- `InputFile` = `{ name, bytes }`; CSV and XLSX supported. XLSX parsing: pick a maintained library.
  **Do not use the `xlsx` package from the npm registry** (stale, known CVEs); see docs/research for the choice.
- **Binance**: spot trade-history export and deposit/withdrawal history export. TDS not deducted by platform.
- **CoinDCX**: one Excel file with several tabs (trades, deposits, withdrawals, TDS…). Each tab its own mapping.
  TDS deducted by platform; take TDS per trade from the export.
- **Generic**: driven by a `Recipe` (below). Same recipe engine is used for broker CSVs in Phase 3.
- `sourceRef`: the export's own trade/order id when present, else sha256 of the canonical raw row.
- Timezone asked once per file. Sells as negative amounts vs side column both handled. Fees in a third coin.
- Never drop a row: unparseable rows become ledger rows with `unknown_type`/`parse_warning`, or are
  returned as row-level errors that the UI shows. Row count in = rows out + rows reported as errors.

### Recipe (packages/core)

```ts
interface Recipe {
	id;
	name;
	version: 1;
	fingerprint: string; // sha256 of normalised header row (+ sheet name)
	sheet?: string;
	columns: {
		timestamp: string;
		type?: string;
		side?: string;
		pair?: string;
		baseAsset?: string;
		quoteAsset?: string;
		amount: string;
		price?: string;
		total?: string;
		feeAmount?: string;
		feeAsset?: string;
		tds?: string;
		id?: string;
		txHash?: string;
	};
	dateFormat: string; // e.g. "yyyy-MM-dd HH:mm:ss"
	timezone?: "IST" | "UTC";
	sideMap?: Record<
		string,
		"buy" | "sell" | "deposit" | "withdrawal" | "income"
	>;
	signStyle: "side_column" | "negative_is_sell";
	pairSplit?: { knownQuotes: string[] }; // e.g. ["INR","USDT","BTC"] to split "BTCINR"
}
```

AI only writes recipes. Endpoint: any OpenAI-compatible `/v1/chat/completions` with `response_format`
json_schema (Ollama supports it). Default `http://ollama:11434/v1`, model configurable. Send **only the
header + first 20 rows**; the exact payload is returned to the UI before sending. Reply validated with
Zod; invalid → error, never partially applied. Use plain `fetch`, no SDK. Cloud endpoints require the
user to set their own key and acknowledge a warning.

Checks after applying a recipe: every date parses, every number parses, rows in = rows out,
no balance goes negative (flag, don't block). Preview: 10 converted rows beside originals.

## 7. Database (packages/db)

Drizzle ORM + SQLite (better-sqlite3), file at `${DATA_DIR:-./data}/tax-tracker.db`, migrations run on boot.
Amounts stored as TEXT. Tables:

- `imports` (id, source, file_name, file_sha256, timezone, status: `pending_recipe|imported|failed`,
  rows_read, rows_inserted, rows_duplicate, rows_error, recipe_id, created_at, error)
- `raw_rows` (id, import_id, sheet, row_index, data JSON)
- `transactions` (all LedgerTx fields; `raw_row_id`; unique (source, source_ref); flags JSON; user_edited bool)
- `recipes` (id, name, fingerprint unique, sheet, json, origin: `ai|user|library`, created_at)
- `settings` (key, value JSON)
- `actual_balances` (tax_year, asset, source nullable, amount)
- `reports` (id, tax_year, computed_at, settings_json, report_json)
- `jobs` (id, kind, status, payload, result, error, created_at, updated_at) — in-process runner
- `price_cache`, `fx_rates` — create now, used later

Deleting an import deletes its transactions and raw rows. Editing a transaction sets `user_edited`;
re-import never overwrites user-edited rows.

## 8. HTTP API (apps/web, route handlers under `/api`)

JSON everywhere; amounts as strings. Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }`
with 400 (validation), 404, 409 (conflict/duplicate), 413 (file > 25 MB), 422 (unprocessable file), 500.
All request/response bodies have Zod schemas in `packages/core/src/api/` — both server and UI import them.

| Method & path                                  | Body / query                                                                                  | Response                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| GET `/api/health`                              |                                                                                               | `{ok:true, version, dbOk}`                                             |
| GET `/api/settings` / PUT `/api/settings`      | partial EngineSettings + `ai {baseUrl, model, apiKey?, cloudAcknowledged}` + `defaultTaxYear` | settings (apiKey never returned, only `apiKeySet`)                     |
| GET `/api/tax-years`                           |                                                                                               | `[{id, act, start, end}]`                                              |
| POST `/api/imports`                            | multipart `file`, `source` (`auto                                                             | binance                                                                | coindcx                                                                                          | generic`), `timezone` (`IST | UTC`) | `ImportSummary`; generic file with no matching recipe → `status:"pending_recipe"` + `{sheets:[{name, headers, sampleRows(20)}]}` |
| GET `/api/imports`                             |                                                                                               | `ImportSummary[]`                                                      |
| GET `/api/imports/:id`                         |                                                                                               | `ImportSummary` + per-sheet details + row errors                       |
| POST `/api/imports/:id/confirm`                | `{recipe, saveRecipe:boolean, recipeName?}`                                                   | `ImportSummary` (status imported)                                      |
| DELETE `/api/imports/:id`                      |                                                                                               | 204                                                                    |
| POST `/api/recipes/suggest`                    | `{importId, sheet?}`                                                                          | `{recipe, sentPayload}` (sentPayload = exactly what went to the model) |
| POST `/api/recipes/suggest/preview-payload`    | `{importId, sheet?}`                                                                          | `{sentPayload, endpoint, model, isLocal}` — shown before sending       |
| POST `/api/recipes/preview`                    | `{importId, sheet?, recipe}`                                                                  | `{rows:[{original, converted                                           | null, error?}] (10), checks:{datesOk, numbersOk, rowCountIn, rowCountOut, negativeBalances:[]}}` |
| GET `/api/recipes` / DELETE `/api/recipes/:id` |                                                                                               |                                                                        |
| GET `/api/transactions`                        | `taxYear, asset, type, source, flagged(bool), q, page, pageSize(≤200), sort`                  | `{items, total, page, pageSize}`                                       |
| POST `/api/transactions`                       | manual LedgerTx (no id/source) — gift, income, missing buy                                    | created tx                                                             |
| PATCH `/api/transactions/:id`                  | `{type?, incomeKind?, inrValue?, userNote?, resolveFlags?: ReviewCode[]}`                     | updated tx                                                             |
| DELETE `/api/transactions/:id`                 | only `source=manual`                                                                          | 204                                                                    |
| GET `/api/review`                              | `taxYear?`                                                                                    | `{groups:[{code, count, items}]}`                                      |
| GET/PUT `/api/balances/actual`                 | `taxYear`; body `[{asset, source?, amount}]`                                                  | list                                                                   |
| POST `/api/reports/:taxYear/compute`           |                                                                                               | `VdaReport` (also stored)                                              |
| GET `/api/reports/:taxYear`                    |                                                                                               | latest stored `VdaReport` or 404                                       |
| GET `/api/reports/:taxYear/export`             | `format=csv                                                                                   | xlsx`, `kind=schedule-vda                                              | tds                                                                                              | income                      | full` | file download; every export starts/contains the disclaimer and settings used                                                     |

Optional `APP_PASSWORD` env: if set, `proxy.ts` (Next 16 name for middleware) requires a signed session cookie
from `POST /api/auth/login {password}`; `POST /api/auth/logout`. No other auth in local mode.

## 9. UI (apps/web)

Desktop-first but usable on a phone. Light and dark. Plain, calm, number-dense, accessible
(keyboard, labels, contrast). Indian number grouping for INR (`₹2,50,000.00`). Every screen footer:
"Not tax advice. Have a Chartered Accountant review before filing."

1. **Overview** — tax-year switcher; cards: taxable income, total tax (base/surcharge/cess), TDS credit,
   net payable, losses not set off; banners for review items and unresolved rows; "Compute report" button.
2. **Import** — drop zone; source picker (auto/Binance/CoinDCX/Other CSV); "Are times in this file IST or UTC?";
   result summary (read/inserted/duplicates/errors, per sheet). Generic wizard: headers → "This is exactly what
   will be sent to <model> at <endpoint>" preview → AI suggestion → editable recipe form → 10-row side-by-side
   preview with checks → confirm, optionally save recipe. Recipe can also be filled by hand (no AI).
3. **Imports** list with delete (confirm dialog).
4. **Transactions** — filterable, paginated table; flag chips; row drawer with raw original row; edit
   type/INR value/note; add manual transaction (gift, income, missing buy).
5. **Review** — grouped by reason with clear explanation and a fix action for each.
6. **Report** — Schedule VDA table (one row per transfer × lot; columns exactly as the ITR asks), trail drawer
   (report row → ledger rows → raw rows), TDS section with per-source table and 26AS/AIS checklist, income &
   gifts, balances with "actual balance" inputs, unresolved rows, settings used, section labels with
   "pending CA verification" badge, export buttons (CSV/XLSX per kind).
7. **Settings** — all engine settings with one-line explanations of why each exists; AI endpoint/model/key
   with cloud-key warning; data folder location; backup note ("copy the .db file").

## 10. Docker

`docker-compose.yml`: service `app` (multi-stage build, Next standalone, non-root user, `DATA_DIR=/data`,
volume `./data:/data`, port 3000, healthcheck on `/api/health`). Optional service `ollama` under compose profile
`ai`. `docker compose up --build` must work from a clean clone. The image installs with `pnpm install --frozen-lockfile`.

## 11. CLI (apps/cli)

`tax-tracker import <file> --source binance|coindcx|generic --tz IST --recipe r.json --out ledger.json`
`tax-tracker compute --ledger ledger.json --year 2026-27 [--settings s.json] --out report.json --csv vda.csv`
