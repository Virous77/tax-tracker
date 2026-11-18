import { hasHeaders, type ReportKind } from "../reports.js";
import { BINANCE_HEADERS } from "./headers.js";
import { rowTransaction } from "./legacy.js";
export const reportKind: ReportKind = {
	verified: true,
	id: "binance:deposits",
	detect: (sheet) =>
		hasHeaders(sheet, BINANCE_HEADERS.wallet) &&
		sheet.headers.some((h) => /^date/i.test(h)) &&
		!sheet.headers.includes("Fee") &&
		!sheet.headers.includes("TransactionFee"),
	parse: (raw, sheet, context) =>
		rowTransaction(
			raw,
			sheet,
			"wallet",
			context,
			`deposit:${context.reference(raw, raw["Transaction ID"])}`,
		),
};
