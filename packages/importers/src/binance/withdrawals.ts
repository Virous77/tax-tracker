import { hasHeaders, type ReportKind } from "../reports.js";
import { BINANCE_HEADERS } from "./headers.js";
import { rowTransaction } from "./legacy.js";
export const reportKind: ReportKind = {
	verified: true,
	id: "binance:withdrawals",
	detect: (sheet) =>
		hasHeaders(sheet, [...BINANCE_HEADERS.wallet, "Fee"]) &&
		sheet.headers.some((h) => /^date/i.test(h)),
	parse: (raw, sheet, context) =>
		rowTransaction(
			raw,
			sheet,
			"wallet",
			context.options,
			`withdraw:${context.reference(raw, raw["Transaction ID"])}`,
			context.fileName,
		),
};
