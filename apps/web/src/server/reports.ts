import { readFile } from "node:fs/promises";
import {
	type ActualBalance,
	type AssetClass,
	type EngineSettings,
	EngineSettingsSchema,
	type ReportWarning,
	taxYearBounds,
	VdaReportSchema,
	venueForSource,
} from "@tax/core";
import type { TaxDatabase } from "@tax/db";
import { computeVdaReport } from "@tax/engine";
import { priceLookupFromCache } from "@tax/prices";
import {
	createFxLookup,
	DEFAULT_SBI_MAX_STALE_DAYS,
	parseSbiCsv,
} from "@tax/rates";
import { listTaxYears, loadRules } from "@tax/rules";
import { runJob } from "./context";
import { demoStatus } from "./demo";
import { ApiError } from "./errors";
import { presentReport, warningSeverity } from "./report-presentation";
import { expireReviewResolutions } from "./report-review";
import { getSettings } from "./settings";
import { pendingMappingMessage, sourceLabels } from "./source-labels";
export function groupWarnings(warnings: ReportWarning[]): ReportWarning[] {
	const groups = new Map<string, ReportWarning>();
	for (const warning of warnings) {
		const severity = warningSeverity(warning);
		const key = JSON.stringify([
			warning.code,
			severity,
			warning.message,
			warning.asset,
			warning.source,
			warning.importId,
		]);
		const group = groups.get(key) ?? {
			code: warning.code,
			severity,
			...(warning.asset ? { asset: warning.asset } : {}),
			...(warning.source ? { source: warning.source } : {}),
			...(warning.importId ? { importId: warning.importId } : {}),
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
function balancesMatchPool(
	values: ActualBalance[],
	lotPool: EngineSettings["lotPool"],
) {
	return values.every((row) =>
		lotPool === "global" ? row.source === undefined : Boolean(row.source),
	);
}

export function checkActualBalancePool(
	values: ActualBalance[],
	lotPool: EngineSettings["lotPool"],
) {
	if (!balancesMatchPool(values, lotPool))
		throw new ApiError(
			409,
			"balance_pool_conflict",
			"Update actual balances to match the selected lot pool.",
		);
}

export function normalizeActualBalances(
	values: ActualBalance[],
	lotPool: EngineSettings["lotPool"],
) {
	const normalized = values.map((row) =>
		row.source ? { ...row, source: venueForSource(row.source) } : row,
	);
	if (!balancesMatchPool(normalized, lotPool))
		throw new ApiError(
			400,
			"validation_error",
			"Actual balance sources must match the configured lot pool.",
		);
	const keys = new Set<string>();
	for (const value of normalized) {
		const key = JSON.stringify([value.asset, value.source ?? null]);
		if (keys.has(key))
			throw new ApiError(409, "conflict", "Duplicate actual balance.");
		keys.add(key);
	}
	return normalized;
}
export function putBalances(
	db: TaxDatabase,
	taxYear: string,
	values: ActualBalance[],
) {
	checkYear(taxYear);
	return db.atomic(
		() =>
			db.actualBalances.replace(
				taxYear,
				normalizeActualBalances(values, getSettings(db).lotPool),
			),
		"immediate",
	);
}

export async function loadSbiFx() {
	try {
		const fx = createFxLookup(
			parseSbiCsv(
				await readFile(
					new URL(
						"../../../../packages/rates/data/SBI_REFERENCE_RATES_USD.csv",
						import.meta.url,
					),
					"utf8",
				),
			),
			{ maxStaleDays: DEFAULT_SBI_MAX_STALE_DAYS },
		);
		return { fx };
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
		return {
			fx: () => null,
			warning: {
				code: "fx_unavailable",
				message:
					"Bundled SBI rates are unavailable; FX-dependent rows remain unresolved.",
			} satisfies ReportWarning,
		};
	}
}

export function importWarnings(db: TaxDatabase, assetClass: AssetClass) {
	const warnings: ReportWarning[] = [];
	for (const item of db.imports.list(assetClass)) {
		if (item.status !== "imported" || item.rowsError > 0)
			warnings.push({
				code: "import_incomplete",
				importId: item.id,
				message:
					item.status === "pending_recipe" && item.kind !== "api_sync"
						? pendingMappingMessage(item.fileName)
						: item.status !== "imported"
							? `${item.fileName} has not finished importing. Review it in Imports before relying on this report.`
							: `${item.fileName} has ${item.rowsError} excluded rows. Review them in Imports before relying on this report.`,
			});
		for (const flag of item.warnings) {
			if (
				flag.code === "parse_warning" &&
				flag.message ===
					"Unsupported sheets and invalid rows are listed in row errors and are excluded from calculations."
			)
				continue;
			warnings.push({ ...flag, importId: item.id });
		}
	}
	return warnings;
}

export async function computeReport(db: TaxDatabase, taxYear: string) {
	checkYear(taxYear);
	return runJob(db, "compute", { taxYear }, async () => {
		const { fx, warning } = await loadSbiFx();
		return db.atomic(() => {
			const warnings = importWarnings(db, "vda");
			if (warning) warnings.unshift(warning);
			const settings = EngineSettingsSchema.parse(getSettings(db));
			const actualBalances = db.actualBalances.get(taxYear);
			checkActualBalancePool(actualBalances, settings.lotPool);
			const { startUtc, endExclusiveUtc: bound } = taxYearBounds(taxYear);
			const transactions = db.transactions
				.active("vda")
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
					(tx) =>
						tx.timestamp >= startUtc &&
						tx.importId &&
						demoImports.has(tx.importId),
				),
			});
			const throughYear = new Set(
				db.transactions
					.list({ assetClass: "vda" })
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
			db.reports.save(report);
			expireReviewResolutions(db, taxYear);
			return presentReport(
				report,
				report.includesDemoData ?? false,
				sourceLabels(db),
			);
		}, "immediate");
	});
}
export function getReportState(
	db: TaxDatabase,
	taxYear: string,
	allowStale = true,
) {
	checkYear(taxYear);
	const { report, status } = db.reports.snapshot(taxYear);
	if (!report || (status === "stale" && !allowStale))
		return {
			status: "missing" as const,
			...db.reports.missingDetails(taxYear),
		};
	return presentReport(
		status === "stale" ? { ...report, stale: true } : report,
		status === "stale"
			? (report.includesDemoData ?? false)
			: demoStatus(db).taxYears.includes(taxYear),
		sourceLabels(db),
	);
}

export function getReport(db: TaxDatabase, taxYear: string) {
	const result = getReportState(db, taxYear, false);
	if ("status" in result) {
		const { invalidatedAt, cause } = result;
		throw new ApiError(
			404,
			"report_not_computed",
			"Compute a report for this year first.",
			{ invalidatedAt, cause },
		);
	}
	return result;
}
