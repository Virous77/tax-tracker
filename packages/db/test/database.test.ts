import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerTx } from "@tax/core";
import type { ImportDetail } from "@tax/core/api";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/index.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
async function setup() {
	const dir = mkdtempSync(join(tmpdir(), "tax-db-"));
	dirs.push(dir);
	return { dir, db: await openDatabase(dir) };
}
const record = (): ImportDetail => ({
	id: randomUUID(),
	source: "binance",
	fileName: "synthetic.csv",
	fileSha256: "sha",
	timezone: "UTC",
	reportKind: null,
	reportKindLabel: null,
	detectedTimezone: null,
	timezoneSource: "user",
	coverage: [],
	status: "imported",
	rowsRead: 1,
	rowsInserted: 1,
	rowsDuplicate: 0,
	rowsError: 0,
	rowsSkipped: 0,
	skippedRows: [],
	recipeId: null,
	createdAt: new Date().toISOString(),
	error: null,
	warnings: [],
	rowErrors: [],
});
function transaction(importId: string): LedgerTx {
	return {
		id: randomUUID(),
		importId,
		source: "binance",
		sourceRef: "buy1",
		timestamp: "2026-05-01T00:00:00.000Z",
		type: "buy",
		assetIn: "BTC",
		amountIn: "0.00000001",
		inrValue: "0.125",
		raw: { Amount: "0.00000001" },
		reviewFlags: [],
	};
}
describe("database", () => {
	it("upgrades old review-only fees while preserving real fees and user edits", async () => {
		const { dir, db } = await setup();
		const imported = record();
		db.imports.save(imported);
		const { id, source, importId, timestamp, raw } = transaction(imported.id);
		const placeholder: LedgerTx = {
			id,
			source,
			importId,
			timestamp,
			raw,
			type: "fee",
			sourceRef: "review-only",
			reviewFlags: [{ code: "parse_warning", message: "Keep the original." }],
		};
		const fee: LedgerTx = {
			...placeholder,
			id: randomUUID(),
			sourceRef: "real-fee",
			feeAsset: "BTC",
			feeAmount: "0.01",
		};
		const edited: LedgerTx = {
			...placeholder,
			id: randomUUID(),
			sourceRef: "edited",
		};
		db.transactions.insert([placeholder, fee, edited].map((tx) => ({ tx })));
		db.transactions.update({ ...edited, userNote: "checked" });
		db.close();
		const sqlite = new Database(join(dir, "tax-tracker.db"));
		sqlite.exec(
			"DELETE FROM __drizzle_migrations WHERE created_at >= (SELECT created_at FROM __drizzle_migrations ORDER BY created_at LIMIT 1 OFFSET 7); ALTER TABLE imports DROP COLUMN demo;",
		);
		sqlite.close();
		const upgraded = await openDatabase(dir);
		expect(upgraded.transactions.get(id)).toMatchObject({
			type: "transfer",
			raw,
			reviewFlags: [{ code: "parse_warning" }, { code: "unknown_type" }],
		});
		expect(upgraded.transactions.get(fee.id)).toEqual(fee);
		expect(upgraded.transactions.get(edited.id)).toEqual({
			...edited,
			userNote: "checked",
		});
		upgraded.close();
	});
	it("migrates, persists precise strings, preserves edits on reimport and cascades deletes", async () => {
		const { dir, db } = await setup();
		const imported = record();
		db.imports.save(imported);
		const rawId = randomUUID();
		const tx = transaction(imported.id);
		db.rawRows.insert([
			{
				id: rawId,
				importId: imported.id,
				sheet: "CSV",
				rowIndex: 0,
				data: tx.raw,
			},
		]);
		expect(db.transactions.insert([{ tx, rawRowId: rawId }])).toEqual({
			inserted: 1,
			duplicate: 0,
		});
		db.transactions.update({ ...tx, inrValue: "0.19", userNote: "corrected" });
		expect(
			db.transactions.insert([
				{ tx: { ...tx, id: randomUUID() }, rawRowId: rawId },
			]),
		).toEqual({ inserted: 0, duplicate: 1 });
		expect(db.transactions.get(tx.id)).toMatchObject({
			amountIn: "0.00000001",
			inrValue: "0.19",
			userNote: "corrected",
			raw: tx.raw,
		});
		db.close();
		const reopened = await openDatabase(dir);
		expect(reopened.health()).toBe(true);
		expect(reopened.transactions.all()).toHaveLength(1);
		reopened.imports.delete(imported.id);
		expect(reopened.transactions.all()).toEqual([]);
		expect(reopened.rawRows.list(imported.id)).toEqual([]);
		reopened.close();
	});
	it("replaces balances atomically and persists settings, recipes and jobs", async () => {
		const { db } = await setup();
		db.actualBalances.replace("2026-27", [{ asset: "BTC", amount: "0.1" }]);
		expect(() =>
			db.actualBalances.replace("2026-27", [
				{ asset: "ETH", amount: "1" },
				{ asset: "ETH", amount: "2" },
			]),
		).toThrow();
		expect(db.actualBalances.get("2026-27")).toEqual([
			{ asset: "BTC", amount: "0.1" },
		]);
		db.settings.set("secret", "server-only");
		expect(db.settings.get("secret")).toBe("server-only");
		const job = db.jobs.create("import", { importId: "x" });
		db.jobs.update(job, "running");
		db.jobs.recover();
		expect(db.jobs.get(job)?.status).toBe("failed");
		db.close();
	});
	it("marks interrupted API sync imports failed without removing rows or cursors", async () => {
		const { dir, db } = await setup();
		const connectionId = randomUUID();
		const imported = { ...record(), status: "pending_recipe" as const };
		db.connections.save({
			id: connectionId,
			kind: "binance",
			label: "Synthetic",
			options: {},
			createdAt: imported.createdAt,
			lastSyncAt: null,
			lastSyncStatus: "running",
			lastSyncError: null,
		});
		db.imports.save({ ...imported, kind: "api_sync", connectionId });
		const unrelated = { ...record(), status: "pending_recipe" as const };
		db.imports.save(unrelated);
		db.transactions.insert([{ tx: transaction(imported.id) }]);
		db.cursors.save(connectionId, "trades", { lastId: "92" });
		const jobId = db.jobs.create("sync", { connectionId });
		db.jobs.update(jobId, "running", { importId: imported.id });
		db.close();

		const reopened = await openDatabase(dir);
		try {
			expect(reopened.jobs.recover()).toBe(1);
			expect(reopened.jobs.get(jobId)).toMatchObject({ status: "failed" });
			expect(reopened.connections.get(connectionId)).toMatchObject({
				lastSyncStatus: "failed",
			});
			expect(reopened.imports.get(imported.id)).toMatchObject({
				status: "failed",
				error: expect.stringContaining("Server restarted"),
			});
			expect(reopened.imports.get(unrelated.id)?.status).toBe("pending_recipe");
			expect(reopened.transactions.active()).toHaveLength(1);
			expect(reopened.cursors.get(connectionId)).toEqual({
				trades: { lastId: "92" },
			});
		} finally {
			reopened.close();
		}
	});
});
