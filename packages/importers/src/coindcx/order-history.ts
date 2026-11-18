import { D, LedgerTxSchema } from "@tax/core";
import { hasHeaders, type ReportKind } from "../reports.js";
import { normaliseHeader } from "../spreadsheet.js";
import {
	baseTransaction,
	numberString,
	RowParseError,
	splitPair,
	tradePriceQuote,
} from "../values.js";

export const reportKind: ReportKind = {
	verified: true,
	id: "coindcx:order-history",
	timezone: "UTC",
	detect: (sheet) =>
		hasHeaders(sheet, [
			"Order ID",
			"Market",
			"Pair",
			"Total Quantity",
			"Remaining Quantity",
			"Price Per Unit",
			"Avg Price",
			"Fee Amount",
			"Total Tds INR",
			"Side",
			"Order Type",
			"Status",
			"Exchange Code",
			"Created At",
			"Updated At",
		]),
	parse: (raw, sheet, context) => {
		const get = (key: string) =>
			raw[
				sheet.headers.find(
					(header) => normaliseHeader(header) === normaliseHeader(key),
				) ?? ""
			]?.trim() ?? "";
		const status = get("Status").toLowerCase();
		if (
			![
				"filled",
				"partially_filled",
				"partially_cancelled",
				"cancelled",
				"canceled",
				"open",
				"init",
				"rejected",
			].includes(status)
		)
			throw new RowParseError("Unknown order status.");
		const totalQuantity = numberString(get("Total Quantity"));
		const remaining = numberString(get("Remaining Quantity"));
		if (
			D(totalQuantity).lt("0") ||
			D(remaining).lt("0") ||
			D(remaining).gt(totalQuantity)
		)
			throw new RowParseError(
				"Remaining quantity must be between zero and total quantity.",
				"number",
			);
		const executed = D(totalQuantity).minus(remaining).toFixed();
		if (D(executed).isZero())
			return {
				skip: `Order ${status} has zero executed quantity; no trade occurred.`,
			};
		const pair = get("Pair").toUpperCase();
		if (!/^[A-Z0-9]+-[A-Z0-9]+_[A-Z0-9]+$/.test(pair))
			throw new RowParseError("Expected a routed BASE_QUOTE pair.");
		const [base, quote] = splitPair(pair.slice(pair.indexOf("-") + 1));
		if (`${base}${quote}` !== get("Market").toUpperCase())
			throw new RowParseError("Market does not match the routed pair.");
		const side = get("Side").toLowerCase();
		if (side !== "buy" && side !== "sell")
			throw new RowParseError("Unknown trade side.");
		const price = numberString(get("Avg Price"));
		if (!D(price).gt("0"))
			throw new RowParseError(
				"Executed order requires a positive average price.",
				"number",
			);
		const total = D(executed).mul(price).toFixed();
		const id = get("Order ID");
		if (!id) throw new RowParseError("Order ID is missing.");
		const tx = baseTransaction(
			"coindcx",
			`order:${id}`,
			context.parseTimestamp(
				get("Updated At"),
				"yyyy-MM-dd HH:mm:ss",
				sheet.excelDate1904,
			),
			raw,
		);
		tx.type = ["INR", "USD", "EUR", "GBP"].includes(quote) ? side : "swap";
		tx.assetIn = side === "buy" ? base : quote;
		tx.amountIn = side === "buy" ? executed : total;
		tx.assetOut = side === "buy" ? quote : base;
		tx.amountOut = side === "buy" ? total : executed;
		tx.priceQuote = tradePriceQuote(side, tx.type, quote, price);
		if (quote === "INR") {
			tx.inrValue = total;
			tx.inrRateSource = "trade_inr";
		}
		if (get("Fee Amount")) {
			tx.feeAmount = numberString(get("Fee Amount"));
			tx.feeAsset = quote;
		}
		if (get("Total Tds INR")) tx.tdsInr = numberString(get("Total Tds INR"));
		if ((get("Avg Price").split(".")[1]?.length ?? 0) > 10)
			tx.reviewFlags.push({
				code: "parse_warning",
				message:
					"Average price has more than ten decimal places and may contain float noise; the exported value has been preserved.",
			});
		if (tx.feeAmount !== undefined)
			tx.reviewFlags.push({
				code: "parse_warning",
				message: "Fee may include GST; no split has been inferred.",
			});
		return LedgerTxSchema.parse(tx);
	},
};
