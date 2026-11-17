import { hasHeaders, type ReportKind } from "../reports.js";
import { reviewOnly } from "../review-only.js";
// Catalogue §2.7 / export-formats §B5: only the USDT-M P&L headers are documented.
export const reportKind: ReportKind = {
	id: "coindcx:futures-orders",
	verified: false,
	detect: (sheet) =>
		hasHeaders(sheet, [
			"Transaction ID",
			"Transaction time",
			"Type of Transaction",
		]) &&
		sheet.headers.some((h) =>
			/Gross P&L for this transaction\(in (USDT|INR)\)/.test(h),
		),
	parse: (raw, sheet, context) =>
		reviewOnly("coindcx", "futures", raw, sheet, context, "Transaction time"),
};
