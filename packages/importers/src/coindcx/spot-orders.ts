import type { ReportKind } from "../reports.js";
import { COINDCX_HEADERS as columns } from "./headers.js";
import { column, convert, isTradeReport } from "./trade-report.js";
export const reportKind: ReportKind = {
	id: "coindcx:spot-orders",
	detect: (sheet) =>
		isTradeReport(sheet) && Boolean(column(sheet, columns.pair)),
	parse: (raw, sheet, context) =>
		convert(
			raw,
			sheet,
			context.options,
			context.reference(raw, raw[column(sheet, columns.id) ?? ""]),
		),
};
