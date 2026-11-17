import {
	D,
	type EngineSettings,
	type LedgerTx,
	normalizedTxHash,
} from "@tax/core";
export interface TransferMatch {
	withdrawal: LedgerTx;
	deposit: LedgerTx;
	feeQuantity: string;
	ambiguous: boolean;
}
export function compareTransactions(a: LedgerTx, b: LedgerTx): number {
	return (
		Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
		compareText(a.source, b.source) ||
		compareText(a.sourceRef, b.sourceRef)
	);
}
export function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
export function matchTransfers(
	transactions: readonly LedgerTx[],
	settings: EngineSettings,
): TransferMatch[] {
	const sorted = [...transactions].sort(compareTransactions);
	const used = new Set<string>();
	const result: TransferMatch[] = [];
	const usedWithdrawals = new Set<string>();
	for (const withdrawal of sorted) {
		if (
			withdrawal.type !== "withdrawal" ||
			!withdrawal.txHash ||
			!withdrawal.amountOut
		)
			continue;
		const candidates = sorted.filter(
			(tx) =>
				tx.type === "deposit" &&
				tx.assetIn === withdrawal.assetOut &&
				tx.amountIn &&
				tx.txHash &&
				normalizedTxHash(tx.txHash) ===
					normalizedTxHash(withdrawal.txHash ?? "") &&
				!used.has(tx.id),
		);
		const deposit = candidates[0];
		if (!deposit) continue;
		used.add(deposit.id);
		usedWithdrawals.add(withdrawal.id);
		result.push({
			withdrawal,
			deposit,
			feeQuantity: D(withdrawal.amountOut)
				.minus(deposit.amountIn ?? "0")
				.toFixed(),
			ambiguous: candidates.length > 1,
		});
	}
	for (const withdrawal of sorted) {
		if (usedWithdrawals.has(withdrawal.id)) continue;
		if (withdrawal.type !== "withdrawal" || !withdrawal.amountOut) continue;
		const amount = D(withdrawal.amountOut);
		const minimum = amount.mul(D("1").minus(settings.transferAmountTolerance));
		const candidates = sorted.filter(
			(tx) =>
				tx.type === "deposit" &&
				!used.has(tx.id) &&
				tx.source !== withdrawal.source &&
				tx.assetIn === withdrawal.assetOut &&
				tx.amountIn !== undefined &&
				Date.parse(tx.timestamp) > Date.parse(withdrawal.timestamp) &&
				Date.parse(tx.timestamp) - Date.parse(withdrawal.timestamp) <=
					settings.transferMatchWindowHours * 3600000 &&
				D(tx.amountIn).gte(minimum) &&
				D(tx.amountIn).lte(amount),
		);
		const deposit = candidates[0];
		if (deposit) {
			used.add(deposit.id);
			result.push({
				withdrawal,
				deposit,
				feeQuantity: amount.minus(deposit.amountIn ?? "0").toFixed(),
				ambiguous:
					candidates.length > 1 ||
					sorted.some(
						(other) =>
							other.id !== withdrawal.id &&
							other.type === "withdrawal" &&
							other.assetOut === withdrawal.assetOut &&
							other.amountOut !== undefined &&
							other.source !== deposit.source &&
							Date.parse(other.timestamp) >= Date.parse(withdrawal.timestamp) &&
							Date.parse(other.timestamp) < Date.parse(deposit.timestamp) &&
							Date.parse(deposit.timestamp) - Date.parse(other.timestamp) <=
								settings.transferMatchWindowHours * 3600000 &&
							D(deposit.amountIn ?? "0").lte(other.amountOut) &&
							D(deposit.amountIn ?? "0").gte(
								D(other.amountOut).mul(
									D("1").minus(settings.transferAmountTolerance),
								),
							),
					),
			});
		}
	}
	return result;
}
