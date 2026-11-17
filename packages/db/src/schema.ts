import type { ActualBalance, LedgerTx, Recipe, VdaReport } from "@tax/core";
import type {
	BalanceSnapshot,
	ImportDetail,
	ImportSummary,
} from "@tax/core/api";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const imports = sqliteTable("imports", {
	id: text("id").primaryKey(),
	kind: text("kind", { enum: ["file", "api_sync"] })
		.notNull()
		.default("file"),
	connectionId: text("connection_id"),
	source: text("source").notNull(),
	fileName: text("file_name").notNull(),
	fileSha256: text("file_sha256").notNull(),
	timezone: text("timezone").$type<ImportSummary["timezone"]>().notNull(),
	reportKind: text("report_kind"),
	reportKindLabel: text("report_kind_label"),
	detectedTimezone: text("detected_timezone"),
	timezoneSource: text("timezone_source", { enum: ["file", "user"] })
		.notNull()
		.default("user"),
	coverage: text("coverage_json", { mode: "json" })
		.$type<ImportSummary["coverage"]>()
		.notNull()
		.default([]),
	tdsSummary: text("tds_summary_json", { mode: "json" }).$type<
		ImportDetail["tdsSummary"]
	>(),
	status: text("status", {
		enum: ["pending_recipe", "imported", "failed"],
	}).notNull(),
	rowsRead: integer("rows_read").notNull(),
	rowsInserted: integer("rows_inserted").notNull(),
	rowsDuplicate: integer("rows_duplicate").notNull(),
	rowsError: integer("rows_error").notNull(),
	rowsSkipped: integer("rows_skipped").notNull().default(0),
	skippedRows: text("skipped_rows", { mode: "json" })
		.$type<ImportSummary["skippedRows"]>()
		.notNull()
		.default([]),
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
		txId: text("tx_id"),
		source: text("source"),
		sourceRef: text("source_ref"),
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
		fingerprint: text("fingerprint"),
		supersededBy: text("superseded_by").references(() => imports.id, {
			onDelete: "set null",
		}),
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
	(t) => [
		uniqueIndex("transactions_source_ref").on(t.source, t.sourceRef),
		index("transactions_fingerprint").on(t.fingerprint),
		index("transactions_superseded_by").on(t.supersededBy),
	],
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
	progress: text("progress", { mode: "json" }).$type<unknown>(),
	result: text("result", { mode: "json" }).$type<unknown>(),
	error: text("error"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});
export const priceCache = sqliteTable(
	"price_cache",
	{
		source: text("source").notNull(),
		sourceId: text("source_id").notNull(),
		quote: text("quote").notNull(),
		dayBasis: text("day_basis", { enum: ["IST", "UTC"] }).notNull(),
		date: text("date").notNull(),
		kind: text("kind").notNull(),
		price: text("price").notNull(),
		final: integer("final", { mode: "boolean" }).notNull(),
		fetchedAt: text("fetched_at").notNull(),
	},
	(t) => [
		primaryKey({
			columns: [t.source, t.sourceId, t.quote, t.dayBasis, t.date, t.kind],
		}),
	],
);
export const assetPriceIds = sqliteTable(
	"asset_price_ids",
	{
		asset: text("asset").notNull(),
		chain: text("chain").notNull().default(""),
		source: text("source").notNull(),
		sourceId: text("source_id").notNull(),
	},
	(t) => [primaryKey({ columns: [t.asset, t.chain, t.source] })],
);
export const vaultMeta = sqliteTable("vault_meta", {
	id: integer("id").primaryKey(),
	json: text("json", { mode: "json" }).$type<unknown>().notNull(),
});
export const secrets = sqliteTable("secrets", {
	id: text("id").primaryKey(),
	kind: text("kind").notNull(),
	iv: text("iv").notNull(),
	ct: text("ct").notNull(),
	tag: text("tag").notNull(),
	createdAt: text("created_at").notNull(),
});
export const connections = sqliteTable("connections", {
	id: text("id").primaryKey(),
	kind: text("kind", { enum: ["binance", "coindcx", "evm"] }).notNull(),
	label: text("label").notNull(),
	chainId: integer("chain_id"),
	address: text("address"),
	options: text("options_json", { mode: "json" })
		.$type<import("@tax/core/api").ConnectionOptions>()
		.notNull(),
	createdAt: text("created_at").notNull(),
	lastSyncAt: text("last_sync_at"),
	lastSyncStatus: text("last_sync_status"),
	lastSyncError: text("last_sync_error"),
});
export const syncCursors = sqliteTable(
	"sync_cursors",
	{
		connectionId: text("connection_id")
			.notNull()
			.references(() => connections.id, { onDelete: "cascade" }),
		stream: text("stream").notNull(),
		cursor: text("cursor_json", { mode: "json" }).$type<unknown>().notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.connectionId, t.stream] })],
);
export const fetchedBalances = sqliteTable(
	"fetched_balances",
	{
		connectionId: text("connection_id")
			.notNull()
			.references(() => connections.id, { onDelete: "cascade" }),
		asset: text("asset").notNull(),
		wallet: text("wallet").notNull().default(""),
		amount: text("amount").notNull(),
		fetchedAt: text("fetched_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.connectionId, t.asset, t.wallet] })],
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

export const reportInvalidations = sqliteTable("report_invalidations", {
	taxYear: text("tax_year").primaryKey(),
	invalidatedAt: text("invalidated_at").notNull(),
	cause: text("cause", {
		enum: ["ledger_changed", "settings_changed", "balances_changed"],
	}).notNull(),
});

export const balanceSnapshots = sqliteTable("balance_snapshots", {
	id: text("id").primaryKey(),
	importId: text("import_id")
		.notNull()
		.unique()
		.references(() => imports.id, { onDelete: "cascade" }),
	venue: text("venue").notNull(),
	asOf: text("as_of").notNull(),
	timezone: text("timezone").$type<BalanceSnapshot["timezone"]>().notNull(),
	rows: text("rows_json", { mode: "json" })
		.$type<BalanceSnapshot["rows"]>()
		.notNull(),
	createdAt: text("created_at").notNull(),
});
