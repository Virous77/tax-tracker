import { parseReports } from "../reports.js";
import { readSheets } from "../spreadsheet.js";
import type { Importer, ImportOptions, TableSheet } from "../types.js";
import { reportKind as accountStatementPdf } from "./account-statement-pdf.js";
import { reportKind as convert } from "./convert.js";
import { reportKind as deposits } from "./deposits.js";
import { reportKind as fiat } from "./fiat.js";
import { reportKind as futuresTrades } from "./futures-trades.js";
import { reportKind as futuresTransactions } from "./futures-transactions.js";
import { reportKind as oldTrade } from "./legacy-spot-trade-history.js";
import { reportKind as orders } from "./spot-order-history.js";
import { reportKind as trade } from "./spot-trade-history.js";
import { reportKind as assetsTrade } from "./spot-trade-history-assets.js";
import { reportKind as statement } from "./transaction-history.js";
import { reportKind as wallet } from "./wallet-history.js";
import { reportKind as withdrawals } from "./withdrawals.js";

export const binancePdfReportKinds = [accountStatementPdf] as const;
export const binanceReportKinds = [
	orders,
	statement,
	deposits,
	withdrawals,
	convert,
	fiat,
	futuresTrades,
	futuresTransactions,
	trade,
	oldTrade,
	assetsTrade,
	wallet,
] as const;
export function binanceKind(sheet: TableSheet): string | undefined {
	return binanceReportKinds.find((kind) => kind.detect(sheet))?.id;
}
export function parseBinance(
	sheets: TableSheet[],
	opts: ImportOptions,
	fileName = "export.csv",
) {
	return parseReports("binance", binanceReportKinds, sheets, opts, fileName);
}
export const binance: Importer = {
	id: "binance",
	detect: (file) =>
		readSheets(file, { allowDuplicateHeaders: true }).some(
			(sheet) => binanceKind(sheet) !== undefined,
		),
	parse: (file, opts) =>
		parseBinance(
			readSheets(file, { allowDuplicateHeaders: true }),
			opts,
			file.name,
		),
};
