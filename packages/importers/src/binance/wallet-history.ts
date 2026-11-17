import { hasHeaders, type ReportKind } from "../reports.js";
import { BINANCE_HEADERS } from "./headers.js";
import { rowTransaction } from "./legacy.js";
export const reportKind: ReportKind = {
	id: "binance:wallet-history",
	detect: (sheet) =>
		hasHeaders(sheet, BINANCE_HEADERS.wallet) &&
		sheet.headers.some((header) => /^date/i.test(header)),
	parse: (raw, sheet, context) => {
		return rowTransaction(
			raw,
			sheet,
			"wallet",
			context.options,
			context.reference(raw, raw["Trade ID"] ?? raw["Transaction ID"]),
			context.fileName,
		);
	},
};
