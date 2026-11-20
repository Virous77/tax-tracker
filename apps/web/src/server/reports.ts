import { readFile } from "node:fs/promises";
import {
	type ActualBalance,
	EngineSettingsSchema,
	type ReportWarning,
	type ReviewFlag,
	taxYearBounds,
	VdaReportSchema,
	venueForSource,
} from "@tax/core";
import type { TaxDatabase } from "@tax/db";
import { computeVdaReport } from "@tax/engine";
import { priceLookupFromCache } from "@tax/prices";
import { createFxLookup, parseSbiCsv } from "@tax/rates";
import { listTaxYears, loadRules } from "@tax/rules";
import { runJob } from "./context";
import { ApiError } from "./errors";
import { getSettings } from "./settings";
export function groupWarnings(warnings: ReportWarning[]): ReportWarning[] {
	const groups = new Map<string, ReportWarning>();
	for (const warning of warnings) {
		const key = JSON.stringify([
			warning.code,
			warning.message,
			warning.asset,
			warning.source,
		]);
		const group = groups.get(key) ?? {
			code: warning.code,
			...(warning.asset ? { asset: warning.asset } : {}),
			...(warning.source ? { source: warning.source } : {}),
			message: warning.message,
			count: 0,
			txIds: [],
		};
		group.count = (group.count ?? 0) + (warning.count ?? 1);
		group.txIds = [
			...new Set([
				...(group.txIds ?? []),
				...(warning.txIds ?? []),
				...(warning.txId ? [warning.txId] : []),
			]),
		];
		if (group.txIds.length === 1) group.txId = group.txIds[0];
		else delete group.txId;
		groups.set(key, group);
	}
	return [...groups.values()];
}
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
	const normalized = values.map((row) =>
		row.source ? { ...row, source: venueForSource(row.source) } : row,
	);
	const keys = new Set<string>();
	for (const value of normalized) {
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
	return db.actualBalances.replace(taxYear, normalized);
}
export async function computeReport(db: TaxDatabase, taxYear: string) {
	checkYear(taxYear);
	return runJob(db, "compute", { taxYear }, async () => {
		const warnings: ReviewFlag[] = db.imports
			.list()
			.filter((item) => item.status !== "imported" || item.rowsError > 0)
			.map((item) => ({
				code: "import_incomplete",
				message: `Import ${item.fileName}: ${item.rowsError} excluded rows; status ${item.status}. Review the import before relying on this report.`,
			}));
		warnings.push(
			...db.imports
				.list()
				.flatMap((item) =>
					item.warnings.filter(
						(flag) =>
							flag.code !== "parse_warning" ||
							flag.message !==
								"Unsupported sheets and invalid rows are listed in row errors and are excluded from calculations.",
					),
				),
		);
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
				code: "fx_unavailable",
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
		const transactions = db.transactions
			.active()
			.filter((tx) => tx.timestamp < bound);
		const demoImports = new Set(db.imports.demoIds());
		const report = VdaReportSchema.parse({
			...computeVdaReport({
				transactions,
				rules: loadRules("india-vda", taxYear),
				settings,
				taxYear,
				actualBalances,
				fx,
				priceLookup: priceLookupFromCache(
					db.prices.all(),
					db.prices.mappings(),
				),
			}),
			includesDemoData: transactions.some(
				(tx) => tx.importId && demoImports.has(tx.importId),
			),
		});
		const throughYear = new Set(
			db.transactions
				.all()
				.filter((tx) => tx.timestamp < bound)
				.map((tx) => tx.id),
		);
		report.excluded.push(
			...db.transactions
				.superseded()
				.filter((row) => throughYear.has(row.txId))
				.map(({ txId }) => ({ txId, reason: "superseded" })),
		);
		report.warnings = groupWarnings([...report.warnings, ...warnings]);
		return db.reports.save(report);
	});
}
export function getReport(db: TaxDatabase, taxYear: string) {
	checkYear(taxYear);
	const report = db.reports.latest(taxYear);
	if (!report)
		throw new ApiError(
			404,
			"report_not_computed",
			"Compute a report for this year first.",
			db.reports.missingDetails(taxYear),
		);
	return { ...report, includesDemoData: report.includesDemoData ?? false };
}
