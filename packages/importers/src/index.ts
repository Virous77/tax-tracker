export {
	binance,
	binanceKind,
	binanceReportKinds,
	parseBinance,
} from "./binance/index.js";
export { recipeChecks } from "./checks.js";
export {
	coindcx,
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
	const sheets = readSheets(file, { allowDuplicateHeaders: true });
	const source =
		!opts.source || opts.source === "auto" ? detectSource(sheets) : opts.source;
	return source === "binance"
		? parseBinance(sheets, opts, file.name)
		: source === "coindcx"
			? parseCoinDcx(sheets, opts)
			: opts.recipe
				? applyRecipe(sheets, opts.recipe, opts)
				: (() => {
						throw new Error("Unknown layout; supply a reviewed recipe.");
					})();
}
