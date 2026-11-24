import { DEFAULT_ENGINE_SETTINGS } from "@tax/core";
import type { UsEquityRules } from "@tax/rules";
import {
	Callout,
	DocLink,
	DocSection,
	Playbook,
	ReferenceTable,
	RuleCitations,
	Topic,
} from "./DocUi";
import { equitySummary, percent } from "./docs-data";

export function UsStocksSection({ rules }: { rules: UsEquityRules }) {
	return (
		<DocSection
			id="us-stocks"
			title="US Stocks / foreign equity"
			intro="Indian tax workpapers for foreign shares: capital gains, dividends, Form 67 and Schedule FA. These calculations stay separate from VDA."
		>
			<ReferenceTable
				caption={`Live US equity rules · ${rules.taxYear}`}
				rows={equitySummary(rules)}
				compactValues
			/>
			<RuleCitations rules={rules} />
			<Topic title="Capital gains: FIFO and exact holding periods">
				<p>
					Each sell consumes FIFO acquisition lots within the selected global or
					per_source pool. Each lot slice has its own acquisition date, USD
					cost, INR cost and sale proceeds. Long-term means strictly more than{" "}
					{rules.longTermHoldingMonths} calendar months; at or below{" "}
					{rules.longTermHoldingMonths} months is short-term. The engine adds
					calendar months, clamping month ends, rather than approximating a
					month with a fixed day count.
				</p>
				<p>
					usEquityFeeTreatment defaults to{" "}
					{DEFAULT_ENGINE_SETTINGS.usEquityFeeTreatment}: USD brokerage
					increases acquisition cost and reduces sale proceeds. Recipe imports
					normalise net broker totals to gross when price × quantity and fee
					reconcile, preventing a second fee deduction. Inspect normalized
					amounts and original broker rows when totals differ.
				</p>
				<p>
					Matched equal-quantity broker withdrawals and deposits preserve
					acquisition lots and cost. Ambiguous or unmatched transfers need
					review. Stock splits, mergers and spin-offs are not automatically
					cost-basis-adjusted: imported corporate_action rows are excluded until
					reviewed. Resolve quantities, dates and basis with broker evidence and
					your CA before clearing the flag.
				</p>
			</Topic>
			<Topic title="Loss set-off and the LTCG calculation">
				<p>
					The app applies STCL against STCG first and LTCL against LTCG first,
					then any remaining STCL against LTCG when permitted by the rule file.
					STCL targets:{" "}
					{rules.lossSetOff.stclAgainst.map((v) => v.toUpperCase()).join(", ")}.
					LTCL targets:{" "}
					{rules.lossSetOff.ltclAgainst.map((v) => v.toUpperCase()).join(", ")}.
					Remaining eligible losses are reported for carry-forward up to{" "}
					{rules.lossSetOff.carryForwardYears} years, subject to filing
					conditions your CA must verify.
				</p>
				<p>
					Net taxable LTCG × {percent(rules.longTermRate)} gives base tax.
					Surcharge uses the lower of your surchargeRate and{" "}
					{percent(rules.surchargeCapLtcg)}, then cess of {percent(rules.cess)}{" "}
					applies to tax plus surcharge. Indexation:{" "}
					{rules.indexation ? "enabled" : "not applied"}. STCG and dividends use{" "}
					{rules.shortTermRate} rates and are reported as income amounts; the
					app does not calculate your complete slab tax across salary, business
					and other income.
				</p>
				<p>
					Only resolved sale slices enter gain totals. Missing history or FX
					leaves unknown values and warnings, so the report may be incomplete.
					This engine’s set-off uses imported US equity gains only; combined
					domestic/foreign capital-loss treatment belongs in your final return
					with your CA.
				</p>
			</Topic>
			<Topic title="FX: previous month-end SBI TT buying rates">
				<p>
					The rule-file policy is “{rules.fxRule.replaceAll("_", " ")}” (
					{rules.sections.currencyConversionRule}). With the default
					prev_month_end setting, a buy, sell, dividend or foreign-tax event
					requests the last day of its previous month. The bundled SBI table
					returns the last published USD/INR rate on or before that date.
					Acquisition cost and disposal proceeds are converted separately at
					their respective event rates; this is not simply USD gain × sale-day
					FX.
				</p>
				<p>
					Every conversion retains rate, publication date and source. Bundled
					SBI TT rates enforce a freshness guard — requests past the bundled
					archive emit fx_unavailable (and missing_inr_value where INR value is
					unresolved) rather than silently using a stale rate. The alternative
					trade_date setting changes event conversion and needs CA approval.
					Schedule FA initial, peak and closing values instead use their
					acquisition, peak and calendar-year-end dates directly.
				</p>
			</Topic>
			<Topic title="Dividends and Form 67 foreign tax credit">
				<p>
					Use gross dividends, not only net cash received. The app converts
					gross income and actual recorded USD withholding to INR using the
					selected FX basis. Standalone foreign_tax entries match by IST date
					and ticker, preferring the same source. Duplicate inline withholding
					is not counted twice; ambiguous allocations remain flagged.
				</p>
				<p>
					The default withholding reference is{" "}
					{percent(rules.usWithholdingDefault)}, with {rules.dtaa.countryName},
					country code {rules.dtaa.countryCode}, {rules.dtaa.dividendArticle}.
					It does not invent withholding when broker evidence is missing. Form
					67 groups foreign income and tax by ticker. Its worksheet ceiling
					tracks recorded foreign tax; actual credit also depends on Indian tax
					attributable to that income and treaty limits, which the app does not
					compute.
				</p>
				<p>
					As a practical workflow, prepare and file Form 67 with supporting
					evidence before filing your ITR and its due date. Confirm the legal
					deadline and the selected year’s requirements with your CA; it is not
					encoded in the rule file. Official guidance:{" "}
					<a
						href="https://www.incometaxindia.gov.in/w/double-taxation-relief"
						target="_blank"
						rel="noreferrer"
						className="text-[var(--accent-text)] underline"
					>
						Income Tax Department — double taxation relief
					</a>
					.
				</p>
			</Topic>
			<Topic title={`Schedule FA · CY ${rules.scheduleFaCalendarYear}`}>
				<p>
					{rules.sections.foreignAssets} uses Jan 1–Dec 31 of{" "}
					{rules.scheduleFaCalendarYear}. Tax year {rules.taxYear} therefore
					uses CY {rules.scheduleFaCalendarYear}, rather than its Apr–Mar
					period. All tickers held during that calendar year are considered,
					including opening holdings and fully exited positions.
				</p>
				<ReferenceTable
					caption="How Schedule FA values are assembled"
					rows={[
						[
							"Initial value",
							"Cost of opening lots and acquisitions held during the calendar year, with acquisition-date SBI FX for each lot. Missing basis remains unknown.",
						],
						[
							"Peak value",
							"Shares held at the end of the supplied peak date × its supplied USD price; convert at peak-date SBI FX. Auto-fill searches unadjusted historical daily closing prices for the largest daily closing position value across dates held, not merely the highest share price or maximum share count.",
						],
						[
							"Closing value",
							"Dec 31 shares × closing USD price, converted at Dec 31 SBI FX. Auto-fill uses the last available unadjusted daily close on/before year-end. Fully exited positions have zero closing value without needing a price.",
						],
						[
							"Gross paid / credited",
							"Gross dividends during the calendar year, converted using the selected event FX basis.",
						],
						[
							"Gross sale / redemption proceeds",
							"Gross USD disposal proceeds during the calendar year, with event FX; brokerage is not subtracted from this gross disclosure.",
						],
					]}
				/>
				<p>
					Use “Edit prices & entity details” in the Schedule FA tab for Peak
					Price (USD), Peak Date, Dec 31 Closing Price (USD), entity name,
					address and ZIP. Polygon.io auto-fill fetches unadjusted historical
					daily closing prices to match historical share counts; if a stock had
					a split, merger or spin-off (corporate_action), review share
					quantities, lots and prices manually before filing. Missing prices
					produce missing_market_price, and a date outside your holding window
					is flagged rather than silently using maximum shares.
				</p>
				<p>
					Table A3 covers foreign equity holdings only. If you held uninvested
					USD cash in a foreign brokerage account, review Table A1 / A2 foreign
					depository and custodial disclosures — along with overall Schedule FA
					applicability — with your CA.
				</p>
			</Topic>
			<Topic title="How to proceed">
				<Playbook>
					<li>
						<strong>Import statements.</strong> On{" "}
						<DocLink href="/import">Import</DocLink>, upload native Vested
						Account Statement PDF or XLSX. For Charles Schwab, Interactive
						Brokers (IBKR) or Generic US Stocks CSV, choose the corresponding
						library recipe or review a custom mapping with asset class “US
						Stocks”. Include earlier acquisitions.
					</li>
					<li>
						<strong>Inspect normalized records.</strong> Filter{" "}
						<DocLink href="/transactions">Transactions</DocLink> to US Stocks.
						Check trades, gross dividends, withholding and transfers against raw
						rows. Resolve <DocLink href="/review">Review Queue</DocLink>{" "}
						warnings and corporate actions.
					</li>
					<li>
						<strong>Complete Schedule FA.</strong> Compute on{" "}
						<DocLink href="/us-stocks">US Stocks</DocLink>, open Schedule FA and
						enter prices and entity details manually. For optional auto-fill,
						enable historical market price lookups in{" "}
						<DocLink href="/settings">Settings</DocLink>, add Polygon.io
						(Massive) or Finnhub keys in{" "}
						<DocLink href="/connections">Connections</DocLink>, and use
						“Auto-fill CY {rules.scheduleFaCalendarYear} prices”. Data
						availability depends on provider plan and history coverage; manual
						entry remains available.
					</li>
					<li>
						<strong>Recompute, review and export.</strong> Inspect Capital
						Gains, Dividends & Form 67, Schedule FA and Holdings. Save actual
						share balances for reconciliation. Export Capital Gains, Dividends,
						Form 67, Schedule FA and Full Workbook as CSV or XLSX for your CA.
					</li>
				</Playbook>
			</Topic>
			<Callout title="A worksheet is not a filed return">
				<p>
					Tax Tracker prepares calculations and supporting exports. It does not
					submit an ITR, Form 67 or foreign asset disclosures, determine
					residency, or calculate complete slab-tax liability.
				</p>
			</Callout>
		</DocSection>
	);
}
