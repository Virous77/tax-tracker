import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerTx } from "@tax/core";
import type { ImportDetail } from "@tax/core/api";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { openDatabase, type TaxDatabase } from "../src/index.js";

const dirs: string[] = [];
const databases: TaxDatabase[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
async function setup() {
	const dir = mkdtempSync(join(tmpdir(), "tax-db-phase2-"));
	dirs.push(dir);
	const db = await openDatabase(dir);
	databases.push(db);
	return db;
}
function imported(
	db: TaxDatabase,
	source: string,
	connectionId?: string,
): ImportDetail {
	return db.imports.save({
		id: randomUUID(),
		source,
		kind: connectionId ? "api_sync" : "file",
		connectionId,
		fileName: "synthetic",
		fileSha256: "",
		timezone: "UTC",
		reportKind: null,
		reportKindLabel: null,
		detectedTimezone: null,
		timezoneSource: "user",
		coverage: [],
		status: "imported",
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
	});
}
function add(
	db: TaxDatabase,
	record: ImportDetail,
	ref: string,
	amount = "1",
	index = 0,
	patch: Partial<LedgerTx> = {},
) {
	const rawRowId = randomUUID();
	const tx: LedgerTx = {
		id: randomUUID(),
		importId: record.id,
		source: record.source,
		sourceRef: ref,
		timestamp: "2026-05-01T00:00:00Z",
		type: "buy",
		assetIn: "ETH",
		amountIn: amount,
		assetOut: "INR",
		amountOut: "1000",
		raw: { ref, amount },
		reviewFlags: [],
		...patch,
	};
	db.rawRows.insert([
		{
			id: rawRowId,
			importId: record.id,
			sheet: "trades",
			rowIndex: index,
			data: tx.raw,
		},
	]);
	return { tx, count: db.transactions.insert([{ tx, rawRowId }]) };
}
for (const first of ["binance", "binance-api"])
	it(`deduplicates as a persistent multiset with ${first} first`, async () => {
		const db = await setup();
		const sibling = first === "binance" ? "binance-api" : "binance";
		const a = imported(db, first);
		add(db, a, "first-1");
		add(db, a, "first-2", "1.000", 1);
		const b = imported(db, sibling);
		expect(add(db, b, "second-1").count).toEqual({ inserted: 0, duplicate: 1 });
		expect(add(db, b, "second-2", "1e0", 1).count).toEqual({
			inserted: 0,
			duplicate: 1,
		});
		expect(add(db, b, "second-3", "1", 2).count).toEqual({
			inserted: 1,
			duplicate: 0,
		});
		expect(db.transactions.all()).toHaveLength(3);
		expect(db.rawRows.list(b.id).every((row) => row.txId)).toBe(true);
		const c = imported(db, sibling);
		expect(add(db, c, "second-1").count.inserted).toBe(0);
		expect(db.transactions.all()).toHaveLength(3);
		db.imports.delete(a.id);
		expect(
			db.rawRows.list(b.id).filter((row) => row.txId === null),
		).toHaveLength(2);
		const d = imported(db, sibling);
		expect(add(db, d, "second-1").count.inserted).toBe(1);
	});
it("inserts near matches and flags the existing ledger id", async () => {
	const db = await setup();
	const a = add(db, imported(db, "coindcx"), "one");
	const b = add(db, imported(db, "coindcx-api"), "two", "1.000000001");
	expect(b.count.inserted).toBe(1);
	expect(db.transactions.get(b.tx.id)?.reviewFlags).toContainEqual({
		code: "possible_duplicate",
		message: `Possible sibling-channel duplicate of ${a.tx.id}; review both original rows.`,
	});
});
it("rolls back rows and cursor together, resets sync cursors on import deletion, and retains ledger on connection deletion", async () => {
	const db = await setup();
	const connection = {
		id: randomUUID(),
		kind: "binance" as const,
		label: "test",
		options: {},
		createdAt: new Date().toISOString(),
		lastSyncAt: null,
		lastSyncStatus: null,
		lastSyncError: null,
	};
	db.connections.save(connection);
	const record = imported(db, "binance-api", connection.id);
	expect(() =>
		db.atomic(() => {
			add(db, record, "one");
			db.cursors.save(connection.id, "trades", { id: "1" });
			throw new Error("interrupted");
		}),
	).toThrow();
	expect(db.transactions.all()).toEqual([]);
	expect(db.cursors.get(connection.id)).toEqual({});
	add(db, record, "one");
	db.cursors.save(connection.id, "trades", { id: "1" });
	db.imports.delete(record.id);
	expect(db.cursors.get(connection.id)).toEqual({});
	const second = imported(db, "binance-api", connection.id);
	add(db, second, "two");
	db.vault.put({
		id: `conn:${connection.id}:key`,
		kind: "key",
		iv: "iv",
		ct: "ct",
		tag: "tag",
		createdAt: connection.createdAt,
	});
	db.fetchedBalances.replace(
		connection.id,
		[{ asset: "ETH", amount: "1" }],
		connection.createdAt,
	);
	db.connections.delete(connection.id);
	expect(db.transactions.all()).toHaveLength(1);
	expect(db.vault.list()).toEqual([]);
	expect(db.fetchedBalances.list(connection.id)).toEqual([]);
});
it("upgrades a phase-1 database and backfills normalized fingerprints without guessing old cache identity", async () => {
	const dir = mkdtempSync(join(tmpdir(), "tax-db-upgrade-"));
	dirs.push(dir);
	const legacy = new Database(join(dir, "tax-tracker.db"));
	for (const name of [
		"0000_misty_red_shift",
		"0001_futuristic_azazel",
		"0002_report_review_contract",
	])
		legacy.exec(
			readFileSync(
				new URL(`../migrations/${name}.sql`, import.meta.url),
				"utf8",
			),
		);
	legacy.exec(
		"CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,hash TEXT NOT NULL,created_at NUMERIC); INSERT INTO __drizzle_migrations(hash,created_at) VALUES('fixture',1794900000000)",
	);
	legacy
		.prepare(
			"INSERT INTO transactions(id,source,source_ref,timestamp,type,asset_in,amount_in,asset_out,amount_out,raw,flags) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
		)
		.run(
			randomUUID(),
			"binance",
			"old",
			"2026-05-01T00:00:00Z",
			"buy",
			"ETH",
			"1.000",
			"INR",
			"1000.0",
			"{}",
			"[]",
		);
	legacy
		.prepare(
			"INSERT INTO price_cache(asset,date,quote,price,source) VALUES('ETH','2026-05-01','USD','1000','legacy')",
		)
		.run();
	legacy.close();
	const db = await openDatabase(dir);
	databases.push(db);
	const check = new Database(join(dir, "tax-tracker.db"));
	expect(
		(
			check.prepare("SELECT fingerprint FROM transactions").get() as {
				fingerprint: string;
			}
		).fingerprint,
	).toBe("trade|binance|1777593600|ETH|INR|buy|1|1000");
	expect(check.prepare("SELECT * FROM price_cache_legacy").all()).toHaveLength(
		1,
	);
	expect(db.prices.all()).toEqual([]);
	check.close();
});

it("retains explicit file TDS when CoinDCX API history arrived first", async () => {
	const db = await setup();
	const api = add(db, imported(db, "coindcx-api"), "api");
	const file = imported(db, "coindcx");
	expect(add(db, file, "file", "1", 0, { tdsInr: "10" }).count).toEqual({
		inserted: 0,
		duplicate: 1,
	});
	expect(db.transactions.get(api.tx.id)).toMatchObject({
		source: "coindcx-api",
		tdsInr: "10",
		reviewFlags: [{ code: "parse_warning" }],
	});
	db.transactions.update({
		...(db.transactions.get(api.tx.id) as LedgerTx),
		tdsInr: "12",
	});
	add(db, imported(db, "coindcx"), "file", "1", 0, { tdsInr: "10" });
	expect(db.transactions.get(api.tx.id)?.tdsInr).toBe("12");
});
