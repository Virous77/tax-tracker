import {
	D,
	type LedgerTx,
	LedgerTxSchema,
	type Recipe,
	RecipeSchema,
} from "@tax/core";
import { headerWarnings } from "./reports.js";
import { readSheets } from "./spreadsheet.js";
import {
	timezoneConflict,
	timezoneFromFileName,
	timezoneFromHeader,
	timezoneFromTimestamp,
} from "./timezone.js";
import type {
	Importer,
	ImportOptions,
	ImportResult,
	ImportTimezone,
	RowError,
	TableSheet,
} from "./types.js";
import {
	baseTransaction,
	headerFingerprint,
	numberString,
	parseTimestamp,
	RowParseError,
	sourceReferences,
	splitPair,
	tradePriceQuote,
} from "./values.js";
export function recipeSheet(sheets: TableSheet[], recipe: Recipe): TableSheet {
	const sheet = sheets.find((sheet) =>
		recipe.sheet ? sheet.name === recipe.sheet : sheets.length === 1,
	);
	if (!sheet) throw new Error("Select the sheet to which this recipe applies.");
	if (recipe.fingerprint !== headerFingerprint(sheet.headers, sheet.name))
		throw new Error("Recipe fingerprint does not match the selected sheet.");
	for (const column of Object.values(recipe.columns))
		if (column !== undefined && !sheet.headers.includes(column))
			throw new Error(`Recipe column is missing: ${column}`);
	return sheet;
}
export function convertRecipeRow(
	raw: Record<string, string>,
	recipe: Recipe,
	opts: ImportOptions,
	sourceRef: string,
	date1904?: boolean,
): LedgerTx {
	const get = (key: keyof Recipe["columns"]) =>
		raw[recipe.columns[key] ?? ""]?.trim() ?? "";
	if (raw.__extraColumns)
		throw new RowParseError("Row has more cells than the header.");
	const timestamp = parseTimestamp(
		get("timestamp"),
		recipe.dateFormat,
		recipe.timezone ?? opts.timezone,
		date1904,
	);
	const signed = numberString(get("amount"));
	const amount = D(signed).abs().toFixed();
	if (D(amount).isZero())
		throw new RowParseError("Transaction quantity must be nonzero.", "number");
	const operation = get("side") || get("type");
	const mapped = Object.entries(recipe.sideMap ?? {}).find(
		([key]) => key.toLowerCase() === operation.toLowerCase(),
	)?.[1];
	const side =
		recipe.signStyle === "negative_is_sell"
			? D(signed).lt("0")
				? "sell"
				: "buy"
			: (mapped ?? operation.toLowerCase());
	if (!["buy", "sell", "deposit", "withdrawal", "income"].includes(side))
		throw new RowParseError("Unknown transaction side/type.");
	const base = get("baseAsset").toUpperCase();
	const quote = get("quoteAsset").toUpperCase();
	const pair = get("pair")
		? splitPair(get("pair"), recipe.pairSplit?.knownQuotes)
		: [base, quote];
	if (!pair[0]) throw new RowParseError("Base asset is missing.");
	const tx = baseTransaction(
		`csv:${recipe.fingerprint}`,
		sourceRef,
		timestamp,
		raw,
	);
	if (side === "deposit" || side === "income") {
		tx.type = side;
		tx.assetIn = pair[0];
		tx.amountIn = amount;
		if (side === "income") tx.incomeKind = "other";
	} else if (side === "withdrawal") {
		tx.type = side;
		tx.assetOut = pair[0];
		tx.amountOut = amount;
	} else {
		if (!pair[1]) throw new RowParseError("Trade quote asset is missing.");
		if (pair[0] === pair[1])
			throw new RowParseError(
				"A trade must have different base and quote assets.",
			);
		const price = get("price") ? numberString(get("price")) : undefined;
		const total = get("total")
			? numberString(get("total"), true)
			: price
				? D(price).mul(amount).toFixed()
				: undefined;
		if (!total || !D(total).gt("0"))
			throw new RowParseError(
				"Trade requires a positive total or price.",
				"number",
			);
		tx.type = ["INR", "USD", "EUR", "GBP"].includes(pair[1])
			? (side as "buy" | "sell")
			: "swap";
		tx.assetIn = side === "buy" ? pair[0] : pair[1];
		tx.amountIn = side === "buy" ? amount : total;
		tx.assetOut = side === "buy" ? pair[1] : pair[0];
		tx.amountOut = side === "buy" ? total : amount;
		if (pair[1] === "INR") {
			tx.inrValue = total;
			tx.inrRateSource = "trade_inr";
		}
		if (price) tx.priceQuote = tradePriceQuote(side, tx.type, pair[1], price);
	}
	if (get("feeAmount")) {
		tx.feeAmount = numberString(get("feeAmount"), true);
		tx.feeAsset = get("feeAsset").toUpperCase();
		if (!tx.feeAsset) throw new RowParseError("Fee asset is missing.");
	}
	if (get("tds")) tx.tdsInr = numberString(get("tds"), true);
	if (get("txHash")) tx.txHash = get("txHash");
	return LedgerTxSchema.parse(tx);
}
export function applyRecipe(
	sheets: TableSheet[],
	recipeInput: Recipe,
	opts: ImportOptions,
	fileName = "",
): ImportResult {
	const recipe = RecipeSchema.parse(recipeInput);
	const sheet = recipeSheet(sheets, recipe);
	const fileTimezone = timezoneFromFileName(fileName);
	const timezone = fileTimezone ?? timezoneFromHeader(recipe.columns.timestamp);
	const effectiveRecipe = timezone ? { ...recipe, timezone } : recipe;
	const suffixes = new Set<ImportTimezone>();
	const ref = sourceReferences();
	const transactions: LedgerTx[] = [];
	const rowErrors: RowError[] = [];
	sheet.rows.forEach((raw, index) => {
		try {
			transactions.push(
				convertRecipeRow(
					raw,
					effectiveRecipe,
					opts,
					ref(raw, raw[recipe.columns.id ?? ""]),
					sheet.excelDate1904,
				),
			);
			const suffix = timezoneFromTimestamp(raw[recipe.columns.timestamp] ?? "");
			if (suffix && suffix !== timezone) suffixes.add(suffix);
		} catch (error) {
			rowErrors.push({
				rowIndex: index,
				sheet: sheet.name,
				message: error instanceof Error ? error.message : "Invalid row",
				raw,
				field: error instanceof RowParseError ? error.field : "other",
			});
		}
	});
	return {
		transactions,
		rowsRead: sheet.rows.length,
		warnings: [
			...headerWarnings(sheet),
			...timezoneConflict(
				opts.timezone,
				timezone,
				fileTimezone ? "the file name" : "the file header",
			),
			...[...suffixes].flatMap((suffix) =>
				timezoneConflict(opts.timezone, suffix, "the timestamps"),
			),
		],
		detectedTimezone: timezone,
		timezoneSource: timezone ? "file" : "user",
		sheets: [{ name: sheet.name, rowsRead: sheet.rows.length }],
		rowErrors,
	};
}
export const generic: Importer = {
	id: "generic",
	detect: () => true,
	parse: (file, opts) => {
		if (!opts.recipe)
			throw new Error("A recipe is required for a generic file.");
		return applyRecipe(
			readSheets(file, { allowDuplicateHeaders: true }),
			opts.recipe,
			opts,
			file.name,
		);
	},
};
