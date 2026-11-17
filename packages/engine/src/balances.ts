import {
	type ActualBalance,
	type Balance,
	D,
	type EngineSettings,
	type ReportWarning,
	venueForSource,
} from "@tax/core";
import { compareText } from "./matching.js";
import { FIAT } from "./valuation.js";
export class BalanceBook {
	private rows = new Map<string, Balance>();
	constructor(private settings: EngineSettings) {}
	change(
		asset: string | undefined,
		source: string,
		quantity: string | undefined,
		txId: string,
	): void {
		if (!asset || !quantity || FIAT.has(asset)) return;
		source = venueForSource(source);
		const key = JSON.stringify([
			asset,
			this.settings.lotPool === "per_source" ? source : null,
		]);
		const row = this.rows.get(key) ?? {
			asset,
			...(this.settings.lotPool === "per_source" ? { source } : {}),
			computed: "0",
			txIds: [],
		};
		row.computed = D(row.computed).plus(quantity).toFixed();
		if (!row.txIds.includes(txId)) row.txIds.push(txId);
		this.rows.set(key, row);
	}
	finish(
		actual: ActualBalance[],
		warn: (flag: ReportWarning) => void,
	): Balance[] {
		const seen = new Set<string>();
		for (const item of actual) {
			if (this.settings.lotPool === "global" && item.source !== undefined)
				throw new Error(
					"Global pool actual balances must be aggregated without source",
				);
			if (this.settings.lotPool === "per_source" && item.source === undefined)
				throw new Error("Per-source actual balances require source");
			const normalizedSource = item.source
				? venueForSource(item.source)
				: undefined;
			const key = JSON.stringify([item.asset, normalizedSource ?? null]);
			if (seen.has(key)) throw new Error("Duplicate actual balance");
			seen.add(key);
			const row = this.rows.get(key) ?? {
				asset: item.asset,
				...(normalizedSource ? { source: normalizedSource } : {}),
				computed: "0",
				txIds: [],
			};
			row.actual = item.amount;
			row.difference = D(item.amount).minus(row.computed).toFixed();
			this.rows.set(key, row);
			if (!D(row.difference).isZero())
				warn({
					code: "balance_mismatch",
					asset: row.asset,
					...(row.source ? { source: row.source } : {}),
					txIds: row.txIds,
					message: `${item.asset}${item.source ? ` at ${item.source}` : ""}: computed ${row.computed}, actual ${item.amount}`,
				});
		}
		const rows = [...this.rows.values()].sort(
			(a, b) =>
				compareText(a.asset, b.asset) ||
				compareText(a.source ?? "", b.source ?? ""),
		);
		for (const row of rows)
			if (D(row.computed).lt("0"))
				warn({
					code: "missing_history",
					asset: row.asset,
					...(row.source ? { source: row.source } : {}),
					txIds: row.txIds,
					message: `Negative ${row.asset} holding${row.source ? ` at ${row.source}` : ""}: ${row.computed}`,
				});
		return rows;
	}
}
