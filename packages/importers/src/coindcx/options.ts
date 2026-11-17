import { hasHeaders, type ReportKind } from "../reports.js";
import { reviewOnly } from "../review-only.js";
// Catalogue §2.3: descriptive column names only; tolerate these markers without inventing a full layout.
export const reportKind: ReportKind = {
	id: "coindcx:options",
	verified: false,
	detect: (sheet) =>
		hasHeaders(sheet, ["Position ID", "Option Contract", "Entry Time"]),
	parse: (raw, sheet, context) =>
		reviewOnly("coindcx", "options", raw, sheet, context, "Entry Time"),
};
