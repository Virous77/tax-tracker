import { z } from "zod";
import { TimezoneSchema } from "../time.js";

export { TimezoneSchema } from "../time.js";

import {
	ConnectionSchema,
	Phase2ApiContract,
	PricesSettingsPatchSchema,
	PricesSettingsSchema,
} from "./phase2.js";

export * from "./phase2.js";

import {
	AssetSchema,
	DecimalStringSchema,
	IncomeKindSchema,
	LedgerTxFieldsSchema,
	LedgerTxSchema,
	ManualVenueSchema,
	NonNegativeDecimalSchema,
	ReviewCodeSchema,
	ReviewFlagSchema,
	TaxYearSchema,
	TxTypeSchema,
} from "../ledger.js";
import { RecipeSchema } from "../recipe.js";
import {
	BalanceSchema,
	ReportWarningSchema,
	UnresolvedSchema,
	VdaReportSchema,
} from "../report.js";
import {
	ActualBalanceSchema,
	EngineSettingsPatchSchema,
	EngineSettingsSchema,
} from "../settings.js";

export const EmptyRequestSchema = z.object({}).strict();
export const NoContentResponseSchema = z.undefined();
export const IdParamsSchema = z.object({ id: z.string().min(1) });
export const TaxYearParamsSchema = z.object({ taxYear: TaxYearSchema });
export const ErrorEnvelopeSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		details: z.unknown().optional(),
	}),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export const HealthRequestSchema = EmptyRequestSchema;
export const HealthResponseSchema = z.object({
	ok: z.literal(true),
	version: z.string(),
	dbOk: z.boolean(),
});

export const AiSettingsSchema = z.object({
	baseUrl: z.url().default("http://ollama:11434/v1"),
	model: z.string().default(""),
	apiKeySet: z.boolean().default(false),
	cloudAcknowledged: z.boolean().default(false),
});
export const SettingsResponseSchema = EngineSettingsSchema.extend({
	ai: AiSettingsSchema,
	prices: PricesSettingsSchema.default({
		enabled: false,
		coingeckoFallback: true,
	}),
	defaultTaxYear: TaxYearSchema,
});
export const GetSettingsRequestSchema = EmptyRequestSchema;
export const PutSettingsRequestSchema = EngineSettingsPatchSchema.extend({
	prices: PricesSettingsPatchSchema.optional(),
	ai: z
		.object({
			baseUrl: z.url().optional(),
			model: z.string().optional(),
			apiKey: z.string().optional(),
			cloudAcknowledged: z.boolean().optional(),
		})
		.strict()
		.optional(),
	defaultTaxYear: TaxYearSchema.optional(),
}).strict();
export const PutSettingsResponseSchema = SettingsResponseSchema;
export type AppSettings = z.infer<typeof SettingsResponseSchema>;
export const TaxYearInfoSchema = z.object({
	id: TaxYearSchema,
	act: z.string(),
	start: z.iso.date(),
	end: z.iso.date(),
});
export const TaxYearsRequestSchema = EmptyRequestSchema;
export const TaxYearsResponseSchema = z.array(TaxYearInfoSchema);

export const ImportSourceSchema = z.enum([
	"auto",
	"binance",
	"coindcx",
	"generic",
]);
export const BalanceSnapshotRowSchema = z.object({
	asset: AssetSchema,
	amount: NonNegativeDecimalSchema,
	wallet: z.string().optional(),
	raw: z.unknown(),
});
export const BalanceSnapshotSchema = z.object({
	id: z.string(),
	importId: z.string(),
	venue: z.string(),
	asOf: z.iso.date(),
	timezone: TimezoneSchema,
	rows: z.array(BalanceSnapshotRowSchema),
	createdAt: z.iso.datetime(),
});
export const BalanceSnapshotsResponseSchema = z.array(
	BalanceSnapshotSchema.extend({
		comparison: z.array(
			z.object({
				asset: AssetSchema,
				statement: DecimalStringSchema,
				computed: DecimalStringSchema,
				difference: DecimalStringSchema,
			}),
		),
	}),
);
export const ApplyBalanceSnapshotRequestSchema = z
	.object({ taxYear: TaxYearSchema })
	.strict();
