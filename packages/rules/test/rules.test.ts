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
