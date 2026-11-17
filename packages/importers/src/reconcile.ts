import { D, type LedgerTx } from "@tax/core";
import { binanceReportKinds } from "./binance/index.js";
import { coindcxReportKinds } from "./coindcx/index.js";
import { canonical, parseTimestamp } from "./values.js";

export interface ReportReconciliation {
	insert: LedgerTx[];
	supersede: { existingId: string; byIncomingRefs: string[] }[];
	duplicates: { incomingRef: string; existingId: string }[];
	ambiguous: { incomingRef: string; candidates: string[] }[];
}
function rawRecord(tx: LedgerTx): Record<string, string> {
	const raw = Array.isArray(tx.raw) ? tx.raw[0] : tx.raw;
	return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
}
export function transactionReportKind(tx: LedgerTx): string | undefined {
	const raw = rawRecord(tx);
	const kinds =
		tx.source === "binance"
			? binanceReportKinds
			: tx.source === "coindcx"
				? coindcxReportKinds
				: [];
	return kinds.find((kind) =>
		kind.detect({ name: "", headers: Object.keys(raw), rows: [] }),
	)?.id;
}
function compare(a: LedgerTx, b: LedgerTx): number {
	return (
		a.timestamp.localeCompare(b.timestamp) ||
		a.source.localeCompare(b.source) ||
		a.sourceRef.localeCompare(b.sourceRef) ||
		a.id.localeCompare(b.id)
	);
}
function isOrder(tx: LedgerTx) {
	return ["binance:spot-order-history", "coindcx:order-history"].includes(
		transactionReportKind(tx) ?? "",
	);
}
function isFill(tx: LedgerTx) {
	return [
		"binance:spot-trade-history",
		"binance:legacy-spot-trade-history",
		"binance:spot-trade-history-assets",
		"coindcx:spot-orders",
	].includes(transactionReportKind(tx) ?? "");
}
function sameDirection(a: LedgerTx, b: LedgerTx) {
	return (
		a.source === b.source &&
		a.type === b.type &&
		a.assetIn === b.assetIn &&
		a.assetOut === b.assetOut
	);
}
function quantity(tx: LedgerTx) {
	const raw = rawRecord(tx);
	const side = (
		raw.Side ??
		raw["Side (Buy/Sell)"] ??
		raw.Type ??
		""
	).toLowerCase();
	return side === "buy" ? tx.amountIn : tx.amountOut;
}
function fillCandidates(order: LedgerTx, fills: LedgerTx[]) {
	const raw = rawRecord(order);
	let start = 0;
	if (order.source === "binance") {
		try {
			const updated = parseTimestamp(
				raw["Time#2"] ?? "",
				"yyyy-MM-dd HH:mm:ss",
				"UTC",
			);
			const created = parseTimestamp(
				raw.Time ?? "",
				"yyyy-MM-dd HH:mm:ss",
				"UTC",
			);
			start =
				Date.parse(order.timestamp) -
				(Date.parse(updated) - Date.parse(created));
		} catch {
			return [];
		}
	}
	return fills.filter((fill) => {
		if (!sameDirection(order, fill)) return false;
		const fillRaw = rawRecord(fill);
		if (order.source === "coindcx")
			return Boolean(
				raw["Order ID"] && fillRaw["Order ID"] === raw["Order ID"],
			);
		return (
			(raw.Pair ?? "").toUpperCase() ===
				(fillRaw.Pair ?? fillRaw.Market ?? "").toUpperCase() &&
			(raw.Side ?? "").toLowerCase() ===
				(fillRaw.Side ?? fillRaw.Type ?? "").toLowerCase() &&
			Date.parse(fill.timestamp) >= start &&
			fill.timestamp <= order.timestamp
		);
	});
}
function complete(order: LedgerTx, fills: LedgerTx[]) {
	const amount = quantity(order);
	return Boolean(
		amount &&
			fills.length &&
			fills.every((f) => quantity(f) !== undefined) &&
			D(amount).eq(
				fills.reduce((sum, fill) => sum.plus(quantity(fill) ?? "0"), D("0")),
			),
	);
}
function sameAmount(a?: string, b?: string) {
	return a === undefined || b === undefined ? a === b : D(a).eq(b);
}
function sameEvent(a: LedgerTx, b: LedgerTx) {
	return (
		sameDirection(a, b) &&
		sameAmount(a.amountIn, b.amountIn) &&
		sameAmount(a.amountOut, b.amountOut)
	);
}
function statementFamily(tx: LedgerTx) {
	if (transactionReportKind(tx) !== "binance:transaction-history")
		return undefined;
	if (tx.type === "deposit") return "deposit";
	if (tx.type === "withdrawal") return "withdrawal";
	if (["buy", "sell", "swap"].includes(tx.type)) {
		const op = rawRecord(tx).Operation;
		return op === "Binance Convert"
			? "convert"
			: /^(Transaction |Buy$|Sell$)/.test(op ?? "")
				? "trade"
				: undefined;
	}
	return undefined;
}
function dedicatedFamily(tx: LedgerTx) {
	const kind = transactionReportKind(tx);
	if (isFill(tx) || kind === "binance:spot-order-history") return "trade";
	if (kind === "binance:convert") return "convert";
	if (
		[
			"binance:deposits",
			"binance:withdrawals",
			"binance:wallet-history",
			"binance:fiat",
		].includes(kind ?? "")
	)
		return tx.type === "deposit" || tx.type === "withdrawal"
			? tx.type
			: undefined;
	return undefined;
}
function statementMatches(dedicated: LedgerTx, statement: LedgerTx) {
	if (dedicated.txHash && statement.txHash)
		return (
			dedicated.txHash.toLowerCase().replace(/^0x/, "") ===
				statement.txHash.toLowerCase().replace(/^0x/, "") &&
			sameDirection(dedicated, statement)
		);
	if (dedicated.timestamp !== statement.timestamp) return false;
	return (
		sameEvent(dedicated, statement) ||
		(dedicated.type === "withdrawal" &&
			statement.type === "withdrawal" &&
			sameDirection(dedicated, statement) &&
			dedicated.feeAsset === dedicated.assetOut &&
			dedicated.amountOut !== undefined &&
			statement.amountOut !== undefined &&
			D(dedicated.amountOut)
				.plus(dedicated.feeAmount ?? "0")
				.eq(statement.amountOut))
	);
}

