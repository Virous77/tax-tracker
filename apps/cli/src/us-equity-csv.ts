import {
	DecimalStringSchema,
	type FxApplied,
	type UsEquityExportKind,
	type UsEquityReport,
} from "@tax/core";

type Row = (string | number | null)[];
type Worksheet = Exclude<UsEquityExportKind, "full">;
const fxFields = ["SBI rate", "SBI rate date", "SBI source"];
const fxCells = (fx: FxApplied | null) => [
	fx?.rate ?? null,
	fx?.rateDate ?? null,
	fx?.source ?? null,
];

function cell(value: Row[number]): string {
	const text = String(value ?? "");
	const formula =
		/^[\s\uFEFF]*[=+@-]/.test(text) &&
		!DecimalStringSchema.safeParse(text).success;
	const safe = formula || /^[\t\r\n]/.test(text) ? `'${text}` : text;
	return `"${safe.replaceAll('"', '""')}"`;
}

function capitalGains(report: UsEquityReport): Row[] {
	const { rows, summary } = report.capitalGains;
	return [
		["Capital gains"],
		[
			"Asset",
			"Quantity",
			"Acquired",
			"Transferred",
			"Holding days",
			"Term",
			"Cost USD",
			"Cost INR",
			...fxFields.map((v) => `Cost ${v}`),
			"Consideration USD",
			"Consideration INR",
			...fxFields.map((v) => `Consideration ${v}`),
			"Sell fee USD",
			"Sell fee INR",
			"Gain INR",
			"Disposal transaction",
			"Acquisition transactions",
			"Review flags",
		],
		...rows.map((row) => [
			row.asset,
			row.quantity,
			row.dateOfAcquisition,
			row.dateOfTransfer,
			row.holdingDays,
			row.term,
			row.costUsd,
			row.costInr,
			...fxCells(row.costFx),
			row.considerationUsd,
			row.considerationInr,
			...fxCells(row.considerationFx),
			row.feeUsd,
			row.feeInr,
			row.gainInr,
			row.trail.disposalTxId,
			row.trail.lotTxIds.join(";"),
			row.reviewFlags.map((item) => item.code).join(";"),
		]),
		[],
		["STCL applied against LTCG INR", summary.setOff.stclAgainstLtcgInr],
		["Taxable STCG INR", summary.setOff.netTaxableStcgInr],
		["Taxable LTCG INR", summary.setOff.netTaxableLtcgInr],
		["STCL carry-forward INR", summary.setOff.carryForwardStclInr],
		["LTCL carry-forward INR", summary.setOff.carryForwardLtclInr],
		["LTCG base tax INR", summary.ltcgTax.baseTaxInr],
		["LTCG surcharge INR", summary.ltcgTax.surchargeInr],
		["LTCG cess INR", summary.ltcgTax.cessInr],
		["Total LTCG tax INR", summary.ltcgTax.totalLtcgTaxInr],
		[summary.stcgNote],
	];
}

function dividends(report: UsEquityReport): Row[] {
	return [
		["Dividends"],
		[
			"Date",
			"Asset",
			"Gross USD",
			"Gross INR",
			"Tax withheld USD",
			"Tax withheld INR",
			"Net USD",
			"Net INR",
			...fxFields,
			"Transaction IDs",
			"Review flags",
		],
		...report.dividends.rows.map((row) => [
			row.date,
			row.asset,
			row.grossUsd,
			row.grossInr,
			row.taxWithheldUsd,
			row.taxWithheldInr,
			row.netUsd,
			row.netInr,
			...fxCells(row.fx),
			row.trail.map(({ txId }) => txId).join(";"),
			row.reviewFlags.map((item) => item.code).join(";"),
		]),
	];
}

