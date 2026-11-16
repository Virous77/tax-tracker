import type { VdaReport } from "@tax/core";

function cell(value: string | null): string {
	return `"${(value ?? "").replaceAll('"', '""')}"`;
}
export function scheduleVdaCsv(report: VdaReport): string {
	const rows: (string | null)[][] = [
		[report.disclaimer],
		["Tax year", report.taxYear, "Act", report.act],
		["Settings", JSON.stringify(report.generatedFrom.settings)],
		[
			"Sections",
			JSON.stringify(report.sections),
			report.sectionsVerified
				? "Verified"
				: "Section numbers pending CA verification",
		],
		[
			"Date of acquisition",
			"Date of transfer",
			"Head of income",
			"Asset",
			"Quantity",
			"Cost of acquisition INR",
			"Consideration received INR",
			"Income INR",
			"Loss INR",
			"Disposal transaction",
			"Lot transactions",
			"Review flags",
		],
		...report.scheduleVdaRows.map((row) => [
			row.dateOfAcquisition,
			row.dateOfTransfer,
			row.headOfIncome,
			row.asset,
			row.quantity,
			row.costOfAcquisition,
			row.considerationReceived,
			row.income,
			row.loss,
			row.trail.disposalTxId,
			row.trail.lotTxIds.join(";"),
			row.reviewFlags.map((flag) => flag.code).join(";"),
		]),
	];
	return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
