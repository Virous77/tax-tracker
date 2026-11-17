import { D, type EngineSettings } from "@tax/core";

export function settingsRows(settings: EngineSettings): string[][] {
	return [
		["Setting", "Value"],
		[
			"Fee & GST treatment",
			settings.feeTreatment === "include" ? "Include fees" : "Exclude fees",
		],
		[
			"Market price basis (pending CA verification)",
			settings.marketPriceBasis === "vwap" ? "IST-day VWAP" : "IST-day close",
		],
		["Lot matching method", "FIFO (First-In, First-Out)"],
		[
			"Lot pool scope",
			settings.lotPool === "per_source"
				? "Per-source (by exchange)"
				: "Global (all wallets)",
		],
		[
			"USDT INR rate",
			settings.usdtInrRate === "sbi_usd_tt"
				? "SBI TT buying USD/INR"
				: "Ledger USDT/INR (fallback SBI TT)",
		],
		[
			"Income receipt cost basis",
			settings.incomeCostBasis === "fmv_at_receipt"
				? "FMV at receipt"
				: "₹0 (conservative default)",
		],
		[
			"Head of income",
			settings.headOfIncome === "business"
				? "Business Income"
				: "Capital Gains",
		],
		["Surcharge rate", `${D(settings.surchargeRate).mul("100").toFixed()}%`],
		["Specified person (TDS)", settings.specifiedPerson ? "Yes" : "No"],
		["Transfer match window", `${settings.transferMatchWindowHours} hours`],
		[
			"Transfer amount tolerance",
			`${D(settings.transferAmountTolerance).mul("100").toFixed()}%`,
		],
	];
}

const sectionLabels: Record<string, string> = {
	vdaTax: "VDA Tax",
	vdaTds: "VDA TDS",
	vdaDefinition: "VDA Definition",
	platformReporting: "Platform Reporting",
	currencyConversionRule: "Currency Conversion Rule",
};

export function sectionRows(sections: Record<string, string>): string[][] {
	return [
		["Section", "Reference"],
		...Object.entries(sections).map(([key, value]) => [
			sectionLabels[key] ??
				key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
			value,
		]),
	];
}
