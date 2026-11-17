import { D, LedgerTxSchema } from "@tax/core";
import { hasHeaders, type ReportKind } from "../reports.js";
import { normaliseHeader } from "../spreadsheet.js";
import {
	baseTransaction,
	numberString,
	parseAmountWithAsset,
	parseTimestamp,
	RowParseError,
	splitPair,
} from "../values.js";

export const reportKind: ReportKind = {
	id: "binance:spot-order-history",
	allowDuplicateHeaders: true,
	detect: (sheet) =>
		hasHeaders(sheet, [
			"Time",
			"OrderNo",
			"Pair",
			"Type",
			"Side",
			"Order Price",
			"Order Amount",
			"Time#2",
			"Executed",
			"Average Price",
			"Trading total",
			"Status",
		]),
	warnings: [
		{
			code: "parse_warning",
			message:
				"Binance Spot Order History has no fees, so fees are not counted. Use the Trade History export if you want fee treatment.",
		},
	],
	parse: (raw, sheet, context) => {
		const get = (key: string) =>
			raw[
				sheet.headers.find(
					(header) => normaliseHeader(header) === normaliseHeader(key),
				) ?? ""
			]?.trim() ?? "";
		const [base, quote] = splitPair(get("Pair"));
		const quantity = parseAmountWithAsset(get("Executed"), base).amount;
		const ordered = parseAmountWithAsset(get("Order Amount"), base).amount;
		if (D(quantity).lt("0") || D(quantity).gt(ordered))
			throw new RowParseError(
				"Executed quantity must be between zero and the order quantity.",
				"number",
			);
		const status = get("Status").toUpperCase();
		if (
			!["FILLED", "PARTIALLY_FILLED", "CANCELED", "CANCELLED"].includes(status)
		)
			throw new RowParseError("Unknown spot order status.");
		if (!["limit", "market", "stop-limit"].includes(get("Type").toLowerCase()))
			throw new RowParseError("Unsupported spot order type.");
		if (D(quantity).isZero())
			return {
				skip: `Spot order ${status} has zero executed quantity; no trade occurred.`,
			};
		const side = get("Side").toLowerCase();
		if (side !== "buy" && side !== "sell")
			throw new RowParseError("Unknown trade side.");
		const total = parseAmountWithAsset(get("Trading total"), quote).amount;
		const price = numberString(get("Average Price"));
		if (!D(price).gt("0") || !D(total).gt("0"))
			throw new RowParseError(
				"Executed trade requires a positive average price and total.",
				"number",
			);
		const id = get("OrderNo");
		if (!id) throw new RowParseError("Order number is missing.");
		// The second Time appears to be the last-fill/update time, so it best represents execution; raw retains both.
		const tx = baseTransaction(
			"binance",
			`order:${id}`,
			parseTimestamp(
				get("Time#2"),
				"yyyy-MM-dd HH:mm:ss",
				context.options.timezone,
				sheet.excelDate1904,
			),
			raw,
		);
		tx.type = ["INR", "USD", "EUR", "GBP"].includes(quote) ? side : "swap";
		tx.assetIn = side === "buy" ? base : quote;
		tx.amountIn = side === "buy" ? quantity : total;
		tx.assetOut = side === "buy" ? quote : base;
		tx.amountOut = side === "buy" ? total : quantity;
		tx.priceQuote = { asset: quote, price };
		if (quote === "INR") {
			tx.inrValue = total;
			tx.inrRateSource = "trade_inr";
		}
		return LedgerTxSchema.parse(tx);
	},
};
