import { randomUUID } from "node:crypto";
import {
	D,
	type FetchedBalance,
	type LedgerTx,
	LedgerTxSchema,
	taxYearOf,
} from "@tax/core";
import {
	type BalanceCheckRow,
	FetchedBalanceSchema,
	type ImportDetail,
	type SyncSummary,
} from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import { computeHoldings } from "@tax/engine";
import { IncompleteExplorerHistoryError } from "@tax/evm";
import { startBackgroundJob } from "./background";
import { connectionOptions } from "./connections";
import { connectorFor } from "./connectors";
import { ApiError, required } from "./errors";
import { startPriceFill } from "./price-jobs";
import { insertReconciled } from "./reconciliation";
import { getSettings } from "./settings";
import { publicError } from "./upstream-errors";

function connectionLedger(db: TaxDatabase, id: string): LedgerTx[] {
	const connection = required(db.connections.get(id));
	if (connection.kind !== "evm") return db.transactions.active();
	const imports = new Set(
		db.imports
			.list()
			.filter((row) => row.connectionId === id)
			.map((row) => row.id),
	);
	return db.transactions
		.active()
		.filter(
			(tx) =>
				!tx.source.startsWith("evm:") ||
				(tx.importId !== null && imports.has(tx.importId)),
		);
}
export function connectionBalances(db: TaxDatabase, id: string) {
	const connection = required(db.connections.get(id));
	if (connection.kind === "evm" && connection.lastSyncStatus === "incomplete")
		return { fetchedAt: null, rows: [] };
	const fetched = db.fetchedBalances.list(id);
	const holdings = computeHoldings({
		transactions: connectionLedger(db, id),
		settings: getSettings(db),
		asOf: new Date().toISOString(),
	});
	const computed = new Map(
		holdings
			.filter(
				(row) =>
					row.venue ===
					(connection.kind === "evm"
						? `evm:${connection.chainId}`
						: connection.kind),
			)
			.map((row) => [row.asset, row.quantity]),
	);
	const amounts = new Map<string, string>();
	for (const row of fetched)
		amounts.set(
			row.asset,
			D(amounts.get(row.asset) ?? "0")
				.plus(row.amount)
				.toFixed(),
		);
	const rows = [...new Set([...computed.keys(), ...amounts.keys()])]
		.sort()
		.map((asset) => {
			const actual = amounts.get(asset) ?? "0";
			const quantity = computed.get(asset) ?? "0";
			const difference = D(actual).minus(quantity).toFixed();
			return {
				asset,
				fetched: actual,
				computed: quantity,
				difference,
				flagged: !D(difference).isZero(),
			};
		});
	return { fetchedAt: fetched[0]?.fetchedAt ?? connection.lastSyncAt, rows };
}
export async function startSync(db: TaxDatabase, id: string) {
	const connection = required(db.connections.get(id));
	if (db.jobs.running(id))
		throw new ApiError(
			409,
			"sync_running",
			"A sync is already running for this connection.",
		);
	// Validate the vault and required credentials before accepting a job. Read again when it starts.
	await connectionOptions(db, id);
	if (db.jobs.running(id))
		throw new ApiError(
			409,
			"sync_running",
			"A sync is already running for this connection.",
		);
	return startBackgroundJob<SyncSummary>(
		db,
		"sync",
		{ connectionId: id },
		async (ctx) => {
			const imported: ImportDetail = {
				id: randomUUID(),
				kind: "api_sync",
				connectionId: id,
				source:
					connection.kind === "evm"
						? `evm:${connection.chainId}`
						: `${connection.kind}-api`,
				fileName: `${connection.label} API sync ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).slice(0, 16)} IST`,
				fileSha256: "",
				timezone: "IST",
				reportKind: null,
				reportKindLabel: null,
				detectedTimezone: null,
				timezoneSource: "user",
				coverage: [],
				status: "pending_recipe",
				rowsRead: 0,
				rowsInserted: 0,
				rowsDuplicate: 0,
				rowsError: 0,
				rowsSkipped: 0,
				skippedRows: [],
				recipeId: null,
				createdAt: new Date().toISOString(),
				error: null,
				warnings: [],
				rowErrors: [],
				sheets: [],
			};
			const summary: SyncSummary = {
				importId: imported.id,
				streams: [],
				balanceCheck: [],
				notices:
					connection.kind === "coindcx"
						? [
								"CoinDCX API has no deposit/withdrawal history or TDS credit. Import the Excel export to complete history and reconcile TDS.",
							]
						: [],
			};
			const years = new Set<string>();
			const indexes = new Map<string, number>();
			const streamSummary = (name: string): SyncSummary["streams"][number] => {
				const stored = summary.streams.find((row) => row.stream === name);
				if (stored) return stored;
				const stream = {
					stream: name,
					rowsFetched: 0,
					rowsInserted: 0,
					rowsDuplicate: 0,
					rowsFlagged: 0,
				};
				summary.streams.push(stream);
				return stream;
			};
			const markIncomplete = (name: string, message: string) => {
				const stream = streamSummary(name);
				if (stream.incomplete === message) return;
				stream.incomplete = message;
				imported.warnings.push({
					code: "import_incomplete",
					message: `${name}: ${message}`,
				});
			};
			db.atomic(() => {
				ctx.result(summary);
				db.imports.save(imported);
				db.connections.save({
					...connection,
					lastSyncStatus: "running",
					lastSyncError: null,
				});
			});
			try {
				const options = await connectionOptions(
					db,
					id,
					ctx.signal,
					ctx.progress,
				);
				const connector = connectorFor(connection.kind);
				for await (const batch of connector.sync(options)) {
					ctx.signal.throwIfAborted();
					const rows = batch.rows.map((row) =>
						LedgerTxSchema.parse({
							...row.tx,
							id: randomUUID(),
							importId: imported.id,
						}),
					);
					const stream = streamSummary(batch.stream);
					const index = indexes.get(batch.stream) ?? 0;
					db.atomic(() => {
						const inserts = rows.map((tx, offset) => {
							const rawRowId = randomUUID();
							db.rawRows.insert([
								{
									id: rawRowId,
									importId: imported.id,
									sheet: batch.stream,
									rowIndex: index + offset,
									data: tx.raw,
								},
							]);
							return { tx, rawRowId };
						});
						const count = insertReconciled(db, imported.id, inserts);
						stream.rowsFetched += rows.length;
						stream.rowsInserted += count.inserted;
						stream.rowsDuplicate += count.duplicate;
						stream.rowsFlagged += rows.filter(
							(tx) => (db.transactions.get(tx.id)?.reviewFlags.length ?? 0) > 0,
						).length;
						if (batch.incomplete)
							markIncomplete(batch.stream, batch.incomplete);
						imported.rowsRead += rows.length;
						imported.rowsInserted += count.inserted;
						imported.rowsDuplicate += count.duplicate;
						db.imports.save(imported);
						db.cursors.save(id, batch.stream, batch.cursor);
					});
					ctx.result(summary);
					indexes.set(batch.stream, index + rows.length);
					for (const tx of rows) years.add(taxYearOf(tx.timestamp));
				}
				let balances: FetchedBalance[] | undefined;
				if (
					connection.kind !== "evm" ||
					!summary.streams.some((row) => row.incomplete)
				) {
					try {
						balances = FetchedBalanceSchema.array().parse(
							await connector.balances({
								...options,
								onProgress: (progress) =>
									ctx.progress({
										...progress,
										streamsDone: summary.streams.length,
										streamsTotal: summary.streams.length,
										rowsFetched: summary.streams.reduce(
											(total, stream) => total + stream.rowsFetched,
											0,
										),
									}),
							}),
						);
					} catch (error) {
						if (!(error instanceof IncompleteExplorerHistoryError)) throw error;
						for (const { stream, message } of error.streams)
							markIncomplete(stream, message);
					}
				}
				ctx.signal.throwIfAborted();
				if (!balances) {
					summary.notices.push(
						"Balance check skipped because explorer history is incomplete.",
					);
				} else {
					db.fetchedBalances.replace(id, balances, new Date().toISOString());
					const check = connectionBalances(db, id);
					summary.balanceCheck = check.rows.map(
						({ flagged: _flagged, ...row }): BalanceCheckRow => row,
					);
					for (const row of check.rows.filter((row) => row.flagged)) {
						const message = `${connection.label}: ${row.asset} fetched ${row.fetched}, computed ${row.computed}, difference ${row.difference}`;
						imported.warnings.push({ code: "balance_mismatch", message });
						summary.notices.push(message);
					}
				}
				const incomplete = summary.streams.some((row) => row.incomplete);
				db.atomic(() => {
					db.reports.invalidate();
					db.imports.save({ ...imported, status: "imported" });
					db.connections.save({
						...required(db.connections.get(id)),
						lastSyncAt: new Date().toISOString(),
						lastSyncStatus: incomplete ? "incomplete" : "completed",
						lastSyncError: incomplete
							? "One or more streams were incomplete; review the sync summary."
							: null,
					});
				});
				if (getSettings(db).prices.enabled)
					for (const year of years) {
						try {
							startPriceFill(db, year);
						} catch (error) {
							if (error instanceof ApiError && error.code === "not_found")
								summary.notices.push(
									`No rules are available for price fill in ${year}.`,
								);
							else throw error;
						}
					}
				return summary;
			} catch (error) {
				if (!ctx.signal.aborted)
					db.atomic(() => {
						db.reports.invalidate();
						const message = publicError(error).message;
						db.imports.save({
							...imported,
							status: "failed",
							error: message,
							warnings: [
								...imported.warnings,
								{
									code: "import_incomplete",
									message:
										"Sync interrupted; stored rows and cursors are retained. Retry to resume.",
								},
							],
						});
						db.connections.save({
							...required(db.connections.get(id)),
							lastSyncAt: new Date().toISOString(),
							lastSyncStatus: "failed",
							lastSyncError: message,
						});
					});
				throw error;
			}
		},
	);
}