export type BalanceSnapshot = z.infer<typeof BalanceSnapshotSchema>;
export const TdsSummarySchema = z.array(
	z.object({
		source: z.string(),
		tdsInr: NonNegativeDecimalSchema,
		period: z.string().optional(),
		raw: z.unknown(),
	}),
);
export const ImportStatusSchema = z.enum([
	"pending_recipe",
	"imported",
	"failed",
]);
export const SampleRowSchema = z.record(z.string(), z.unknown());
export const ImportSheetSchema = z.object({
	name: z.string(),
	headers: z.array(z.string()),
	sampleRows: z.array(SampleRowSchema).max(20),
	rowsRead: z.number().int().nonnegative().optional(),
});
export const RowErrorSchema = z.object({
	rowIndex: z.number().int().nonnegative(),
	sheet: z.string().optional(),
	message: z.string(),
	raw: z.unknown().optional(),
});
export const SkippedRowSchema = z.object({
	rowIndex: z.number().int().nonnegative(),
	sheet: z.string(),
	reason: z.string(),
});
export const ReportMissingDetailsSchema = z.object({
	invalidatedAt: z.iso.datetime().nullable(),
	cause: z.enum([
		"ledger_changed",
		"settings_changed",
		"balances_changed",
		"never_computed",
	]),
});
export type ReportMissingDetails = z.infer<typeof ReportMissingDetailsSchema>;
export const ImportSummarySchema = z.object({
	id: z.string(),
	kind: z.enum(["file", "api_sync"]).optional(),
	connectionId: z.string().nullable().optional(),
	connectionLabel: z.string().nullable().optional(),
	source: z.string(),
	fileName: z.string(),
	fileSha256: z.string(),
	timezone: TimezoneSchema,
	reportKind: z.string().nullable().default(null),
	reportKindLabel: z.string().nullable().default(null),
	detectedTimezone: z.string().nullable().default(null),
	timezoneSource: z.enum(["file", "user"]).default("user"),
	coverage: z
		.array(
			z.object({
				reportKind: z.string(),
				firstTimestamp: z.iso.datetime(),
				lastTimestamp: z.iso.datetime(),
			}),
		)
		.default([]),
	status: ImportStatusSchema,
	rowsRead: z.number().int().nonnegative(),
	rowsInserted: z.number().int().nonnegative(),
	rowsDuplicate: z.number().int().nonnegative(),
	rowsError: z.number().int().nonnegative(),
	rowsSkipped: z.number().int().nonnegative().default(0),
	skippedRows: z.array(SkippedRowSchema).default([]),
	recipeId: z.string().nullable(),
	createdAt: z.iso.datetime(),
	error: z.string().nullable(),
	warnings: z.array(ReviewFlagSchema),
	sheets: z.array(ImportSheetSchema).optional(),
});
export type ImportSummary = z.infer<typeof ImportSummarySchema>;
// File bytes are validated separately from the multipart metadata, before parsing an export.
export const CreateImportRequestSchema = z.object({
	file: z
		.instanceof(Uint8Array)
		.refine((v) => v.byteLength <= 25 * 1024 * 1024, "File exceeds 25 MB"),
	fileName: z.string().min(1),
	pdfPassword: z.string().optional(),
	source: ImportSourceSchema,
	timezone: TimezoneSchema,
});
export const CreateImportResponseSchema = ImportSummarySchema;
export const ListImportsRequestSchema = EmptyRequestSchema;
export const ListImportsResponseSchema = z.array(ImportSummarySchema);
export const GetImportRequestSchema = IdParamsSchema;
export const GetImportResponseSchema = ImportSummarySchema.extend({
	rowErrors: z.array(RowErrorSchema),
	tdsSummary: TdsSummarySchema.optional(),
	balanceSnapshot: BalanceSnapshotSchema.optional(),
});
export const ConfirmImportRequestSchema = z.object({
	recipe: RecipeSchema,
	saveRecipe: z.boolean(),
	recipeName: z.string().optional(),
});
export const ConfirmImportResponseSchema = ImportSummarySchema.extend({
	status: z.literal("imported"),
});
export const DeleteImportRequestSchema = IdParamsSchema;
export const DeleteImportResponseSchema = NoContentResponseSchema;

