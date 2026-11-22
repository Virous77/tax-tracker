import {
	D,
	type EngineSettings,
	type LedgerTx,
	type ReviewFlag,
	roundInr,
	type TdsSource,
	type VdaTotals,
	venueForSource,
} from "@tax/core";
import type { VdaRules } from "@tax/rules";
import { compareText } from "./matching.js";
export interface ExactTotals {
	consideration: ReturnType<typeof D>;
	cost: ReturnType<typeof D>;
	income: ReturnType<typeof D>;
	loss: ReturnType<typeof D>;
}
export function taxTotals(
	totals: ExactTotals,
	rules: VdaRules,
	settings: EngineSettings,
	tdsCredit: string,
): VdaTotals {
	const baseTax = totals.income.mul(rules.rate);
	const surcharge = baseTax.mul(settings.surchargeRate);
	const cess = baseTax.plus(surcharge).mul(rules.cess);
	const totalTax = baseTax.plus(surcharge).plus(cess);
	return {
		consideration: roundInr(totals.consideration),
		cost: roundInr(totals.cost),
		taxableIncome: roundInr(totals.income),
		lossesNotSetOff: roundInr(totals.loss),
		baseTax: roundInr(baseTax),
		surcharge: roundInr(surcharge),
		cess: roundInr(cess),
		totalTax: roundInr(totalTax),
		totalTaxRounded: totalTax.toFixed(0),
		tdsCredit: roundInr(tdsCredit),
		netPayable: roundInr(totalTax.minus(tdsCredit)),
	};
}
export class TdsBook {
	private sources = new Map<
		string,
		{
			credit: ReturnType<typeof D>;
			transfers: ReturnType<typeof D>;
			txIds: string[];
		}
	>();
	add(
		tx: LedgerTx,
		transferValue: string | null,
		isDisposal: boolean,
		warn: (flag: ReviewFlag) => void,
	): void {
		const source = venueForSource(tx.source);
		const row = this.sources.get(source) ?? {
			credit: D("0"),
			transfers: D("0"),
			txIds: [],
		};
		row.credit = row.credit.plus(tx.tdsInr ?? "0");
		if (tx.tdsInr !== undefined || isDisposal) row.txIds.push(tx.id);
		if (isDisposal && transferValue !== null)
			row.transfers = row.transfers.plus(transferValue);
		if (isDisposal && source === "binance")
			warn({
				txId: tx.id,
				code: "tds_not_deducted",
				message:
					"Platform does not deduct TDS; review buyer obligations and reconcile Form 26AS/AIS.",
			});
		if (
			isDisposal &&
			source !== "binance" &&
			source !== "coindcx" &&
			!D(tx.tdsInr ?? "0").gt("0")
		)
			warn({
				txId: tx.id,
				code: "tds_not_deducted",
				message: `TDS deduction status for ${tx.source} is unknown; verify payer obligations and Form 26AS/AIS.`,
			});
		this.sources.set(source, row);
	}
	finish(
		rules: VdaRules,
		settings: EngineSettings,
	): { bySource: TdsSource[]; checklist: string[]; credit: string } {
		const threshold = settings.specifiedPerson
			? rules.tds.specifiedPersonThresholdInr
			: rules.tds.thresholdInr;
		const annual = [...this.sources.values()].reduce(
			(sum, row) => sum.plus(row.transfers),
			D("0"),
		);
		const bySource = [...this.sources.entries()]
			.filter(
				([, row]) =>
					row.txIds.length > 0 ||
					!row.credit.isZero() ||
					!row.transfers.isZero(),
			)
			.sort(([a], [b]) => compareText(a, b))
			.map(([source, row]) => ({
				source,
				deductedByPlatform:
					source === "coindcx" ? true : source === "binance" ? false : null,
				tdsInr: roundInr(row.credit),
				transferValueInr: roundInr(row.transfers),
				possiblyDueInr: roundInr(
					source !== "coindcx" && annual.gt(threshold)
						? row.transfers.mul(rules.tds.rate)
						: "0",
				),
				txIds: row.txIds,
			}));
		return {
			bySource,
			checklist: bySource.map(
				(row) =>
					`${row.source}: match ledger TDS ${row.tdsInr} with Form 26AS/AIS; verify payer, threshold and credit before filing.`,
			),
			credit: [...this.sources.values()]
				.reduce((sum, row) => sum.plus(row.credit), D("0"))
				.toFixed(),
		};
	}
}
