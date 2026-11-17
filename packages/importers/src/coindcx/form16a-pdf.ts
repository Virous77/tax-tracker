import { pdfError } from "../pdf/text.js";
// Catalogue §2.5: no CoinDCX/TRACES sample is verified; do not infer totals from repeated challan figures.
export const reportKind = {
	id: "coindcx:form16a-pdf",
	verified: false,
	detect: (text: string) => /FORM\s*NO\.?\s*16\s*A\b/i.test(text),
	parse(): never {
		throw pdfError("pdf_form16a_not_supported", this.id);
	},
};
