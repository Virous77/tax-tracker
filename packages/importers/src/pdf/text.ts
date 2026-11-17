import { Worker } from "node:worker_threads";
import type { InputFile } from "../types.js";
import {
	type PdfErrorCode,
	PdfImportError,
	type PdfLine,
	type PdfPageText,
} from "./types.js";

const messages: Record<PdfErrorCode, string> = {
	pdf_password_required:
		"This PDF requires a password. Enter the 8-digit password set when downloading the Binance statement.",
	pdf_password_incorrect:
		"The PDF password is incorrect. Check the password and try again.",
	pdf_no_text:
		"This PDF has no text layer; scanned/image-only statements are not supported. Upload a text PDF.",
	pdf_unknown_layout:
		"The PDF statement layout is not recognized. Use a supported export or a reviewed recipe.",
	pdf_form16a_not_supported:
		"CoinDCX Form 16A is recognized, but its TDS table is not supported yet. Compare the certificate totals manually until a verified report layout is available.",
	pdf_invalid:
		"The PDF could not be read. Check that it is a valid, complete PDF.",
	pdf_too_large: "The PDF exceeds the 25 MB, 2,000-page or text-item limit.",
	pdf_timeout: "PDF text extraction exceeded the 30-second limit.",
	pdf_requires_async: "Use importFileAsync or importPdf for PDF documents.",
};
export function pdfError(code: PdfErrorCode, kind?: string) {
	return new PdfImportError(code, messages[code], kind);
}
export function isPdf(file: InputFile) {
	return new TextDecoder().decode(file.bytes.subarray(0, 5)) === "%PDF-";
}
export async function extractPdfText(
	file: InputFile,
	password?: string,
): Promise<PdfPageText[]> {
	if (file.bytes.length > 25 * 1024 * 1024) throw pdfError("pdf_too_large");
	if (!isPdf(file)) throw pdfError("pdf_invalid");
	return new Promise((resolve, reject) => {
		const worker = new Worker(
			new URL(
				import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js",
				import.meta.url,
			),
			{
				workerData: { bytes: file.bytes, password },
				resourceLimits: { maxOldGenerationSizeMb: 256 },
			},
		);
		let settled = false;
		const finish = (pages?: PdfPageText[], code?: PdfErrorCode) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			void worker.terminate();
			if (code) reject(pdfError(code));
			else if (!pages?.some((p) => p.items.length))
				reject(pdfError("pdf_no_text"));
			else resolve(pages);
		};
		const timer = setTimeout(() => finish(undefined, "pdf_timeout"), 30000);
		worker.once(
			"message",
			(message: { pages?: PdfPageText[]; code?: PdfErrorCode }) =>
				finish(message.pages, message.code),
		);
		worker.once("error", () => finish(undefined, "pdf_invalid"));
		worker.once("exit", () => {
			if (!settled) finish(undefined, "pdf_invalid");
		});
	});
}
export function positionedLines(pages: PdfPageText[]): PdfLine[] {
	return pages.flatMap((page) => {
		const heights = page.items.map((i) => i.height).sort((a, b) => a - b);
		const tolerance = (heights[Math.floor(heights.length / 2)] ?? 10) * 0.4;
		const lines: PdfLine[] = [];
		for (const item of [...page.items].sort((a, b) => a.y - b.y || a.x - b.x)) {
			let line = lines.at(-1);
			if (!line || Math.abs(line.y - item.y) >= tolerance) {
				line = {
					page: page.page,
					pageHeight: page.height,
					y: item.y,
					height: item.height,
					cells: [],
				};
				lines.push(line);
			}
			line.cells.push({ ...item });
		}
		for (const line of lines) {
			const cells: PdfLine["cells"] = [];
			for (const item of line.cells.sort((a, b) => a.x - b.x)) {
				const previous = cells.at(-1);
				if (
					previous &&
					item.x - previous.x - previous.width < line.height * 0.25
				) {
					previous.str += item.str;
					previous.width = Math.max(
						previous.width,
						item.x + item.width - previous.x,
					);
				} else cells.push({ ...item });
			}
			line.cells = cells;
		}
		return lines;
	});
}
