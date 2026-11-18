export {
	binance,
	binanceKind,
	binancePdfReportKinds,
	binanceReportKinds,
	parseBinance,
} from "./binance/index.js";
export { recipeChecks } from "./checks.js";
export {
	coindcx,
	coindcxPdfReportKinds,
	coindcxReportKinds,
	isCoinDcx,
	parseCoinDcx,
} from "./coindcx/index.js";
export {
	applyRecipe,
	convertRecipeRow,
	generic,
	recipeSheet,
} from "./generic.js";
export type { ReportContext, ReportKind } from "./reports.js";
export type { ReadSheetOptions } from "./spreadsheet.js";
export {
	csvRecords,
	normaliseHeader,
	readSheets,
	writeXlsx,
} from "./spreadsheet.js";
export { timezoneFromFileName } from "./timezone.js";
export * from "./types.js";
export {
	canonical,
	headerFingerprint,
	numberString,
	parseAmountWithAsset,
	parseTimestamp,
	sha256,
	splitPair,
} from "./values.js";

import { binanceKind, parseBinance } from "./binance/index.js";
import { isCoinDcx, parseCoinDcx } from "./coindcx/index.js";
import { applyRecipe } from "./generic.js";
import { readSheets } from "./spreadsheet.js";
import type { ImportOptions, InputFile, TableSheet } from "./types.js";
export function detectSource(
	sheets: TableSheet[],
): "binance" | "coindcx" | "generic" {
	return sheets.some(isCoinDcx)
		? "coindcx"
		: sheets.some((sheet) => binanceKind(sheet))
			? "binance"
			: "generic";
}
export function importFile(
	file: InputFile,
	opts: ImportOptions & { source?: "auto" | "binance" | "coindcx" | "generic" },
) {
	if (isPdf(file)) throw pdfError("pdf_requires_async");
	const sheets = readSheets(file, { allowDuplicateHeaders: true });
	const source =
		!opts.source || opts.source === "auto" ? detectSource(sheets) : opts.source;
	return source === "binance"
		? parseBinance(sheets, opts, file.name)
		: source === "coindcx"
			? parseCoinDcx(sheets, opts, file.name)
			: opts.recipe
				? applyRecipe(sheets, opts.recipe, opts, file.name)
				: (() => {
						throw new Error("Unknown layout; supply a reviewed recipe.");
					})();
}
export { AWAITING_HEADER_SAMPLES, REPORT_KIND_LABELS } from "./labels.js";
export {
	importPdf,
	type PdfErrorCode,
	PdfImportError,
	pdfReportKinds,
	positionedLines,
} from "./pdf/index.js";
export {
	type ReportReconciliation,
	reconcileReportKinds,
	transactionReportKind,
} from "./reconcile.js";

import { importPdf, isPdf } from "./pdf/index.js";
import { pdfError } from "./pdf/text.js";
export async function importFileAsync(
	file: InputFile,
	opts: Parameters<typeof importFile>[1],
) {
	return isPdf(file) || /\.pdf$/i.test(file.name)
		? importPdf(file, opts)
		: importFile(file, opts);
}