/** Catalogue §1.9 / §2.8. Results describe changes; neither input nor its raw originals are mutated. */
export function reconcileReportKinds(
	existing: LedgerTx[],
	incoming: LedgerTx[],
): ReportReconciliation {
	const old = [...existing].sort(compare);
	const fresh = [...incoming].sort(compare);
	const result: ReportReconciliation = {
		insert: [],
		supersede: [],
		duplicates: [],
		ambiguous: [],
	};
	const blocked = new Set<LedgerTx>();
	const duplicate = (tx: LedgerTx, other: LedgerTx) => {
		blocked.add(tx);
		result.duplicates.push({ incomingRef: tx.sourceRef, existingId: other.id });
	};
	const ambiguity = (tx: LedgerTx, rows: LedgerTx[]) => {
		const candidates = [...new Set(rows.map((r) => r.id))].sort();
		const previous = result.ambiguous.find(
			(r) => r.incomingRef === tx.sourceRef,
		);
		if (previous)
			previous.candidates = [
				...new Set([...previous.candidates, ...candidates]),
			].sort();
		else result.ambiguous.push({ incomingRef: tx.sourceRef, candidates });
	};
	const supersede = (tx: LedgerTx, by: LedgerTx[]) => {
		const refs = [...new Set(by.map((r) => r.sourceRef))].sort();
		const previous = result.supersede.find((r) => r.existingId === tx.id);
		if (previous)
			previous.byIncomingRefs = [
				...new Set([...previous.byIncomingRefs, ...refs]),
			].sort();
		else result.supersede.push({ existingId: tx.id, byIncomingRefs: refs });
	};
	const identities = new Map(
		old.map((tx) => [canonical([tx.source, tx.sourceRef]), tx]),
	);
	for (const tx of fresh) {
		const key = canonical([tx.source, tx.sourceRef]);
		const match = identities.get(key);
		if (match) duplicate(tx, match);
		else identities.set(key, tx);
	}
	const available = fresh.filter((tx) => !blocked.has(tx));
	const allFills = [...old, ...available].filter(isFill);
	const allOrders = [...old, ...available].filter(isOrder);
	const matches = allOrders.map((order) => ({
		order,
		fills: fillCandidates(order, allFills),
	}));
	for (const { order, fills } of matches) {
		if (!fills.length) {
			if (order.source === "coindcx") {
				const fingerprints = allFills.filter(
					(fill) =>
						fill.timestamp === order.timestamp && sameEvent(order, fill),
				);
				if (available.includes(order) && fingerprints.length)
					ambiguity(order, fingerprints);
				for (const fill of fingerprints.filter((tx) => available.includes(tx)))
					ambiguity(fill, [order]);
			}
			continue;
		}
		const competing = matches.filter(
			(m) => m.order !== order && m.fills.some((fill) => fills.includes(fill)),
		);
		const incomingFills = fills.filter((fill) => available.includes(fill));
		if (!complete(order, fills) || competing.length) {
			if (available.includes(order)) ambiguity(order, fills);
			for (const fill of incomingFills)
				ambiguity(fill, [order, ...competing.map((m) => m.order)]);
			continue;
		}
		if (old.includes(order) && incomingFills.length)
			supersede(order, incomingFills);
		else if (available.includes(order)) {
			const first = fills[0];
			if (first) duplicate(order, first);
		}
	}
	// Dedicated histories win only inside their observed range and for an unambiguous matching event.
	const claimed = new Set<LedgerTx>();
	const statements = [...old, ...available].filter((tx) => statementFamily(tx));
	for (const statement of statements) {
		const dedicated = (
			old.includes(statement) ? available : [...old, ...available]
		).filter(
			(tx) =>
				!blocked.has(tx) &&
				!result.supersede.some((s) => s.existingId === tx.id) &&
				tx.source === statement.source &&
				dedicatedFamily(tx) === statementFamily(statement),
		);
		if (!dedicated.length) continue;
		const times = dedicated.map((tx) => tx.timestamp).sort();
		if (
			statement.timestamp < (times[0] ?? "") ||
			statement.timestamp > (times.at(-1) ?? "")
		)
			continue;
		const candidates = dedicated.filter(
			(tx) => !claimed.has(tx) && statementMatches(tx, statement),
		);
		const competitors = statements.filter(
			(other) =>
				other !== statement &&
				other.source === statement.source &&
				statementFamily(other) === statementFamily(statement) &&
				candidates.some((tx) => statementMatches(tx, other)),
		);
		if (competitors.length) {
			if (available.includes(statement)) ambiguity(statement, candidates);
			for (const tx of candidates.filter((tx) => available.includes(tx)))
				ambiguity(tx, [statement, ...competitors]);
			continue;
		}
		const match = candidates[0];
		if (candidates.length === 1 && match) {
			claimed.add(match);
			if (old.includes(statement)) supersede(statement, [match]);
			else duplicate(statement, match);
		} else {
			if (available.includes(statement))
				ambiguity(statement, candidates.length ? candidates : dedicated);
			else
				for (const tx of candidates.length ? candidates : dedicated)
					ambiguity(tx, [statement]);
		}
	}
	result.insert = available.filter((tx) => !blocked.has(tx));
	result.supersede.sort((a, b) => a.existingId.localeCompare(b.existingId));
	result.duplicates.sort(
		(a, b) =>
			a.incomingRef.localeCompare(b.incomingRef) ||
			a.existingId.localeCompare(b.existingId),
	);
	result.ambiguous.sort((a, b) => a.incomingRef.localeCompare(b.incomingRef));
	return result;
}
