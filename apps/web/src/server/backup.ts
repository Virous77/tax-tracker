import { mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TaxDatabase } from "@tax/db";

export async function downloadBackup(db: TaxDatabase) {
	const stamp = new Date().toISOString().replaceAll(":", "-");
	const fileName = `tax-tracker-${stamp}.db`;
	const directory = await mkdtemp(join(db.dataDir, ".backup-"));
	const snapshot = join(directory, fileName);
	let file: Awaited<ReturnType<typeof open>> | undefined;
	const cleanup = async () => {
		await file?.close();
		await rm(directory, { recursive: true, force: true });
	};
	try {
		await db.backup(snapshot);
		file = await open(snapshot);
		const { size } = await file.stat();
		const reader = file.readableWebStream().getReader();
		const stream = new ReadableStream<Uint8Array>({
			async pull(controller) {
				try {
					const { done, value } = await reader.read();
					if (done) {
						await cleanup();
						controller.close();
					} else {
						controller.enqueue(value);
					}
				} catch (error) {
					await cleanup();
					controller.error(error);
				}
			},
			async cancel(reason) {
				try {
					await reader.cancel(reason);
				} finally {
					await cleanup();
				}
			},
		});
		return { stream, size, fileName };
	} catch (error) {
		await cleanup();
		throw error;
	}
}
