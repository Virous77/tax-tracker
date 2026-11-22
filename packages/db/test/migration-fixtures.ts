import { fileURLToPath } from "node:url";
import type { Database } from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

const migrations = readMigrationFiles({
	migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
});

export function migrateFixtureThrough(db: Database, index: number) {
	db.exec(
		"CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
	);
	const record = db.prepare(
		"INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)",
	);
	for (const migration of migrations.slice(0, index + 1)) {
		for (const statement of migration.sql) db.exec(statement);
		record.run(migration.hash, migration.folderMillis);
	}
}

export function removePhase3Schema(db: Database) {
	db.exec(`
		DROP TABLE us_equity_actual_balances;
		DROP TABLE us_equity_reports;
		DROP TABLE us_equity_report_invalidations;
		DROP TABLE equity_metadata;
		DROP TABLE equity_cy_prices;
		DROP INDEX transactions_asset_class;
		ALTER TABLE transactions DROP COLUMN asset_class;
		ALTER TABLE transactions DROP COLUMN dividend_asset;
		ALTER TABLE transactions DROP COLUMN withholding_tax_amount;
		ALTER TABLE transactions DROP COLUMN withholding_tax_asset;
		ALTER TABLE transactions DROP COLUMN entity_name;
		ALTER TABLE imports DROP COLUMN asset_class;
	`);
	const migration = migrations[10];
	if (!migration) throw new Error("Phase 3 migration is missing");
	db.prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?").run(
		migration.folderMillis,
	);
}
