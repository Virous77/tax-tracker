import { type LedgerTx, LedgerTxSchema } from "@tax/core";
import { timezoneFromFileName } from "../timezone.js";
import type { ImportOptions, TableSheet } from "../types.js";
import {
	amountAsset,
	baseTransaction,
	numberString,
	parseTimestamp,
	RowParseError,
	splitPair,
	tradePriceQuote,
} from "../values.js";
export function rowTransaction(
	raw: Record<string, string>,
	sheet: TableSheet,
	kind: "trade" | "oldTrade" | "wallet",
	opts: ImportOptions,
	sourceRef: string,
	fileName: string,
): LedgerTx {
	if (raw.__extraColumns)
		throw new RowParseError("Row has more cells than the header.");
	const dateColumn = sheet.headers.find((v) => /^date/i.test(v)) ?? "";
	const fileTimezone = timezoneFromFileName(fileName);
	const timezoneExplicit =
		/UTC(?:\+0)?\)/i.test(dateColumn) || dateColumn === "UTC_Time";
	const tx = baseTransaction(
		"binance",
		sourceRef,
		parseTimestamp(
			raw[dateColumn] ?? "",
			"yyyy-MM-dd HH:mm:ss",
			fileTimezone ?? (timezoneExplicit ? "UTC" : opts.timezone),
			sheet.excelDate1904,
		),
		raw,
	);
	if (
		!fileTimezone &&
		((timezoneExplicit && opts.timezone !== "UTC") ||
			(/UTC(?!\)|\+0\))/i.test(dateColumn) && !timezoneExplicit))
	)
		tx.reviewFlags.push({
			code: "ambiguous_timezone",
			message:
				"Header timezone conflicts with the selected timezone or has an unsupported offset. Verify this timestamp.",
		});

	if (kind === "wallet") {
		if (
			!["completed", "successful"].includes(
				(raw.Status ?? "").trim().toLowerCase(),
			)
		) {
			tx.reviewFlags.push({
				code: "unknown_type",
				message:
					"Wallet row is not completed; original is preserved with no balance effect.",
			});
			return LedgerTxSchema.parse(tx);
		}
		const combined = sheet.headers.includes("TransactionFee");
		if (combined && !/deposit|withdraw/i.test(fileName))
			throw new RowParseError(
				"Combined wallet layout requires deposit/withdraw in the file name.",
			);
		const withdrawal = combined
			? /withdraw/i.test(fileName)
			: sheet.headers.includes("Fee");
		const amount = numberString(raw.Amount ?? "", true);
		const asset = (raw.Coin ?? "").toUpperCase();
		tx.type = withdrawal ? "withdrawal" : "deposit";
		if (withdrawal) {
			tx.assetOut = asset;
			tx.amountOut = amount;
			const fee = raw.Fee ?? raw.TransactionFee;
			if (fee?.trim()) {
				tx.feeAsset = asset;
				tx.feeAmount = numberString(fee, true);
				tx.reviewFlags.push({
					code: "parse_warning",
					message:
						"Withdrawal amount is treated as sent quantity and fee as additional; confirm against the exchange balance statement.",
				});
			}
		} else {
			tx.assetIn = asset;
			tx.amountIn = amount;
		}
		if (raw.TXID) tx.txHash = raw.TXID;
		if (raw.Network) tx.chain = raw.Network;
		return LedgerTxSchema.parse(tx);
	}
	const [base, quote] = splitPair(
		raw.Pair ?? raw.Market ?? "",
		raw["Quote Asset"] ? [raw["Quote Asset"]] : undefined,
	);
	if (raw["Base Asset"] && raw["Base Asset"].toUpperCase() !== base)
		throw new RowParseError("Base Asset does not match the pair.");
	const side = (raw.Side ?? raw.Type ?? "").toLowerCase();
	if (!["buy", "sell"].includes(side))
		throw new RowParseError("Unknown trade side.");
	const quantity =
		kind === "trade"
			? amountAsset(raw.Executed ?? "", base).amount
			: numberString(raw.Amount ?? "", true);
	const total =
		kind === "trade"
			? amountAsset(raw.Amount ?? "", quote).amount
			: numberString(raw.Total ?? "", true);
	tx.type = ["INR", "USD", "EUR", "GBP"].includes(quote)
		? (side as "buy" | "sell")
		: "swap";
	tx.assetIn = side === "buy" ? base : quote;
	tx.amountIn = side === "buy" ? quantity : total;
	tx.assetOut = side === "buy" ? quote : base;
	tx.amountOut = side === "buy" ? total : quantity;
	tx.priceQuote = tradePriceQuote(side, tx.type, quote, raw.Price ?? "");
	if (quote === "INR") {
		tx.inrValue = total;
		tx.inrRateSource = "trade_inr";
	}
	if (raw.Fee?.trim()) {
		const knownFeeAsset = [base, quote, "BNB", "BTC", "ETH", "USDT", "USDC"]
			.sort((a, b) => b.length - a.length)
			.find((asset) => raw.Fee?.trim().toUpperCase().endsWith(asset));
		const fee =
			kind === "trade"
				? amountAsset(raw.Fee, knownFeeAsset)
				: {
						amount: numberString(raw.Fee, true),
						asset: (raw["Fee Coin"] ?? "").toUpperCase(),
					};
		tx.feeAsset = fee.asset;
		tx.feeAmount = fee.amount;
		if (kind === "trade" && !knownFeeAsset)
			tx.reviewFlags.push({
				code: "parse_warning",
				message:
					"Fee asset was inferred from a concatenated cell; verify its symbol and quantity, especially symbols beginning with digits.",
			});
	}
	return LedgerTxSchema.parse(tx);
}
