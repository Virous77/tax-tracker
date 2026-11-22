import { normaliseHeader, readSheets } from "../spreadsheet.js";
import type { Importer, ImportOptions, TableSheet } from "../types.js";
import { columnKey, mapStatement, sectionForHeaders } from "./mapping.js";

const metadata = new Set(["accountstatement", "cover", "metadata", "glossary"]);

export function isVestedSheet(sheet: TableSheet): boolean {
	return (
		!metadata.has(normaliseHeader(sheet.name)) &&
		sectionForHeaders(sheet.headers) !== undefined
	);
}

export function isVested(sheets: TableSheet[]): boolean {
	return sheets.some(isVestedSheet);
}

export function parseVested(
	sheets: TableSheet[],
	options: ImportOptions,
	fileName = "export.xlsx",
) {
	if (!isVested(sheets))
		throw new Error("File does not match the Vested Account Statement layout.");
	const tables = sheets
		.filter(
			(sheet) =>
				sheet.headers.length && !metadata.has(normaliseHeader(sheet.name)),
		)
		.map((sheet) => {
			const duplicateHeaders =
				sheet.duplicateHeaders?.length ||
				new Set(sheet.headers.map(columnKey)).size !== sheet.headers.length;
			return {
				name: sheet.name,
				section: duplicateHeaders
					? undefined
					: sectionForHeaders(sheet.headers),
				rows: sheet.rows.map((raw) => ({
					values: raw,
					raw,
					error: duplicateHeaders
						? "Duplicate headers are not supported in Vested statement tables."
						: raw.__extraColumns
							? "Row has more cells than the header."
							: undefined,
				})),
			};
		});
	return mapStatement(
		tables,
		options,
		/\.csv$/i.test(fileName)
			? "vested:account-statement-csv"
			: "vested:account-statement-xlsx",
	);
}

export const vested: Importer = {
	id: "vested",
	detect: (file) => isVested(readSheets(file, { allowDuplicateHeaders: true })),
	parse: (file, options) =>
		parseVested(
			readSheets(file, { allowDuplicateHeaders: true }),
			options,
			file.name,
		),
};
