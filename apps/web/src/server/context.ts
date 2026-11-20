import { resolve } from "node:path";
import { openDatabase, type TaxDatabase } from "@tax/db";

import { cancelBackgroundJobs } from "./background";
import { closeVaultSessions } from "./vault";

const processState = globalThis as typeof globalThis & {
	taxTrackerDatabases?: Map<string, Promise<TaxDatabase>>;
};
processState.taxTrackerDatabases ??= new Map();
const databases = processState.taxTrackerDatabases;

export function database(): Promise<TaxDatabase> {
	const dir = resolve(
		/* turbopackIgnore: true */ process.env.DATA_DIR ?? "./data",
	);
	let pending = databases.get(dir);
	if (!pending) {
		pending = openDatabase(dir)
			.then((db) => {
				try {
					db.jobs.recover();
					return db;
				} catch (error) {
					db.close();
					throw error;
				}
			})
			.catch((error) => {
				databases.delete(dir);
				throw error;
			});
		databases.set(dir, pending);
	}
	return pending;
}

export async function closeDatabases(): Promise<void> {
	closeVaultSessions();
	for (const result of await Promise.allSettled(databases.values())) {
		if (result.status === "fulfilled") {
			cancelBackgroundJobs(result.value);
			result.value.close();
		}
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
