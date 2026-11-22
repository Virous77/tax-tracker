import {
	Callout,
	DocLink,
	DocSection,
	Playbook,
	ReferenceTable,
	Topic,
} from "./DocUi";
import type { DocsYear } from "./docs-data";
import { percent } from "./docs-data";

export function IndianMarketSection({
	years,
	selected,
}: {
	years: readonly DocsYear[];
	selected: DocsYear;
}) {
	return (
		<DocSection
			id="indian-market"
			title="Indian market & complete ITR filing"
			intro="Combine domestic investment records with Tax Tracker’s crypto and foreign equity workpapers for one complete Indian return."
		>
			<Callout title="Domestic market engine: not yet supported">
				<p>
					Dedicated calculators currently cover Indian Crypto / VDA and US
					Stocks for Indian residents. There is no dedicated engine for domestic
					NSE/BSE shares, Indian mutual funds or F&O. Do not import these trades
					as VDA or US Equity: their classifications, holding periods, rates and
					loss rules differ.
				</p>
			</Callout>
			<Topic title="Financial years and the Act transition">
				<p>
					Use Apr 1–Mar 31 IST for Indian financial-year income. The bundled
					rules identify{" "}
					{years.map(({ vda }) => `${vda.taxYear} under ${vda.act}`).join("; ")}
					. Schedule FA remains calendar-year based: the selected{" "}
					{selected.equity.taxYear} rules use CY{" "}
					{selected.equity.scheduleFaCalendarYear}. Check the final filing forms
					and applicability for your year with your CA.
				</p>
			</Topic>
			<ReferenceTable
				caption="Where the workpapers fit"
				headers={[
					"Investment bucket",
					"Records and filing destinations to review",
				]}
				rows={[
					[
						"Crypto / VDA",
						`Schedule VDA disposal rows plus ${percent(selected.vda.tds.rate)} TDS reconciliation against Form 26AS / AIS. Income receipts and gifts require separate income-head review.`,
					],
					[
						"US Stocks",
						"Capital gains → Schedule CG; dividends → Schedule OS; foreign income and tax relief → Schedule FSI, Schedule TR and Form 67; calendar-year foreign equity holdings → Schedule FA. Confirm applicability and any additional foreign-account disclosures.",
					],
					[
						"Domestic Indian market",
						"Broker Tax P&L, dividend and RTA statements, AIS/TIS and Form 26AS feed the appropriate Schedule CG, domestic equity capital-gains schedule and Schedule OS. F&O / business classification may require business schedules; Tax Tracker does not prepare these.",
					],
				]}
			/>
			<Topic title="Shared income, separate calculations">
				<p>
					Salary, business and other domestic income share the final slab
					calculation with US short-term gains and gross dividends. Tax Tracker
					reports these US income amounts; your complete return determines their
					tax alongside deductions and the chosen regime.
				</p>
				<p>
					Set surchargeRate in <DocLink href="/settings">Settings</DocLink> with
					your CA using total taxable income across all sources. The app cannot
					derive it from imported investment trades alone. US LTCG applies its
					rule-file surcharge cap; VDA uses the selected surcharge setting.
					Final-return relief and cross-market capital-loss adjustments require
					review.
				</p>
				<p>
					Keep VDA losses isolated: never offset them against Indian or US stock
					gains. Do not blindly add separately computed domestic and US
					capital-gains worksheets without reviewing permitted loss adjustments
					in your complete ITR.
				</p>
			</Topic>
			<Topic title="How to proceed alongside Tax Tracker">
				<Playbook>
					<li>
						Export annual Tax P&L and dividend statements from Indian brokers
						such as Zerodha Console, Groww or Upstox, and mutual-fund
						capital-gains statements from CAMS / KFintech. Download Form 26AS
						and AIS/TIS from the Income Tax Portal.
					</li>
					<li>
						Generate and export crypto workpapers from{" "}
						<DocLink href="/report">Report</DocLink> and foreign equity
						workpapers from <DocLink href="/us-stocks">US Stocks</DocLink>,
						using the correct tax year and Schedule FA calendar year.
					</li>
					<li>
						Reconcile crypto TDS at {percent(selected.vda.tds.rate)} and
						domestic/foreign dividends against broker evidence, Form 26AS and
						AIS/TIS. Keep foreign withholding evidence for the foreign tax
						credit claim; resolve discrepancies before claiming credit.
					</li>
					<li>
						Give all records to your CA, or use the appropriate ITR-2 / ITR-3
						with their guidance. ITR choice depends on your full income profile,
						including business income. Complete the Form 67 workflow before ITR
						filing where possible and confirm the applicable deadline with your
						CA.
					</li>
				</Playbook>
				<p className="text-xs">
					Official preparation guidance:{" "}
					<a
						href="https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/itr-2/itr-2-faqs"
						target="_blank"
						rel="noreferrer"
						className="text-[var(--accent-text)] underline"
					>
						Income Tax Department — ITR-2 FAQs
					</a>
					.
				</p>
			</Topic>
		</DocSection>
	);
}
