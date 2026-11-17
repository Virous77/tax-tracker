import type { PdfErrorCode, PdfImportError } from "@tax/importers";
import { ApiError } from "./errors";

const errors: Record<PdfErrorCode, [string, string]> = {
	pdf_password_required: [
		"pdf_password_required",
		"This PDF is encrypted. Enter its password and upload it again.",
	],
	pdf_password_incorrect: [
		"pdf_wrong_password",
		"The PDF password did not open this file. Check the password and try again.",
	],
	pdf_no_text: [
		"pdf_no_text",
		"This PDF has no usable text layer. Upload the CSV or XLSX export instead.",
	],
	pdf_unknown_layout: [
		"pdf_unknown_layout",
		"This PDF layout is not recognized. Use the venue's CSV or XLSX export.",
	],
	pdf_form16a_not_supported: [
		"pdf_unsupported",
		"CoinDCX Form 16A is not supported yet. Preserve it for your tax records.",
	],
	pdf_invalid: [
		"pdf_unsupported",
		"This PDF could not be read. Download a fresh export or use CSV or XLSX.",
	],
	pdf_requires_async: [
		"pdf_unsupported",
		"This PDF could not be processed. Use CSV or XLSX.",
	],
	pdf_timeout: [
		"pdf_unsupported",
		"This PDF took too long to read. Use a smaller file or the CSV or XLSX export.",
	],
	pdf_too_large: [
		"pdf_too_large",
		"PDF exceeds the size or extraction limit. Use a smaller statement (maximum upload: 25 MB).",
	],
};
export function pdfApiError(error: PdfImportError): ApiError {
	const [code, message] = errors[error.code];
	return new ApiError(code === "pdf_too_large" ? 413 : 422, code, message);
}
export function isPdf(bytes: Uint8Array): boolean {
	return new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
}