export const SuggestRecipeRequestSchema = z.object({
	importId: z.string(),
	sheet: z.string().optional(),
});
export const SentPayloadSchema = z.object({
	model: z.string(),
	messages: z.array(
		z.object({
			role: z.enum(["system", "user", "assistant"]),
			content: z.string(),
		}),
	),
	response_format: z.object({
		type: z.literal("json_schema"),
		json_schema: z.object({
			name: z.string(),
			strict: z.boolean().optional(),
			schema: z.record(z.string(), z.unknown()),
		}),
	}),
});
export const SuggestRecipeResponseSchema = z.object({
	recipe: RecipeSchema,
	sentPayload: SentPayloadSchema,
});
export const PreviewPayloadRequestSchema = SuggestRecipeRequestSchema;
export const PreviewPayloadResponseSchema = z.object({
	sentPayload: SentPayloadSchema,
	endpoint: z.url(),
	model: z.string(),
	isLocal: z.boolean(),
});
export const PreviewRecipeRequestSchema = SuggestRecipeRequestSchema.extend({
	recipe: RecipeSchema,
});
export const PreviewChecksSchema = z.object({
	datesOk: z.boolean(),
	numbersOk: z.boolean(),
	rowCountIn: z.number().int().nonnegative(),
	rowCountOut: z.number().int().nonnegative(),
	negativeBalances: z.array(
		z.object({
			asset: z.string(),
			source: z.string().optional(),
			amount: z.string(),
		}),
	),
});
export const PreviewRecipeResponseSchema = z.object({
	rows: z
		.array(
			z.object({
				original: z.unknown(),
				converted: LedgerTxSchema.nullable(),
				error: z.string().optional(),
			}),
		)
		.max(10),
	checks: PreviewChecksSchema,
});
export const ListRecipesRequestSchema = EmptyRequestSchema;
export const ListRecipesResponseSchema = z.array(RecipeSchema);
export const DeleteRecipeRequestSchema = IdParamsSchema;
export const DeleteRecipeResponseSchema = NoContentResponseSchema;

const QueryBooleanSchema = z.union([
	z.boolean(),
	z.enum(["true", "false"]).transform((v) => v === "true"),
]);
export const PaginationQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const TransactionSortSchema = z.enum([
	"timestamp:asc",
	"timestamp:desc",
	"asset:asc",
	"asset:desc",
	"source:asc",
	"source:desc",
]);
export const TransactionsQuerySchema = PaginationQuerySchema.extend({
	taxYear: TaxYearSchema.optional(),
	asset: z.string().optional(),
	type: TxTypeSchema.optional(),
	source: z.string().optional(),
	flagged: QueryBooleanSchema.optional(),
	superseded: QueryBooleanSchema.optional(),
	q: z.string().optional(),
	sort: TransactionSortSchema.default("timestamp:desc"),
});
export const ListTransactionsRequestSchema = TransactionsQuerySchema;
export const PaginationResponseSchema = z.object({
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive().max(200),
});
export const TransactionListItemSchema = z.intersection(
	LedgerTxSchema,
	z.object({ supersededBy: z.string().nullable() }),
);
export const ListTransactionsResponseSchema = PaginationResponseSchema.extend({
	items: z.array(TransactionListItemSchema),
});
export { ManualVenueSchema } from "../ledger.js";
export const CreateTransactionRequestSchema = LedgerTxFieldsSchema.omit({
	id: true,
	source: true,
})
	.extend({ venue: ManualVenueSchema.default("manual") })
	.superRefine((tx, ctx) => {
		const parsed = LedgerTxSchema.safeParse({
			...tx,
			id: "00000000-0000-4000-8000-000000000000",
			source: "manual",
		});
		if (!parsed.success)
			for (const issue of parsed.error.issues)
				ctx.addIssue({ ...issue, path: issue.path });
	});
export const CreateTransactionResponseSchema = LedgerTxSchema;
export const PatchTransactionRequestSchema = z
	.object({
		type: TxTypeSchema.optional(),
		incomeKind: IncomeKindSchema.optional(),
		inrValue: NonNegativeDecimalSchema.optional(),
		userNote: z.string().optional(),
		resolveFlags: z.array(ReviewCodeSchema).optional(),
	})
	.strict();
