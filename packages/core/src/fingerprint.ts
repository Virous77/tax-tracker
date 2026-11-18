import { D } from "./decimal.js";
import type { LedgerTx } from "./ledger.js";

export const venueForSource = (source: string): string =>
	source.replace(/-api$/, "");
export const venueForTransaction = (
	tx: Pick<LedgerTx, "source" | "venue">,
): string =>
	tx.source === "manual" && tx.venue ? tx.venue : venueForSource(tx.source);
export const normalizedTxHash = (hash: string): string =>
	hash.toLowerCase().replace(/^0x/, "");
export function siblingChannel(source: string): string | null {
	const venue = venueForSource(source);
	return venue === "binance" || venue === "coindcx"
		? source.endsWith("-api")
			? venue
			: `${venue}-api`
		: null;
}
export function eventFingerprint(
	tx: Omit<LedgerTx, "id" | "importId">,
): string | null {
	const venue = venueForSource(tx.source);
	const time = Date.parse(tx.timestamp);
	if (!Number.isFinite(time)) return null;
	if (["buy", "sell", "swap"].includes(tx.type)) {
		if (!tx.assetIn || !tx.amountIn || !tx.assetOut || !tx.amountOut)
			return null;
		// Side and both legs are retained: a buy and sell must never collapse together.
		const buy = tx.type === "buy";
		return [
			"trade",
			venue,
			Math.floor(time / 1000),
			buy ? tx.assetIn : tx.assetOut,
			buy ? tx.assetOut : tx.assetIn,
			tx.type,
			D(buy ? tx.amountIn : tx.amountOut).toFixed(),
			D(buy ? tx.amountOut : tx.amountIn).toFixed(),
		].join("|");
	}
	if (tx.type === "deposit" || tx.type === "withdrawal") {
		const asset = tx.type === "deposit" ? tx.assetIn : tx.assetOut;
		const amount = tx.type === "deposit" ? tx.amountIn : tx.amountOut;
		if (!asset || !amount) return null;
		return [
			"move",
			venue,
			asset,
			D(amount).toFixed(),
			tx.txHash ? normalizedTxHash(tx.txHash) : Math.floor(time / 60000),
		].join("|");
	}
	return null;
}
