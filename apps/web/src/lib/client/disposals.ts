import { D, type LedgerTx, type VdaReport } from "@tax/core";
import type { ManualVenue } from "@/lib/client/api";
import {
	formatInr,
	formatManualVenueLabel,
	formatQty,
} from "@/lib/client/format";

/** A plain sentence for what a ledger row did, e.g. "Swapped 250 USDC → 250.21 USDT". */
export function describeTransaction(tx: LedgerTx): string {
	const out = tx.assetOut ? `${formatQty(tx.amountOut)} ${tx.assetOut}` : null;
	const into = tx.assetIn ? `${formatQty(tx.amountIn)} ${tx.assetIn}` : null;
	switch (tx.type) {
		case "swap":
			if (out && into) return `Swapped ${out} → ${into}`;
			break;
		case "sell":
			if (out && into) return `Sold ${out} for ${into}`;
			if (out && tx.inrValue)
				return `Sold ${out} for ${formatInr(tx.inrValue)}`;
			if (out) return `Sold ${out}`;
			break;
		case "buy":
			if (into && out) return `Bought ${into} with ${out}`;
			if (into) return `Bought ${into}`;
			break;
		case "withdrawal":
			if (out) return `Withdrew ${out}`;
			break;
		case "deposit":
			if (into) return `Deposited ${into}`;
			break;
		case "gift":
			if (out) return `Gave away ${out}`;
			if (into) return `Received ${into} as a gift`;
			break;
		case "fee":
			if (out) return `Paid ${out} in fees`;
			break;
	}
	const parts = [out ? `-${out}` : null, into ? `+${into}` : null].filter(
		Boolean,
	);
	const label = tx.type.charAt(0).toUpperCase() + tx.type.slice(1);
	return parts.length > 0 ? `${label} ${parts.join(" / ")}` : label;
}

/** When the uncovered coin is only the fee, say so instead of describing the trade. */
export function describeDisposal(tx: LedgerTx, asset: string): string {
	if (tx.assetOut !== asset && tx.feeAsset === asset && tx.feeAmount) {
		return `Paid ${formatQty(tx.feeAmount)} ${asset} fee on: ${describeTransaction(tx)}`;
	}
	return describeTransaction(tx);
}

export function venueForSource(tx: LedgerTx): ManualVenue {
	if (tx.source === "manual") return tx.venue ?? "manual";
	if (tx.source === "binance" || tx.source === "binance-api") return "binance";
	if (tx.source === "coindcx" || tx.source === "coindcx-api") return "coindcx";
	return "manual";
}

/** "Manual (Binance)" for a hand-entered row that counts toward an exchange. */
export function saleSourceLabel(
	tx: LedgerTx,
	sourceLabel: (source: string) => string,
): string {
	const label = sourceLabel(tx.source);
	if (tx.source !== "manual" || !tx.venue || tx.venue === "manual")
		return label;
	return `${label} (${formatManualVenueLabel(tx.venue)})`;
}

export function transactionHref(tx: LedgerTx, taxYear?: string): string {
	const params = new URLSearchParams();
	if (taxYear) params.set("taxYear", taxYear);
	params.set("q", tx.sourceRef);
	return `/transactions?${params.toString()}`;
}

export interface MissingExport {
	name: string;
	where: string;
}

export interface MissingExportHint {
	venue: string;
	exports: MissingExport[];
}

const BINANCE_EXPORTS: MissingExport[] = [
	{
		name: "Deposit history",
		where: "Wallet → Transaction History → Deposit → Export",
	},
	{
		name: "Convert history",
		where:
			"Wallet → Transaction History → Convert History → Export (website only)",
	},
	{
		name: "Transaction History statement",
		where:
			"Assets → Asset History → Export Transaction Records (dust, Earn, airdrops, Binance Pay)",
	},
	{
		name: "Spot Trade History (from your first trade)",
		where: "Orders → Spot Order → Trade History → Export Trade History",
	},
	{
		name: "P2P buys",
		where:
			"no P2P file is read yet: add each one as a manual purchase on Binance",
	},
];

const COINDCX_EXPORTS: MissingExport[] = [
	{
		name: "Trade Report for every year since your first trade",
		where: "App → Profile → Generate Reports → Trade Report",
	},
	{
		name: "Order History",
		where: "Web → Orders → Order History → Download CSV",
	},
];

const WALLET_EXPORTS: MissingExport[] = [
	{
		name: "the wallet's full history",
		where: "sync it from its first transaction in Connections",
	},
];

const OTHER_EXPORTS: MissingExport[] = [
	{
		name: "earlier files from the same exchange",
		where: "import them with the same recipe",
	},
];

/** Which exports usually hold the missing purchases, per source (docs/user-guide.md §2). */
export function missingExportHints(
	sources: Iterable<string>,
): MissingExportHint[] {
	const venues = new Map<string, MissingExport[]>();
	for (const source of sources) {
		if (source === "binance" || source === "binance-api")
			venues.set("Binance", BINANCE_EXPORTS);
		else if (source === "coindcx" || source === "coindcx-api")
			venues.set("CoinDCX", COINDCX_EXPORTS);
		else if (source.startsWith("evm:"))
			venues.set("On-chain wallets", WALLET_EXPORTS);
		else if (source !== "manual") venues.set("Other files", OTHER_EXPORTS);
	}
	return [...venues].map(([venue, exports]) => ({ venue, exports }));
}

export interface UnresolvedSale {
	txId: string;
	tx: LedgerTx | undefined;
	asset: string;
	quantity: string;
	reasons: VdaReport["unresolved"][number]["reason"][];
}

/** One entry per sale and coin: a sale can be split into several FIFO slices. */
export function unresolvedSales(report: VdaReport): UnresolvedSale[] {
	const ledger = new Map(report.ledger.map((tx) => [tx.id, tx]));
	const byKey = new Map<string, UnresolvedSale>();
	for (const u of report.unresolved) {
		const key = `${u.txId}:${u.asset}`;
		const existing = byKey.get(key);
		if (existing) {
			existing.quantity = D(existing.quantity).plus(u.quantity).toString();
			if (!existing.reasons.includes(u.reason)) existing.reasons.push(u.reason);
		} else {
			byKey.set(key, {
				txId: u.txId,
				tx: ledger.get(u.txId),
				asset: u.asset,
				quantity: u.quantity,
				reasons: [u.reason],
			});
		}
	}
	return [...byKey.values()].sort((a, b) =>
		(a.tx?.timestamp ?? "").localeCompare(b.tx?.timestamp ?? ""),
	);
}

export function unresolvedSaleCount(report: VdaReport): number {
	return new Set(report.unresolved.map((u) => u.txId)).size;
}
