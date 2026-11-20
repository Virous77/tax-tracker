import { mkdirSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as SQLiteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const migrationsFolder = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../migrations",
);
const backupName =
	/^tax-tracker-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z-pre-[\w-]+\.db$/;

export async function backupDatabase(sqlite: SQLiteDatabase, target: string) {
	await sqlite.backup(target);
	await chmod(target, 0o600);
}

async function backupBeforeMigration(
	sqlite: SQLiteDatabase,
	directory: string,
	tag: string,
) {
	const backups = join(directory, "backups");
	mkdirSync(backups, { recursive: true, mode: 0o700 });
	const staging = await mkdtemp(join(backups, ".migration-"));
	const snapshot = join(staging, "snapshot.db");
	const stamp = new Date().toISOString().replaceAll(":", "-");
	const filename = `tax-tracker-${stamp}-pre-${tag}.db`;
	try {
		await backupDatabase(sqlite, snapshot);
		await rename(snapshot, join(backups, filename));
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
	const previous = (await readdir(backups, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && backupName.test(entry.name))
		.map((entry) => entry.name)
		.sort()
		.reverse()
		.slice(5);
	for (const name of previous) await rm(join(backups, name), { force: true });
}

export async function openMigratedDatabase(
	dataDir: string,
): Promise<{ sqlite: SQLiteDatabase; directory: string }> {
	const directory = resolve(/* turbopackIgnore: true */ dataDir);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, "tax-tracker.db");
	const existing = (statSync(path, { throwIfNoEntry: false })?.size ?? 0) > 0;
	const sqlite = new Database(path);
	try {
		await chmod(path, 0o600);
		sqlite.pragma("foreign_keys = ON");
		sqlite.pragma("busy_timeout = 5000");
		sqlite.pragma("journal_mode = WAL");
		if (existing) {
			const table = sqlite
				.prepare(
					"SELECT 1 FROM sqlite_schema WHERE type='table' AND name='__drizzle_migrations'",
				)
				.get();
			const latest = table
				? (sqlite
						.prepare("SELECT MAX(created_at) FROM __drizzle_migrations")
						.pluck()
						.get() as number | null)
				: null;
			const { entries } = JSON.parse(
				readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
			) as { entries: { when: number; tag: string }[] };
			const pending = entries.find(
				(entry) => latest === null || entry.when > latest,
			);
			if (pending) await backupBeforeMigration(sqlite, directory, pending.tag);
		}
		migrate(drizzle(sqlite), { migrationsFolder });
		return { sqlite, directory };
	} catch (error) {
		sqlite.close();
		throw error;
	}
}
