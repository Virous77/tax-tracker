import { hasHeaders, type ReportKind } from "../reports.js";
import { BINANCE_HEADERS, STATEMENT_OVERLAP } from "./headers.js";
import { rowTransaction } from "./legacy.js";
export const reportKind: ReportKind = {
	id: "binance:transaction-history",
	detect: (sheet) => hasHeaders(sheet, BINANCE_HEADERS.statement),
	parse: (raw, sheet, context) => {
		if (STATEMENT_OVERLAP.has(raw.Operation ?? ""))
			return {
				skip: "Statement row overlaps trade/deposit/withdrawal exports; import the dedicated history file. This row is preserved but not applied.",
			};
		return rowTransaction(
			raw,
			sheet,
			"statement",
			context.options,
			context.reference(raw, raw["Trade ID"] ?? raw["Transaction ID"]),
			context.fileName,
		);
	},
};
