import { D } from "@tax/core";
import type { ImportResult } from "./types.js";
export function recipeChecks(result: ImportResult) {
	const balances = new Map<string, string>();
	const negative = new Map<string, string>();
	const change = (asset: string | undefined, amount: string | undefined) => {
		if (
			!asset ||
			amount === undefined ||
			["INR", "USD", "EUR", "GBP"].includes(asset)
		)
			return;
		const next = D(balances.get(asset) ?? "0")
			.plus(amount)
			.toFixed();
		balances.set(asset, next);
		if (D(next).lt("0")) {
			const prior = negative.get(asset);
			if (!prior || D(next).lt(prior)) negative.set(asset, next);
		}
	};
	for (const tx of [...result.transactions].sort(
		(a, b) =>
			a.timestamp.localeCompare(b.timestamp) ||
			a.sourceRef.localeCompare(b.sourceRef),
	)) {
		change(tx.assetIn, tx.amountIn);
		change(
			tx.assetOut,
			tx.amountOut ? D(tx.amountOut).negated().toFixed() : undefined,
		);
		change(
			tx.feeAsset,
			tx.feeAmount ? D(tx.feeAmount).negated().toFixed() : undefined,
		);
	}
	return {
		datesOk: !result.rowErrors.some((error) => error.field === "date"),
		numbersOk: !result.rowErrors.some((error) => error.field === "number"),
		rowCountIn: result.rowsRead,
		rowCountOut: result.transactions.length,
		negativeBalances: [...negative].map(([asset, amount]) => ({
			asset,
			amount,
		})),
	};
}
