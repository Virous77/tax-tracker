import { D, type LedgerTx, LedgerTxSchema } from "@tax/core";
import {
	hasHeaders,
	type ReportContext,
	type ReportKind,
	type ReportRowResult,
} from "../reports.js";
import type { TableSheet } from "../types.js";
import {
	baseTransaction,
	canonical,
	numberString,
	parseTimestamp,
} from "../values.js";
import { BINANCE_HEADERS, BINANCE_INCOME } from "./headers.js";

const trades = new Set([
	"Transaction Buy",
	"Transaction Spend",
	"Transaction Sold",
	"Transaction Revenue",
	"Transaction Related",
	"Buy",
	"Sell",
]);
const fees = new Set(["Transaction Fee", "Fee", "BNB Fee Deduction"]);
const swaps = new Set([
	"Binance Convert",
	"Small assets exchange BNB",
	"Small Assets Exchange BNB",
	"ETH 2.0 Staking",
	"Stablecoins Auto-Conversion",
	"Asset Conversion Transfer",
	"Large OTC trading",
	"Buy Crypto With Card",
]);
const moves = new Set([
	"transfer_in",
	"transfer_out",
	"Transfer Between Main and Funding Wallet",
	"Transfer Between Spot Account and UM Futures Account",
	"Transfer Between Spot Account and CM Futures Account",
	"Transfer Between Main Account/Futures and Margin Account",
	"Simple Earn Flexible Subscription",
	"Simple Earn Flexible Redemption",
	"Simple Earn Locked Subscription",
	"Simple Earn Locked Redemption",
	"Staking Purchase",
	"Staking Redemption",
	"POS savings purchase",
	"POS savings redemption",
	"Savings purchase",
	"Savings Principal redemption",
	"Launchpool Subscription/Redemption",
	"Launchpool Subscription",
	"Launchpool Redemption",
]);
const deposits = new Set(["Deposit", "Fiat Deposit", "Buy Crypto"]);
const withdrawals = new Set([
	"Withdraw",
	"Fiat Withdraw",
	"Fiat Withdrawal",
	"Send",
]);
type Raw = Record<string, string>;
function base(
	raw: Raw,
	sheet: TableSheet,
	context: ReportContext,
	originals: LedgerTx["raw"] = raw,
) {
	return baseTransaction(
		"binance",
		context.reference(
			Array.isArray(originals)
				? [...originals].sort((a, b) =>
						canonical(a).localeCompare(canonical(b)),
					)
				: originals,
			raw["Transaction ID"],
		),
		parseTimestamp(
			raw.UTC_Time ?? "",
			"yyyy-MM-dd HH:mm:ss",
			context.options.timezone,
			sheet.excelDate1904,
		),
		originals,
	);
}
function review(
	raw: Raw,
	sheet: TableSheet,
	context: ReportContext,
	message: string,
	complex = false,
) {
	const tx = base(raw, sheet, context);
	// Catalogue §3: no monetary legs on review-only rows, so the engine cannot create spot disposals or lots.
	tx.reviewFlags.push({ code: "unknown_type", message });
	if (complex)
		tx.reviewFlags.push({
			code: "complex_onchain",
			message:
				"Futures, margin and options tax treatment is a CA question; this row is review-only.",
		});
	return LedgerTxSchema.parse(tx);
}
function parse(
	raw: Raw,
	sheet: TableSheet,
	context: ReportContext,
): ReportRowResult {
	const operation = raw.Operation ?? "";

	if (/futures|margin|options/i.test(raw.Account ?? ""))
		return review(
			raw,
			sheet,
			context,
			"Derivative or margin balance event; tax treatment is a CA question.",
			true,
		);
	if (moves.has(operation)) {
		const tx = base(raw, sheet, context);
		tx.type = "transfer";
		return LedgerTxSchema.parse(tx);
	}
	if (/funding fee|realized profit|loan|borrow|repay|margin/i.test(operation))
		return review(
			raw,
			sheet,
			context,
			"Derivative or margin balance event; tax treatment is a CA question.",
			true,
		);

	if (
		!BINANCE_INCOME[operation] &&
		!deposits.has(operation) &&
		!withdrawals.has(operation) &&
		!fees.has(operation)
	)
		return review(
			raw,
			sheet,
			context,
			"Unknown or unpaired statement operation; original preserved for review without a guessed tax classification.",
		);
	const change = numberString(raw.Change ?? "");
	const tx = base(raw, sheet, context);
	const asset = (raw.Coin ?? "").toUpperCase();
	const amount = D(change).abs().toFixed();
	const income = BINANCE_INCOME[operation];
	if (income && D(change).gt("0")) {
		tx.type = "income";
		tx.incomeKind = income;
		tx.assetIn = asset;
		tx.amountIn = amount;
	} else if (deposits.has(operation) && D(change).gt("0")) {
		tx.type = "deposit";
		tx.assetIn = asset;
		tx.amountIn = amount;
	} else if (withdrawals.has(operation) && D(change).lt("0")) {
		tx.type = "withdrawal";
		tx.assetOut = asset;
		tx.amountOut = amount;
	} else if (fees.has(operation) && D(change).lt("0")) {
		tx.type = "fee";
		tx.assetOut = asset;
		tx.amountOut = amount;
	} else
		return review(
			raw,
			sheet,
			context,
			"Unknown operation, unsupported sign, or ambiguous unpaired statement leg; check the original row before tax calculation.",
		);
	return LedgerTxSchema.parse(tx);
}
function prepare(sheet: TableSheet, context: ReportContext) {
	const results = new Map<Raw, ReportRowResult>();
	const groups = new Map<string, Raw[]>();
	for (const raw of sheet.rows) {
		if (/futures|margin|options/i.test(raw.Account ?? "")) continue;
		const op = raw.Operation ?? "";
		const category =
			trades.has(op) || fees.has(op)
				? "trade"
				: swaps.has(op)
					? op.toLowerCase()
					: undefined;
		if (!category) continue;
		const key = canonical([raw.UTC_Time, raw.Account, category]);
		const group = groups.get(key) ?? [];
		group.push(raw);
		groups.set(key, group);
	}
	for (const group of groups.values()) {
		try {
			const positive = group.filter(
				(r) =>
					!fees.has(r.Operation ?? "") &&
					D(numberString(r.Change ?? "")).gt("0"),
			);
			const negative = group.filter(
				(r) =>
					!fees.has(r.Operation ?? "") &&
					D(numberString(r.Change ?? "")).lt("0"),
			);
			const feeRows = group.filter((r) => fees.has(r.Operation ?? ""));
			const received = positive[0];
			const spent = negative[0];
			if (
				!received ||
				!spent ||
				positive.length !== 1 ||
				negative.length !== 1 ||
				feeRows.length > 1 ||
				group.length !== 2 + feeRows.length ||
				received.Coin === spent.Coin
			) {
				if (
					group.some(
						(r) =>
							trades.has(r.Operation ?? "") || swaps.has(r.Operation ?? ""),
					)
				)
					for (const row of group)
						results.set(
							row,
							review(
								row,
								sheet,
								context,
								"Statement has non-unique or incomplete trade legs; use dedicated Trade History or review the originals before classification.",
							),
						);
				continue;
			}
			const tx = base(received, sheet, context, group);
			tx.type = "swap";
			tx.assetIn = received.Coin?.toUpperCase();
			tx.amountIn = numberString(received.Change ?? "");
			tx.assetOut = spent.Coin?.toUpperCase();
			tx.amountOut = D(numberString(spent.Change ?? ""))
				.abs()
				.toFixed();
			if (tx.assetOut === "INR" || tx.assetIn === "INR") {
				tx.type = tx.assetOut === "INR" ? "buy" : "sell";
				tx.inrValue = tx.assetOut === "INR" ? tx.amountOut : tx.amountIn;
				tx.inrRateSource = "trade_inr";
			} else
				tx.priceQuote = {
					asset: tx.assetIn ?? "",
					price: D(tx.amountIn).div(tx.amountOut).toFixed(),
				};
			const fee = feeRows[0];
			if (fee) {
				if (D(numberString(fee.Change ?? "")).gt("0")) continue;
				tx.feeAsset = fee.Coin?.toUpperCase();
				tx.feeAmount = numberString(fee.Change ?? "", true);
			}
			const first = group[0];
			if (!first) continue;
			results.set(first, LedgerTxSchema.parse(tx));
			for (const row of group.slice(1))
				results.set(row, {
					skip: "Statement leg is preserved in the grouped transaction raw rows.",
				});
		} catch {
			// Invalid or non-unique groups stay as individual review rows; no candidate pairing is guessed.
		}
	}
	return (raw: Raw) => results.get(raw) ?? parse(raw, sheet, context);
}
export const reportKind: ReportKind = {
	verified: true,
	id: "binance:transaction-history",
	timezone: "UTC",
	detect: (sheet) => hasHeaders(sheet, BINANCE_HEADERS.statement),
	prepare,
	parse,
};
