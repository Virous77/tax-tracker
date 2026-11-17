import { hasHeaders, type ReportKind } from "../reports.js";
import { BINANCE_HEADERS } from "./headers.js";
import { rowTransaction } from "./legacy.js";
export const reportKind: ReportKind = {
	id: "binance:legacy-spot-trade-history",
	detect: (sheet) => hasHeaders(sheet, BINANCE_HEADERS.oldTrade),
	parse: (raw, sheet, context) => {
		return rowTransaction(
			raw,
			sheet,
			"oldTrade",
			context.options,
			context.reference(raw, raw["Trade ID"] ?? raw["Transaction ID"]),
			context.fileName,
		);
	},
};
