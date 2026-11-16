import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	type ActualBalance,
	EngineSettingsSchema,
	type LedgerTx,
	VdaReportSchema,
} from "@tax/core";
import { loadRules } from "@tax/rules";
import { describe, expect, test } from "vitest";
import { computeVdaReport } from "../src/index.js";

interface GoldenInput {
	transactions: LedgerTx[];
	taxYear: string;
	settings?: Record<string, unknown>;
	actualBalances?: ActualBalance[];
	fxRows?: { currency: string; date: string; rate: string; source: string }[];
	determinism?: boolean;
}
const root = resolve(import.meta.dirname, "golden");
for (const directory of readdirSync(root).sort()) {
	const inputs = JSON.parse(
		readFileSync(resolve(root, directory, "input.json"), "utf8"),
	) as { cases: GoldenInput[] };
	const expected = JSON.parse(
		readFileSync(resolve(root, directory, "expected.json"), "utf8"),
	) as { cases: (Record<string, unknown> & { warningCodes?: string[] })[] };
	describe(directory, () => {
		for (const [index, input] of inputs.cases.entries())
			test(`hand-calculated variant ${index + 1}`, () => {
				const before = JSON.stringify(input);
				const settings = EngineSettingsSchema.parse(input.settings ?? {});
				const fx = (currency: string, date: string) => {
					const row = [...(input.fxRows ?? [])]
						.filter((r) => r.currency === currency && r.date <= date)
						.sort((a, b) => a.date.localeCompare(b.date))
						.at(-1);
					return row
						? { rate: row.rate, rateDate: row.date, source: row.source }
						: null;
				};
				const args = {
					...input,
					settings,
					rules: loadRules("india-vda", input.taxYear),
					fx,
				};
				const report = computeVdaReport(args);
				expect(VdaReportSchema.safeParse(report).success).toBe(true);
				const { warningCodes, ...output } = expected.cases[index] ?? {};
				expect(report).toMatchObject(output);
				expect(report.unresolved).toMatchObject(output.unresolved ?? []);
				for (const code of warningCodes ?? [])
					expect(report.warnings.some((flag) => flag.code === code)).toBe(true);
				expect(JSON.stringify(input)).toBe(before);
				if (input.determinism) {
					expect(computeVdaReport(args)).toEqual(report);
					expect(
						computeVdaReport({
							...args,
							transactions: [...args.transactions].reverse(),
						}),
					).toEqual(report);
				}
			});
	});
}
