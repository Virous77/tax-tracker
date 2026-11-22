import { reportKind as binance } from "../binance/account-statement-pdf.js";
import { reportKind as form16a } from "../coindcx/form16a-pdf.js";
import type {
	Importer,
	ImportOptions,
	ImportResult,
	InputFile,
} from "../types.js";
import { reportKind as vested } from "../vested/account-statement-pdf.js";
import { extractPdfText, pdfError, positionedLines } from "./text.js";
import { PdfImportError } from "./types.js";

export { isPdf, positionedLines } from "./text.js";
export { type PdfErrorCode, PdfImportError } from "./types.js";
export const pdfReportKinds = [binance, form16a, vested] as const;
export async function importPdf(
	file: InputFile,
	options: ImportOptions & { source?: Importer["id"] | "auto" },
): Promise<ImportResult> {
	const lines = positionedLines(
		await extractPdfText(file, options.pdfPassword),
	);
	const text = lines
		.map((line) => line.cells.map((c) => c.str).join(" "))
		.join("\n");
	if (vested.detect(text)) {
		if (
			options.source &&
			options.source !== "auto" &&
			options.source !== "vested"
		)
			throw new PdfImportError(
				"pdf_unknown_layout",
				"This Vested Account Statement does not match the selected venue.",
				vested.id,
			);
		return vested.parse(lines, options, file.name);
	}
	if (options.source === "vested")
		throw new PdfImportError(
			"pdf_unknown_layout",
			"File does not match the Vested Account Statement PDF layout.",
		);
	if (form16a.detect(text)) return form16a.parse();
	if (binance.detect(text)) return binance.parse(lines, options, file.name);
	throw pdfError("pdf_unknown_layout");
}
