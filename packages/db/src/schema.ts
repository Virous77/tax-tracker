import type { ActualBalance, LedgerTx, Recipe, VdaReport } from "@tax/core";
import type { ImportDetail, ImportSummary } from "@tax/core/api";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const imports = sqliteTable("imports", {
	id: text("id").primaryKey(),
	source: text("source").notNull(),
	fileName: text("file_name").notNull(),
	fileSha256: text("file_sha256").notNull(),
	timezone: text("timezone", { enum: ["IST", "UTC"] }).notNull(),
	status: text("status", {
		enum: ["pending_recipe", "imported", "failed"],
	}).notNull(),
	rowsRead: integer("rows_read").notNull(),
	rowsInserted: integer("rows_inserted").notNull(),
	rowsDuplicate: integer("rows_duplicate").notNull(),
	rowsError: integer("rows_error").notNull(),
	recipeId: text("recipe_id"),
	createdAt: text("created_at").notNull(),
	error: text("error"),
	warnings: text("warnings", { mode: "json" })
		.$type<ImportSummary["warnings"]>()
		.notNull(),
	sheets: text("sheets", { mode: "json" }).$type<ImportSummary["sheets"]>(),
	rowErrors: text("row_errors", { mode: "json" })
		.$type<ImportDetail["rowErrors"]>()
		.notNull(),
});
export const rawRows = sqliteTable(
	"raw_rows",
	{
		id: text("id").primaryKey(),
		importId: text("import_id")
			.notNull()
			.references(() => imports.id, { onDelete: "cascade" }),
		sheet: text("sheet").notNull(),
		rowIndex: integer("row_index").notNull(),
		excelDate1904: integer("excel_date_1904", { mode: "boolean" }),
		data: text("data", { mode: "json" }).$type<unknown>().notNull(),
	},
	(t) => [uniqueIndex("raw_rows_position").on(t.importId, t.sheet, t.rowIndex)],
);
export const transactions = sqliteTable(
	"transactions",
	{
		id: text("id").primaryKey(),
		source: text("source").notNull(),
		sourceRef: text("source_ref").notNull(),
		importId: text("import_id").references(() => imports.id, {
			onDelete: "cascade",
		}),
		rawRowId: text("raw_row_id").references(() => rawRows.id, {
			onDelete: "cascade",
		}),
		timestamp: text("timestamp").notNull(),
		type: text("type").$type<LedgerTx["type"]>().notNull(),
		incomeKind: text("income_kind").$type<LedgerTx["incomeKind"]>(),
		assetIn: text("asset_in"),
		amountIn: text("amount_in"),
		assetOut: text("asset_out"),
		amountOut: text("amount_out"),
		feeAsset: text("fee_asset"),
		feeAmount: text("fee_amount"),
		gstInr: text("gst_inr"),
		inrValue: text("inr_value"),
		inrRateSource: text("inr_rate_source").$type<LedgerTx["inrRateSource"]>(),
		priceQuote: text("price_quote", { mode: "json" }).$type<
			LedgerTx["priceQuote"]
		>(),
		tdsInr: text("tds_inr"),
		txHash: text("tx_hash"),
		chain: text("chain"),
		raw: text("raw", { mode: "json" }).$type<unknown>().notNull(),
		reviewFlags: text("flags", { mode: "json" })
			.$type<LedgerTx["reviewFlags"]>()
			.notNull(),
		userNote: text("user_note"),
		userEdited: integer("user_edited", { mode: "boolean" })
			.notNull()
			.default(false),
	},
	(t) => [uniqueIndex("transactions_source_ref").on(t.source, t.sourceRef)],
);
export const recipes = sqliteTable("recipes", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	fingerprint: text("fingerprint").notNull().unique(),
	sheet: text("sheet"),
	json: text("json", { mode: "json" }).$type<Recipe>().notNull(),
	origin: text("origin", { enum: ["ai", "user", "library"] }).notNull(),
	createdAt: text("created_at").notNull(),
});
export const settings = sqliteTable("settings", {
	key: text("key").primaryKey(),
	value: text("value", { mode: "json" }).$type<unknown>().notNull(),
});
export const actualBalances = sqliteTable(
	"actual_balances",
	{
		taxYear: text("tax_year").notNull(),
		asset: text("asset").notNull(),
		// Empty source represents a global balance so SQLite's NULL uniqueness cannot admit duplicates.
		source: text("source").notNull().default(""),
		amount: text("amount").$type<ActualBalance["amount"]>().notNull(),
	},
	(t) => [primaryKey({ columns: [t.taxYear, t.asset, t.source] })],
);
export const reports = sqliteTable("reports", {
	id: text("id").primaryKey(),
	taxYear: text("tax_year").notNull(),
	computedAt: text("computed_at").notNull(),
	settingsJson: text("settings_json", { mode: "json" })
		.$type<VdaReport["generatedFrom"]["settings"]>()
		.notNull(),
	reportJson: text("report_json", { mode: "json" })
		.$type<VdaReport>()
		.notNull(),
});
export const jobs = sqliteTable("jobs", {
	id: text("id").primaryKey(),
	kind: text("kind").notNull(),
	status: text("status", {
		enum: ["pending", "running", "completed", "failed"],
	}).notNull(),
	payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
	result: text("result", { mode: "json" }).$type<unknown>(),
	error: text("error"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});
export const priceCache = sqliteTable(
	"price_cache",
	{
		asset: text("asset").notNull(),
		date: text("date").notNull(),
		quote: text("quote").notNull(),
		price: text("price").notNull(),
		source: text("source").notNull(),
	},
	(t) => [primaryKey({ columns: [t.asset, t.date, t.quote] })],
);
export const fxRates = sqliteTable(
	"fx_rates",
	{
		currency: text("currency").notNull(),
		date: text("date").notNull(),
		rate: text("rate").notNull(),
		source: text("source").notNull(),
	},
	(t) => [primaryKey({ columns: [t.currency, t.date] })],
);
