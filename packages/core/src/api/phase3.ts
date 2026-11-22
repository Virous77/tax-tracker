import { z } from "zod";
import { AssetSchema, TaxYearSchema } from "../ledger.js";
import { ActualBalanceSchema } from "../settings.js";
import {
	EquityCyPriceSchema,
	EquityMetadataSchema,
	UsEquityReportSchema,
} from "../us-equity.js";
import { DownloadResponseSchema } from "./download.js";

const empty = z.strictObject({});
const calendarYear = z.number().int();
export const UsEquityTaxYearParamsSchema = z.object({ taxYear: TaxYearSchema });
export const ComputeUsEquityReportRequestSchema = empty;
export const ComputeUsEquityReportResponseSchema = UsEquityReportSchema;
export const GetUsEquityReportQuerySchema = z.object({
	allowStale: z
		.union([
			z.boolean(),
			z.enum(["true", "false"]).transform((value) => value === "true"),
		])
		.optional(),
	allowMissing: z
		.union([
			z.boolean(),
			z.enum(["true", "false"]).transform((value) => value === "true"),
		])
		.optional(),
});
export const GetUsEquityReportRequestSchema = GetUsEquityReportQuerySchema;
export const GetUsEquityReportResponseSchema = UsEquityReportSchema;
export const UsEquityReportMissingSchema = z.object({
	status: z.literal("missing"),
	invalidatedAt: z.iso.datetime().nullable(),
	cause: z.enum([
		"ledger_changed",
		"settings_changed",
		"balances_changed",
		"never_computed",
	]),
});
export const GetUsEquityReportStateResponseSchema = z.union([
	UsEquityReportSchema,
	UsEquityReportMissingSchema,
]);
export const UsEquityExportKindSchema = z.enum([
	"capital-gains",
	"dividends",
	"form67",
	"schedule-fa",
	"full",
]);
export const ExportUsEquityReportQuerySchema = z.object({
	format: z.enum(["csv", "xlsx"]),
	kind: UsEquityExportKindSchema,
});
export const ExportUsEquityReportRequestSchema =
	ExportUsEquityReportQuerySchema;
export const ExportUsEquityReportResponseSchema = DownloadResponseSchema;
export const GetEquityMetadataRequestSchema = empty;
export const GetEquityMetadataResponseSchema = z.array(EquityMetadataSchema);
export const PutEquityMetadataRequestSchema = GetEquityMetadataResponseSchema;
export const PutEquityMetadataResponseSchema = GetEquityMetadataResponseSchema;
export const GetEquityPricesQuerySchema = z.object({
	calendarYear: z.union([
		calendarYear,
		z
			.string()
			.regex(/^\d{4}$/)
			.transform(Number),
	]),
});
export const GetEquityPricesRequestSchema = GetEquityPricesQuerySchema;
export const GetEquityPricesResponseSchema = z.array(EquityCyPriceSchema);
export const PutEquityPricesRequestSchema = z
	.object({
		calendarYear,
		prices: GetEquityPricesResponseSchema,
	})
	.refine(
		({ calendarYear, prices }) =>
			prices.every((price) => price.calendarYear === calendarYear),
		{
			path: ["prices"],
			message: "All prices must belong to the requested calendar year.",
		},
	);
export const PutEquityPricesResponseSchema = GetEquityPricesResponseSchema;
export const UsEquityActualBalancesQuerySchema = UsEquityTaxYearParamsSchema;
export const GetUsEquityActualBalancesRequestSchema =
	UsEquityActualBalancesQuerySchema;
export const GetUsEquityActualBalancesResponseSchema =
	z.array(ActualBalanceSchema);
export const PutUsEquityActualBalancesRequestSchema =
	GetUsEquityActualBalancesResponseSchema;
export const PutUsEquityActualBalancesResponseSchema =
	GetUsEquityActualBalancesResponseSchema;

