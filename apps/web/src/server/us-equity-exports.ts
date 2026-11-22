import { D, type UsEquityReport } from "@tax/core";
import type { ExportUsEquityReportQuerySchema } from "@tax/core/api";
import { writeXlsx } from "@tax/importers";
import type { z } from "zod";
import { csv, safeCell, table } from "./exports";
import { sectionRows } from "./report-metadata";

type Cell = string | number | null | undefined;
type Rows = Cell[][];

function capitalGainsRows({
	rows,
	summary,
}: UsEquityReport["capitalGains"]): Rows {
	return [
		[
			"Ticker",
			"Quantity",
			"Date Acquired",
			"Date Sold",
			"Holding Days",
			"Term",
			"Cost USD",
			"Cost FX Rate",
			"Cost FX Date",
			"Cost INR",
			"Proceeds USD",
			"Proceeds FX Rate",
			"Proceeds FX Date",
			"Proceeds INR",
			"Fee USD",
			"Fee INR",
			"Gain/Loss INR",
			"Disposal Transaction",
			"Acquisition Transactions",
		],
		...rows.map((row) => [
			row.asset,
			row.quantity,
			row.dateOfAcquisition,
			row.dateOfTransfer,
			row.holdingDays,
			row.term === "long" ? "LTCG" : row.term === "short" ? "STCG" : null,
			row.costUsd,
			row.costFx?.rate,
			row.costFx?.rateDate,
			row.costInr,
			row.considerationUsd,
			row.considerationFx?.rate,
			row.considerationFx?.rateDate,
			row.considerationInr,
			row.feeUsd,
			row.feeInr,
			row.gainInr,
			row.trail.disposalTxId,
			row.trail.lotTxIds.join(", "),
		]),
		[],
		[
			"Term",
			"Consideration INR",
			"Cost INR",
			"Gross Gain INR",
			"Gross Loss INR",
			"Net Gain INR",
		],
		...(
			[
				["LTCG", summary.longTerm],
				["STCG", summary.shortTerm],
			] as const
		).map(([term, value]) => [
			term,
			value.considerationInr,
			value.costInr,
			value.grossGainInr,
			value.grossLossInr,
			value.netGainInr,
		]),
		["STCL Set Off Against LTCG INR", summary.setOff.stclAgainstLtcgInr],
		["Net Taxable LTCG INR", summary.setOff.netTaxableLtcgInr],
		["Net Taxable STCG INR", summary.setOff.netTaxableStcgInr],
		["Carry Forward STCL INR", summary.setOff.carryForwardStclInr],
		["Carry Forward LTCL INR", summary.setOff.carryForwardLtclInr],
		["LTCG Rate", summary.ltcgTax.rate],
		["LTCG Base Tax INR", summary.ltcgTax.baseTaxInr],
		["Surcharge Rate Applied", summary.ltcgTax.surchargeRateApplied],
		["Surcharge INR", summary.ltcgTax.surchargeInr],
		["Cess INR", summary.ltcgTax.cessInr],
		["Total LTCG Tax INR", summary.ltcgTax.totalLtcgTaxInr],
		["Total LTCG Tax Rounded INR", summary.ltcgTax.totalLtcgTaxRoundedInr],
		[summary.stcgNote],
	];
}

function dividendRows({ rows, totals }: UsEquityReport["dividends"]): Rows {
	return [
		[
			"Date",
			"Ticker",
			"Gross USD",
			"Tax Withheld USD",
			"Net USD",
			"Gross INR",
			"Tax Withheld INR",
			"Net INR",
			"Withholding Rate",
			"FX Rate",
			"FX Date",
			"Transaction",
		],
		...rows.map((row) => [
			row.date,
			row.asset,
			row.grossUsd,
			row.taxWithheldUsd,
			row.netUsd,
			row.grossInr,
			row.taxWithheldInr,
			row.netInr,
			row.withholdingRate,
			row.fx?.rate,
			row.fx?.rateDate,
			row.txId,
		]),
		[
			"Total",
			"",
			totals.grossUsd,
			totals.taxWithheldUsd,
			totals.netUsd,
			totals.grossInr,
			totals.taxWithheldInr,
			totals.netInr,
		],
	];
}

function form67Rows({ rows, totals, notes }: UsEquityReport["form67"]): Rows {
	return [
		[
			"Country",
			"Country Code",
			"Nature of Income",
			"DTAA Article",
			"Ticker",
			"Foreign Income USD",
			"Foreign Income INR",
			"Foreign Tax Paid USD",
			"Foreign Tax Paid INR",
			"Max Eligible Credit INR",
			"Effective Rate",
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
		]),
		[
			"Total",
			"",
			"",
			"",
			"",
			totals.foreignIncomeUsd,
			totals.foreignIncomeInr,
			totals.foreignTaxPaidUsd,
			totals.foreignTaxPaidInr,
			totals.maxCreditEligibleInr,
		],
		[],
		["Notes"],
		...notes.map((note) => [note]),
	];
}

