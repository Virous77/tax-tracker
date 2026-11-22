import {
	type ActualBalance,
	EngineSettingsSchema,
	type EquityCyPrice,
	type EquityMetadata,
	istDate,
	taxYearBounds,
	UsEquityReportSchema,
} from "@tax/core";
import type { TaxDatabase } from "@tax/db";
import { computeUsEquityReport } from "@tax/engine";
import { loadRules } from "@tax/rules";
import { runJob } from "./context";
import { ApiError } from "./errors";
import { expireReviewResolutions } from "./report-review";
import {
	checkActualBalancePool,
	checkYear,
	groupWarnings,
	importWarnings,
	loadSbiFx,
	normalizeActualBalances,
} from "./reports";
import { getSettings } from "./settings";

export async function computeUsEquity(db: TaxDatabase, taxYear: string) {
	checkYear(taxYear);
	const rules = loadRules("india-us-equity", taxYear);
	return runJob(db, "compute_us_equity", { taxYear }, async () => {
		const { fx, warning } = await loadSbiFx();
		return db.atomic(() => {
			const settings = EngineSettingsSchema.parse(getSettings(db));
			const actualBalances = db.usEquityActualBalances.get(taxYear);
			checkActualBalancePool(actualBalances, settings.lotPool);

			const { end } = taxYearBounds(taxYear);
			const calendarEnd = `${rules.scheduleFaCalendarYear}-12-31`;
			const through = end > calendarEnd ? end : calendarEnd;
			const transactions = db.transactions
				.active("us_equity")
				.filter((tx) => istDate(tx.timestamp) <= through);
			const computed = computeUsEquityReport({
				transactions,
				rules,
				taxYear,
				settings,
				actualBalances,
				metadata: db.equityMetadata.list(),
				cyPrices: db.equityCyPrices.list(rules.scheduleFaCalendarYear),
				fx,
			});
			const importIssues = importWarnings(db, "us_equity", transactions);
			const demoImports = new Set(db.imports.demoIds());
			const report = UsEquityReportSchema.parse({
				...computed,
				warnings: groupWarnings([
					...computed.warnings,
					...(warning ? [warning] : []),
					...importIssues,
				]),
				incomplete:
					computed.incomplete ||
					Boolean(warning) ||
					importIssues.some(({ code }) => code === "import_incomplete"),
				includesDemoData: transactions.some(
					(tx) => tx.importId && demoImports.has(tx.importId),
				),
			});
			db.usEquityReports.save(report);
			expireReviewResolutions(db, taxYear);
			return report;
		}, "immediate");
	});
}

export function getUsEquityReportState(
	db: TaxDatabase,
	taxYear: string,
	allowStale = true,
) {
	checkYear(taxYear);
	return db.atomic(() => {
		const { report, status } = db.usEquityReports.snapshot(taxYear);
		if (!report || (status === "stale" && !allowStale))
			return {
				status: "missing" as const,
				...db.usEquityReports.missingDetails(taxYear),
			};
		return status === "stale" ? { ...report, stale: true as const } : report;
	});
}

export function getUsEquityReport(
	db: TaxDatabase,
	taxYear: string,
	allowStale = false,
) {
	const result = getUsEquityReportState(db, taxYear, allowStale);
	if ("status" in result) {
		const { invalidatedAt, cause } = result;
		throw new ApiError(
			404,
			"report_not_computed",
			"Compute a US equity report for this year first.",
			{ invalidatedAt, cause },
		);
	}
	return result;
}

function uniqueSymbols(rows: { symbol: string }[]) {
	const symbols = new Set<string>();
	for (const { symbol } of rows) {
		if (symbols.has(symbol))
			throw new ApiError(409, "conflict", `Duplicate equity symbol ${symbol}.`);
		symbols.add(symbol);
	}
}

export function getEquityMetadata(db: TaxDatabase) {
	return db.equityMetadata.list();
}

export function putEquityMetadata(db: TaxDatabase, rows: EquityMetadata[]) {
	uniqueSymbols(rows);
	return db.equityMetadata.replace(rows);
}

export function getEquityPrices(db: TaxDatabase, calendarYear: number) {
	return db.equityCyPrices.list(calendarYear);
}

export function putEquityPrices(
	db: TaxDatabase,
	calendarYear: number,
	rows: EquityCyPrice[],
) {
	uniqueSymbols(rows);
	return db.equityCyPrices.replace(calendarYear, rows);
}

export function getUsEquityBalances(db: TaxDatabase, taxYear: string) {
	checkYear(taxYear);
	return db.usEquityActualBalances.get(taxYear);
}

export function putUsEquityBalances(
	db: TaxDatabase,
	taxYear: string,
	rows: ActualBalance[],
) {
	checkYear(taxYear);
	return db.atomic(
		() =>
			db.usEquityActualBalances.replace(
				taxYear,
				normalizeActualBalances(rows, getSettings(db).lotPool),
			),
		"immediate",
	);
}
