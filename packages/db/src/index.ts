import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ActualBalance,
	ActualBalanceSchema,
	D,
	eventFingerprint,
	type LedgerTx,
	LedgerTxSchema,
	type Recipe,
	RecipeSchema,
	siblingChannel,
	type VdaReport,
	VdaReportSchema,
} from "@tax/core";
import {
	type BalanceSnapshot,
	BalanceSnapshotSchema,
	GetImportResponseSchema,
	type ImportDetail,
	type ReportMissingDetails,
} from "@tax/core/api";
import Database, { type Database as SQLiteDatabase } from "better-sqlite3";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { phase2Repositories } from "./phase2.js";
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
	sqlite.transaction(() => {
		const rows = sqlite
			.prepare("SELECT * FROM transactions WHERE fingerprint IS NULL")
			.all() as Record<string, unknown>[];
		for (const row of rows) {
			const tx = {
				source: row.source,
				sourceRef: row.source_ref,
				timestamp: row.timestamp,
				type: row.type,
				assetIn: row.asset_in ?? undefined,
				amountIn: row.amount_in ?? undefined,
				assetOut: row.asset_out ?? undefined,
				amountOut: row.amount_out ?? undefined,
				txHash: row.tx_hash ?? undefined,
			} as LedgerTx;
			sqlite
				.prepare("UPDATE transactions SET fingerprint=? WHERE id=?")
				.run(eventFingerprint(tx), row.id);
		}
	})();
	const invalidateReports = (
		cause: Exclude<ReportMissingDetails["cause"], "never_computed">,
		onlyTaxYear?: string,
	) => {
		const invalidatedAt = new Date().toISOString();
		const scope = onlyTaxYear
			? eq(schema.reports.taxYear, onlyTaxYear)
			: undefined;
		const years = orm
			.selectDistinct({ taxYear: schema.reports.taxYear })
			.from(schema.reports)
			.where(scope)
			.all();
		for (const { taxYear } of years)
			orm
				.insert(schema.reportInvalidations)
				.values({ taxYear, invalidatedAt, cause })
				.onConflictDoUpdate({
					target: schema.reportInvalidations.taxYear,
					set: { invalidatedAt, cause },
				})
				.run();
		orm.delete(schema.reports).where(scope).run();
	};
	const txValues = (tx: LedgerTx) => ({
		...tx,
		fingerprint: eventFingerprint(tx),
		...Object.fromEntries(
			Object.keys(schema.transactions)
				.filter((key) => key in tx && tx[key as keyof LedgerTx] === undefined)
				.map((key) => [key, null]),
		),
	});

	const duplicateTransaction = (
		tx: LedgerTx,
		absorbed: Set<string>,
		skipCrossChannel = false,
	): string | undefined => {
		const direct = sqlite
			.prepare("SELECT id FROM transactions WHERE source=? AND source_ref=?")
			.get(tx.source, tx.sourceRef) as { id: string } | undefined;
		const linked = sqlite
			.prepare(
				"SELECT t.id FROM raw_rows r JOIN transactions t ON t.id=r.tx_id WHERE r.source=? AND r.source_ref=? LIMIT 1",
			)
			.get(tx.source, tx.sourceRef) as { id: string } | undefined;
		if (direct ?? linked) return (direct ?? linked)?.id;
		const sibling = siblingChannel(tx.source),
			fingerprint = eventFingerprint(tx);
		if (skipCrossChannel || !sibling || !fingerprint) return undefined;
		const candidates = sqlite
			.prepare(
				"SELECT t.id FROM transactions t WHERE t.superseded_by IS NULL AND t.source=? AND t.type=? AND t.fingerprint=? AND NOT EXISTS (SELECT 1 FROM raw_rows r WHERE r.tx_id=t.id AND r.source=?) ORDER BY t.id",
			)
			.all(sibling, tx.type, fingerprint, tx.source) as { id: string }[];
		const exact = candidates.find((row) => !absorbed.has(row.id));
		if (exact) absorbed.add(exact.id);
		return exact?.id;
	};
	const repositories = {
		imports: {
			syncConnections: (id: string): string[] => {
				const related = sqlite
					.prepare(
						"SELECT DISTINCT i.connection_id AS connectionId FROM raw_rows r JOIN imports i ON i.id=r.import_id JOIN transactions t ON t.id=r.tx_id WHERE t.import_id=? AND i.connection_id IS NOT NULL UNION SELECT connection_id AS connectionId FROM imports WHERE id=? AND connection_id IS NOT NULL",
					)
					.all(id, id) as { connectionId: string }[];
				return related.map((row) => row.connectionId);
			},
			list: () =>
				orm
					.select()
					.from(schema.imports)
					.orderBy(desc(schema.imports.createdAt))
					.all()
					.map((v) =>
						GetImportResponseSchema.parse({
							...v,
							sheets: v.sheets ?? undefined,
							tdsSummary: v.tdsSummary ?? undefined,
							connectionLabel: v.connectionId
								? (orm
										.select()
										.from(schema.connections)
										.where(eq(schema.connections.id, v.connectionId))
										.get()?.label ?? null)
								: null,
						}),
					),
			get: (id: string) => {
				const row = orm
					.select()
					.from(schema.imports)
					.where(eq(schema.imports.id, id))
					.get();
				return row
					? GetImportResponseSchema.parse({
							...row,
							sheets: row.sheets ?? undefined,
							tdsSummary: row.tdsSummary ?? undefined,
							balanceSnapshot: orm
								.select()
								.from(schema.balanceSnapshots)
								.where(eq(schema.balanceSnapshots.importId, id))
								.get(),
							connectionLabel: row.connectionId
								? (orm
										.select()
										.from(schema.connections)
										.where(eq(schema.connections.id, row.connectionId))
										.get()?.label ?? null)
								: null,
						})
					: undefined;
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
					const imported = orm
						.select()
						.from(schema.imports)
						.where(eq(schema.imports.id, id))
						.get();
					sqlite
						.prepare(
							"DELETE FROM sync_cursors WHERE connection_id IN (SELECT i.connection_id FROM raw_rows r JOIN imports i ON i.id=r.import_id JOIN transactions t ON t.id=r.tx_id WHERE t.import_id=?)",
						)
						.run(id);
					if (imported?.connectionId)
						sqlite
							.prepare("DELETE FROM sync_cursors WHERE connection_id=?")
							.run(imported.connectionId);
					sqlite
						.prepare(
							"UPDATE raw_rows SET tx_id=NULL WHERE tx_id IN (SELECT id FROM transactions WHERE import_id=?)",
						)
						.run(id);
					const result = orm
						.delete(schema.imports)
						.where(eq(schema.imports.id, id))
						.run();
					invalidateReports("ledger_changed");
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
		balanceSnapshots: {
			list: () =>
				orm
					.select()
					.from(schema.balanceSnapshots)
					.orderBy(desc(schema.balanceSnapshots.createdAt))
					.all()
					.map((row) => BalanceSnapshotSchema.parse(row)),
			get: (id: string) => {
				const row = orm
					.select()
					.from(schema.balanceSnapshots)
					.where(eq(schema.balanceSnapshots.id, id))
					.get();
				return row ? BalanceSnapshotSchema.parse(row) : undefined;
			},
			save: (snapshot: BalanceSnapshot) => {
				const row = BalanceSnapshotSchema.parse(snapshot);
				orm.insert(schema.balanceSnapshots).values(row).run();
				return row;
			},
		},
		transactions: {
			matchDuplicates: (transactions: LedgerTx[]) => {
				const absorbed = new Set<string>();
				return transactions.flatMap((tx) => {
					const existingId = duplicateTransaction(tx, absorbed);
					return existingId ? [{ incomingId: tx.id, existingId }] : [];
				});
			},
			active: (): LedgerTx[] => {
				const excluded = new Set(
					repositories.transactions.superseded().map((row) => row.txId),
				);
				return repositories.transactions
					.all()
					.filter((tx) => !excluded.has(tx.id));
			},
			superseded: (): { txId: string; importId: string }[] =>
				sqlite
					.prepare(
						"SELECT id AS txId, superseded_by AS importId FROM transactions WHERE superseded_by IS NOT NULL ORDER BY id",
					)
					.all() as { txId: string; importId: string }[],
			supersede: (id: string, importId: string) => {
				sqlite
					.prepare("UPDATE transactions SET superseded_by=? WHERE id=?")
					.run(importId, id);
				invalidateReports("ledger_changed");
			},
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
			insert: (
				rows: {
					tx: LedgerTx;
					rawRowId?: string;
					duplicateOf?: string;
					skipCrossChannel?: boolean;
				}[],
			) =>
				orm.transaction(() => {
					let inserted = 0;
					const absorbed = new Set<string>();
					for (const { tx, rawRowId, duplicateOf, skipCrossChannel } of rows) {
						let value = LedgerTxSchema.parse(tx);
						const supplementFileTds = (txId: string) => {
							if (
								value.source !== "coindcx" ||
								value.tdsInr === undefined ||
								!D(value.tdsInr).gt("0")
							)
								return;
							const stored = orm
								.select()
								.from(schema.transactions)
								.where(eq(schema.transactions.id, txId))
								.get();
							if (
								stored?.source !== "coindcx-api" ||
								stored.userEdited ||
								stored.tdsInr !== null
							)
								return;
							orm
								.update(schema.transactions)
								.set({
									tdsInr: value.tdsInr,
									reviewFlags: [
										...stored.reviewFlags,
										{
											code: "parse_warning",
											message: `TDS credit supplied by exact-matching CoinDCX file row in import ${value.importId}; the linked original contains the deduction.`,
										},
									],
								})
								.where(eq(schema.transactions.id, txId))
								.run();
							invalidateReports("ledger_changed");
						};
						const link = (txId: string) => {
							if (rawRowId)
								sqlite
									.prepare(
										"UPDATE raw_rows SET tx_id=?,source=?,source_ref=? WHERE id=?",
									)
									.run(txId, value.source, value.sourceRef, rawRowId);
						};
						const matchedId =
							duplicateOf ??
							duplicateTransaction(value, absorbed, skipCrossChannel);
						if (duplicateOf) absorbed.add(duplicateOf);
						const known = matchedId ? { id: matchedId } : undefined;
						if (known) {
							link(known.id);
							supplementFileTds(known.id);
							continue;
						}
						const sibling = siblingChannel(value.source);
						if (sibling && !skipCrossChannel) {
							const others = sqlite
								.prepare(
									"SELECT id,timestamp,amount_in,amount_out FROM transactions WHERE superseded_by IS NULL AND source=? AND type=? AND asset_in IS ? AND asset_out IS ?",
								)
								.all(
									sibling,
									value.type,
									value.assetIn ?? null,
									value.assetOut ?? null,
								) as {
								id: string;
								timestamp: string;
								amount_in: string | null;
								amount_out: string | null;
							}[];
							const near = others.find(
								(other) =>
									Math.abs(
										Date.parse(other.timestamp) - Date.parse(value.timestamp),
									) <= 2000 ||
									((value.amountIn !== undefined ||
										value.amountOut !== undefined) &&
										(!value.amountIn ||
											(other.amount_in &&
												D(value.amountIn)
													.minus(other.amount_in)
													.abs()
													.lte("0.00000001"))) &&
										(!value.amountOut ||
											(other.amount_out &&
												D(value.amountOut)
													.minus(other.amount_out)
													.abs()
													.lte("0.00000001")))),
							);
							if (near)
								value = {
									...value,
									reviewFlags: [
										...value.reviewFlags,
										{
											code: "possible_duplicate",
											message: `Possible sibling-channel duplicate of ${near.id}; review both original rows.`,
										},
									],
								};
						}
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
						link(value.id);
					}
					if (inserted) invalidateReports("ledger_changed");
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
					invalidateReports("ledger_changed");
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
					invalidateReports("ledger_changed");
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
					const previous = orm
						.select()
						.from(schema.settings)
						.where(eq(schema.settings.key, key))
						.get()?.value;
					orm
						.insert(schema.settings)
						.values({ key, value })
						.onConflictDoUpdate({ target: schema.settings.key, set: { value } })
						.run();
					// Only engine settings feed the tax computation; AI or UI preferences must not clear reports.
					if (
						key === "engine" &&
						JSON.stringify(previous) !== JSON.stringify(value)
					)
						invalidateReports("settings_changed");
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
					invalidateReports("balances_changed", taxYear);
					return rows;
				}),
		},
		reports: {
			invalidate: () => invalidateReports("ledger_changed"),
			missingDetails: (taxYear: string): ReportMissingDetails =>
				orm
					.select({
						invalidatedAt: schema.reportInvalidations.invalidatedAt,
						cause: schema.reportInvalidations.cause,
					})
					.from(schema.reportInvalidations)
					.where(eq(schema.reportInvalidations.taxYear, taxYear))
					.get() ?? { invalidatedAt: null, cause: "never_computed" },
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
			progress: (id: string, progress: unknown) =>
				orm
					.update(schema.jobs)
					.set({ progress, updatedAt: new Date().toISOString() })
					.where(eq(schema.jobs.id, id))
					.run(),
			forConnection: (
				connectionId: string,
			): (typeof schema.jobs.$inferSelect)[] => {
				const ids = sqlite
					.prepare(
						"SELECT id FROM jobs WHERE kind='sync' AND json_extract(payload, '$.connectionId')=? ORDER BY rowid DESC",
					)
					.all(connectionId) as { id: string }[];
				return ids.flatMap(({ id }) => {
					const row = repositories.jobs.get(id);
					return row ? [row] : [];
				});
			},
			running: (connectionId: string) =>
				orm
					.select()
					.from(schema.jobs)
					.where(inArray(schema.jobs.status, ["pending", "running"]))
					.all()
					.some(
						(row) =>
							row.kind === "sync" &&
							(row.payload as { connectionId?: string })?.connectionId ===
								connectionId,
					),
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
				orm.transaction(() => {
					const changed = orm
						.update(schema.jobs)
						.set({
							status: "failed",
							error: "Server restarted before completion; retry the operation.",
							updatedAt: new Date().toISOString(),
						})
						.where(inArray(schema.jobs.status, ["pending", "running"]))
						.run().changes;
					sqlite
						.prepare(
							"UPDATE connections SET last_sync_status='failed',last_sync_error='Server restarted before completion; retry to resume.' WHERE last_sync_status='running'",
						)
						.run();
					return changed;
				}),
		},
	};
	return {
		...repositories,
		...phase2Repositories(sqlite, () => invalidateReports("ledger_changed")),
		dataDir: directory,
		atomic: <T>(fn: () => T): T => orm.transaction(fn),
		health: () => sqlite.prepare("SELECT 1").get() !== undefined,
		close: (): void => {
			sqlite.close();
		},
	};
}
export type TaxDatabase = ReturnType<typeof openDatabase>;
