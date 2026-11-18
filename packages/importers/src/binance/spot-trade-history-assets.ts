import { hasHeaders, type ReportKind } from "../reports.js";
import { rowTransaction } from "./legacy.js";
// export-formats §A3 / catalogue §1.4: third-party field names only; verify every imported row.
export const reportKind: ReportKind = {
	id: "binance:spot-trade-history-assets",
	verified: false,
	detect: (sheet) =>
		hasHeaders(sheet, [
			"Date(UTC)",
			"Pair",
			"Base Asset",
			"Quote Asset",
			"Type",
			"Price",
			"Amount",
			"Total",
			"Fee",
			"Fee Coin",
		]),
	parse: (raw, sheet, context) =>
		rowTransaction(
			raw,
			sheet,
			"oldTrade",
			context,
			context.reference(raw, raw["Trade ID"]),
		),
};
