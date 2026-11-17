export interface PdfTextItem {
	str: string;
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface PdfPageText {
	page: number;
	height: number;
	items: PdfTextItem[];
}
export interface PdfLine {
	page: number;
	pageHeight?: number;
	y: number;
	height: number;
	cells: PdfTextItem[];
}
export type PdfErrorCode =
	| "pdf_password_required"
	| "pdf_password_incorrect"
	| "pdf_no_text"
	| "pdf_unknown_layout"
	| "pdf_form16a_not_supported"
	| "pdf_invalid"
	| "pdf_too_large"
	| "pdf_timeout"
	| "pdf_requires_async";
export class PdfImportError extends Error {
	constructor(
		public readonly code: PdfErrorCode,
		message: string,
		public readonly reportKind?: string,
	) {
		super(message);
		this.name = "PdfImportError";
	}
}
