import { D, DEFAULT_ENGINE_SETTINGS, formatInr } from "@tax/core";
import type { UsEquityRules, VdaRules } from "@tax/rules";
import { formatSectionLabel } from "@/lib/client/format";

export interface DocsYear {
	vda: VdaRules;
	equity: UsEquityRules;
}
export type ReferenceRow = readonly [label: string, value: string];

export const percent = (value: string): string =>
	`${D(value).mul("100").toFixed()}%`;
const yesNo = (value: boolean) => (value ? "Yes" : "No");

export function statutoryReferences(
	rules: VdaRules | UsEquityRules,
): ReferenceRow[] {
	return Object.entries(rules.sections).map(([key, value]) => [
		formatSectionLabel(key),
		value,
	]);
}

export function vdaSummary(rules: VdaRules): ReferenceRow[] {
	return [
		["Act", rules.act],
		["Flat VDA tax rate", percent(rules.rate)],
		["Health & Education Cess", `${percent(rules.cess)} of tax plus surcharge`],
		["Loss set-off", yesNo(rules.lossSetOff)],
		["Loss carry-forward", yesNo(rules.lossCarryForward)],
		["Allowed deductions", rules.deductions.join(", ")],
		["TDS rate", percent(rules.tds.rate)],
		["Annual TDS threshold · normal", formatInr(rules.tds.thresholdInr)],
		[
			"Annual TDS threshold · specified person",
			formatInr(rules.tds.specifiedPersonThresholdInr),
		],
		["Gift review threshold", formatInr(rules.giftThresholdInr)],
	];
}

export function equitySummary(rules: UsEquityRules): ReferenceRow[] {
	return [
		["Act", rules.act],
		["Schedule FA calendar year", String(rules.scheduleFaCalendarYear)],
		[
			"Long-term holding period",
			`Strictly more than ${rules.longTermHoldingMonths} calendar months`,
		],
		["LTCG rate", percent(rules.longTermRate)],
		["LTCG surcharge cap", percent(rules.surchargeCapLtcg)],
		["Health & Education Cess", `${percent(rules.cess)} of tax plus surcharge`],
		["Indexation", yesNo(rules.indexation)],
		["Short-term gains", rules.shortTermRate],
		["Dividends", rules.dividendRate],
		[
			"Default US withholding · reference only",
			percent(rules.usWithholdingDefault),
		],
		[
			"DTAA country / code",
			`${rules.dtaa.countryName} / ${rules.dtaa.countryCode}`,
		],
		["DTAA dividend article", rules.dtaa.dividendArticle],
		[
			"STCL can offset",
			rules.lossSetOff.stclAgainst.map((v) => v.toUpperCase()).join(", "),
		],
		[
			"LTCL can offset",
			rules.lossSetOff.ltclAgainst.map((v) => v.toUpperCase()).join(", "),
		],
		[
			"Loss carry-forward · eligibility requires review",
			`${rules.lossSetOff.carryForwardYears} years`,
		],
		["FX rule", rules.fxRule.replaceAll("_", " ")],
	];
}

export function settingsReference(rules: VdaRules): ReferenceRow[] {
	const s = DEFAULT_ENGINE_SETTINGS;
	return [
		[
			"feeTreatment",
			`${s.feeTreatment} · VDA fees and GST excluded; include only after CA review.`,
		],
		[
			"lotMethod / lotPool",
			`${s.lotMethod} / ${s.lotPool} · first acquisitions first, across venues; per_source separates venue pools.`,
		],
		[
			"usdtInrRate",
			`${s.usdtInrRate} · latest preceding ledger USDT/INR rate, falling back to SBI USD TT.`,
		],
		[
			"incomeCostBasis",
			`${s.incomeCostBasis} · conservative nil cost for income receipts; fmv_at_receipt is optional.`,
		],
		[
			"headOfIncome",
			`${s.headOfIncome} · business is available; confirm classification with your CA.`,
		],
		[
			"surchargeRate",
			`${percent(s.surchargeRate)} · choose with your CA using total income from all sources and the applicable regime.`,
		],
		[
			"specifiedPerson",
			`${yesNo(s.specifiedPerson)} · selects ${formatInr(s.specifiedPerson ? rules.tds.specifiedPersonThresholdInr : rules.tds.thresholdInr)} threshold; verify eligibility.`,
		],
		[
			"transferMatchWindowHours",
			`${s.transferMatchWindowHours} hours · fallback transfer matching window.`,
		],
		[
			"transferAmountTolerance",
			`${percent(s.transferAmountTolerance)} · fallback allowance for network fees.`,
		],
		[
			"marketPriceBasis",
			`${s.marketPriceBasis} · IST-day close; vwap is available for Binance daily prices.`,
		],
		[
			"usEquityFeeTreatment",
			`${s.usEquityFeeTreatment} · add USD brokerage to acquisition cost and deduct it from disposal proceeds.`,
		],
		[
			"usEquityFxBasis",
			`${s.usEquityFxBasis} · previous month-end SBI TT; trade_date is an alternative requiring CA review.`,
		],
	];
}
