import { D, type LedgerTx, LedgerTxSchema } from "@tax/core";
import { normaliseHeader, readSheets } from "../spreadsheet.js";
import type {
	Importer,
	ImportOptions,
	ImportResult,
	TableSheet,
} from "../types.js";
import {
	baseTransaction,
	numberString,
	parseTimestamp,
	RowParseError,
	sourceReferences,
	splitPair,
	tradePriceQuote,
} from "../values.js";
import { COINDCX_HEADERS as columns } from "./headers.js";

function column(sheet: TableSheet, keys: string[]): string | undefined {
	return sheet.headers.find((header) =>
		keys.some((key) => normaliseHeader(key) === normaliseHeader(header)),
	);
}
export function isCoinDcx(sheet: TableSheet): boolean {
	return Boolean(
		column(sheet, columns.timestamp) &&
			column(sheet, columns.side) &&
			(column(sheet, columns.grossInr) || column(sheet, columns.grossQuote)),
	);
}
function convert(
	raw: Record<string, string>,
	sheet: TableSheet,
	opts: ImportOptions,
	sourceRef: string,
): LedgerTx {
	if (raw.__extraColumns)
		throw new RowParseError("Row has more cells than the header.");
	const get = (keys: string[]) => raw[column(sheet, keys) ?? ""]?.trim() ?? "";
	if (!column(sheet, columns.timestamp) || !column(sheet, columns.side))
		throw new RowParseError(
			"Unknown CoinDCX sheet mapping; use a reviewed recipe.",
		);
	const spot = Boolean(column(sheet, columns.pair));
	const [asset, quote] = spot
		? splitPair(get(columns.pair), [get(columns.quote)])
		: [get(columns.asset).toUpperCase(), "INR"];
	const tx = baseTransaction(
		"coindcx",
		sourceRef,
		parseTimestamp(
			get(columns.timestamp),
			"yyyy-MM-dd HH:mm:ss",
			opts.timezone,
			sheet.excelDate1904,
		),
		raw,
	);
	const side = get(columns.side).toLowerCase();
	if (!["buy", "sell"].includes(side))
		throw new RowParseError("Unknown trade side.");
	const amount = numberString(get(columns.amount), true);
	const gross = numberString(
		get(spot ? columns.grossQuote : columns.grossInr),
		true,
	);
	tx.type = ["INR", "USD", "EUR", "GBP"].includes(quote)
		? (side as "buy" | "sell")
		: "swap";
	tx.assetIn = side === "buy" ? asset : quote;
	tx.amountIn = side === "buy" ? amount : gross;
	tx.assetOut = side === "buy" ? quote : asset;
	tx.amountOut = side === "buy" ? gross : amount;
	tx.priceQuote = tradePriceQuote(
		side,
		tx.type,
		quote,
		get(spot ? columns.priceQuote : columns.priceInr),
	);
	if (quote === "INR") {
		tx.inrValue = gross;
		tx.inrRateSource = "trade_inr";
	} else if (get(columns.netInr) && get(columns.netQuote)) {
		const net = numberString(get(columns.netQuote), true);
		if (!D(net).gt("0"))
			throw new RowParseError("Net quote amount must be positive.", "number");
		tx.inrValue = D(gross)
			.mul(numberString(get(columns.netInr), true))
			.div(net)
			.toFixed();
		tx.inrRateSource = "trade_inr";
		tx.reviewFlags.push({
			code: "parse_warning",
			message:
				"Gross INR value is derived from the export's indicative net INR conversion; verify with the trade report.",
		});
	}
	const fee = get(spot ? columns.feeQuote : columns.feeInr);
	if (fee) {
		tx.feeAmount = numberString(fee, true);
		tx.feeAsset = quote;
	}
	if (get(columns.tdsInr)) tx.tdsInr = numberString(get(columns.tdsInr), true);
	if (get(columns.gst)) tx.gstInr = numberString(get(columns.gst), true);
	else if (fee)
		tx.reviewFlags.push({
			code: "parse_warning",
			message:
				"Export does not separate GST from fees; GST has not been inferred. Verify whether fees include GST.",
		});
	return LedgerTxSchema.parse(tx);
}
export function parseCoinDcx(
	sheets: TableSheet[],
	opts: ImportOptions,
): ImportResult {
	const result: ImportResult = {
		transactions: [],
		rowsRead: 0,
		warnings: [],
		rowErrors: [],
		sheets: [],
	};
	const ref = sourceReferences();
	for (const sheet of sheets) {
		result.rowsRead += sheet.rows.length;
		result.sheets?.push({ name: sheet.name, rowsRead: sheet.rows.length });
		sheet.rows.forEach((raw, rowIndex) => {
			try {
				if (!isCoinDcx(sheet))
					throw new RowParseError(
						"Unsupported or unverified CoinDCX sheet. Preserved for review; use a recipe for a verified wallet layout. Futures require separate tax treatment.",
					);
				result.transactions.push(
					convert(
						raw,
						sheet,
						opts,
						ref(raw, raw[column(sheet, columns.id) ?? ""]),
					),
				);
			} catch (error) {
				result.rowErrors.push({
					rowIndex,
					sheet: sheet.name,
					message: error instanceof Error ? error.message : "Invalid row",
					raw,
					field: error instanceof RowParseError ? error.field : "other",
				});
			}
		});
	}
	if (result.rowErrors.length)
		result.warnings.push({
			code: "parse_warning",
			message:
				"Unsupported sheets and invalid rows are listed in row errors and are excluded from calculations.",
		});
	return result;
}
export const coindcx: Importer = {
	id: "coindcx",
	detect: (file) => readSheets(file).some(isCoinDcx),
	parse: (file, opts) => parseCoinDcx(readSheets(file), opts),
};