function scheduleFaRows({ rows, notes }: UsEquityReport["scheduleFa"]): Rows {
	return [
		[
			"Sl. No.",
			"Country Name",
			"Country Code",
			"Name of Entity",
			"Address of Entity",
			"ZIP Code",
			"Nature of Entity",
			"Date of Acquiring Interest",
			"Initial Value of Investment (INR)",
			"Peak Value of Investment during Period (INR)",
			"Closing Balance (INR)",
			"Total Gross Amount Paid/Credited (INR)",
			"Total Gross Proceeds from Sale/Redemption (INR)",
			"Ticker",
			"Opening Qty",
			"Closing Qty",
			"Max Qty",
			"Lot Count",
			"Initial Value USD",
			"Initial FX Rate",
			"Initial FX Date",
			"Initial FX by Lot",
			"Peak Price USD",
			"Peak Date",
			"Peak Value USD",
			"Peak FX Rate",
			"Peak FX Date",
			"Closing Price USD",
			"Closing Value USD",
			"Closing FX Rate",
			"Closing FX Date",
			"Gross Dividends Paid USD",
			"Gross Sale Proceeds USD",
			"Flow FX by Transaction",
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
			row.closingQty,
			row.maxQtyHeld,
			row.lotCount,
			row.initialValueUsd,
			row.initialFx?.rate,
			row.initialFx?.rateDate,
			row.initialFxByLot && JSON.stringify(row.initialFxByLot),
			row.peakPriceUsd,
			row.peakDate,
			row.peakValueUsd,
			row.peakFx?.rate,
			row.peakFx?.rateDate,
			row.closingPriceUsd,
			row.closingValueUsd,
			row.closingFx?.rate,
			row.closingFx?.rateDate,
			row.grossDividendsPaidUsd,
			row.grossSaleProceedsUsd,
			row.flowFx && JSON.stringify(row.flowFx),
		]),
		[],
		["Notes"],
		...notes.map((note) => [note]),
	];
}

export function exportUsEquityReport(
	report: UsEquityReport,
	{ format, kind }: z.infer<typeof ExportUsEquityReportQuerySchema>,
) {
	const settings = report.generatedFrom.settings;
	const metadata = [
		[report.disclaimer],
		...(report.includesDemoData ? [["Includes sample data"]] : []),
		...(report.incomplete
			? [["Incomplete report — review unresolved or missing inputs"]]
			: []),
		["Tax year", report.taxYear, "Act", report.act],
		["Schedule FA calendar year", String(report.calendarYear)],
		["Setting", "Value"],
		["US equity fee treatment", settings.usEquityFeeTreatment],
		[
			"US equity FX basis",
			settings.usEquityFxBasis === "prev_month_end"
				? "Previous month end"
				: "Trade date",
		],
		["Lot matching method", settings.lotMethod],
		["Lot pool scope", settings.lotPool === "global" ? "Global" : "Per source"],
		["Surcharge rate", `${D(settings.surchargeRate).mul("100").toFixed()}%`],
		...sectionRows(report.sections),
		[
			"Section verification",
			report.sectionsVerified
				? "Verified"
				: "Section numbers pending CA verification",
		],
		[],
	];
	const sections = {
		"capital-gains": () => capitalGainsRows(report.capitalGains),
		dividends: () => dividendRows(report.dividends),
		form67: () => form67Rows(report.form67),
		"schedule-fa": () => scheduleFaRows(report.scheduleFa),
	};
	const worksheets =
		kind === "full"
			? [
					...Object.entries(sections).map(([name, rows]) => ({
						name,
						rows: rows(),
					})),
					{ name: "holdings", rows: table(report.balances) },
					{ name: "warnings", rows: table(report.warnings) },
					{ name: "unresolved", rows: table(report.unresolved) },
					{ name: "excluded", rows: table(report.excluded) },
				]
			: [{ name: kind, rows: sections[kind]() }];
	const strings = (rows: Rows) =>
		rows.map((row) => row.map((cell) => String(cell ?? "")));
	const fileName = `tax-tracker-us-equity-${report.taxYear}-${kind}.${format}`;
	if (format === "csv")
		return {
			fileName,
			contentType: "text/csv; charset=utf-8" as const,
			bytes: new TextEncoder().encode(
				csv([
					...metadata,
					...worksheets.flatMap(({ name, rows }) => [
						[name],
						...strings(rows),
						[],
					]),
				]),
			),
		};
	return {
		fileName,
		contentType:
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
		bytes: writeXlsx(
			worksheets.map(({ name, rows }) => ({
				name,
				rows: [...metadata, ...strings(rows)].map((row) => row.map(safeCell)),
			})),
		),
	};
}