export const PatchTransactionResponseSchema = LedgerTxSchema;
export const DeleteTransactionRequestSchema = IdParamsSchema;
export const DeleteTransactionResponseSchema = NoContentResponseSchema;
export const ReviewQuerySchema = z.object({
	taxYear: TaxYearSchema.optional(),
});
export const ReviewRequestSchema = ReviewQuerySchema;
export const ReportReviewItemSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("warning"),
		taxYear: TaxYearSchema,
		message: z.string(),
		warning: ReportWarningSchema,
	}),
	z.object({
		kind: z.literal("balance"),
		taxYear: TaxYearSchema,
		message: z.string(),
		balance: BalanceSchema,
	}),
	z.object({
		kind: z.literal("unresolved"),
		taxYear: TaxYearSchema,
		message: z.string(),
		unresolved: UnresolvedSchema,
	}),
]);
export type ReportReviewItem = z.infer<typeof ReportReviewItemSchema>;
export const ReviewResponseSchema = z.object({
	connections: z.array(ConnectionSchema).default([]),
	reportStatus: z.enum(["current", "missing"]),
	reportStatuses: z.array(
		z.object({
			taxYear: TaxYearSchema,
			status: z.enum(["current", "missing"]),
		}),
	),
	computeTaxYears: z.array(TaxYearSchema),
	groups: z.array(
		z.object({
			code: ReviewCodeSchema,
			count: z.number().int().nonnegative(),
			items: z.array(LedgerTxSchema),
			reportItems: z.array(ReportReviewItemSchema),
		}),
	),
});
export const ActualBalancesQuerySchema = z.object({ taxYear: TaxYearSchema });
export const GetActualBalancesRequestSchema = ActualBalancesQuerySchema;
export const ActualBalancesResponseSchema = z.array(ActualBalanceSchema);
export const PutActualBalancesRequestSchema = ActualBalancesResponseSchema;
export const PutActualBalancesResponseSchema = ActualBalancesResponseSchema;
export const ComputeReportRequestSchema = EmptyRequestSchema;
export const ComputeReportResponseSchema = VdaReportSchema;
export const GetReportRequestSchema = TaxYearParamsSchema;
export const GetReportResponseSchema = VdaReportSchema;
export const ExportReportQuerySchema = z.object({
	format: z.enum(["csv", "xlsx"]),
	kind: z.enum(["schedule-vda", "tds", "income", "full"]),
});
export const ExportReportRequestSchema = ExportReportQuerySchema;
export const ExportReportResponseSchema = z.object({
	fileName: z.string(),
	contentType: z.enum([
		"text/csv; charset=utf-8",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	]),
	bytes: z.instanceof(Uint8Array),
});
export const LoginRequestSchema = z.object({ password: z.string().min(1) });
export const LoginResponseSchema = z.object({ ok: z.literal(true) });
export const LogoutRequestSchema = EmptyRequestSchema;
export const LogoutResponseSchema = NoContentResponseSchema;
export type TransactionsQuery = z.infer<typeof TransactionsQuerySchema>;
export type SettingsUpdate = z.infer<typeof PutSettingsRequestSchema>;
export type SentPayload = z.infer<typeof SentPayloadSchema>;
export type ImportDetail = z.infer<typeof GetImportResponseSchema>;