function form67(report: UsEquityReport): Row[] {
	const { rows, totals, notes } = report.form67;
	return [
		["Form 67 worksheet"],
		[
			"Country",
			"Country code",
			"Income type",
			"DTAA article",
			"Asset",
			"Foreign income USD",
			"Foreign income INR",
			"Foreign tax USD",
			"Foreign tax INR",
			"Worksheet credit ceiling INR",
			"Effective foreign tax rate",
			"Transaction IDs",
			"Foreign tax payments and FX",
		],
		...rows.map((row) => [
			row.countryName,
			row.countryCode,
			row.natureOfIncome,
			row.dtaaArticle,
			row.asset,
			row.foreignIncomeUsd,
			row.foreignIncomeInr,
			row.foreignTaxPaidUsd,
			row.foreignTaxPaidInr,
			row.maxCreditEligibleInr,
			row.effectiveForeignTaxRate,
			row.txIds.join(";"),
			JSON.stringify(row.foreignTaxPayments ?? []),
		]),
		[
			"Totals",
			null,
			null,
			null,
			null,
			totals.foreignIncomeUsd,
			totals.foreignIncomeInr,
			totals.foreignTaxPaidUsd,
			totals.foreignTaxPaidInr,
			totals.maxCreditEligibleInr,
		],
		...notes.map((note) => [note]),
	];
}

function scheduleFa(report: UsEquityReport): Row[] {
	const { rows, notes } = report.scheduleFa;
	return [
		[report.sections.foreignAssets],
		[
			"Sl. No.",
			"Country",
			"Country code",
			"Entity",
			"Entity address",
			"ZIP code",
			"Nature of entity",
			"Date of acquiring",
			"Initial value INR",
			"Peak value INR",
			"Closing balance INR",
			"Gross dividends paid INR",
			"Gross sale proceeds INR",
			"Asset",
			"Opening shares",
			"Maximum shares held",
			"Closing shares",
			"Initial value USD",
			"Peak value USD",
			"Closing balance USD",
			"Gross dividends paid USD",
			"Gross sale proceeds USD",
			"Peak date",
			"Peak price USD",
			"Closing price USD",
			...fxFields.map((v) => `Peak ${v}`),
			...fxFields.map((v) => `Closing ${v}`),
			"Acquisition FX",
			"Cash flow FX",
			"Transaction IDs",
			"Review flags",
		],
		...rows.map((row) => [
			row.slNo,
			row.countryName,
			row.countryCode,
			row.entityName,
			row.entityAddress,
			row.zipCode,
			row.natureOfEntity,
			row.dateOfAcquiring,
			row.initialValueInr,
			row.peakValueInr,
			row.closingValueInr,
			row.grossDividendsPaidInr,
			row.grossSaleProceedsInr,
			row.asset,
			row.openingQty,
			row.maxQtyHeld,
			row.closingQty,
			row.initialValueUsd,
			row.peakValueUsd,
			row.closingValueUsd,
			row.grossDividendsPaidUsd,
			row.grossSaleProceedsUsd,
			row.peakDate,
			row.peakPriceUsd,
			row.closingPriceUsd,
			...fxCells(row.peakFx),
			...fxCells(row.closingFx),
			JSON.stringify(row.initialFxByLot ?? []),
			JSON.stringify(row.flowFx ?? []),
			row.trail.map(({ txId }) => txId).join(";"),
			row.reviewFlags.map((item) => item.code).join(";"),
		]),
		...notes.map((note) => [note]),
	];
}

const worksheets: Record<Worksheet, (report: UsEquityReport) => Row[]> = {
	"capital-gains": capitalGains,
	dividends,
	form67,
	"schedule-fa": scheduleFa,
};

export function usEquityCsv(
	report: UsEquityReport,
	kind: UsEquityExportKind = "full",
): string {
	const selected =
		kind === "full" ? Object.values(worksheets) : [worksheets[kind]];
	const rows: Row[] = [
		[report.disclaimer],
		[
			"Tax year",
			report.taxYear,
			"Act",
			report.act,
			"Schedule FA calendar year",
			report.calendarYear,
		],
		["Settings", JSON.stringify(report.generatedFrom.settings)],
		[
			"Sections",
			JSON.stringify(report.sections),
			report.sectionsVerified
				? "Verified"
				: "Section numbers pending CA verification",
		],
		...selected.flatMap((worksheet) => [[], ...worksheet(report)]),
	];
	if (report.warnings.length) {
		rows.push([], ["Review code", "Asset", "Transaction", "Message"]);
		for (const item of report.warnings)
			rows.push([
				item.code,
				item.asset ?? null,
				item.txId ?? null,
				item.message,
			]);
	}
	return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
