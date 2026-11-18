import { type LedgerTx, venueForSource } from "@tax/core";
import type { TaxDatabase } from "@tax/db";
import { reconcileReportKinds, transactionReportKind } from "@tax/importers";

// Reconciliation sees a header projection of API rows; persistence always keeps the original raw row.
function reconciliationView(tx: LedgerTx): LedgerTx {
	const source = venueForSource(tx.source);
	const raw =
		tx.raw && typeof tx.raw === "object"
			? (tx.raw as Record<string, unknown>)
			: {};
	let projection: Record<string, unknown> | undefined;
	if (tx.source === "binance-api") {
		if (tx.sourceRef.startsWith("trade:") && typeof raw.isBuyer === "boolean") {
			projection = {
				"Date(UTC)": tx.timestamp,
				Pair: tx.sourceRef.split(":")[1],
				Side: raw.isBuyer ? "BUY" : "SELL",
				Price: raw.price,
				Executed: raw.qty,
				Amount: raw.quoteQty,
				Fee: raw.commission,
			};
		} else if (tx.type === "deposit" || tx.type === "withdrawal") {
			projection = {
				"Date(UTC+0)": tx.timestamp,
				Coin: raw.coin,
				Network: raw.network,
				Amount: raw.amount,
				Address: raw.address,
				TXID: raw.txId,
				Status: "Completed",
				...(tx.type === "withdrawal" ? { Fee: raw.transactionFee } : {}),
			};
		} else if (tx.sourceRef.startsWith("convert:")) {
			projection = {
				Date: tx.timestamp,
				Pair: `${tx.assetOut}/${tx.assetIn}`,
				Type: "Convert",
				Sell: raw.fromAmount,
				Buy: raw.toAmount,
				Price: raw.ratio,
				"Inverse Price": raw.inverseRatio,
				"Date Updated": tx.timestamp,
				Status: "Successful",
			};
		}
	} else if (tx.source === "coindcx-api") {
		projection = {
			"Order ID": raw.order_id ?? raw.orderId,
			"Trade ID": raw.id,
			"Crypto Pair": raw.symbol,
			"Base currency": tx.priceQuote?.asset,
			"Trade Completion time": tx.timestamp,
			"Side (Buy/Sell)": raw.side,
			Quantity: raw.quantity,
			"Gross Amount Paid/Received by the user(in base currency)": raw.total,
			"Avg Buying/Selling Price(in base currency)": raw.price,
		};
	}
	return {
		...tx,
		source,
		sourceRef: JSON.stringify([tx.source, tx.sourceRef]),
		raw: projection ?? tx.raw,
	};
}

export function insertReconciled(
	db: TaxDatabase,
	importId: string,
	rows: { tx: LedgerTx; rawRowId?: string }[],
) {
	if (!rows.length) return { inserted: 0, duplicate: 0 };
	const incoming = rows.map(({ tx }) => reconciliationView(tx));
	const venues = new Set(incoming.map((tx) => tx.source));
	const existing = db.transactions
		.active()
		.filter((tx) => venues.has(venueForSource(tx.source)))
		.map(reconciliationView);
	const category = (tx: LedgerTx) => {
		const kind = transactionReportKind(tx);
		return kind &&
			[
				"binance:spot-trade-history",
				"binance:legacy-spot-trade-history",
				"binance:spot-trade-history-assets",
			].includes(kind)
			? "binance:fill"
			: kind;
	};
	const preDuplicates = new Map(
		db.transactions
			.matchDuplicates(rows.map(({ tx }) => tx))
			.filter(({ incomingId, existingId }) => {
				const next = incoming.find((tx) => tx.id === incomingId),
					previous = existing.find((tx) => tx.id === existingId);
				return (
					next &&
					previous &&
					category(next) !== undefined &&
					category(next) === category(previous)
				);
			})
			.map(({ incomingId, existingId }) => [incomingId, existingId]),
	);
	const result = reconcileReportKinds(
		existing,
		incoming.filter((tx) => !preDuplicates.has(tx.id)),
	);
	const duplicates = new Map(
		result.duplicates.map((row) => [row.incomingRef, row.existingId]),
	);
	const ambiguous = new Map(
		result.ambiguous.map((row) => [row.incomingRef, row.candidates]),
	);
	const replacements = new Set(
		result.supersede.flatMap((row) => row.byIncomingRefs),
	);
	return db.atomic(() => {
		for (const row of result.supersede)
			db.transactions.supersede(row.existingId, importId);
		const writes = rows.map(({ tx, rawRowId }, index) => {
			const ref = incoming[index]?.sourceRef ?? "";
			const candidates = ambiguous.get(ref);
			return {
				tx: candidates
					? {
							...tx,
							reviewFlags: [
								...tx.reviewFlags,
								{
									code: "possible_duplicate" as const,
									message: `Possible report-kind duplicate; review candidate transactions: ${candidates.join(", ")}.`,
								},
							],
						}
					: tx,
				rawRowId,
				duplicateOf: preDuplicates.get(tx.id) ?? duplicates.get(ref),
				skipCrossChannel: replacements.has(ref) || Boolean(candidates),
			};
		});
		return db.transactions.insert(
			writes.sort(
				(a, b) =>
					Number(Boolean(a.duplicateOf)) - Number(Boolean(b.duplicateOf)),
			),
		);
	});
}
