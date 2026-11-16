import { randomUUID } from "node:crypto";
import { type Recipe, RecipeSchema } from "@tax/core";
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
	isCoinDcx,
	parseBinance,
	parseCoinDcx,
	readSheets,
	recipeChecks,
	sha256,
	type TableSheet,
} from "@tax/importers";
import { libraryRecipes } from "@tax/recipes";
import type { z } from "zod";
import { runJob } from "./context";
import { ApiError, required } from "./errors";

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
function saveResult(
	db: TaxDatabase,
	imported: ImportDetail,
	result: ImportResult,
	recipeId: string | null,
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
		const count = db.transactions.insert(
			result.transactions.map((tx) => ({
				tx: { ...tx, importId: imported.id },
				rawRowId: queues.get(canonical(tx.raw))?.shift(),
			})),
		);
		const updated = {
			...imported,
			status: "imported" as const,
			rowsRead: result.rowsRead,
			rowsInserted: count.inserted,
			rowsDuplicate: count.duplicate,
			rowsError: result.rowErrors.length,
			recipeId,
			rowErrors: result.rowErrors,
			warnings: result.warnings,
			error: null,
		};
		if (
			updated.rowsRead !==
			updated.rowsInserted + updated.rowsDuplicate + updated.rowsError
		)
			throw new ApiError(
				422,
				"row_count_mismatch",
				"Importer did not account for every row.",
			);
		return db.imports.save(updated);
	});
}
export async function createImport(
	db: TaxDatabase,
	input: z.infer<typeof CreateImportRequestSchema>,
) {
	let sheets: TableSheet[];
	try {
		sheets = readSheets({ name: input.fileName, bytes: input.file });
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
	const imported: ImportDetail = {
		id: randomUUID(),
		source,
		fileName: input.fileName,
		fileSha256: sha256(input.file),
		timezone: input.timezone,
		status: "pending_recipe",
		rowsRead: sheets.reduce((count, sheet) => count + sheet.rows.length, 0),
		rowsInserted: 0,
		rowsDuplicate: 0,
		rowsError: 0,
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
	db.atomic(() => {
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
	});
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
				return saveResult(db, imported, parseCoinDcx(sheets, options), null);
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
					applyRecipe(sheets, recipe, options),
					recipe.id,
				);
			return imported;
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
		result = applyRecipe(sheets, recipe, { timezone: imported.timezone });
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
			return saveResult(db, imported, result, recipe.id);
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
		result = applyRecipe(sheets, recipe, { timezone: imported.timezone });
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
