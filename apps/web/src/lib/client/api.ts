import type {
	ActualBalance,
	LedgerTx,
	Recipe,
	ReviewCode,
	TxType,
	VdaReport,
} from "@tax/core";
import {
	ActualBalancesResponseSchema,
	type AppSettings,
	ComputeReportResponseSchema,
	ConfirmImportRequestSchema,
	ConfirmImportResponseSchema,
	CreateImportResponseSchema,
	CreateTransactionRequestSchema,
	CreateTransactionResponseSchema,
	ErrorEnvelopeSchema,
	GetImportResponseSchema,
	GetReportResponseSchema,
	HealthResponseSchema,
	type ImportDetail,
	type ImportSummary,
	ListImportsResponseSchema,
	ListRecipesResponseSchema,
	ListTransactionsResponseSchema,
	LoginResponseSchema,
	PatchTransactionRequestSchema,
	PatchTransactionResponseSchema,
	PreviewPayloadResponseSchema,
	PreviewRecipeResponseSchema,
	PutActualBalancesResponseSchema,
	PutSettingsRequestSchema,
	PutSettingsResponseSchema,
	ReviewResponseSchema,
	type SentPayload,
	SettingsResponseSchema,
	type SettingsUpdate,
	SuggestRecipeResponseSchema,
	TaxYearsResponseSchema,
	type TransactionsQuery,
} from "@tax/core/api";
import { z } from "zod";

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details?: unknown;

	constructor(
		status: number,
		code: string,
		message: string,
		details?: unknown,
	) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export class ValidationError extends Error {
	readonly fieldErrors: Record<string, string>;

	constructor(message: string, fieldErrors: Record<string, string>) {
		super(message);
		this.name = "ValidationError";
		this.fieldErrors = fieldErrors;
	}
}

const FIELD_LABELS: Record<string, string> = {
	timestamp: "Date & time",
	assetIn: "Asset received",
	amountIn: "Quantity received",
	assetOut: "Asset sold / paid",
	amountOut: "Quantity sold / paid",
	inrValue: "INR value",
	tdsInr: "TDS deducted",
	incomeKind: "Income kind",
	type: "Transaction type",
	"ai.baseUrl": "OpenAI-compatible base URL",
	"ai.model": "Model name",
	transferMatchWindowHours: "Transfer match window",
	transferAmountTolerance: "Transfer amount tolerance",
	defaultTaxYear: "Default tax year",
	recipeName: "Recipe name",
	"recipe.name": "Recipe name",
	"recipe.dateFormat": "Date format",
};

const DECIMAL_FIELDS = new Set([
	"amountIn",
	"amountOut",
	"inrValue",
	"tdsInr",
	"transferAmountTolerance",
]);

function humanizeIssue(issue: z.core.$ZodIssue): {
	field: string;
	message: string;
} {
	const field = issue.path.map(String).join(".") || "_form";
	const label = FIELD_LABELS[field] ?? field;

	if (DECIMAL_FIELDS.has(field)) {
		if (issue.message === "Must be positive") {
			return { field, message: `${label} must be greater than zero.` };
		}
		if (issue.message === "Must be nonnegative") {
			return { field, message: `${label} must be zero or greater.` };
		}
		if (
			issue.code === "invalid_format" ||
			issue.code === "invalid_type" ||
			issue.message === "Must be finite"
		) {
			return { field, message: `${label} must be a valid number.` };
		}
	}

	if (field === "assetIn" || field === "assetOut") {
		if (issue.code === "too_small" || issue.code === "invalid_type") {
			return { field, message: `${label} is required.` };
		}
		if (issue.code === "invalid_format") {
			return {
				field,
				message: `${label} must start with a letter or digit (A–Z, 0–9).`,
			};
		}
	}

	if (field === "timestamp") {
		return { field, message: "Date & time must be a valid IST date and time." };
	}

	if (field === "ai.baseUrl") {
		return {
			field,
			message:
				"OpenAI-compatible base URL must be a valid URL (for example http://ollama:11434/v1).",
		};
	}

	if (issue.code === "custom") {
		if (issue.message.endsWith("requires assetIn")) {
			return { field: "assetIn", message: "Asset received is required." };
		}
		if (issue.message.endsWith("requires amountIn")) {
			return { field: "amountIn", message: "Quantity received is required." };
		}
		if (issue.message.startsWith("buy requires assetOut")) {
			return {
				field: "assetOut",
				message: "Enter Cost in INR or a quote asset paid.",
			};
		}
		if (issue.message.startsWith("buy requires amountOut")) {
			return {
				field: "amountOut",
				message: "Enter Cost in INR or a quote quantity paid.",
			};
		}
		if (issue.message.endsWith("requires assetOut")) {
			return { field: "assetOut", message: "Asset sold is required." };
		}
		if (issue.message.endsWith("requires amountOut")) {
			return { field: "amountOut", message: "Quantity sold is required." };
		}
	}

	if (issue.code === "invalid_type") {
		return { field, message: `${label} is required.` };
	}

	const clean = issue.message.replace(/\.$/, "");
	return { field, message: `${label}: ${clean}.` };
}

