import {
	D,
	type EngineSettings,
	istDate,
	type LedgerTx,
	type ReviewFlag,
	roundInr,
	type ScheduleVdaRow,
	type Unresolved,
} from "@tax/core";
import type { LotSlice } from "./lots.js";
export class DisposalBook {
	readonly rows: ScheduleVdaRow[] = [];
	readonly unresolved: Unresolved[] = [];
	readonly totals = {
		consideration: D("0"),
		cost: D("0"),
		income: D("0"),
		loss: D("0"),
	};
	constructor(
		private settings: EngineSettings,
		private ledger: ReadonlyMap<string, LedgerTx>,
		private warn: (flag: ReviewFlag) => void,
	) {}
	add(
		tx: LedgerTx,
		asset: string,
		quantity: string,
		slices: LotSlice[],
		consideration: ReturnType<typeof D> | null,
	): void {
		if (consideration?.lt("0")) {
			this.warn({
				txId: tx.id,
				code: "fee_review_required",
				message:
					"Fee exceeds disposal consideration; review the fee before calculating tax.",
			});
			consideration = null;
		}
		for (const slice of slices) {
			const value = consideration?.mul(slice.qty).div(quantity) ?? null;
			const flags: ReviewFlag[] = [];
			if (slice.costInr === null) {
				const type = slice.txId ? this.ledger.get(slice.txId)?.type : undefined;
				flags.push({
					txId: tx.id,
					code:
						slice.txId === null ||
						slice.acquiredAt === null ||
						type === "deposit" ||
						type === "gift"
							? "missing_history"
							: "missing_inr_value",
					message:
						"Acquisition history or cost basis is unknown; excluded from totals.",
				});
			}
			if (value === null)
				flags.push({
					txId: tx.id,
					code: "missing_inr_value",
					message:
						"Disposal consideration is unresolved; excluded from totals.",
				});
			for (const flag of flags) {
				this.warn(flag);
				this.unresolved.push({
					txId: tx.id,
					asset,
					quantity: slice.qty.toFixed(),
					reason: flag.code,
				});
			}
			const gain =
				value !== null && slice.costInr !== null
					? value.minus(slice.costInr)
					: null;
			const income = gain === null ? null : gain.gt("0") ? gain : D("0");
			const loss =
				gain === null ? null : gain.lt("0") ? gain.negated() : D("0");
			const rawRefs = [...new Set([...slice.trailTxIds, tx.id])].map((id) => {
				const row = this.ledger.get(id);
				if (!row) throw new Error("Missing trail ledger row");
				return {
					txId: row.id,
					source: row.source,
					sourceRef: row.sourceRef,
					raw: row.raw,
				};
			});
			this.rows.push({
				dateOfAcquisition: slice.acquiredAt ? istDate(slice.acquiredAt) : null,
				dateOfTransfer: istDate(tx.timestamp),
				headOfIncome: this.settings.headOfIncome,
				asset,
				quantity: slice.qty.toFixed(),
				costOfAcquisition:
					slice.costInr === null ? null : roundInr(slice.costInr),
				considerationReceived: value === null ? null : roundInr(value),
				income: income === null ? null : roundInr(income),
				loss: loss === null ? null : roundInr(loss),
				trail: {
					disposalTxId: tx.id,
					lotTxIds: slice.txId ? [slice.txId] : [],
					rawRefs,
				},
				reviewFlags: flags,
			});
			if (
				value !== null &&
				slice.costInr !== null &&
				income !== null &&
				loss !== null
			) {
				this.totals.consideration = this.totals.consideration.plus(value);
				this.totals.cost = this.totals.cost.plus(slice.costInr);
				this.totals.income = this.totals.income.plus(income);
				this.totals.loss = this.totals.loss.plus(loss);
			}
		}
	}
}
