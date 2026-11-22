import {
	D,
	type EngineSettings,
	roundInr,
	type UsEquityCapitalGainsSummary,
} from "@tax/core";
import type { UsEquityRules } from "@tax/rules";
import type { Money } from "./values.js";

type Term = "long" | "short";

export class CapitalGains {
	private totals = { short: this.emptyTerm(), long: this.emptyTerm() };

	private emptyTerm() {
		return {
			consideration: D("0"),
			cost: D("0"),
			gains: D("0"),
			losses: D("0"),
		};
	}

	add(term: Term, consideration: Money, cost: Money, gain: Money): void {
		const total = this.totals[term];
		total.consideration = total.consideration.plus(consideration);
		total.cost = total.cost.plus(cost);
		if (gain.lt("0")) total.losses = total.losses.minus(gain);
		else total.gains = total.gains.plus(gain);
	}

	summarize(
		rules: UsEquityRules,
		settings: EngineSettings,
	): UsEquityCapitalGainsSummary {
		const shorten = ({
			consideration,
			cost,
			gains,
			losses,
		}: ReturnType<CapitalGains["emptyTerm"]>) => ({
			considerationInr: roundInr(consideration),
			costInr: roundInr(cost),
			grossGainInr: roundInr(gains),
			grossLossInr: roundInr(losses),
			netGainInr: roundInr(gains.minus(losses)),
		});
		const { short, long } = this.totals;
		const gains = { stcg: short.gains, ltcg: long.gains };
		const losses = { stcl: short.losses, ltcl: long.losses };
		const applyLoss = (loss: keyof typeof losses, gain: keyof typeof gains) => {
			const targets: readonly ("stcg" | "ltcg")[] =
				rules.lossSetOff[`${loss}Against`];
			if (!targets.includes(gain)) return D("0");
			const applied = losses[loss].lte(gains[gain])
				? losses[loss]
				: gains[gain];
			losses[loss] = losses[loss].minus(applied);
			gains[gain] = gains[gain].minus(applied);
			return applied;
		};
		applyLoss("stcl", "stcg");
		applyLoss("ltcl", "ltcg");
		const stclAgainstLtcg = applyLoss("stcl", "ltcg");
		applyLoss("ltcl", "stcg");

		const taxableLtcg = gains.ltcg;
		const baseTax = taxableLtcg.mul(rules.longTermRate);
		const surchargeCapped = D(settings.surchargeRate).gt(
			rules.surchargeCapLtcg,
		);
		const surchargeRate = surchargeCapped
			? rules.surchargeCapLtcg
			: settings.surchargeRate;
		const surcharge = baseTax.mul(surchargeRate);
		const cess = baseTax.plus(surcharge).mul(rules.cess);
		const totalTax = baseTax.plus(surcharge).plus(cess);
		return {
			shortTerm: shorten(short),
			longTerm: shorten(long),
			setOff: {
				stclAgainstLtcgInr: roundInr(stclAgainstLtcg),
				netTaxableStcgInr: roundInr(gains.stcg),
				netTaxableLtcgInr: roundInr(taxableLtcg),
				carryForwardStclInr: roundInr(losses.stcl),
				carryForwardLtclInr: roundInr(losses.ltcl),
			},
			ltcgTax: {
				taxableLtcgInr: roundInr(taxableLtcg),
				rate: rules.longTermRate,
				baseTaxInr: roundInr(baseTax),
				surchargeRateApplied: surchargeRate,
				surchargeCapped,
				surchargeInr: roundInr(surcharge),
				cessInr: roundInr(cess),
				totalLtcgTaxInr: roundInr(totalTax),
				totalLtcgTaxRoundedInr: totalTax.toFixed(0),
			},
			stcgNote: `Short-term gains are taxed at ${rules.shortTermRate} rates. Confirm eligibility to carry losses forward for up to ${rules.lossSetOff.carryForwardYears} years.`,
		};
	}
}