export const EquityPricesStatusQuerySchema = UsEquityTaxYearParamsSchema;
export const EquityPricesStatusRequestSchema = EquityPricesStatusQuerySchema;
export const EquityPricesStatusResponseSchema = z.object({
	enabled: z.boolean(),
	calendarYear: calendarYear,
	vaultUnlocked: z.boolean(),
	needed: z.number().int().nonnegative(),
	filled: z.number().int().nonnegative(),
	missing: z.array(
		z.object({
			symbol: AssetSchema,
			needsPeak: z.boolean(),
			needsClosing: z.boolean(),
		}),
	),
	sources: z.object({
		polygon: z.object({ keySet: z.boolean() }),
		finnhub: z.object({ keySet: z.boolean() }),
	}),
});
export const FillEquityPricesRequestSchema = z
	.object({
		taxYear: TaxYearSchema,
		provider: z.enum(["auto", "polygon", "finnhub"]).default("auto"),
		overwrite: z.boolean().default(false),
	})
	.strict();
export const FillEquityPricesResponseSchema = z.object({ jobId: z.string() });

export type EquityPricesStatus = z.infer<
	typeof EquityPricesStatusResponseSchema
>;
export type UsEquityExportKind = z.infer<typeof UsEquityExportKindSchema>;

export const Phase3ApiContract = {
	computeUsEquityReport: {
		method: "POST",
		path: "/api/us-equity/reports/:taxYear/compute",
		params: UsEquityTaxYearParamsSchema,
		request: ComputeUsEquityReportRequestSchema,
		response: ComputeUsEquityReportResponseSchema,
	},
	getUsEquityReport: {
		method: "GET",
		path: "/api/us-equity/reports/:taxYear",
		params: UsEquityTaxYearParamsSchema,
		request: GetUsEquityReportRequestSchema,
		response: GetUsEquityReportStateResponseSchema,
	},
	exportUsEquityReport: {
		method: "GET",
		path: "/api/us-equity/reports/:taxYear/export",
		params: UsEquityTaxYearParamsSchema,
		request: ExportUsEquityReportRequestSchema,
		response: ExportUsEquityReportResponseSchema,
	},
	getEquityMetadata: {
		method: "GET",
		path: "/api/us-equity/metadata",
		request: GetEquityMetadataRequestSchema,
		response: GetEquityMetadataResponseSchema,
	},
	putEquityMetadata: {
		method: "PUT",
		path: "/api/us-equity/metadata",
		request: PutEquityMetadataRequestSchema,
		response: PutEquityMetadataResponseSchema,
	},
	getEquityPrices: {
		method: "GET",
		path: "/api/us-equity/prices",
		request: GetEquityPricesRequestSchema,
		response: GetEquityPricesResponseSchema,
	},
	putEquityPrices: {
		method: "PUT",
		path: "/api/us-equity/prices",
		request: PutEquityPricesRequestSchema,
		response: PutEquityPricesResponseSchema,
	},
	getUsEquityActualBalances: {
		method: "GET",
		path: "/api/us-equity/balances/actual",
		request: GetUsEquityActualBalancesRequestSchema,
		response: GetUsEquityActualBalancesResponseSchema,
	},
	putUsEquityActualBalances: {
		method: "PUT",
		path: "/api/us-equity/balances/actual",
		query: UsEquityActualBalancesQuerySchema,
		request: PutUsEquityActualBalancesRequestSchema,
		response: PutUsEquityActualBalancesResponseSchema,
	},
	equityPricesStatus: {
		method: "GET",
		path: "/api/us-equity/prices/status",
		request: EquityPricesStatusRequestSchema,
		response: EquityPricesStatusResponseSchema,
	},
	fillEquityPrices: {
		method: "POST",
		path: "/api/us-equity/prices/fill",
		request: FillEquityPricesRequestSchema,
		response: FillEquityPricesResponseSchema,
	},
} as const;
