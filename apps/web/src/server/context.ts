import { resolve } from "node:path";
import { openDatabase, type TaxDatabase } from "@tax/db";

import { cancelBackgroundJobs } from "./background";
import { closeVaultSessions, vaultSession } from "./vault";

const databases = new Map<string, TaxDatabase>();
export function database(): TaxDatabase {
	const dir = resolve(
		/* turbopackIgnore: true */ process.env.DATA_DIR ?? "./data",
	);
	let db = databases.get(dir);
	if (!db) {
		db = openDatabase(dir);
		db.jobs.recover();
		databases.set(dir, db);
		void vaultSession(db);
	}
	return db;
}
export function closeDatabases(): void {
	closeVaultSessions();
	for (const db of databases.values()) {
		cancelBackgroundJobs(db);
		db.close();
	}
	databases.clear();
}
export async function runJob<T>(
	db: TaxDatabase,
	kind: string,
	payload: unknown,
	operation: () => Promise<T>,
): Promise<T> {
	const id = db.jobs.create(kind, payload);
	db.jobs.update(id, "running");
	try {
		const result = await operation();
		db.jobs.update(id, "completed", { ok: true });
		return result;
	} catch (error) {
		db.jobs.update(
			id,
			"failed",
			null,
			error instanceof Error ? error.message : "Operation failed",
		);
		throw error;
	}
}
