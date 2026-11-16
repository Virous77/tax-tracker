import { D, type DecimalValue } from "@tax/core";
export interface Lot {
	asset: string;
	qty: ReturnType<typeof D>;
	costInr: ReturnType<typeof D> | null;
	acquiredAt: string | null;
	txId: string | null;
	pool: string;
	order: number;
	trailTxIds: string[];
}
export interface LotSlice extends Lot {}
export class LotBook {
	private lots: Lot[] = [];
	add(lot: Lot): void {
		if (!lot.qty.gt("0")) return;
		this.lots.push({
			...lot,
			qty: D(lot.qty),
			costInr: lot.costInr === null ? null : D(lot.costInr),
			trailTxIds: [...lot.trailTxIds],
		});
		this.lots.sort((a, b) => a.order - b.order);
	}
	consume(asset: string, pool: string, quantity: DecimalValue): LotSlice[] {
		let remaining = D(quantity);
		const result: LotSlice[] = [];
		for (const lot of this.lots) {
			if (
				lot.asset !== asset ||
				lot.pool !== pool ||
				lot.qty.isZero() ||
				remaining.isZero()
			)
				continue;
			const qty = lot.qty.lte(remaining) ? D(lot.qty) : D(remaining);
			const costInr = lot.costInr?.mul(qty).div(lot.qty) ?? null;
			result.push({ ...lot, qty, costInr, trailTxIds: [...lot.trailTxIds] });
			lot.qty = lot.qty.minus(qty);
			if (lot.costInr !== null && costInr !== null)
				lot.costInr = lot.costInr.minus(costInr);
			remaining = remaining.minus(qty);
		}
		if (remaining.gt("0"))
			result.push({
				asset,
				pool,
				qty: remaining,
				costInr: null,
				acquiredAt: null,
				txId: null,
				order: Number.MAX_SAFE_INTEGER,
				trailTxIds: [],
			});
		this.lots = this.lots.filter((lot) => lot.qty.gt("0"));
		return result;
	}
}
