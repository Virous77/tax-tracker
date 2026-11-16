import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerTx } from "@tax/core";
import type { ImportDetail } from "@tax/core/api";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/index.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function setup() {
	const dir = mkdtempSync(join(tmpdir(), "tax-db-"));
	dirs.push(dir);
	return { dir, db: openDatabase(dir) };
}
const record = (): ImportDetail => ({
	id: randomUUID(),
	source: "binance",
	fileName: "synthetic.csv",
	fileSha256: "sha",
	timezone: "UTC",
	status: "imported",
	rowsRead: 1,
	rowsInserted: 1,
	rowsDuplicate: 0,
	rowsError: 0,
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
	it("migrates, persists precise strings, preserves edits on reimport and cascades deletes", () => {
		const { dir, db } = setup();
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
		const reopened = openDatabase(dir);
		expect(reopened.health()).toBe(true);
		expect(reopened.transactions.all()).toHaveLength(1);
		reopened.imports.delete(imported.id);
		expect(reopened.transactions.all()).toEqual([]);
		expect(reopened.rawRows.list(imported.id)).toEqual([]);
		reopened.close();
	});
	it("replaces balances atomically and persists settings, recipes and jobs", () => {
		const { db } = setup();
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
});
