import { expect, test } from "vitest";
import { listTaxYears, loadRules } from "../src/index.js";

test("loads both Acts and equity data without sharing mutable state", () => {
	expect(listTaxYears().map((r) => r.id)).toEqual(["2025-26", "2026-27"]);
	expect(loadRules("india-vda", "2025-26").sections.vdaTax).toBe(
		"Section 115BBH",
	);
	const rules = loadRules("india-vda", "2026-27");
	rules.rate = "1";
	expect(loadRules("india-vda", "2026-27").rate).toBe("0.30");
	expect(loadRules("india-us-equity", "2026-27").longTermHoldingMonths).toBe(
		24,
	);
	expect(() => loadRules("india-vda", "2027-28")).toThrow();
});

test.each([
	["2025-26", "Income-tax Act, 1961", 2025, "Rule 115"],
	["2026-27", "Income-tax Act, 2025", 2026, "Rule 206"],
])(
	"loads complete unverified US equity rules for %s",
	(year, act, cy, fxRule) => {
		const rules = loadRules("india-us-equity", year);
		expect(rules).toMatchObject({
			act,
			scheduleFaCalendarYear: cy,
			longTermHoldingMonths: 24,
			longTermRate: "0.125",
			cess: "0.04",
			surchargeCapLtcg: "0.15",
			sectionsVerified: false,
			indexation: false,
			lossSetOff: {
				stclAgainst: ["stcg", "ltcg"],
				ltclAgainst: ["ltcg"],
				carryForwardYears: 8,
			},
			dtaa: { countryCode: "2", dividendArticle: "Article 10(2)(b)" },
			sections: { currencyConversionRule: fxRule },
		});
		rules.lossSetOff.ltclAgainst.push("ltcg");
		expect(loadRules("india-us-equity", year).lossSetOff.ltclAgainst).toEqual([
			"ltcg",
		]);
	},
);
