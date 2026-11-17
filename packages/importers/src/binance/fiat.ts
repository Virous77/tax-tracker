import { D, LedgerTxSchema } from "@tax/core";
import { hasHeaders, type ReportKind } from "../reports.js";
import { baseTransaction, numberString, parseTimestamp } from "../values.js";
// Catalogue §1.2 / export-formats §A6: identical fiat headers need the selected report direction.
export const reportKind: ReportKind = {
	verified: true,
	id: "binance:fiat",
	detect: (sheet) =>
		hasHeaders(sheet, [
			"Coin",
			"Amount",
			"Status",
			"Payment Method",
			"Indicated Amount",
			"Fee",
			"Order ID",
		]) && sheet.headers.some((h) => /^Date/.test(h)),
	parse: (raw, sheet, context) => {
		const date = sheet.headers.find((h) => /^Date/.test(h)) ?? "";
		const tx = baseTransaction(
			"binance",
			`fiat:${context.reference(raw, raw["Order ID"])}`,
			parseTimestamp(
				raw[date] ?? "",
				"yyyy-MM-dd HH:mm:ss",
				/UTC(?:\+0)?\)/.test(date) ? "UTC" : context.options.timezone,
				sheet.excelDate1904,
			),
			raw,
		);
		if (
			raw.Status?.toLowerCase() !== "successful" ||
			!/deposit|withdraw/i.test(context.fileName)
		) {
			tx.reviewFlags.push({
				code: "unknown_type",
				message:
					"Fiat direction or completion is not established; original payment preserved for review. Select a deposit/withdrawal file or use a recipe.",
			});
			return LedgerTxSchema.parse(tx);
		}
		const asset = (raw.Coin ?? "").toUpperCase();
		const amount = numberString(raw.Amount ?? "");
		if (!D(amount).gt("0")) throw new Error("Fiat amount must be positive.");
		tx.type = /withdraw/i.test(context.fileName) ? "withdrawal" : "deposit";
		if (tx.type === "withdrawal") {
			tx.assetOut = asset;
			tx.amountOut = amount;
		} else {
			tx.assetIn = asset;
			tx.amountIn = amount;
		}
		if (raw.Fee) {
			tx.feeAsset = asset;
			tx.feeAmount = numberString(raw.Fee);
		}
		return LedgerTxSchema.parse(tx);
	},
};
