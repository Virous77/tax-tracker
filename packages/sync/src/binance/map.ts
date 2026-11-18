import { D, type IncomeKind } from "@tax/core";
import {
	type ApiRow,
	amount,
	base,
	FIAT,
	fee,
	iso,
	type SyncTx,
	stableHash,
	text,
	trade,
	unknownRow,
	validated,
} from "../values.js";
export interface SymbolInfo {
	symbol: string;
	baseAsset: string;
	quoteAsset: string;
}
const start = (raw: ApiRow, ref: string, time: string) =>
	base("binance-api", ref, iso(time), raw);
export function mapBinanceTrade(raw: ApiRow, market: SymbolInfo): SyncTx {
	const tx = start(
		raw,
		`trade:${market.symbol}:${text(raw, "id")}`,
		text(raw, "time"),
	);
	if (typeof raw.isBuyer !== "boolean")
		return unknownRow(tx, "Unknown isBuyer value");
	trade(
		tx,
		raw.isBuyer ? "buy" : "sell",
		market.baseAsset,
		market.quoteAsset,
		amount(raw, "qty"),
		amount(raw, "quoteQty"),
		amount(raw, "price"),
	);
	fee(tx, text(raw, "commissionAsset"), amount(raw, "commission"));
	return validated(tx);
}
export function mapBinanceDeposit(raw: ApiRow): SyncTx | null {
	const status = text(raw, "status");
	if (["0", "2", "7", "8"].includes(status)) return null;
	const tx = start(raw, `deposit:${text(raw, "id")}`, text(raw, "insertTime"));
	if (!["1", "6"].includes(status))
		return unknownRow(tx, "Unknown deposit status");
	return validated({
		...tx,
		type: "deposit",
		assetIn: text(raw, "coin"),
		amountIn: amount(raw, "amount"),
		txHash: text(raw, "txId"),
		chain: typeof raw.network === "string" ? raw.network : undefined,
	});
}
export function mapBinanceWithdrawal(raw: ApiRow): SyncTx | null {
	const status = text(raw, "status");
	if (["0", "2", "3", "4"].includes(status)) return null;
	const tx = start(raw, `withdraw:${text(raw, "id")}`, text(raw, "applyTime"));
	if (status !== "6") return unknownRow(tx, "Unknown withdrawal status");
	return validated({
		...tx,
		type: "withdrawal",
		assetOut: text(raw, "coin"),
		amountOut: amount(raw, "amount"),
		feeAsset: text(raw, "coin"),
		feeAmount: amount(raw, "transactionFee"),
		txHash: text(raw, "txId"),
		chain: typeof raw.network === "string" ? raw.network : undefined,
	});
}
export function mapBinanceConvert(raw: ApiRow): SyncTx | null {
	if (
		["PROCESS", "FAIL", "FAILED", "PENDING"].includes(String(raw.orderStatus))
	)
		return null;
	const tx = start(
		raw,
		`convert:${text(raw, "orderId")}`,
		text(raw, "createTime"),
	);
	if (raw.orderStatus !== "SUCCESS")
		return unknownRow(tx, "Unknown Convert order status");
	const outgoing = text(raw, "fromAsset"),
		incoming = text(raw, "toAsset");
	if (typeof raw.ratio === "string")
		tx.priceQuote = { asset: incoming, price: amount(raw, "ratio") };
	return validated({
		...tx,
		type: FIAT.has(outgoing) ? "buy" : FIAT.has(incoming) ? "sell" : "swap",
		assetIn: incoming,
		amountIn: amount(raw, "toAmount"),
		assetOut: outgoing,
		amountOut: amount(raw, "fromAmount"),
		...(outgoing === "INR" || incoming === "INR"
			? {
					inrValue: amount(raw, outgoing === "INR" ? "fromAmount" : "toAmount"),
					inrRateSource: "trade_inr" as const,
				}
			: {}),
	});
}
export function mapBinanceDust(raw: ApiRow, parent: ApiRow): SyncTx {
	const tx = start(
		raw,
		`dust:${text(parent, "transId")}:${text(raw, "transId")}`,
		text(raw, "operateTime"),
	);
	return validated({
		...tx,
		type: "swap",
		assetIn: typeof raw.targetAsset === "string" ? raw.targetAsset : "BNB",
		amountIn: D(amount(raw, "transferedAmount"))
			.plus(amount(raw, "serviceChargeAmount"))
			.toFixed(),
		assetOut: text(raw, "fromAsset"),
		amountOut: amount(raw, "amount"),
		feeAsset: "BNB",
		feeAmount: amount(raw, "serviceChargeAmount"),
	});
}
const income: Record<string, IncomeKind> = Object.fromEntries(
	[
		...[
			"Simple Earn Flexible Interest",
			"Savings Interest",
			"Savings distribution",
			"Pool Distribution",
			"Launchpool Interest",
		].map((v) => [v, "interest"]),
		...[
			"Staking Rewards",
			"ETH 2.0 Staking Rewards",
			"Simple Earn Locked Rewards",
			"POS savings interest",
			"BNB Vault Rewards",
			"Swap Farming Rewards",
			"Liquid Swap rewards",
		].map((v) => [v, "staking"]),
		...[
			"Airdrop Assets",
			"Distribution",
			"Simple Earn Flexible Airdrop",
			"HODLer Airdrops Distribution",
			"Launchpool Airdrop",
			"Megadrop Rewards",
			"Cash Voucher distribution",
			"Campaign Related Reward",
		].map((v) => [v, "airdrop"]),
		...[
			"Commission Rebate",
			"Commission History",
			"Referral Kickback",
			"Referral Commission",
			"Referrer rebates",
			"Commission Fee Shared With You",
		].map((v) => [v, "referral"]),
		["Super BNB Mining", "mining"],
	].map(([description, kind]) => [String(description).toLowerCase(), kind]),
) as Record<string, IncomeKind>;
export function mapBinanceDividend(raw: ApiRow): SyncTx {
	const tx = start(raw, `dividend:${text(raw, "id")}`, text(raw, "divTime"));
	if (text(raw, "direction") !== "1")
		return unknownRow(
			tx,
			"Unknown dividend direction; classify this receipt manually",
		);
	const kind = income[String(raw.enInfo).trim().toLowerCase()];
	if (!kind)
		tx.reviewFlags.push({
			code: "unknown_type",
			message:
				"Unknown dividend description; receipt retained as other income pending review",
		});
	return validated({
		...tx,
		type: "income",
		incomeKind: kind ?? "other",
		assetIn: text(raw, "asset"),
		amountIn: amount(raw, "amount"),
	});
}
export function mapBinanceFiatOrder(
	raw: ApiRow,
	direction: "0" | "1",
): SyncTx | null {
	if (
		["Processing", "Failed", "Refunded", "Cancelled"].includes(
			String(raw.status),
		)
	)
		return null;
	const tx = start(
		raw,
		`fiat:${text(raw, "orderNo")}`,
		text(raw, "createTime"),
	);
	if (!["Successful", "Completed", "Finished"].includes(String(raw.status)))
		return unknownRow(tx, "Unknown fiat order status");
	const asset = text(raw, "fiatCurrency"),
		value = amount(raw, "amount");
	return validated({
		...tx,
		type: direction === "0" ? "deposit" : "withdrawal",
		...(direction === "0"
			? { assetIn: asset, amountIn: value }
			: { assetOut: asset, amountOut: value }),
		feeAsset: asset,
		feeAmount: amount(raw, "totalFee"),
	});
}
export function mapBinanceFiatPayment(
	raw: ApiRow,
	direction: "0" | "1",
): SyncTx | null {
	if (["Processing", "Failed", "Refunded"].includes(String(raw.status)))
		return null;
	const tx = start(
		raw,
		`fiatpay:${text(raw, "orderNo")}`,
		text(raw, "createTime"),
	);
	if (raw.status !== "Completed")
		return unknownRow(tx, "Unknown fiat payment status");
	trade(
		tx,
		direction === "0" ? "buy" : "sell",
		text(raw, "cryptoCurrency"),
		text(raw, "fiatCurrency"),
		amount(raw, "obtainAmount"),
		amount(raw, "sourceAmount"),
		amount(raw, "price"),
	);
	fee(tx, text(raw, "fiatCurrency"), amount(raw, "totalFee"));
	return validated(tx);
}
export function mapBinanceP2p(input: ApiRow): SyncTx | null {
	if (
		[
			"CANCELLED",
			"CANCELLED_BY_SYSTEM",
			"IN_TRADING",
			"TRADING",
			"APPEALING",
		].includes(String(input.orderStatus))
	)
		return null;
	// Only deliberately redacted raw field: third-party personal data (research §1.3).
	const raw: ApiRow = {
		...input,
		...(input.counterPartNickName !== undefined
			? { counterPartNickName: "<removed>" }
			: {}),
	};
	const tx = start(
		raw,
		`p2p:${text(raw, "orderNumber")}`,
		text(raw, "createTime"),
	);
	if (
		raw.orderStatus !== "COMPLETED" ||
		!["BUY", "SELL"].includes(String(raw.tradeType))
	)
		return unknownRow(tx, "Unknown P2P status or trade type");
	trade(
		tx,
		String(raw.tradeType).toLowerCase(),
		text(raw, "asset"),
		text(raw, "fiat"),
		amount(raw, "amount"),
		amount(raw, "totalPrice"),
		amount(raw, "unitPrice"),
	);
	fee(tx, text(raw, "asset"), amount(raw, "commission"));
	return validated(tx);
}
export function mapBinanceEarnAudit(raw: ApiRow, kind: string): SyncTx {
	const tx = start(
		raw,
		`earn-audit:${kind}:${stableHash(raw)}`,
		text(raw, "time"),
	);
	const known = ["BONUS", "REALTIME", "REWARDS", "ALL", "INTEREST"].includes(
		String(raw.type),
	);
	tx.reviewFlags.push({
		code: "unknown_type",
		message: known
			? "Earn audit row has no separate balance effect."
			: "Unknown Earn reward type; audit row needs review.",
	});
	return validated({
		...tx,
		reviewFlags: [
			...tx.reviewFlags,
			{
				code: "parse_warning",
				message:
					"Earn reward retained for cross-check only because Binance Distribution History may already include it.",
			},
		],
	});
}
export function discoverSymbols(
	info: SymbolInfo[],
	knownAssets: Iterable<string>,
	extraSymbols: string[],
): SymbolInfo[] {
	const assets = new Set([...knownAssets].map((asset) => asset.toUpperCase()));
	const selected = new Map(
		info
			.filter((row) => assets.has(row.baseAsset) && assets.has(row.quoteAsset))
			.map((row) => [row.symbol, row]),
	);
	for (const symbol of extraSymbols) {
		const market = info.find((row) => row.symbol === symbol.toUpperCase());
		if (market) selected.set(market.symbol, market);
	}
	return [...selected.values()].sort((a, b) =>
		a.symbol.localeCompare(b.symbol),
	);
}
