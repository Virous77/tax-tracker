import { hasHeaders, type ReportKind } from "../reports.js";
import { reviewOnly } from "../review-only.js";
// Catalogue §1.8: third-party header only; contract tax treatment requires a CA.
export const reportKind: ReportKind = {
	id: "binance:futures-trades",
	verified: false,
	timezone: "UTC",
	detect: (sheet) =>
		hasHeaders(sheet, [
			"Date(UTC)",
			"Pair",
			"Side",
			"Price",
			"Quantity",
			"Amount",
			"Fee",
			"Realized Profit",
		]),
	parse: (raw, sheet, context) =>
		reviewOnly("binance", "futures-trades", raw, sheet, context, "Date(UTC)"),
};
