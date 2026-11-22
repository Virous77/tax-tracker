import {
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../src/index.js";
import { removePhase3Schema } from "./migration-fixtures.js";

let directory: string;
let dbPath: string;

beforeEach(async () => {
	directory = mkdtempSync(join(tmpdir(), "tax-migration-"));
	dbPath = join(directory, "tax-tracker.db");
	const db = await openDatabase(directory);
	db.settings.set("synthetic", "before migration");
	db.close();
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function makeReviewMigrationPending() {
	const db = new Database(dbPath);
	try {
		removePhase3Schema(db);
		db.exec(`DROP TABLE review_resolutions;
			DELETE FROM __drizzle_migrations WHERE created_at =
				(SELECT MAX(created_at) FROM __drizzle_migrations);`);
	} finally {
		db.close();
	}
}

it("backs up the pre-migration schema, retaining the five newest snapshots", async () => {
	expect(readdirSync(directory)).not.toContain("backups");
	const reopened = await openDatabase(directory);
	reopened.close();
	expect(readdirSync(directory)).not.toContain("backups");

	for (let run = 0; run < 6; run++) {
		makeReviewMigrationPending();
		const db = await openDatabase(directory);
		try {
			expect(db.reviewResolutions.list(["2025-26"])).toEqual([]);
			expect(db.settings.get("synthetic")).toBe("before migration");
		} finally {
			db.close();
		}
	}
	const backupDir = join(directory, "backups");
	const names = readdirSync(backupDir).sort();
	expect(names).toHaveLength(5);
	const path = join(backupDir, names.at(-1) ?? "");
	expect(path).toMatch(/tax-tracker-.*Z-pre-0009_review_resolutions\.db$/);
	expect(statSync(path).mode & 0o777).toBe(0o600);
	const snapshot = new Database(path, { readonly: true });
	try {
		expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
		expect(
			snapshot
				.prepare("SELECT value FROM settings WHERE key='synthetic'")
				.pluck()
				.get(),
		).toBe('"before migration"');
		expect(
			snapshot
				.prepare(
					"SELECT name FROM sqlite_schema WHERE name='review_resolutions'",
				)
				.get(),
		).toBeUndefined();
	} finally {
		snapshot.close();
	}
});

it("leaves the pending migration unapplied if the snapshot cannot be written", async () => {
	makeReviewMigrationPending();
	writeFileSync(join(directory, "backups"), "");
	await expect(openDatabase(directory)).rejects.toThrow();
	const db = new Database(dbPath, { readonly: true });
	try {
		expect(
			db
				.prepare(
					"SELECT name FROM sqlite_schema WHERE name='review_resolutions'",
				)
				.get(),
		).toBeUndefined();
	} finally {
		db.close();
	}
});
