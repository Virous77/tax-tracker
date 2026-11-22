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
function positiveAmount(value: string): string {
	const amount = numberString(value, true);
	if (D(amount).isZero())
		throw new RowParseError("Transaction quantity must be nonzero.", "number");
	return amount;
}

function tradeTotal(
	price: string | undefined,
	amount: string,
	totalCell: string,
	fee: string | undefined,
	side: "buy" | "sell",
): string {
	const gross = price ? D(price).mul(amount) : null;
	const reported = totalCell ? D(numberString(totalCell, true)) : null;
	let total = reported ?? gross;
	// Broker cash totals can include commissions. Store gross consideration and the fee separately.
	if (reported && gross && fee && !reported.eq(gross)) {
		const net = side === "buy" ? gross.plus(fee) : gross.minus(fee);
		if (reported.minus(net).abs().lte("0.02")) total = gross;
	}
	if (!total?.gt("0"))
		throw new RowParseError(
			"Trade requires a positive total or price.",
			"number",
		);
	return total.toFixed();
}

function tryConvertRecipeRow(
	raw: Record<string, string>,
	recipe: Recipe,
	opts: ImportOptions,
	sourceRef: string,
	date1904?: boolean,
): LedgerTx | null {
	const get = (key: keyof Recipe["columns"]) =>
		raw[recipe.columns[key] ?? ""]?.trim() ?? "";
	if (raw.__extraColumns)
		throw new RowParseError("Row has more cells than the header.");
	const operation = (get("side") || get("type")).toLowerCase();
	const mapped = Object.entries(recipe.sideMap ?? {}).find(
		([key]) => key.toLowerCase() === operation,
	)?.[1];
	if ((mapped ?? operation) === "skip") return null;
	const inferTradeSide =
		recipe.signStyle === "negative_is_sell" &&
		(mapped === undefined || mapped === "buy" || mapped === "sell");
	const side = inferTradeSide
		? D(numberString(get("amount"))).lt("0")
			? "sell"
			: "buy"
		: (mapped ?? operation);

	const timestamp = parseTimestamp(
		get("timestamp"),
		recipe.dateFormat,
		recipe.timezone ?? opts.timezone,
		date1904,
		recipe.dateAsOf,
	);
	const [base, quote] = get("pair")
		? splitPair(get("pair"), recipe.pairSplit?.knownQuotes)
		: [
				get("baseAsset").toUpperCase(),
				(
					get("quoteAsset") ||
					get("currency") ||
					recipe.defaultQuoteAsset ||
					""
				).toUpperCase(),
			];
	const tx = baseTransaction(
		`csv:${recipe.fingerprint}`,
		sourceRef,
		timestamp,
		raw,
	);
	tx.assetClass = recipe.assetClass ?? "vda";
	const description = get("description");
	if (description) tx.entityName = description;
	if (get("feeAmount")) {
		const fee = numberString(get("feeAmount"), true);
		if (D(fee).gt("0")) {
			tx.feeAsset = get("feeAsset").toUpperCase() || recipe.defaultFeeAsset;
			if (!tx.feeAsset) throw new RowParseError("Fee asset is missing.");
			tx.feeAmount = fee;
		}
	}

	switch (side) {
		case "dividend":
		case "foreign_tax": {
			const amount = positiveAmount(get("total") || get("amount"));
			const currency = quote || "USD";
			tx.type = side;
			if (base) tx.dividendAsset = base;
			if (side === "foreign_tax") {
				tx.assetOut = currency;
				tx.amountOut = amount;
				tx.withholdingTaxAmount = amount;
				tx.withholdingTaxAsset = currency;
			} else {
				tx.assetIn = currency;
				tx.amountIn = amount;
				if (get("withholdingTax")) {
					const withheld = numberString(get("withholdingTax"), true);
					if (D(withheld).gt("0")) {
						tx.withholdingTaxAmount = withheld;
						tx.withholdingTaxAsset =
							get("withholdingTaxAsset").toUpperCase() || currency;
					}
				}
			}
			break;
		}
		case "deposit":
		case "income":
		case "withdrawal": {
			const asset = base || (side === "income" ? "" : quote);
			if (!asset) throw new RowParseError("Base asset is missing.");
			const amount = positiveAmount(get("amount") || get("total"));
			tx.type = side;
			if (side === "withdrawal") {
				tx.assetOut = asset;
				tx.amountOut = amount;
			} else {
				tx.assetIn = asset;
				tx.amountIn = amount;
				if (side === "income") tx.incomeKind = "other";
			}
			break;
		}
		case "buy":
		case "sell": {
			if (!base) throw new RowParseError("Base asset is missing.");
			if (!quote) throw new RowParseError("Trade quote asset is missing.");
			if (base === quote)
				throw new RowParseError(
					"A trade must have different base and quote assets.",
				);
			const amount = positiveAmount(get("amount"));
			const price = get("price") ? numberString(get("price")) : undefined;
			const total = tradeTotal(
				price,
				amount,
				get("total"),
				tx.feeAsset === quote ? tx.feeAmount : undefined,
				side,
			);
			tx.type =
				tx.assetClass === "us_equity" ||
				["INR", "USD", "EUR", "GBP"].includes(quote)
					? side
					: "swap";
			tx.assetIn = side === "buy" ? base : quote;
			tx.amountIn = side === "buy" ? amount : total;
			tx.assetOut = side === "buy" ? quote : base;
			tx.amountOut = side === "buy" ? total : amount;
			if (quote === "INR") {
				tx.inrValue = total;
				tx.inrRateSource = "trade_inr";
			}
			if (price) tx.priceQuote = tradePriceQuote(side, tx.type, quote, price);
			break;
		}
		default:
			throw new RowParseError("Unknown transaction side/type.");
	}
	if (get("tds")) tx.tdsInr = numberString(get("tds"), true);
	if (get("txHash")) tx.txHash = get("txHash");
	const { assetClass, ...ledgerRow } = LedgerTxSchema.parse(tx);
	// Keep existing recipe output stable. The ledger schema supplies the VDA default when read.
	return recipe.assetClass ? { ...ledgerRow, assetClass } : ledgerRow;
}
export function convertRecipeRow(
	raw: Record<string, string>,
	recipe: Recipe,
	opts: ImportOptions,
	sourceRef: string,
	date1904?: boolean,
): LedgerTx {
	const tx = tryConvertRecipeRow(raw, recipe, opts, sourceRef, date1904);
	if (!tx) throw new RowParseError("Recipe maps this action to skip.");
	return tx;
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
	const skippedRows: NonNullable<ImportResult["skippedRows"]> = [];
	sheet.rows.forEach((raw, index) => {
		try {
			const tx = tryConvertRecipeRow(
				raw,
				effectiveRecipe,
				opts,
				ref(raw, raw[recipe.columns.id ?? ""]),
				sheet.excelDate1904,
			);
			if (tx === null) {
				skippedRows.push({
					rowIndex: index,
					sheet: sheet.name,
					reason: "Recipe maps this action to skip.",
					raw,
				});
				return;
			}
			transactions.push(tx);
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
				fileTimezone ? "the file name" : "the column header",
			),
			...[...suffixes].flatMap((suffix) =>
				timezoneConflict(opts.timezone, suffix, "the timestamps"),
			),
		],
		detectedTimezone: timezone,
		timezoneSource: timezone ? "file" : "user",
		timezoneOrigin: fileTimezone ? "file_name" : timezone ? "header" : null,
		sheets: [{ name: sheet.name, rowsRead: sheet.rows.length }],
		rowErrors,
		...(skippedRows.length ? { skippedRows } : {}),
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
