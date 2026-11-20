import type { VdaReport } from "@tax/core";
import type { ExportReportQuerySchema } from "@tax/core/api";
import { writeXlsx } from "@tax/importers";
import type { z } from "zod";
import { sectionRows, settingsRows } from "./report-metadata";
export function safeCell(value: string): string {
	const start = value
		.split("")
		.findIndex(
			(character) => character.charCodeAt(0) > 32 && !/\s/.test(character),
		);
	return start >= 0 && "=+-@".includes(value[start] ?? "")
		? `'${value}`
		: value;
}
function csv(rows: string[][]): string {
	return `${rows.map((row) => row.map((value) => `"${safeCell(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")}\r\n`;
}
function table(rows: unknown[]): string[][] {
	const objects = rows.map((row) => row as Record<string, unknown>);
	const keys = [...new Set(objects.flatMap((row) => Object.keys(row)))];
	return [
		keys,
		...objects.map((row) =>
			keys.map((key) => {
				const value = row[key];
				return value === undefined || value === null
					? ""
					: typeof value === "object"
						? JSON.stringify(value)
						: String(value);
			}),
		),
	];
}
export async function exportReport(
	report: VdaReport,
	query: z.infer<typeof ExportReportQuerySchema>,
) {
	const metadata = [
		[report.disclaimer],
		...(report.includesDemoData ? [["Includes sample data"]] : []),
		["Tax year", report.taxYear, "Act", report.act],
		...settingsRows(report.generatedFrom.settings),
		...sectionRows(report.sections),
		[
			"Section verification",
			report.sectionsVerified
				? "Verified"
				: "Section numbers pending CA verification",
		],
	];
	const all = [
		{ name: "schedule-vda", rows: table(report.scheduleVdaRows) },
		{
			name: "tds",
			rows: [
				...table(report.tds.bySource),
				["Reconciliation checklist"],
				...report.tds.checklist.map((value) => [value]),
			],
		},
		{
			name: "income",
			rows: [
				...table(report.income.rows),
				["Gifts total INR", report.income.giftsTotalInr],
				["Gifts over threshold", String(report.income.giftsOverThreshold)],
				...(report.income.note ? [[report.income.note]] : []),
			],
		},
	];
	const sections =
		query.kind === "full"
			? [
					...all,
					{ name: "totals", rows: table([report.totals]) },
					{ name: "balances", rows: table(report.balances) },
					{ name: "unresolved", rows: table(report.unresolved) },
					{ name: "warnings", rows: table(report.warnings) },
					{ name: "valuations", rows: table(report.valuations) },
					{ name: "ledger", rows: table(report.ledger) },
				]
			: all.filter((section) => section.name === query.kind);
	const fileName = `tax-tracker-${report.taxYear}-${query.kind}.${query.format}`;
	if (query.format === "csv")
		return {
			fileName,
			contentType: "text/csv; charset=utf-8" as const,
			bytes: new TextEncoder().encode(
				csv([
					...metadata,
					...sections.flatMap((section) => [
						[section.name],
						...section.rows,
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
			sections.map((section) => ({
				name: section.name,
				rows: [...metadata, ...section.rows],
			})),
		),
	};
}