export function formatZodError(err: z.ZodError): ValidationError {
	const fieldErrors: Record<string, string> = {};
	const summaryParts: string[] = [];

	for (const issue of err.issues) {
		const { field, message } = humanizeIssue(issue);
		if (!fieldErrors[field]) fieldErrors[field] = message;
		if (!summaryParts.includes(message)) summaryParts.push(message);
	}

	const summary =
		summaryParts.length === 0
			? "Please check the highlighted fields."
			: summaryParts.length === 1
				? (summaryParts[0] ?? "Please check the highlighted fields.")
				: `Please check ${summaryParts.length} fields below.`;

	return new ValidationError(summary, fieldErrors);
}

export function getErrorMessage(err: unknown): string {
	if (err instanceof ValidationError) return err.message;
	if (err instanceof z.ZodError) return formatZodError(err).message;
	if (err instanceof ApiError) return err.message;
	if (err instanceof Error) return err.message;
	return "Something went wrong";
}

function redirectToLogin() {
	if (typeof window === "undefined") return;
	if (window.location.pathname === "/login") return;
	const next = `${window.location.pathname}${window.location.search}`;
	window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

function parseInDev<T>(schema: z.ZodType<T>, data: unknown): T {
	if (process.env.NODE_ENV !== "production") {
		return schema.parse(data);
	}
	return data as T;
}

async function requestJson<T>(
	path: string,
	options: RequestInit & {
		schema?: z.ZodType<T>;
		skipAuthRedirect?: boolean;
	} = {},
): Promise<T> {
	const { schema, skipAuthRedirect, headers, ...init } = options;
	const res = await fetch(path, {
		...init,
		credentials: "same-origin",
		headers: {
			Accept: "application/json",
			...(init.body && !(init.body instanceof FormData)
				? { "Content-Type": "application/json" }
				: {}),
			...headers,
		},
	});

	if (res.status === 401) {
		if (!skipAuthRedirect) redirectToLogin();
		let message = "Authentication required";
		try {
			const body = await res.json();
			const parsed = ErrorEnvelopeSchema.safeParse(body);
			if (parsed.success) message = parsed.data.error.message;
		} catch {
			// ignore non-json 401
		}
		throw new ApiError(401, "UNAUTHORIZED", message);
	}

	if (res.status === 204) {
		return undefined as T;
	}

	let json: unknown;
	try {
		json = await res.json();
	} catch {
		if (!res.ok) {
			throw new ApiError(
				res.status,
				`HTTP_${res.status}`,
				res.statusText || "Request failed",
			);
		}
		throw new ApiError(
			res.status,
			"INVALID_JSON",
			"Expected JSON response from server",
		);
	}

	if (!res.ok) {
		const parsed = ErrorEnvelopeSchema.safeParse(json);
		if (parsed.success) {
			throw new ApiError(
				res.status,
				parsed.data.error.code,
				parsed.data.error.message,
				parsed.data.error.details,
			);
		}
		throw new ApiError(
			res.status,
			`HTTP_${res.status}`,
			res.statusText || "Request failed",
			json,
		);
	}

	if (schema) {
		return parseInDev(schema, json);
	}
	return json as T;
}

export type TaxYearInfo = z.infer<typeof TaxYearsResponseSchema>[number];
export type ReviewData = z.infer<typeof ReviewResponseSchema>;
export type PreviewPayloadData = z.infer<typeof PreviewPayloadResponseSchema>;
export type SuggestRecipeData = z.infer<typeof SuggestRecipeResponseSchema>;
export type PreviewRecipeData = z.infer<typeof PreviewRecipeResponseSchema>;
export type TransactionsPage = z.infer<typeof ListTransactionsResponseSchema>;

function parseRequest<T extends z.ZodType>(
	schema: T,
	input: z.input<T>,
): z.output<T> {
	const parsed = schema.safeParse(input);
	if (!parsed.success) throw formatZodError(parsed.error);
	return parsed.data;
}

export const api = {
	health() {
		return requestJson("/api/health", { schema: HealthResponseSchema });
	},

	getSettings(): Promise<AppSettings> {
		return requestJson("/api/settings", { schema: SettingsResponseSchema });
	},

	putSettings(patch: SettingsUpdate): Promise<AppSettings> {
		const body = parseRequest(PutSettingsRequestSchema, patch);
		return requestJson("/api/settings", {
			method: "PUT",
			body: JSON.stringify(body),
			schema: PutSettingsResponseSchema,
		});
	},

	getTaxYears(): Promise<TaxYearInfo[]> {
		return requestJson("/api/tax-years", { schema: TaxYearsResponseSchema });
	},

	createImport(input: {
		file: File;
		source: "auto" | "binance" | "coindcx" | "generic";
		timezone: "IST" | "UTC";
	}): Promise<ImportSummary> {
		const formData = new FormData();
		formData.append("file", input.file);
		formData.append("source", input.source);
		formData.append("timezone", input.timezone);
		return requestJson("/api/imports", {
			method: "POST",
			body: formData,
			schema: CreateImportResponseSchema,
		});
	},

	listImports(): Promise<ImportSummary[]> {
		return requestJson("/api/imports", { schema: ListImportsResponseSchema });
	},

	getImport(id: string): Promise<ImportDetail> {
		return requestJson(`/api/imports/${encodeURIComponent(id)}`, {
			schema: GetImportResponseSchema,
		});
	},

	confirmImport(
		id: string,
		input: { recipe: Recipe; saveRecipe: boolean; recipeName?: string },
	): Promise<ImportSummary> {
		const body = parseRequest(ConfirmImportRequestSchema, input);
		return requestJson(`/api/imports/${encodeURIComponent(id)}/confirm`, {
			method: "POST",
			body: JSON.stringify(body),
			schema: ConfirmImportResponseSchema,
		});
	},

	deleteImport(id: string): Promise<void> {
		return requestJson(`/api/imports/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	},

	previewPayload(input: {
		importId: string;
		sheet?: string;
	}): Promise<PreviewPayloadData> {
		return requestJson("/api/recipes/suggest/preview-payload", {
			method: "POST",
			body: JSON.stringify(input),
			schema: PreviewPayloadResponseSchema,
		});
	},

	suggestRecipe(input: {
		importId: string;
		sheet?: string;
	}): Promise<SuggestRecipeData> {
		return requestJson("/api/recipes/suggest", {
			method: "POST",
			body: JSON.stringify(input),
			schema: SuggestRecipeResponseSchema,
		});
	},

	previewRecipe(input: {
		importId: string;
		sheet?: string;
		recipe: Recipe;
	}): Promise<PreviewRecipeData> {
		return requestJson("/api/recipes/preview", {
			method: "POST",
			body: JSON.stringify(input),
			schema: PreviewRecipeResponseSchema,
		});
	},

	listRecipes(): Promise<Recipe[]> {
		return requestJson("/api/recipes", { schema: ListRecipesResponseSchema });
	},

	deleteRecipe(id: string): Promise<void> {
		return requestJson(`/api/recipes/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	},

	listTransactions(
		query: Partial<TransactionsQuery>,
	): Promise<TransactionsPage> {
		const params = new URLSearchParams();
		if (query.taxYear) params.set("taxYear", query.taxYear);
		if (query.asset) params.set("asset", query.asset);
		if (query.type) params.set("type", query.type);
		if (query.source) params.set("source", query.source);
		if (query.flagged !== undefined)
			params.set("flagged", String(query.flagged));
		if (query.q) params.set("q", query.q);
		if (query.page) params.set("page", String(query.page));
		if (query.pageSize) params.set("pageSize", String(query.pageSize));
		if (query.sort) params.set("sort", query.sort);
		const qs = params.toString();
		return requestJson(`/api/transactions${qs ? `?${qs}` : ""}`, {
			schema: ListTransactionsResponseSchema,
		});
	},

	createTransaction(
		input: z.input<typeof CreateTransactionRequestSchema>,
	): Promise<LedgerTx> {
		const body = parseRequest(CreateTransactionRequestSchema, input);
		return requestJson("/api/transactions", {
			method: "POST",
			body: JSON.stringify(body),
			schema: CreateTransactionResponseSchema,
		});
	},

	patchTransaction(
		id: string,
		patch: {
			type?: TxType;
			incomeKind?: LedgerTx["incomeKind"];
			inrValue?: string;
			userNote?: string;
			resolveFlags?: ReviewCode[];
		},
	): Promise<LedgerTx> {
		const body = parseRequest(PatchTransactionRequestSchema, patch);
		return requestJson(`/api/transactions/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify(body),
			schema: PatchTransactionResponseSchema,
		});
	},

	deleteTransaction(id: string): Promise<void> {
		return requestJson(`/api/transactions/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	},

	getReview(taxYear?: string): Promise<ReviewData> {
		const qs = taxYear ? `?taxYear=${encodeURIComponent(taxYear)}` : "";
		return requestJson(`/api/review${qs}`, { schema: ReviewResponseSchema });
	},

	getActualBalances(taxYear: string): Promise<ActualBalance[]> {
		return requestJson(
			`/api/balances/actual?taxYear=${encodeURIComponent(taxYear)}`,
			{ schema: ActualBalancesResponseSchema },
		);
	},

	putActualBalances(
		taxYear: string,
		balances: ActualBalance[],
	): Promise<ActualBalance[]> {
		return requestJson(
			`/api/balances/actual?taxYear=${encodeURIComponent(taxYear)}`,
			{
				method: "PUT",
				body: JSON.stringify(balances),
				schema: PutActualBalancesResponseSchema,
			},
		);
	},

	computeReport(taxYear: string): Promise<VdaReport> {
		return requestJson(`/api/reports/${encodeURIComponent(taxYear)}/compute`, {
			method: "POST",
			body: JSON.stringify({}),
			schema: ComputeReportResponseSchema,
		});
	},

	async getReportOrNull(taxYear: string): Promise<VdaReport | null> {
		try {
			return await requestJson(`/api/reports/${encodeURIComponent(taxYear)}`, {
				schema: GetReportResponseSchema,
			});
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) return null;
			throw err;
		}
	},

	getExportUrl(
		taxYear: string,
		format: "csv" | "xlsx",
		kind: "schedule-vda" | "tds" | "income" | "full",
	): string {
		const params = new URLSearchParams({ format, kind });
		return `/api/reports/${encodeURIComponent(taxYear)}/export?${params.toString()}`;
	},

	login(password: string): Promise<{ ok: true }> {
		return requestJson("/api/auth/login", {
			method: "POST",
			body: JSON.stringify({ password }),
			schema: LoginResponseSchema,
			skipAuthRedirect: true,
		});
	},

	logout(): Promise<void> {
		return requestJson("/api/auth/logout", {
			method: "POST",
			body: JSON.stringify({}),
			skipAuthRedirect: true,
		});
	},
};

export type { AppSettings, ImportDetail, ImportSummary, SentPayload };
