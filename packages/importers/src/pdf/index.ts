import { reportKind as binance } from "../binance/account-statement-pdf.js";
import { reportKind as form16a } from "../coindcx/form16a-pdf.js";
import type { ImportOptions, ImportResult, InputFile } from "../types.js";
import { extractPdfText, pdfError, positionedLines } from "./text.js";

export { isPdf, positionedLines } from "./text.js";
export { type PdfErrorCode, PdfImportError } from "./types.js";
export const pdfReportKinds = [binance, form16a] as const;
export async function importPdf(
	file: InputFile,
	options: ImportOptions,
): Promise<ImportResult> {
	const lines = positionedLines(
		await extractPdfText(file, options.pdfPassword),
	);
	const text = lines
		.map((line) => line.cells.map((c) => c.str).join(" "))
		.join("\n");
	if (form16a.detect(text)) return form16a.parse();
	if (binance.detect(text)) return binance.parse(lines, options);
	throw pdfError("pdf_unknown_layout");
}
