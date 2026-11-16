import { readFile } from "node:fs/promises";
import {
	type ActualBalance,
	EngineSettingsSchema,
	type ReviewFlag,
	taxYearBounds,
	VdaReportSchema,
} from "@tax/core";
import type { TaxDatabase } from "@tax/db";
import { computeVdaReport } from "@tax/engine";
import { createFxLookup, parseSbiCsv } from "@tax/rates";
import { listTaxYears, loadRules } from "@tax/rules";
import { runJob } from "./context";
import { ApiError, required } from "./errors";
import { getSettings } from "./settings";
export function checkYear(taxYear: string): void {
	if (!listTaxYears().some((year) => year.id === taxYear))
		throw new ApiError(
			404,
			"not_found",
			"Rules are unavailable for this tax year.",
		);
}
export function putBalances(
	db: TaxDatabase,
	taxYear: string,
	values: ActualBalance[],
) {
	checkYear(taxYear);
	const settings = getSettings(db);
	const keys = new Set<string>();
	for (const value of values) {
		if (
			(settings.lotPool === "global" && value.source !== undefined) ||
			(settings.lotPool === "per_source" && !value.source)
		)
			throw new ApiError(
				400,
				"validation_error",
				"Actual balance sources must match the configured lot pool.",
			);
		const key = JSON.stringify([value.asset, value.source ?? null]);
		if (keys.has(key))
			throw new ApiError(409, "conflict", "Duplicate actual balance.");
		keys.add(key);
	}
	return db.actualBalances.replace(taxYear, values);
}
export async function computeReport(db: TaxDatabase, taxYear: string) {
	checkYear(taxYear);
	return runJob(db, "compute", { taxYear }, async () => {
		const warnings: ReviewFlag[] = db.imports
			.list()
			.filter((item) => item.status !== "imported" || item.rowsError > 0)
			.map((item) => ({
				code: "parse_warning",
				message: `Import ${item.fileName}: ${item.rowsError} excluded rows; status ${item.status}. Review the import before relying on this report.`,
			}));
		let fx = (() => null) as ReturnType<typeof createFxLookup>;
		try {
			fx = createFxLookup(
				parseSbiCsv(
					await readFile(
						new URL(
							"../../../../packages/rates/data/SBI_REFERENCE_RATES_USD.csv",
							import.meta.url,
						),
						"utf8",
					),
				),
			);
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
			warnings.push({
				code: "parse_warning",
				message:
					"Bundled SBI rates are unavailable; FX-dependent rows remain unresolved.",
			});
		}
		const settings = EngineSettingsSchema.parse(getSettings(db));
		const actualBalances = db.actualBalances.get(taxYear);
		if (
			actualBalances.some((row) =>
				settings.lotPool === "global" ? row.source !== undefined : !row.source,
			)
		)
			throw new ApiError(
				409,
				"balance_pool_conflict",
				"Update actual balances to match the selected lot pool.",
			);
		const bound = taxYearBounds(taxYear).endExclusiveUtc;
		const report = VdaReportSchema.parse(
			computeVdaReport({
				transactions: db.transactions
					.all()
					.filter((tx) => tx.timestamp < bound),
				rules: loadRules("india-vda", taxYear),
				settings,
				taxYear,
				actualBalances,
				fx,
			}),
		);
		report.warnings.push(...warnings);
		return db.reports.save(report);
	});
}
export function getReport(db: TaxDatabase, taxYear: string) {
	checkYear(taxYear);
	return required(
		db.reports.latest(taxYear),
		"Compute a report for this year first.",
	);
}
