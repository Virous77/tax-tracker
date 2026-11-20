import { randomUUID } from "node:crypto";
import { D, type Recipe, RecipeSchema, timezoneOffsetMinutes } from "@tax/core";
import type {
	ConfirmImportRequestSchema,
	CreateImportRequestSchema,
	ImportDetail,
	PreviewRecipeRequestSchema,
} from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import {
	applyRecipe,
	binanceKind,
	canonical,
	detectSource,
	headerFingerprint,
	type ImportResult,
	importFileAsync,
	isCoinDcx,
	PdfImportError,
	parseBinance,
	parseCoinDcx,
	REPORT_KIND_LABELS,
	readSheets,
	recipeChecks,
	sha256,
	type TableSheet,
} from "@tax/importers";
import { libraryRecipes } from "@tax/recipes";
import type { z } from "zod";
import { runJob } from "./context";
import { ApiError, required } from "./errors";
import { isPdf, pdfApiError } from "./pdf-errors";
import { insertReconciled } from "./reconciliation";

function storedSheets(db: TaxDatabase, id: string): TableSheet[] {
	const imported = required(db.imports.get(id));
	const rows = db.rawRows.list(id);
	return (imported.sheets ?? []).map((sheet) => ({
		name: sheet.name,
		headers: sheet.headers,
		excelDate1904:
			rows.find((row) => row.sheet === sheet.name)?.excelDate1904 ?? undefined,
		rows: rows
			.filter((row) => row.sheet === sheet.name)
			.map((row) => row.data as Record<string, string>),
	}));
}
function snapshotContent(
	snapshot: NonNullable<ImportResult["balanceSnapshot"]>,
) {
	const rows = snapshot.rows
		.map(({ asset, amount, wallet }) =>
			canonical([asset, D(amount).toFixed(), wallet ?? null]),
		)
		.sort();
	return canonical([
		snapshot.asOf,
		timezoneOffsetMinutes(snapshot.timezone),
		rows,
	]);
}
function saveResult(
	db: TaxDatabase,
	imported: ImportDetail,
	result: ImportResult,
	recipe: Recipe | null,
): ImportDetail {
	const rawRows = db.rawRows.list(imported.id);
	const queues = new Map<string, string[]>();
	for (const raw of rawRows) {
		const key = canonical(raw.data);
		const ids = queues.get(key) ?? [];
		ids.push(raw.id);
		queues.set(key, ids);
	}
	return db.atomic(() => {
		const count = insertReconciled(
			db,
			imported.id,
			result.transactions.map((tx) => ({
				tx: { ...tx, importId: imported.id },
				rawRowId: queues.get(canonical(tx.raw))?.shift(),
			})),
		);
		let snapshotInserted = 0;
		let snapshotDuplicate = 0;
		if (result.balanceSnapshot) {
			const snapshot = result.balanceSnapshot;
			const content = snapshotContent(snapshot);
			const duplicate = db.balanceSnapshots
				.list()
				.some(
					(existing) =>
						existing.venue === imported.source &&
						(snapshotContent(existing) === content ||
							db.imports.get(existing.importId)?.fileSha256 ===
								imported.fileSha256),
				);
			if (duplicate) snapshotDuplicate = snapshot.rows.length;
			else {
				db.balanceSnapshots.save({
					id: randomUUID(),
					importId: imported.id,
					venue: imported.source,
					...snapshot,
					createdAt: imported.createdAt,
				});
				snapshotInserted = snapshot.rows.length;
			}
		}
		const updated = {
			...imported,
			status: "imported" as const,
			rowsRead: result.rowsRead,
			rowsInserted:
				count.inserted + snapshotInserted + (result.tdsSummary?.length ?? 0),
			rowsDuplicate: count.duplicate + snapshotDuplicate,
			rowsError: result.rowErrors.length,
			rowsSkipped: result.skippedRows?.length ?? 0,
			skippedRows: result.skippedRows ?? [],
			recipeId: recipe?.id ?? null,
			sheets: recipe
				? imported.sheets?.map((sheet) =>
						sheet.name === result.sheets?.[0]?.name
							? { ...sheet, recipeName: recipe.name }
							: sheet,
					)
				: imported.sheets,
			rowErrors: result.rowErrors,
			warnings: result.warnings,
			reportKind: result.reportKind ?? null,
			reportKindLabel: result.reportKind
				? (REPORT_KIND_LABELS[result.reportKind] ?? null)
				: null,
			detectedTimezone: result.detectedTimezone ?? null,
			timezoneSource: result.timezoneSource,
			timezoneOrigin: result.timezoneOrigin,
			coverage: result.coverage ?? [],
			tdsSummary: result.tdsSummary,
			error: null,
		};
		if (
			updated.rowsRead !==
			updated.rowsInserted +
				updated.rowsDuplicate +
				updated.rowsError +
				updated.rowsSkipped
		)
			throw new ApiError(
				422,
				"row_count_mismatch",
				"Importer did not account for every row.",
			);
		db.imports.save(updated);
		return required(db.imports.get(imported.id));
	});
}
function pendingImport(
	input: z.infer<typeof CreateImportRequestSchema>,
	source: string,
	rowsRead: number,
	sheets: TableSheet[],
): ImportDetail {
	return {
		id: randomUUID(),
		source,
		fileName: input.fileName,
		fileSha256: sha256(input.file),
		timezone: input.timezone,
		reportKind: null,
		reportKindLabel: null,
		detectedTimezone: null,
		timezoneSource: "user",
		timezoneOrigin: null,
		coverage: [],
		status: "pending_recipe",
		rowsRead: rowsRead,
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
		sheets: sheets.map((sheet) => ({
			name: sheet.name,
			headers: sheet.headers,
			sampleRows: sheet.rows.slice(0, 20),
			rowsRead: sheet.rows.length,
		})),
	};
}
export async function createImport(
	db: TaxDatabase,
	input: z.infer<typeof CreateImportRequestSchema>,
) {
	if (isPdf(input.file)) {
		let result: ImportResult;
		try {
			result = await importFileAsync(
				{ name: input.fileName, bytes: input.file },
				{
					timezone: input.timezone,
					pdfPassword: input.pdfPassword,
					source: input.source,
				},
			);
		} catch (error) {
			if (error instanceof PdfImportError) throw pdfApiError(error);
			throw new ApiError(
				422,
				"pdf_unsupported",
				"The PDF could not be processed. Use a CSV or XLSX export.",
			);
		}
		const source = result.reportKind?.split(":")[0] ?? "generic";
		if (input.source !== "auto" && input.source !== source)
			throw new ApiError(
				422,
				"unprocessable_file",
				"This PDF does not match the selected venue.",
			);
		const imported = pendingImport(input, source, result.rowsRead, []);
		return runJob(db, "import", { importId: imported.id }, async () =>
			db.atomic(() => {
				db.imports.save(imported);
				const originals =
					result.balanceSnapshot?.rows ??
					result.tdsSummary ??
					result.transactions.map((tx) => ({ raw: tx.raw }));
				db.rawRows.insert(
					originals.map((row, rowIndex) => ({
						id: randomUUID(),
						importId: imported.id,
						sheet: result.reportKind ?? "PDF",
						rowIndex,
						data: row.raw,
					})),
				);
				return saveResult(db, imported, result, null);
			}),
		);
	}
	let sheets: TableSheet[];
	try {
		sheets = readSheets(
			{ name: input.fileName, bytes: input.file },
			{ allowDuplicateHeaders: true },
		);
	} catch {
		throw new ApiError(
			422,
			"unprocessable_file",
			"File is not a supported, safe CSV or XLSX workbook.",
		);
	}
	if (!sheets.some((sheet) => sheet.rows.length))
		throw new ApiError(
			422,
			"unprocessable_file",
			"File contains no data rows.",
		);
	const source = input.source === "auto" ? detectSource(sheets) : input.source;
	if (
		source === "binance" &&
		!sheets.some((sheet) => sheet.rows.length && binanceKind(sheet))
	)
		throw new ApiError(
			422,
			"unprocessable_file",
			"File does not match Binance. Expected headers: Date(UTC), Pair, Side, Price, Executed, Amount, Fee; or Date(UTC), Market, Type, Price, Amount, Total, Fee, Fee Coin; or UTC_Time, Account, Operation, Coin, Change, Remark; or Coin, Amount, TXID, Status plus a date column.",
		);
	if (
		source === "coindcx" &&
		!sheets.some((sheet) => sheet.rows.length && isCoinDcx(sheet))
	)
		throw new ApiError(
			422,
			"unprocessable_file",
			"File does not match CoinDCX. Expected headers: Trade Completion time (or Transaction time), Side (Buy/Sell), and Gross Amount Paid/Received by the user(in INR) (or in base currency).",
		);
	const imported = pendingImport(
		input,
		source,
		sheets.reduce((count, sheet) => count + sheet.rows.length, 0),
		sheets,
	);
	const existing = db.atomic(() => {
		if (source === "generic") {
			const pending = db.imports.findPendingGenericFile(imported.fileSha256);
			if (pending) return pending;
		}
		db.imports.save(imported);
		db.rawRows.insert(
			sheets.flatMap((sheet) =>
				sheet.rows.map((data, rowIndex) => ({
					id: randomUUID(),
					importId: imported.id,
					sheet: sheet.name,
					excelDate1904: sheet.excelDate1904,
					rowIndex,
					data,
				})),
			),
		);
	}, "immediate");
	if (existing) return existing;
	return runJob(db, "import", { importId: imported.id }, async () => {
		try {
			const options = { timezone: input.timezone };
			if (source === "binance")
				return saveResult(
					db,
					imported,
					parseBinance(sheets, options, input.fileName),
					null,
				);
			if (source === "coindcx")
				return saveResult(
					db,
					imported,
					parseCoinDcx(sheets, options, input.fileName),
					null,
				);
			const recipes = [...db.recipes.list(), ...libraryRecipes];
			const recipe =
				sheets.length === 1
					? recipes.find(
							(recipe) =>
								recipe.fingerprint ===
								headerFingerprint(sheets[0]?.headers ?? [], sheets[0]?.name),
						)
					: undefined;
			if (recipe)
				return saveResult(
					db,
					imported,
					applyRecipe(sheets, recipe, options, input.fileName),
					recipe,
				);
			return required(db.imports.get(imported.id));
		} catch (error) {
			if (error instanceof ApiError) throw error;
			db.imports.save({
				...imported,
				status: "failed",
				error: "The file could not be imported. Review its layout and recipe.",
			});
			throw new ApiError(
				422,
				"unprocessable_file",
				"The file could not be imported. Review its layout and recipe.",
			);
		}
	});
}
export async function confirmImport(
	db: TaxDatabase,
	id: string,
	input: z.infer<typeof ConfirmImportRequestSchema>,
) {
	const imported = required(db.imports.get(id));
	if (imported.status !== "pending_recipe")
		throw new ApiError(
			409,
			"conflict",
			"Only an import awaiting a recipe can be confirmed.",
		);
	const recipe = RecipeSchema.parse({
		...input.recipe,
		...(input.recipeName ? { name: input.recipeName } : {}),
	});
	const sheets = storedSheets(db, id);
	let result: ImportResult;
	try {
		result = applyRecipe(
			sheets,
			recipe,
			{ timezone: imported.timezone },
			imported.fileName,
		);
		for (const sheet of sheets)
			if (sheet.name !== (recipe.sheet ?? sheets[0]?.name)) {
				result.rowsRead += sheet.rows.length;
				result.sheets?.push({ name: sheet.name, rowsRead: sheet.rows.length });
				sheet.rows.forEach((raw, rowIndex) => {
					result.rowErrors.push({
						raw,
						rowIndex,
						sheet: sheet.name,
						message:
							"No confirmed recipe for this sheet. This row was preserved but not imported.",
					});
				});
			}
	} catch {
		throw new ApiError(
			422,
			"invalid_recipe",
			"Recipe does not match the import's sheet and columns.",
		);
	}
	return runJob(db, "confirm_import", { importId: id }, async () =>
		db.atomic(() => {
			if (input.saveRecipe) {
				const existing = db.recipes
					.list()
					.find(
						(r) => r.id === recipe.id && r.fingerprint !== recipe.fingerprint,
					);
				if (existing)
					throw new ApiError(
						409,
						"conflict",
						"Recipe ID belongs to a different header fingerprint.",
					);
				db.recipes.save(recipe);
			}
			return saveResult(db, imported, result, recipe);
		}),
	);
}
export function previewRecipe(
	db: TaxDatabase,
	input: z.infer<typeof PreviewRecipeRequestSchema>,
) {
	const imported = required(db.imports.get(input.importId));
	const recipe: Recipe = {
		...input.recipe,
		...(input.sheet ? { sheet: input.sheet } : {}),
	};
	let result: ImportResult;
	let sheet: TableSheet;
	try {
		const sheets = storedSheets(db, imported.id);
		result = applyRecipe(
			sheets,
			recipe,
			{ timezone: imported.timezone },
			imported.fileName,
		);
		sheet = required(
			sheets.find((value) =>
				recipe.sheet ? value.name === recipe.sheet : sheets.length === 1,
			),
		);
	} catch {
		throw new ApiError(
			422,
			"invalid_recipe",
			"Recipe does not match the import's sheet and columns.",
		);
	}
	const transactions = [...result.transactions];
	return {
		rows: sheet.rows.slice(0, 10).map((original, rowIndex) => {
			const error = result.rowErrors.find((row) => row.rowIndex === rowIndex);
			return error
				? { original, converted: null, error: error.message }
				: { original, converted: transactions.shift() ?? null };
		}),
		checks: recipeChecks(result),
	};
}
