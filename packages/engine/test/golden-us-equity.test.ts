import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EngineSettingsSchema, UsEquityReportSchema } from "@tax/core";
import { loadRules } from "@tax/rules";
import { describe, expect, test } from "vitest";
import {
	type ComputeUsEquityInput,
	computeHoldings,
	computeUsEquityReport,
	computeVdaReport,
} from "../src/index.js";

type GoldenInput = Omit<ComputeUsEquityInput, "rules" | "settings" | "fx"> & {
	settings?: Record<string, unknown>;
	fxRows: { currency: string; date: string; rate: string; source: string }[];
	checkVdaIsolation?: boolean;
};
type GoldenExpected = Record<string, unknown> & {
	warningCodes?: string[];
	unresolved?: unknown[];
};

const root = resolve(import.meta.dirname, "golden-us-equity");
for (const directory of readdirSync(root).sort()) {
	const input = JSON.parse(
		readFileSync(resolve(root, directory, "input.json"), "utf8"),
	) as { cases: GoldenInput[] };
	const expected = JSON.parse(
		readFileSync(resolve(root, directory, "expected.json"), "utf8"),
	) as { cases: GoldenExpected[] };

	describe(directory, () => {
		expect(input.cases).toHaveLength(expected.cases.length);
		for (const [
			index,
			{ fxRows, settings, checkVdaIsolation, ...item },
		] of input.cases.entries()) {
			test(`hand-calculated variant ${index + 1}`, () => {
				const before = JSON.stringify(item);
				const args: ComputeUsEquityInput = {
					...item,
					settings: EngineSettingsSchema.parse(settings ?? {}),
					rules: loadRules("india-us-equity", item.taxYear),
					fx: (currency, date) => {
						const row = fxRows
							.filter((row) => row.currency === currency && row.date <= date)
							.sort((a, b) => a.date.localeCompare(b.date))
							.at(-1);
						return row
							? { rate: row.rate, rateDate: row.date, source: row.source }
							: null;
					},
				};
				const report = computeUsEquityReport(args);
				const { warningCodes, ...shape } = expected.cases[index] ?? {};
				expect(UsEquityReportSchema.parse(report)).toEqual(report);
				expect(report).toMatchObject(shape);
				expect(report.unresolved).toMatchObject(shape.unresolved ?? []);
				expect(report.warnings.map(({ code }) => code)).toEqual(
					expect.arrayContaining(warningCodes ?? []),
				);
				expect(JSON.stringify(item)).toBe(before);
				expect(
					computeUsEquityReport({
						...args,
						transactions: [...args.transactions].reverse(),
					}),
				).toEqual(report);
				if (checkVdaIsolation) {
					const vda = computeVdaReport({
						...args,
						rules: loadRules("india-vda", item.taxYear),
					});
					expect(vda.generatedFrom.txCount).toBe(2);
					expect(vda.totals.taxableIncome).toBe("200.00");
					expect(vda.balances).toMatchObject([
						{ asset: "TSLA", computed: "1" },
					]);
					const holdings = { ...args, asOf: "2027-03-31T12:00:00.000Z" };
					expect(computeHoldings(holdings)).toMatchObject([
						{ asset: "TSLA", quantity: "1" },
					]);
					expect(
						computeHoldings({ ...holdings, assetClass: "us_equity" }),
					).toMatchObject([{ asset: "TSLA", quantity: "3" }]);
				}
			});
		}
	});
}
