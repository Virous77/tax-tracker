import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ActualBalance,
	ActualBalanceSchema,
	type LedgerTx,
	LedgerTxSchema,
	type Recipe,
	RecipeSchema,
	type VdaReport,
	VdaReportSchema,
} from "@tax/core";
import { GetImportResponseSchema, type ImportDetail } from "@tax/core/api";
import Database, { type Database as SQLiteDatabase } from "better-sqlite3";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export * as schema from "./schema.js";
export function openDatabase(dataDir = process.env.DATA_DIR ?? "./data") {
	const directory = resolve(/* turbopackIgnore: true */ dataDir);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = resolve(directory, "tax-tracker.db");
	const sqlite: SQLiteDatabase = new Database(path);
	chmodSync(path, 0o600);
	sqlite.pragma("foreign_keys = ON");
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("journal_mode = WAL");
	const orm = drizzle(sqlite, { schema });
	migrate(orm, {
		migrationsFolder: resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../migrations",
		),
	});
	const invalidateReports = () => orm.delete(schema.reports).run();
	const txValues = (tx: LedgerTx) => ({
		...tx,
		...Object.fromEntries(
			Object.keys(schema.transactions)
				.filter((key) => key in tx && tx[key as keyof LedgerTx] === undefined)
				.map((key) => [key, null]),
		),
	});
	const repositories = {
		imports: {
			list: () =>
				orm
					.select()
					.from(schema.imports)
					.orderBy(desc(schema.imports.createdAt))
					.all()
					.map((v) => GetImportResponseSchema.parse(v)),
			get: (id: string) => {
				const row = orm
					.select()
					.from(schema.imports)
					.where(eq(schema.imports.id, id))
					.get();
				return row ? GetImportResponseSchema.parse(row) : undefined;
			},
			save: (value: ImportDetail) => {
				const row = GetImportResponseSchema.parse(value);
				orm
					.insert(schema.imports)
					.values(row)
					.onConflictDoUpdate({ target: schema.imports.id, set: row })
					.run();
				return row;
			},
			delete: (id: string) =>
				orm.transaction(() => {
					const result = orm
						.delete(schema.imports)
						.where(eq(schema.imports.id, id))
						.run();
					invalidateReports();
					return result.changes > 0;
				}),
		},
		rawRows: {
			insert: (rows: (typeof schema.rawRows.$inferInsert)[]) =>
				orm.transaction(() => {
					for (const row of rows) orm.insert(schema.rawRows).values(row).run();
				}),
			list: (importId: string) =>
				orm
					.select()
					.from(schema.rawRows)
					.where(eq(schema.rawRows.importId, importId))
					.orderBy(schema.rawRows.sheet, schema.rawRows.rowIndex)
					.all(),
		},
		transactions: {
			all: () =>
				orm
					.select()
					.from(schema.transactions)
					.orderBy(
						schema.transactions.timestamp,
						schema.transactions.source,
						schema.transactions.sourceRef,
					)
					.all()
					.map((v) =>
						LedgerTxSchema.parse(
							Object.fromEntries(
								Object.entries(v).filter(
									([k, x]) => x !== null || k === "importId" || k === "raw",
								),
							),
						),
					),
			get: (id: string) => {
				const row = orm
					.select()
					.from(schema.transactions)
					.where(eq(schema.transactions.id, id))
					.get();
				return row
					? LedgerTxSchema.parse(
							Object.fromEntries(
								Object.entries(row).filter(
									([k, x]) => x !== null || k === "importId" || k === "raw",
								),
							),
						)
					: undefined;
			},
			insert: (rows: { tx: LedgerTx; rawRowId?: string }[]) =>
				orm.transaction(() => {
					let inserted = 0;
					for (const { tx, rawRowId } of rows) {
						const value = LedgerTxSchema.parse(tx);
						inserted += orm
							.insert(schema.transactions)
							.values({ ...txValues(value), rawRowId })
							.onConflictDoNothing({
								target: [
									schema.transactions.source,
									schema.transactions.sourceRef,
								],
							})
							.run().changes;
					}
					if (inserted) invalidateReports();
					return { inserted, duplicate: rows.length - inserted };
				}),
			update: (tx: LedgerTx) =>
				orm.transaction(() => {
					const value = LedgerTxSchema.parse(tx);
					const result = orm
						.update(schema.transactions)
						.set({
							...txValues(value),
							incomeKind: value.incomeKind ?? null,
							userEdited: true,
						})
						.where(eq(schema.transactions.id, value.id))
						.run();
					invalidateReports();
					return result.changes > 0;
				}),
			deleteManual: (id: string) =>
				orm.transaction(() => {
					const result = orm
						.delete(schema.transactions)
						.where(
							and(
								eq(schema.transactions.id, id),
								eq(schema.transactions.source, "manual"),
							),
						)
						.run();
					invalidateReports();
					return result.changes > 0;
				}),
		},
		recipes: {
			list: () =>
				orm
					.select()
					.from(schema.recipes)
					.all()
					.map((v) => RecipeSchema.parse(v.json)),
			save: (recipe: Recipe, origin: "ai" | "user" | "library" = "user") => {
				const json = RecipeSchema.parse(recipe);
				orm
					.insert(schema.recipes)
					.values({
						id: json.id,
						name: json.name,
						fingerprint: json.fingerprint,
						sheet: json.sheet,
						json,
						origin,
						createdAt: new Date().toISOString(),
					})
					.onConflictDoUpdate({
						target: schema.recipes.fingerprint,
						set: {
							id: json.id,
							name: json.name,
							json,
							sheet: json.sheet,
							origin,
						},
					})
					.run();
				return json;
			},
			delete: (id: string) =>
				orm.delete(schema.recipes).where(eq(schema.recipes.id, id)).run()
					.changes > 0,
		},
		settings: {
			get: (key: string): unknown =>
				orm
					.select()
					.from(schema.settings)
					.where(eq(schema.settings.key, key))
					.get()?.value,
			set: (key: string, value: unknown) =>
				orm.transaction(() => {
					orm
						.insert(schema.settings)
						.values({ key, value })
						.onConflictDoUpdate({ target: schema.settings.key, set: { value } })
						.run();
					invalidateReports();
				}),
		},
		actualBalances: {
			get: (taxYear: string): ActualBalance[] =>
				orm
					.select()
					.from(schema.actualBalances)
					.where(eq(schema.actualBalances.taxYear, taxYear))
					.all()
					.map((v) =>
						ActualBalanceSchema.parse({
							asset: v.asset,
							amount: v.amount,
							...(v.source ? { source: v.source } : {}),
						}),
					),
			replace: (taxYear: string, values: ActualBalance[]) =>
				orm.transaction(() => {
					const rows = ActualBalanceSchema.array().parse(values);
					orm
						.delete(schema.actualBalances)
						.where(eq(schema.actualBalances.taxYear, taxYear))
						.run();
					for (const row of rows)
						orm
							.insert(schema.actualBalances)
							.values({ ...row, taxYear, source: row.source ?? "" })
							.run();
					invalidateReports();
					return rows;
				}),
		},
		reports: {
			save: (report: VdaReport) => {
				const value = VdaReportSchema.parse(report);
				orm
					.insert(schema.reports)
					.values({
						id: randomUUID(),
						taxYear: value.taxYear,
						computedAt: new Date().toISOString(),
						settingsJson: value.generatedFrom.settings,
						reportJson: value,
					})
					.run();
				return value;
			},
			latest: (taxYear: string) => {
				const row = orm
					.select()
					.from(schema.reports)
					.where(eq(schema.reports.taxYear, taxYear))
					.orderBy(desc(schema.reports.computedAt), desc(schema.reports.id))
					.get();
				return row ? VdaReportSchema.parse(row.reportJson) : undefined;
			},
		},
		jobs: {
			create: (kind: string, payload: unknown) => {
				const id = randomUUID();
				const now = new Date().toISOString();
				orm
					.insert(schema.jobs)
					.values({
						id,
						kind,
						payload,
						status: "pending",
						createdAt: now,
						updatedAt: now,
					})
					.run();
				return id;
			},
			get: (id: string) =>
				orm.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get(),
			update: (
				id: string,
				status: "running" | "completed" | "failed",
				result: unknown = null,
				error: string | null = null,
			) =>
				orm
					.update(schema.jobs)
					.set({ status, result, error, updatedAt: new Date().toISOString() })
					.where(eq(schema.jobs.id, id))
					.run().changes,
			recover: () =>
				orm
					.update(schema.jobs)
					.set({
						status: "failed",
						error: "Server restarted before completion; retry the operation.",
						updatedAt: new Date().toISOString(),
					})
					.where(inArray(schema.jobs.status, ["pending", "running"]))
					.run().changes,
		},
	};
	return {
		...repositories,
		dataDir: directory,
		atomic: <T>(fn: () => T): T => orm.transaction(fn),
		health: () => sqlite.prepare("SELECT 1").get() !== undefined,
		close: (): void => {
			sqlite.close();
		},
	};
}
export type TaxDatabase = ReturnType<typeof openDatabase>;
