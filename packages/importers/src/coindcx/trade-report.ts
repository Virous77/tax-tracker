import { D, type LedgerTx, LedgerTxSchema } from "@tax/core";
import type { ReportContext } from "../reports.js";
import { normaliseHeader } from "../spreadsheet.js";
import type { TableSheet } from "../types.js";
import {
	baseTransaction,
	numberString,
	RowParseError,
	splitPair,
	tradePriceQuote,
} from "../values.js";
import { COINDCX_HEADERS as columns } from "./headers.js";
export function column(sheet: TableSheet, keys: string[]): string | undefined {
	return sheet.headers.find((header) =>
		keys.some((key) => normaliseHeader(key) === normaliseHeader(header)),
	);
}
export function isTradeReport(sheet: TableSheet): boolean {
	return Boolean(
		column(sheet, columns.timestamp) &&
			column(sheet, columns.side) &&
			(column(sheet, columns.grossInr) || column(sheet, columns.grossQuote)),
	);
}
export function convert(
	raw: Record<string, string>,
	sheet: TableSheet,
	context: ReportContext,
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
		context.parseTimestamp(
			get(columns.timestamp),
			"yyyy-MM-dd HH:mm:ss",
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
