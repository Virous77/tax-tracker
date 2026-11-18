import {
	D,
	type EngineSettings,
	type LedgerTx,
	LedgerTxSchema,
	venueForTransaction,
} from "@tax/core";
import { matchTransfers } from "./matching.js";
import { FIAT } from "./valuation.js";

export function computeHoldings(input: {
	transactions: LedgerTx[];
	settings: EngineSettings;
	asOf: string;
}): { asset: string; venue: string; quantity: string }[] {
	const asOf = Date.parse(input.asOf);
	if (!Number.isFinite(asOf)) throw new Error("Invalid holdings date");
	const txs = input.transactions
		.map((tx) => LedgerTxSchema.parse(tx))
		.filter(
			(tx) =>
				Date.parse(tx.timestamp) <= asOf &&
				!tx.reviewFlags.some((f) => f.code === "suspected_spam"),
		);
	const matches = new Map(
		matchTransfers(txs, input.settings).map((m) => [m.withdrawal.id, m]),
	);
	const rows = new Map<
		string,
		{ asset: string; venue: string; quantity: string }
	>();
	const change = (
		asset: string | undefined,
		venue: string,
		amount: string | undefined,
	) => {
		if (!asset || !amount || FIAT.has(asset)) return;
		const key = JSON.stringify([asset, venue]);
		const row = rows.get(key) ?? { asset, venue, quantity: "0" };
		row.quantity = D(row.quantity).plus(amount).toFixed();
		rows.set(key, row);
	};
	for (const tx of txs) {
		const venue = venueForTransaction(tx);
		change(tx.assetIn, venue, tx.amountIn);
		change(
			tx.assetOut,
			venue,
			tx.amountOut ? D(tx.amountOut).negated().toFixed() : undefined,
		);
		if (tx.feeAsset && tx.feeAmount) {
			const match = matches.get(tx.id);
			const included =
				match && tx.feeAsset === tx.assetOut ? D(match.feeQuantity) : D("0");
			const extra = D(tx.feeAmount).minus(included.gt("0") ? included : "0");
			if (extra.gt("0")) change(tx.feeAsset, venue, extra.negated().toFixed());
		}
	}
	return [...rows.values()].sort(
		(a, b) => a.asset.localeCompare(b.asset) || a.venue.localeCompare(b.venue),
	);
}
