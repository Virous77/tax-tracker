import { D, LedgerTxSchema } from "@tax/core";
import { hasHeaders, type ReportKind } from "../reports.js";
import {
	baseTransaction,
	parseAmountWithAsset,
	parseTimestamp,
} from "../values.js";
export const reportKind: ReportKind = {
	verified: true,
	id: "binance:convert",
	detect: (sheet) =>
		hasHeaders(sheet, [
			"Date",
			"Pair",
			"Type",
			"Sell",
			"Buy",
			"Price",
			"Inverse Price",
			"Date Updated",
			"Status",
		]),
	parse: (raw, sheet, context) => {
		const tx = baseTransaction(
			"binance",
			`convert:${context.reference(raw)}`,
			parseTimestamp(
				raw["Date Updated"] || raw.Date || "",
				"yyyy-MM-dd HH:mm:ss",
				context.options.timezone,
				sheet.excelDate1904,
			),
			raw,
		);
		if (raw.Status?.toLowerCase() !== "successful") {
			tx.reviewFlags.push({
				code: "unknown_type",
				message:
					"Unconfirmed Convert status; preserved for review with no balance effect.",
			});
			return LedgerTxSchema.parse(tx);
		}
		const bought = parseAmountWithAsset(raw.Buy ?? "");
		const sold = parseAmountWithAsset(raw.Sell ?? "");
		tx.type = "swap";
		tx.assetIn = bought.asset;
		tx.amountIn = bought.amount;
		tx.assetOut = sold.asset;
		tx.amountOut = sold.amount;
		tx.priceQuote = {
			asset: bought.asset,
			price: D(bought.amount).div(sold.amount).toFixed(),
		};
		return LedgerTxSchema.parse(tx);
	},
};
