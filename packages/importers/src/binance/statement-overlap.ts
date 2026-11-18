import { D, type LedgerTx } from "@tax/core";
import { canonical, numberString } from "../values.js";
import {
	isStatementTradeFee,
	statementTradeCategory,
} from "./transaction-history.js";

export function ambiguousStatementGroup(tx: LedgerTx): string | undefined {
	if (
		tx.assetIn ||
		tx.assetOut ||
		tx.feeAsset ||
		!tx.reviewFlags.some(
			(flag) =>
				flag.code === "unknown_type" &&
				flag.message.startsWith(
					"Statement has non-unique or incomplete trade legs",
				),
		) ||
		!tx.raw ||
		typeof tx.raw !== "object"
	)
		return undefined;
	const raw = tx.raw as Record<string, string>;
	return raw.Account === "Spot"
		? statementTradeCategory(raw.Operation ?? "")
		: undefined;
}

function leg(asset: string, amount: string, kind: "fee" | "in" | "out") {
	return canonical([asset.toUpperCase(), D(amount).abs().toFixed(), kind]);
}

export function matchStatementLegs(
	statement: LedgerTx[],
	dedicated: LedgerTx[],
): { statement: LedgerTx; dedicated: LedgerTx }[] {
	const legs = new Map<string, LedgerTx[]>();
	const add = (key: string, tx: LedgerTx) => {
		const matches = legs.get(key) ?? [];
		matches.push(tx);
		legs.set(key, matches);
	};
	for (const tx of dedicated) {
		if (!tx.assetIn || !tx.amountIn || !tx.assetOut || !tx.amountOut) return [];
		add(leg(tx.assetIn, tx.amountIn, "in"), tx);
		add(leg(tx.assetOut, tx.amountOut, "out"), tx);
		if (tx.feeAsset && tx.feeAmount && D(tx.feeAmount).gt("0"))
			add(leg(tx.feeAsset, tx.feeAmount, "fee"), tx);
	}
	const matched: { statement: LedgerTx; dedicated: LedgerTx }[] = [];
	for (const tx of statement) {
		const raw = tx.raw as Record<string, string>;
		if (!raw.Coin) return [];
		try {
			const change = D(numberString(raw.Change ?? ""));
			const fee = isStatementTradeFee(raw.Operation ?? "");
			if (change.isZero() || (fee && change.isPositive())) return [];
			const match = legs
				.get(
					leg(
						raw.Coin,
						change.toFixed(),
						fee ? "fee" : change.gt("0") ? "in" : "out",
					),
				)
				?.shift();
			if (!match) return [];
			matched.push({ statement: tx, dedicated: match });
		} catch {
			return [];
		}
	}
	return [...legs.values()].every((remaining) => !remaining.length)
		? matched
		: [];
}
