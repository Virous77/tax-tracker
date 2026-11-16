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
import type { z } from "zod";

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

export function getErrorMessage(err: unknown): string {
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

export const api = {
	health() {
		return requestJson("/api/health", { schema: HealthResponseSchema });
	},

	getSettings(): Promise<AppSettings> {
		return requestJson("/api/settings", { schema: SettingsResponseSchema });
	},

	putSettings(patch: SettingsUpdate): Promise<AppSettings> {
		const body = PutSettingsRequestSchema.parse(patch);
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
		const body = ConfirmImportRequestSchema.parse(input);
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
		const body = CreateTransactionRequestSchema.parse(input);
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
		const body = PatchTransactionRequestSchema.parse(patch);
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
