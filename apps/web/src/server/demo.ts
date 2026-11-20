import { randomUUID } from "node:crypto";
import type { TaxDatabase } from "@tax/db";
import { sampleImports } from "./demo-data";
import { ApiError } from "./errors";

export function demoStatus(db: TaxDatabase) {
	const importIds = db.imports.demoIds();
	return { loaded: importIds.length > 0, importIds };
}

export function loadDemo(db: TaxDatabase) {
	return db.atomic(() => {
		if (demoStatus(db).loaded)
			throw new ApiError(
				409,
				"demo_already_loaded",
				"Sample data is already loaded.",
			);

		const createdAt = new Date().toISOString();
		const importIds = sampleImports().map(
			({ source, fileName, fileSha256, rows }) => {
				const id = randomUUID();
				db.imports.save({
					id,
					source,
					fileName,
					fileSha256,
					createdAt,
					demo: true,
					timezone: "UTC",
					status: "imported",
					rowsRead: rows.length,
					rowsInserted: rows.length,
					rowsDuplicate: 0,
					rowsError: 0,
					rowsSkipped: 0,
					skippedRows: [],
					recipeId: null,
					error: null,
					warnings: [],
					rowErrors: [],
					reportKind: null,
					reportKindLabel: null,
					detectedTimezone: null,
					timezoneSource: "user",
					coverage: [],
				});
				const originals = rows.map(({ sheet, rowIndex, data }) => ({
					id: randomUUID(),
					importId: id,
					sheet,
					rowIndex,
					data,
				}));
				db.rawRows.insert(originals);
				const { inserted } = db.transactions.insert(
					rows.map(({ tx }, index) => ({
						tx: { ...tx, importId: id, sourceRef: `demo:${tx.sourceRef}` },
						rawRowId: originals[index]?.id,
						skipCrossChannel: true,
					})),
				);
				if (inserted !== rows.length)
					throw new Error("Sample ledger references must be unique.");
				return id;
			},
		);
		return { importIds: importIds.sort() };
	}, "immediate");
}

export function removeDemo(db: TaxDatabase) {
	db.atomic(() => {
		for (const id of db.imports.demoIds()) db.imports.delete(id);
	}, "immediate");
}