export const ApiContract = {
	...Phase2ApiContract,
	health: {
		method: "GET",
		path: "/api/health",
		request: HealthRequestSchema,
		response: HealthResponseSchema,
	},
	getSettings: {
		method: "GET",
		path: "/api/settings",
		request: GetSettingsRequestSchema,
		response: SettingsResponseSchema,
	},
	putSettings: {
		method: "PUT",
		path: "/api/settings",
		request: PutSettingsRequestSchema,
		response: PutSettingsResponseSchema,
	},
	taxYears: {
		method: "GET",
		path: "/api/tax-years",
		request: TaxYearsRequestSchema,
		response: TaxYearsResponseSchema,
	},
	createImport: {
		method: "POST",
		path: "/api/imports",
		request: CreateImportRequestSchema,
		response: CreateImportResponseSchema,
	},
	listImports: {
		method: "GET",
		path: "/api/imports",
		request: ListImportsRequestSchema,
		response: ListImportsResponseSchema,
	},
	getImport: {
		method: "GET",
		path: "/api/imports/:id",
		params: IdParamsSchema,
		request: EmptyRequestSchema,
		response: GetImportResponseSchema,
	},
	confirmImport: {
		method: "POST",
		path: "/api/imports/:id/confirm",
		params: IdParamsSchema,
		request: ConfirmImportRequestSchema,
		response: ConfirmImportResponseSchema,
	},
	deleteImport: {
		method: "DELETE",
		path: "/api/imports/:id",
		params: IdParamsSchema,
		request: EmptyRequestSchema,
		response: DeleteImportResponseSchema,
	},
	suggestRecipe: {
		method: "POST",
		path: "/api/recipes/suggest",
		request: SuggestRecipeRequestSchema,
		response: SuggestRecipeResponseSchema,
	},
	previewPayload: {
		method: "POST",
		path: "/api/recipes/suggest/preview-payload",
		request: PreviewPayloadRequestSchema,
		response: PreviewPayloadResponseSchema,
	},
	previewRecipe: {
		method: "POST",
		path: "/api/recipes/preview",
		request: PreviewRecipeRequestSchema,
		response: PreviewRecipeResponseSchema,
	},
	listRecipes: {
		method: "GET",
		path: "/api/recipes",
		request: ListRecipesRequestSchema,
		response: ListRecipesResponseSchema,
	},
	deleteRecipe: {
		method: "DELETE",
		path: "/api/recipes/:id",
		params: IdParamsSchema,
		request: EmptyRequestSchema,
		response: DeleteRecipeResponseSchema,
	},
	listTransactions: {
		method: "GET",
		path: "/api/transactions",
		request: ListTransactionsRequestSchema,
		response: ListTransactionsResponseSchema,
	},
	createTransaction: {
		method: "POST",
		path: "/api/transactions",
		request: CreateTransactionRequestSchema,
		response: CreateTransactionResponseSchema,
	},
	patchTransaction: {
		method: "PATCH",
		path: "/api/transactions/:id",
		params: IdParamsSchema,
		request: PatchTransactionRequestSchema,
		response: PatchTransactionResponseSchema,
	},
	deleteTransaction: {
		method: "DELETE",
		path: "/api/transactions/:id",
		params: IdParamsSchema,
		request: EmptyRequestSchema,
		response: DeleteTransactionResponseSchema,
	},
	review: {
		method: "GET",
		path: "/api/review",
		request: ReviewRequestSchema,
		response: ReviewResponseSchema,
	},
	listBalanceSnapshots: {
		method: "GET",
		path: "/api/balances/snapshots",
		request: EmptyRequestSchema,
		response: BalanceSnapshotsResponseSchema,
	},
	applyBalanceSnapshot: {
		method: "POST",
		path: "/api/balances/snapshots/:id/apply",
		params: IdParamsSchema,
		request: ApplyBalanceSnapshotRequestSchema,
		response: ActualBalancesResponseSchema,
	},
	getActualBalances: {
		method: "GET",
		path: "/api/balances/actual",
		request: GetActualBalancesRequestSchema,
		response: ActualBalancesResponseSchema,
	},
	putActualBalances: {
		method: "PUT",
		path: "/api/balances/actual",
		query: ActualBalancesQuerySchema,
		request: PutActualBalancesRequestSchema,
		response: PutActualBalancesResponseSchema,
	},
	computeReport: {
		method: "POST",
		path: "/api/reports/:taxYear/compute",
		params: TaxYearParamsSchema,
		request: ComputeReportRequestSchema,
		response: ComputeReportResponseSchema,
	},
	getReport: {
		method: "GET",
		path: "/api/reports/:taxYear",
		params: TaxYearParamsSchema,
		request: EmptyRequestSchema,
		response: GetReportResponseSchema,
	},
	exportReport: {
		method: "GET",
		path: "/api/reports/:taxYear/export",
		params: TaxYearParamsSchema,
		request: ExportReportRequestSchema,
		response: ExportReportResponseSchema,
	},
	login: {
		method: "POST",
		path: "/api/auth/login",
		request: LoginRequestSchema,
		response: LoginResponseSchema,
	},
	logout: {
		method: "POST",
		path: "/api/auth/logout",
		request: LogoutRequestSchema,
		response: LogoutResponseSchema,
	},
} as const;
