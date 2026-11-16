import equity2026 from "../data/india-us-equity/2026-27.json" with {
	type: "json",
};
import vda2025 from "../data/india-vda/2025-26.json" with { type: "json" };
import vda2026 from "../data/india-vda/2026-27.json" with { type: "json" };
import {
	type UsEquityRules,
	UsEquityRulesSchema,
	type VdaRules,
	VdaRulesSchema,
} from "./schema.js";

export * from "./schema.js";

const vda = new Map<string, VdaRules>(
	[vda2025, vda2026].map((v) => [v.taxYear, VdaRulesSchema.parse(v)]),
);
const equity = new Map<string, UsEquityRules>([
	[equity2026.taxYear, UsEquityRulesSchema.parse(equity2026)],
]);
export function loadRules(regime: "india-vda", taxYear: string): VdaRules;
export function loadRules(
	regime: "india-us-equity",
	taxYear: string,
): UsEquityRules;
export function loadRules(
	regime: "india-vda" | "india-us-equity",
	taxYear: string,
): VdaRules | UsEquityRules {
	const rules = (regime === "india-vda" ? vda : equity).get(taxYear);
	if (!rules) throw new Error(`Unsupported rules: ${regime}/${taxYear}`);
	return structuredClone(rules);
}
export function listTaxYears(): {
	id: string;
	act: string;
	start: string;
	end: string;
}[] {
	return [...vda.values()].map((r) => ({
		id: r.taxYear,
		act: r.act,
		start: r.period.start,
		end: r.period.end,
	}));
}
