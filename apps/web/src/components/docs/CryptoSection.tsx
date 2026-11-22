import { DEFAULT_ENGINE_SETTINGS, formatInr } from "@tax/core";
import type { VdaRules } from "@tax/rules";
import {
	Callout,
	DocLink,
	DocSection,
	Playbook,
	ReferenceTable,
	RuleCitations,
	Topic,
} from "./DocUi";
import { percent, vdaSummary } from "./docs-data";

export function CryptoSection({ rules }: { rules: VdaRules }) {
	const defaults = DEFAULT_ENGINE_SETTINGS;
	return (
		<DocSection
			id="crypto"
			title="Crypto / VDA"
			intro="Understand how the app values disposals, matches acquisitions and produces Schedule VDA and TDS workpapers."
		>
			<ReferenceTable
				caption={`Live VDA rules · ${rules.taxYear}`}
				rows={vdaSummary(rules)}
			/>
			<ReferenceTable
				caption="Informational surcharge slabs"
				headers={["Total income above", "Surcharge rate"]}
				rows={rules.surchargeSlabs.map((slab) => [
					formatInr(slab.aboveInr),
					percent(slab.rate),
				])}
			/>
			<p className="text-xs">
				The engine applies your surchargeRate setting; it does not infer total
				income or automatically select a slab. Ask your CA about regime limits
				and relief.
			</p>
			<RuleCitations rules={rules} />
			<Topic title="What counts as a disposal?">
				<p>
					Selling a VDA for INR disposes of that coin. A crypto-to-crypto swap
					disposes of the asset given up and acquires the asset received at the
					same INR value. USDT is itself a VDA: selling BTC for USDT disposes of
					BTC; spending USDT to buy BTC disposes of USDT. The engine also
					recognises a non-fiat outgoing leg on a buy or sell as a disposal.
				</p>
				<p>
					Each disposal is split across the acquisition lots consumed. Every
					resolved row reports its own positive income or loss; losses do not
					reduce income on other rows. Missing acquisition history produces an
					unresolved row with unknown cost, excluded from resolved totals. Never
					interpret incomplete totals as a finished return.
				</p>
			</Topic>
			<Topic title="FIFO, pools and acquisition cost">
				<p>
					FIFO consumes the oldest available acquisition first. The default
					lotPool is {defaults.lotPool}, sharing lots across venues; per_source
					separates venue pools. Import earlier purchases even when they fall
					outside the selected tax year.
				</p>
				<p>
					feeTreatment defaults to {defaults.feeTreatment}. With include, valued
					buy-side fees and GST increase cost and sell-side fees and GST reduce
					consideration. Unknown fee values remain flagged. Crypto-denominated
					fees reduce holdings and receive fee_review_required because
					separate-disposal treatment needs CA review.
				</p>
				<p>
					Income receipts use the conservative incomeCostBasis=
					{defaults.incomeCostBasis}; fmv_at_receipt instead uses the recorded
					fair market value for a later disposal. Receipt taxation is a separate
					question. Gift acquisitions carry unknown donor basis in the engine;
					later disposals need documented history and CA review.
				</p>
			</Topic>
			<Topic title="Self-transfers preserve cost basis">
				<p>
					Withdrawals and deposits of the same asset are matched by transaction
					hash first. Otherwise the app looks for a later deposit at a different
					source within {defaults.transferMatchWindowHours} hours, between the
					withdrawal amount less {percent(defaults.transferAmountTolerance)}{" "}
					tolerance and the full withdrawal amount. Matched lots keep their
					acquisition dates and cost basis. Network-fee differences reduce
					quantity; ambiguous matches need review.
				</p>
				<p>
					Import both sides of wallet and exchange moves so that transfers do
					not create apparent missing acquisitions. Unmatched deposits are not
					assumed to have free acquisition cost.
				</p>
			</Topic>
			<Topic title="INR valuation, in order">
				<ol className="list-decimal space-y-2 pl-5">
					<li>
						<strong>Recorded value / trade_inr:</strong> an existing inrValue
						takes priority, followed by INR trade legs or an INR price quote.
					</li>
					<li>
						<strong>trade_usdt_x_usd_inr:</strong> use the trade’s USDT amount
						or USD quote. For USDT, the default uses the latest preceding ledger
						USDT/INR trade, falling back to bundled SBI USD TT buying rates on
						or before the event date. A USD quote uses SBI directly.
					</li>
					<li>
						<strong>market_price_cache:</strong> consult locally cached daily
						prices only when trade valuation is unavailable. Opt-in fetching
						prefers Binance IST-day close or VWAP; optional CoinGecko fallback
						resolves verified ERC-20 contracts across all 5 supported EVM chains
						(Ethereum, Base, Arbitrum, Polygon, BNB Chain) within CoinGecko’s
						365-day free window and supplies a UTC snapshot, not an IST close.
					</li>
					<li>
						<strong>Manual resolution:</strong> enter a supported INR value in
						the transaction drawer. A manual inrValue overrides automatic
						valuation on recomputation; it is not a lower-priority quote source.
					</li>
				</ol>
				<p>
					No usable value means missing_inr_value, not a fabricated price.
					Inspect the valuation source, FX date and raw-row trail on the report.
				</p>
			</Topic>
			<Topic title="Tax arithmetic, receipts and TDS">
				<p>
					Taxable income is the sum of positive resolved disposal gains. Base
					tax = taxable income × {percent(rules.rate)}. Surcharge = base tax ×
					your surchargeRate. Cess = (base tax + surcharge) ×{" "}
					{percent(rules.cess)}. Total tax adds these three amounts; net payable
					subtracts recorded TDS credit. Full decimal precision is retained
					internally; INR output is rounded to paise and a separate rounded
					total to rupees.
				</p>
				<p>
					Staking, mining, airdrop, referral, interest and other income receipts
					are listed separately at receipt FMV. They are not taxed as receipt
					income by the VDA calculation. Gifts are separately totalled;
					exceeding {formatInr(rules.giftThresholdInr)} triggers a note to
					review exemptions and slab treatment.
				</p>
				<p>
					The TDS table totals recorded tdsInr by venue. CoinDCX is treated as
					deducting; Binance is treated as not deducting; other sources have
					unknown status. When aggregate annual transfer value exceeds the
					selected threshold, the app estimates possibly due TDS at{" "}
					{percent(rules.tds.rate)} on non-CoinDCX consideration. This is a
					reconciliation aid, not proof of payer liability or credit. Match it
					to Form 26AS / AIS and discuss {rules.sections.platformReporting}{" "}
					reporting with your CA.
				</p>
			</Topic>
			<Topic title="Exchange API sync scope limits">
				<p>
					<strong>CoinDCX API sync</strong> imports Spot Orderbook trades only.
					It does not sync Instant Buy/Sell orders, crypto deposits/withdrawals,
					Earn/SIP, or TDS / Form 16A, and fees are returned without fee
					currency or GST split. Always supplement CoinDCX API sync with manual
					Instant/Spot XLSX and Form 16A PDF exports on{" "}
					<DocLink href="/import">Import</DocLink>.
				</p>
				<p>
					<strong>Binance API sync</strong> is subject to exchange API limits:
					P2P history is capped at the past 6 months, dust conversions return
					only the latest 100 records, and symbol discovery cannot automatically
					detect fully exited zero-balance pairs unless added under extra
					symbols. Supplement API sync with Binance Statement CSVs on{" "}
					<DocLink href="/import">Import</DocLink> for complete multi-year
					history.
				</p>
			</Topic>
			<Topic title="How to proceed">
				<Playbook>
					<li>
						<strong>Import complete history.</strong> Use{" "}
						<DocLink href="/import">Import</DocLink> for Binance or CoinDCX
						CSV/XLSX, or Generic CSV with a reviewed recipe / AI Recipe Wizard.
						Alternatively configure read-only exchange APIs or Ethereum, Base,
						Arbitrum, Polygon and BNB Chain (BSC) wallets in{" "}
						<DocLink href="/connections">Connections</DocLink>. Inspect file
						counts and errors in <DocLink href="/imports">Imports</DocLink>.
					</li>
					<li>
						<strong>Optionally fill prices.</strong> In{" "}
						<DocLink href="/settings">Settings → Price lookups</DocLink>, turn
						on “Enable historical market price lookups”. Enable “Use CoinGecko
						fallback” and add a CoinGecko Demo key in Connections if needed. On{" "}
						<DocLink href="/report">Report</DocLink>, click “Fetch missing
						prices”, then recompute.
					</li>
					<li>
						<strong>Resolve the queue.</strong> Inspect{" "}
						<DocLink href="/transactions">Transactions</DocLink> and{" "}
						<DocLink href="/review">Review Queue</DocLink> for missing_history,
						missing_inr_value, unmatched_transfer, tds_not_deducted,
						ambiguous_timezone, complex_onchain and balance_mismatch. The
						reference below explains fixes. Do not clear flags without evidence.
					</li>
					<li>
						<strong>Compute and reconcile.</strong> On{" "}
						<DocLink href="/report">Report</DocLink>, compute or recompute,
						inspect Schedule VDA, TDS, income, holdings and unresolved rows.
						Export CSV/XLSX workpapers and have your CA verify them against
						source records before filing.
					</li>
				</Playbook>
			</Topic>
			<Callout title="VDA losses remain isolated">
				<p>
					They are reported for visibility and cannot reduce domestic or US
					stock gains in this engine. Income receipts and gift treatment still
					need separate review.
				</p>
			</Callout>
		</DocSection>
	);
}
