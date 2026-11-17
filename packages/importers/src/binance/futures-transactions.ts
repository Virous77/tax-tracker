import { hasHeaders, type ReportKind } from "../reports.js";
import { reviewOnly } from "../review-only.js";
export const reportKind: ReportKind = {
	verified: true,
	id: "binance:futures-transactions",
	timezone: "UTC",
	detect: (sheet) =>
		hasHeaders(sheet, [
			"Date(UTC)",
			"type",
			"Amount",
			"Asset",
			"Symbol",
			"Transaction ID",
		]),
	parse: (raw, sheet, context) =>
		reviewOnly(
			"binance",
			"futures-transactions",
			raw,
			sheet,
			context,
			"Date(UTC)",
		),
};
