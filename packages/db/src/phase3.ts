import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	type EquityCyPrice,
	EquityCyPriceSchema,
	type EquityMetadata,
	EquityMetadataSchema,
	type UsEquityReport,
	UsEquityReportSchema,
} from "@tax/core";
import { desc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { actualBalanceRepository } from "./actual-balances.js";
import {
	equityCyPrices,
	equityMetadata,
	usEquityReportInvalidations as invalidations,
	usEquityReports as reports,
	usEquityActualBalances,
} from "./schema.js";

type InvalidationCause = (typeof invalidations.$inferInsert)["cause"];

function omitNull(row: object) {
	return Object.fromEntries(
		Object.entries(row).filter(([, value]) => value !== null),
	);
}

export function phase3Repositories(orm: BetterSQLite3Database) {
	const invalidate = (
		cause: InvalidationCause = "ledger_changed",
		scope: { taxYear?: string; calendarYear?: number } = {},
	) => {
		const { taxYear, calendarYear } = scope;
		orm.run(sql`
			INSERT OR IGNORE INTO ${invalidations} (tax_year, invalidated_at, cause)
			SELECT DISTINCT ${reports.taxYear}, ${new Date().toISOString()}, ${cause}
			FROM ${reports}
			WHERE (${taxYear ?? null} IS NULL OR ${reports.taxYear} = ${taxYear ?? null})
			AND (${calendarYear ?? null} IS NULL OR json_extract(${reports.reportJson}, '$.calendarYear') = ${calendarYear ?? null})
		`);
	};
	const listMetadata = () =>
		orm
			.select()
			.from(equityMetadata)
			.orderBy(equityMetadata.symbol)
			.all()
			.map((row) => EquityMetadataSchema.parse(omitNull(row)));
	const listPrices = (calendarYear: number) =>
		orm
			.select()
			.from(equityCyPrices)
			.where(eq(equityCyPrices.calendarYear, calendarYear))
			.orderBy(equityCyPrices.symbol)
			.all()
			.map((row) => EquityCyPriceSchema.parse(omitNull(row)));
	return {
		usEquityReports: {
			invalidate,
			snapshot: (taxYear: string) => {
				const row = orm
					.select({
						report: reports.reportJson,
						stale: invalidations.invalidatedAt,
					})
					.from(reports)
					.leftJoin(invalidations, eq(invalidations.taxYear, reports.taxYear))
					.where(eq(reports.taxYear, taxYear))
					.orderBy(desc(reports.computedAt), sql`${reports}.rowid DESC`)
					.get();
				return row
					? {
							report: UsEquityReportSchema.parse(row.report),
							status: row.stale ? ("stale" as const) : ("current" as const),
						}
					: { report: undefined, status: "missing" as const };
			},
			missingDetails: (taxYear: string) =>
				orm
					.select({
						invalidatedAt: invalidations.invalidatedAt,
						cause: invalidations.cause,
					})
					.from(invalidations)
					.where(eq(invalidations.taxYear, taxYear))
					.get() ?? { invalidatedAt: null, cause: "never_computed" as const },
			save: (report: UsEquityReport) =>
				orm.transaction(() => {
					const value = UsEquityReportSchema.parse(report);
					orm.delete(reports).where(eq(reports.taxYear, value.taxYear)).run();
					orm
						.insert(reports)
						.values({
							id: randomUUID(),
							taxYear: value.taxYear,
							computedAt: new Date().toISOString(),
							settingsJson: value.generatedFrom.settings,
							reportJson: value,
						})
						.run();
					orm
						.delete(invalidations)
						.where(eq(invalidations.taxYear, value.taxYear))
						.run();
					return value;
				}),
		},
		equityMetadata: {
			list: listMetadata,
			replace: (values: EquityMetadata[]) =>
				orm.transaction(() => {
					const rows = EquityMetadataSchema.array().parse(values);
					const previous = listMetadata();
					orm.delete(equityMetadata).run();
					for (const row of rows) orm.insert(equityMetadata).values(row).run();
					const saved = listMetadata();
					if (!isDeepStrictEqual(saved, previous))
						invalidate("metadata_changed");
					return saved;
				}),
		},
		equityCyPrices: {
			list: listPrices,
			replace: (calendarYear: number, values: EquityCyPrice[]) =>
				orm.transaction(() => {
					const rows = EquityCyPriceSchema.array().parse(values);
					if (rows.some((row) => row.calendarYear !== calendarYear))
						throw new Error(
							"All prices must belong to the requested calendar year.",
						);
					const previous = listPrices(calendarYear);
					orm
						.delete(equityCyPrices)
						.where(eq(equityCyPrices.calendarYear, calendarYear))
						.run();
					for (const row of rows) orm.insert(equityCyPrices).values(row).run();
					const saved = listPrices(calendarYear);
					if (!isDeepStrictEqual(saved, previous))
						invalidate("prices_changed", { calendarYear });
					return saved;
				}),
		},
		usEquityActualBalances: actualBalanceRepository(
			orm,
			usEquityActualBalances,
			(taxYear) => invalidate("balances_changed", { taxYear }),
		),
	};
}
