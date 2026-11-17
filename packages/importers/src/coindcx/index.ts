import { parseReports } from "../reports.js";
import { readSheets } from "../spreadsheet.js";
import type { Importer, ImportOptions, TableSheet } from "../types.js";
import { reportKind as form16aPdf } from "./form16a-pdf.js";
import { reportKind as futures } from "./futures-orders.js";
import { reportKind as instant } from "./instant-orders.js";
import { reportKind as options } from "./options.js";
import { reportKind as orders } from "./order-history.js";
import { reportKind as spot } from "./spot-orders.js";

export const coindcxPdfReportKinds = [form16aPdf] as const;
export const coindcxReportKinds = [
	orders,
	instant,
	spot,
	futures,
	options,
] as const;
export function isCoinDcx(sheet: TableSheet): boolean {
	return coindcxReportKinds.some((kind) => kind.detect(sheet));
}
export function parseCoinDcx(sheets: TableSheet[], opts: ImportOptions) {
	return parseReports("coindcx", coindcxReportKinds, sheets, opts);
}
export const coindcx: Importer = {
	id: "coindcx",
	detect: (file) => readSheets(file).some(isCoinDcx),
	parse: (file, opts) => parseCoinDcx(readSheets(file), opts),
};
