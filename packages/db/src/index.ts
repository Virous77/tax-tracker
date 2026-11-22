import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	type AssetClass,
	D,
	EngineSettingsSchema,
	eventFingerprint,
	type LedgerTx,
	LedgerTxSchema,
	type Recipe,
	RecipeSchema,
	siblingChannel,
	transactionTaxInputs,
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
import type { Database as SQLiteDatabase } from "better-sqlite3";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { actualBalanceRepository } from "./actual-balances.js";
import { backupDatabase, openMigratedDatabase } from "./backup.js";
import { phase2Repositories } from "./phase2.js";
import { phase3Repositories } from "./phase3.js";
import * as schema from "./schema.js";

export * as schema from "./schema.js";

type AssetClassFilter = AssetClass | "all";
export async function openDatabase(dataDir = process.env.DATA_DIR ?? "./data") {
	const { sqlite, directory } = await openMigratedDatabase(dataDir);
	try {
		return repositoriesFor(sqlite, directory);
	} catch (error) {
		sqlite.close();
		throw error;
	}
}

function repositoriesFor(sqlite: SQLiteDatabase, directory: string) {
	const orm = drizzle(sqlite);
	const equity = phase3Repositories(orm);
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
			.leftJoin(
				schema.reportInvalidations,
				eq(schema.reportInvalidations.taxYear, schema.reports.taxYear),
			)
			.where(and(scope, isNull(schema.reportInvalidations.taxYear)))
			.all();
		for (const { taxYear } of years)
			orm
				.insert(schema.reportInvalidations)
				.values({ taxYear, invalidatedAt, cause })
				.onConflictDoNothing()
				.run();
	};
	const reportSnapshot = (taxYear: string) => {
		const row = orm
			.select({
				report: schema.reports.reportJson,
				stale: schema.reportInvalidations.invalidatedAt,
			})
			.from(schema.reports)
			.leftJoin(
				schema.reportInvalidations,
				eq(schema.reportInvalidations.taxYear, schema.reports.taxYear),
			)
			.where(eq(schema.reports.taxYear, taxYear))
			.orderBy(
				desc(schema.reports.computedAt),
				sql`${schema.reports}.rowid DESC`,
			)
			.get();
		return row
			? {
					report: VdaReportSchema.parse(row.report),
					status: row.stale ? ("stale" as const) : ("current" as const),
				}
			: { report: undefined, status: "missing" as const };
	};
	const invalidateLedger = (classes: Iterable<AssetClass>) => {
		const affected = new Set(classes);
		if (affected.has("vda")) invalidateReports("ledger_changed");
		if (affected.has("us_equity")) equity.usEquityReports.invalidate();
	};
	const importAssetClasses = (id: string) =>
		(
			sqlite
				.prepare(`
			SELECT DISTINCT asset_class AS assetClass FROM transactions
			WHERE import_id = ? OR superseded_by = ? OR raw_row_id IN (
				SELECT id FROM raw_rows WHERE import_id = ?
			)
		`)
				.all(id, id, id) as { assetClass: AssetClass }[]
		).map(({ assetClass }) => assetClass);
	const readTransaction = (row: typeof schema.transactions.$inferSelect) =>
		LedgerTxSchema.parse(
			Object.fromEntries(
				Object.entries(row).filter(
					([key, value]) =>
						value !== null || key === "importId" || key === "raw",
				),
			),
		);
	const listTransactions = (
		assetClass: AssetClassFilter = "all",
		active = false,
	) =>
		orm
			.select()
			.from(schema.transactions)
			.where(
				and(
					assetClass === "all"
						? undefined
						: eq(schema.transactions.assetClass, assetClass),
					active ? isNull(schema.transactions.supersededBy) : undefined,
				),
			)
			.orderBy(
				schema.transactions.timestamp,
				schema.transactions.source,
				schema.transactions.sourceRef,
			)
			.all()
			.map(readTransaction);
	const txValues = (tx: LedgerTx) => ({
		...tx,
		fingerprint: eventFingerprint(tx),
		...Object.fromEntries(
			Object.keys(schema.transactions)
				.filter((key) => key in tx && tx[key as keyof LedgerTx] === undefined)
				.map((key) => [key, null]),
		),
		assetClass: tx.assetClass ?? "vda",
		dividendAsset: tx.dividendAsset ?? null,
		withholdingTaxAmount: tx.withholdingTaxAmount ?? null,
		withholdingTaxAsset: tx.withholdingTaxAsset ?? null,
		entityName: tx.entityName ?? null,
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
				"SELECT t.id FROM transactions t WHERE t.superseded_by IS NULL AND NOT EXISTS (SELECT 1 FROM imports i WHERE i.id=t.import_id AND i.demo=1) AND t.source=? AND t.type=? AND t.asset_class=? AND t.fingerprint=? AND NOT EXISTS (SELECT 1 FROM raw_rows r WHERE r.tx_id=t.id AND r.source=?) ORDER BY t.id",
			)
			.all(
				sibling,
				tx.type,
				tx.assetClass ?? "vda",
				fingerprint,
				tx.source,
			) as { id: string }[];
		const exact = candidates.find((row) => !absorbed.has(row.id));
		if (exact) absorbed.add(exact.id);
		return exact?.id;
	};
	const repositories = {
		imports: {
			findPendingGenericFile: (fileSha256: string) => {
				const row = orm
					.select({ id: schema.imports.id })
					.from(schema.imports)
					.where(
						and(
							eq(schema.imports.fileSha256, fileSha256),
							eq(schema.imports.source, "generic"),
							eq(schema.imports.kind, "file"),
							eq(schema.imports.status, "pending_recipe"),
						),
					)
					.orderBy(schema.imports.createdAt, schema.imports.id)
					.get();
				return row && repositories.imports.get(row.id);
			},
			demoIds: () =>
				orm
					.select({ id: schema.imports.id })
					.from(schema.imports)
					.where(eq(schema.imports.demo, true))
					.orderBy(schema.imports.id)
					.all()
					.map(({ id }) => id),
			activeDemoTimestamps: () =>
				orm
					.select({ timestamp: schema.transactions.timestamp })
					.from(schema.transactions)
					.innerJoin(
						schema.imports,
						eq(schema.imports.id, schema.transactions.importId),
					)
					.where(
						and(
							eq(schema.imports.demo, true),
							isNull(schema.transactions.supersededBy),
						),
					)
					.all()
					.map(({ timestamp }) => timestamp),
			syncConnections: (id: string): string[] => {
				const related = sqlite
					.prepare(
						"SELECT DISTINCT i.connection_id AS connectionId FROM raw_rows r JOIN imports i ON i.id=r.import_id JOIN transactions t ON t.id=r.tx_id WHERE t.import_id=? AND i.connection_id IS NOT NULL UNION SELECT connection_id AS connectionId FROM imports WHERE id=? AND connection_id IS NOT NULL",
					)
					.all(id, id) as { connectionId: string }[];
				return related.map((row) => row.connectionId);
			},
			list: (assetClass?: AssetClass) =>
				orm
					.select()
					.from(schema.imports)
					.where(
						assetClass
							? eq(
									sql`coalesce(${schema.imports.assetClass}, 'vda')`,
									assetClass,
								)
							: undefined,
					)
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
			save: (value: ImportDetail, assetClass?: AssetClass) =>
				orm.transaction(() => {
					const row = GetImportResponseSchema.parse(value);
					const previous = orm
						.select()
						.from(schema.imports)
						.where(eq(schema.imports.id, row.id))
						.get();
					const classified =
						assetClass ??
						previous?.assetClass ??
						(row.source === "generic" ? null : "vda");
					const stored = { ...row, assetClass: classified };
					orm
						.insert(schema.imports)
						.values(stored)
						.onConflictDoUpdate({ target: schema.imports.id, set: stored })
						.run();
					if (
						!previous ||
						classified !== previous.assetClass ||
						previous.status !== row.status ||
						previous.fileName !== row.fileName ||
						previous.rowsError !== row.rowsError ||
						!isDeepStrictEqual(previous.warnings, row.warnings)
					)
						invalidateLedger(
							classified ? [classified] : importAssetClasses(row.id),
						);
					return row;
				}),
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
					const affected = importAssetClasses(id);
					if (imported?.assetClass) affected.push(imported.assetClass);
					const result = orm
						.delete(schema.imports)
						.where(eq(schema.imports.id, id))
						.run();
					if (result.changes)
						invalidateLedger(affected.length ? affected : ["vda"]);
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
			active: (assetClass?: AssetClassFilter) =>
				listTransactions(assetClass, true),
			superseded: (): { txId: string; importId: string }[] =>
				sqlite
					.prepare(
						"SELECT id AS txId, superseded_by AS importId FROM transactions WHERE superseded_by IS NOT NULL ORDER BY id",
					)
					.all() as { txId: string; importId: string }[],
			supersede: (id: string, importId: string) =>
				orm.transaction(() => {
					const result = sqlite
						.prepare(
							"UPDATE transactions SET superseded_by=? WHERE id=? AND superseded_by IS NOT ? RETURNING asset_class AS assetClass",
						)
						.get(importId, id, importId) as
						| { assetClass: AssetClass }
						| undefined;
					if (result) invalidateLedger([result.assetClass]);
				}),
			all: () => listTransactions(),
			list: ({ assetClass }: { assetClass?: AssetClassFilter } = {}) =>
				listTransactions(assetClass),
			get: (id: string) => {
				const row = orm
					.select()
					.from(schema.transactions)
					.where(eq(schema.transactions.id, id))
					.get();
				return row ? readTransaction(row) : undefined;
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
					const affected = new Set<AssetClass>();
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
								stored.assetClass !== "vda" ||
								value.assetClass !== "vda" ||
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
							affected.add(stored.assetClass);
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
									"SELECT id,timestamp,amount_in,amount_out FROM transactions t WHERE t.superseded_by IS NULL AND NOT EXISTS (SELECT 1 FROM imports i WHERE i.id=t.import_id AND i.demo=1) AND t.source=? AND t.type=? AND t.asset_class=? AND t.asset_in IS ? AND t.asset_out IS ?",
								)
								.all(
									sibling,
									value.type,
									value.assetClass ?? "vda",
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
						const changed = orm
							.insert(schema.transactions)
							.values({ ...txValues(value), rawRowId })
							.onConflictDoNothing({
								target: [
									schema.transactions.source,
									schema.transactions.sourceRef,
								],
							})
							.run().changes;
						if (changed) {
							inserted += changed;
							affected.add(value.assetClass ?? "vda");
							link(value.id);
						}
					}
					invalidateLedger(affected);
					return { inserted, duplicate: rows.length - inserted };
				}),
			update: (tx: LedgerTx) =>
				orm.transaction(() => {
					const value = LedgerTxSchema.parse(tx);
					const previous = repositories.transactions.get(value.id);
					const result = orm
						.update(schema.transactions)
						.set({
							...txValues(value),
							incomeKind: value.incomeKind ?? null,
							userEdited: true,
						})
						.where(eq(schema.transactions.id, value.id))
						.run();
					if (
						previous &&
						!isDeepStrictEqual(
							transactionTaxInputs(previous),
							transactionTaxInputs(value),
						)
					)
						invalidateLedger([
							previous.assetClass ?? "vda",
							value.assetClass ?? "vda",
						]);
					return result.changes > 0;
				}),
			deleteManual: (id: string) =>
				orm.transaction(() => {
					const removed = orm
						.delete(schema.transactions)
						.where(
							and(
								eq(schema.transactions.id, id),
								eq(schema.transactions.source, "manual"),
							),
						)
						.returning({ assetClass: schema.transactions.assetClass })
						.get();
					if (removed) invalidateLedger([removed.assetClass]);
					return removed !== undefined;
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
					if (key === "engine") {
						const taxSettings = (input: unknown) => {
							const { usEquityFeeTreatment, usEquityFxBasis, ...vda } =
								EngineSettingsSchema.parse(input ?? {});
							return {
								vda: {
									...vda,
									transferAmountTolerance: D(
										vda.transferAmountTolerance,
									).toFixed(),
								},
								equity: {
									usEquityFeeTreatment,
									usEquityFxBasis,
									lotPool: vda.lotPool,
									surchargeRate: vda.surchargeRate,
									transferMatchWindowHours: vda.transferMatchWindowHours,
								},
							};
						};
						const before = taxSettings(previous);
						const after = taxSettings(value);
						if (!isDeepStrictEqual(before.vda, after.vda))
							invalidateReports("settings_changed");
						if (!isDeepStrictEqual(before.equity, after.equity))
							equity.usEquityReports.invalidate("settings_changed");
					}
				}),
		},
		actualBalances: actualBalanceRepository(
			orm,
			schema.actualBalances,
			(taxYear) => invalidateReports("balances_changed", taxYear),
		),
		reports: {
			invalidate: () => invalidateReports("ledger_changed"),
			snapshot: reportSnapshot,
			missingDetails: (taxYear: string): ReportMissingDetails =>
				orm
					.select({
						invalidatedAt: schema.reportInvalidations.invalidatedAt,
						cause: schema.reportInvalidations.cause,
					})
					.from(schema.reportInvalidations)
					.where(eq(schema.reportInvalidations.taxYear, taxYear))
					.get() ?? { invalidatedAt: null, cause: "never_computed" },
			save: (report: VdaReport) =>
				orm.transaction(() => {
					const value = VdaReportSchema.parse(report);
					orm
						.delete(schema.reports)
						.where(eq(schema.reports.taxYear, value.taxYear))
						.run();
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
					orm
						.delete(schema.reportInvalidations)
						.where(eq(schema.reportInvalidations.taxYear, value.taxYear))
						.run();
					return value;
				}),
			latest: (taxYear: string) => {
				const snapshot = reportSnapshot(taxYear);
				return snapshot.status === "current" ? snapshot.report : undefined;
			},
		},
		reviewResolutions: {
			list: (years: string[]) =>
				orm
					.select()
					.from(schema.reviewResolutions)
					.where(inArray(schema.reviewResolutions.taxYear, years))
					.all(),
			save: (rows: (typeof schema.reviewResolutions.$inferInsert)[]) => {
				for (const row of rows)
					orm
						.insert(schema.reviewResolutions)
						.values(row)
						.onConflictDoNothing()
						.run();
			},
			remove: (rows: (typeof schema.reviewResolutions.$inferSelect)[]) => {
				for (const row of rows)
					orm
						.delete(schema.reviewResolutions)
						.where(
							and(
								eq(schema.reviewResolutions.taxYear, row.taxYear),
								eq(schema.reviewResolutions.code, row.code),
								eq(schema.reviewResolutions.txId, row.txId),
								eq(schema.reviewResolutions.itemKey, row.itemKey),
							),
						)
						.run();
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
					const restart =
						"Server restarted before completion; retry the operation.";
					const imports = sqlite
						.prepare(
							`UPDATE imports SET status='failed',error=?
							WHERE kind='api_sync' AND status='pending_recipe' AND id IN (
								SELECT json_extract(result, '$.importId') FROM jobs
								WHERE kind='sync' AND status IN ('pending','running')
								AND json_extract(payload, '$.connectionId')=imports.connection_id
							)`,
						)
						.run(restart).changes;
					if (imports) invalidateReports("ledger_changed");
					const changed = orm
						.update(schema.jobs)
						.set({
							status: "failed",
							error: restart,
							progress: sql`json_remove(${schema.jobs.progress}, '$.waitingUntil')`,
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
		...equity,
		...phase2Repositories(sqlite, () => invalidateReports("ledger_changed")),
		dataDir: directory,
		backup: (target: string) => backupDatabase(sqlite, target),
		atomic: <T>(fn: () => T, behavior?: "immediate"): T =>
			orm.transaction(fn, { behavior }),
		health: () => sqlite.prepare("SELECT 1").get() !== undefined,
		close: (): void => {
			sqlite.close();
		},
	};
}
export type TaxDatabase = Awaited<ReturnType<typeof openDatabase>>;
