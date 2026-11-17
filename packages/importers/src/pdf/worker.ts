import { parentPort, workerData } from "node:worker_threads";
import type { PdfErrorCode, PdfPageText } from "./types.js";

const input = workerData as { bytes: Uint8Array; password?: string };
try {
	const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const parameters = {
		data: input.bytes,
		password: input.password,
		isEvalSupported: false,
		disableFontFace: true,
		useSystemFonts: false,
		stopAtErrors: true,
		verbosity: 0,
	};
	const task = getDocument(parameters);
	try {
		const doc = await task.promise;
		if (doc.numPages > 2000) throw new Error("PDF_LIMIT");
		const pages: PdfPageText[] = [];
		let count = 0;
		for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
			const page = await doc.getPage(pageNumber);
			const height = page.getViewport({ scale: 1 }).height;
			const content = await page.getTextContent();
			const items: PdfPageText["items"] = [];
			for (const item of content.items) {
				if (!("str" in item) || !item.str.trim()) continue;
				if (
					Math.abs(item.transform[1] ?? 0) > 0.01 ||
					Math.abs(item.transform[2] ?? 0) > 0.01
				)
					continue;
				count++;
				if (count > 250000) throw new Error("PDF_LIMIT");
				items.push({
					str: item.str,
					x: item.transform[4] ?? 0,
					y: height - (item.transform[5] ?? 0),
					width: item.width,
					height: item.height || Math.abs(item.transform[0] ?? 0) || 10,
				});
			}
			pages.push({ page: pageNumber, height, items });
			page.cleanup();
		}
		parentPort?.postMessage({ pages });
	} finally {
		await task.destroy();
	}
} catch (error) {
	const failure = error as { name?: string; code?: number; message?: string };
	const code: PdfErrorCode =
		failure.name === "PasswordException"
			? failure.code === 1
				? "pdf_password_required"
				: "pdf_password_incorrect"
			: failure.message === "PDF_LIMIT"
				? "pdf_too_large"
				: "pdf_invalid";
	// Only a typed code leaves the worker; library errors could contain input details.
	parentPort?.postMessage({ code });
} finally {
	parentPort?.close();
}
