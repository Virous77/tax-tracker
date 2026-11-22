import { z } from "zod";
import {
	AssetSchema,
	DecimalStringSchema,
	LedgerTxSchema,
	PositiveDecimalSchema,
	ReviewFlagSchema,
	TaxYearSchema,
} from "./ledger.js";
import {
	BalanceSchema,
	RawRefSchema,
	ReportExcludedSchema,
	ReportWarningSchema,
	TrailSchema,
	UnresolvedSchema,
} from "./report.js";
import { EngineSettingsSchema } from "./settings.js";

const amount = DecimalStringSchema;
const nullableAmount = amount.nullable();
const date = z.iso.date();
const count = z.number().int().nonnegative();

export const EquityMetadataSchema = z.object({
	symbol: AssetSchema,
	entityName: z.string().min(1),
	entityAddress: z.string().optional(),
	zipCode: z.string().optional(),
	natureOfEntity: z.string().optional(),
	countryName: z.string().optional(),
	countryCode: z.string().optional(),
});

export const EquityCyPriceSchema = z
	.object({
		calendarYear: z.number().int(),
		symbol: AssetSchema,
		peakPriceUsd: PositiveDecimalSchema.optional(),
		peakDate: date.optional(),
		closingPriceUsd: PositiveDecimalSchema.optional(),
		source: z.string().optional(),
	})
	.refine(
		(row) =>
			row.peakPriceUsd === undefined ||
			(row.peakDate !== undefined &&
				Number(row.peakDate.slice(0, 4)) === row.calendarYear),
		{
			path: ["peakDate"],
			message: "Enter a peak date within the calendar year.",
		},
	);

export const FxAppliedSchema = z.object({
	currency: z.string(),
	rate: amount,
	rateDate: date,
	source: z.string(),
});

export const UsEquitySectionsSchema = z.object({
	ltcgTax: z.string(),
	stcgTax: z.string(),
	dividendIncome: z.string(),
	foreignTaxCredit: z.string(),
	foreignAssets: z.string(),
	currencyConversionRule: z.string(),
});

export const UsEquityDtaaSchema = z.object({
	countryName: z.string(),
	countryCode: z.string(),
	dividendArticle: z.string(),
});

export const UsEquityGainRowSchema = z.object({
	asset: AssetSchema,
	quantity: amount,
	dateOfAcquisition: date.nullable(),
	dateOfTransfer: date,
	holdingDays: count.nullable(),
	term: z.enum(["long", "short"]).nullable(),
	costUsd: nullableAmount,
	costFx: FxAppliedSchema.nullable(),
	costInr: nullableAmount,
	considerationUsd: nullableAmount,
	considerationFx: FxAppliedSchema.nullable(),
	considerationInr: nullableAmount,
	feeUsd: nullableAmount,
	feeInr: nullableAmount,
	gainInr: nullableAmount,
	trail: TrailSchema,
	reviewFlags: z.array(ReviewFlagSchema),
});

export const UsEquityTermSummarySchema = z.object({
	considerationInr: amount,
	costInr: amount,
	grossGainInr: amount,
	grossLossInr: amount,
	netGainInr: amount,
});

export const UsEquityCapitalGainsSummarySchema = z.object({
	shortTerm: UsEquityTermSummarySchema,
	longTerm: UsEquityTermSummarySchema,
	setOff: z.object({
		stclAgainstLtcgInr: amount,
		netTaxableStcgInr: amount,
		netTaxableLtcgInr: amount,
		carryForwardStclInr: amount,
		carryForwardLtclInr: amount,
	}),
	ltcgTax: z.object({
		taxableLtcgInr: amount,
		rate: amount,
		baseTaxInr: amount,
		surchargeRateApplied: amount,
		surchargeCapped: z.boolean(),
		surchargeInr: amount,
		cessInr: amount,
		totalLtcgTaxInr: amount,
		totalLtcgTaxRoundedInr: amount,
	}),
	stcgNote: z.string(),
});

export const UsEquityDividendTotalsSchema = z.object({
	grossUsd: nullableAmount,
	taxWithheldUsd: nullableAmount,
	netUsd: nullableAmount,
	grossInr: nullableAmount,
	taxWithheldInr: nullableAmount,
	netInr: nullableAmount,
});

export const UsEquityDividendRowSchema = UsEquityDividendTotalsSchema.extend({
	txId: z.string(),
	date,
	asset: AssetSchema.nullable(),
	fx: FxAppliedSchema.nullable(),
	withholdingRate: nullableAmount,
	trail: z.array(RawRefSchema),
	reviewFlags: z.array(ReviewFlagSchema),
});

export const Form67TotalsSchema = z.object({
	foreignIncomeUsd: nullableAmount,
	foreignIncomeInr: nullableAmount,
	foreignTaxPaidUsd: nullableAmount,
	foreignTaxPaidInr: nullableAmount,
	maxCreditEligibleInr: nullableAmount,
});

export const Form67RowSchema = Form67TotalsSchema.extend({
	countryName: z.string(),
	countryCode: z.string(),
	natureOfIncome: z.string(),
	dtaaArticle: z.string(),
	asset: AssetSchema.nullable(),
	effectiveForeignTaxRate: nullableAmount,
	txIds: z.array(z.string()),
	foreignTaxPayments: z
		.array(
			z.object({
				txId: z.string(),
				fx: FxAppliedSchema.nullable(),
				amountUsd: nullableAmount,
				amountInr: nullableAmount,
				possibleOverlap: z.literal(true).optional(),
			}),
		)
		.optional(),
});

export const ScheduleFaRowSchema = z.object({
	slNo: z.number().int().positive(),
	countryName: z.string(),
	countryCode: z.string(),
	asset: AssetSchema,
	entityName: z.string(),
	entityAddress: z.string(),
	zipCode: z.string(),
	natureOfEntity: z.string(),
	dateOfAcquiring: date.nullable(),
	lotCount: count,
	openingQty: amount,
	closingQty: amount,
	maxQtyHeld: amount,
	initialValueUsd: nullableAmount,
	initialValueInr: nullableAmount,
	initialFx: FxAppliedSchema.nullable(),
	initialFxByLot: z
		.array(z.object({ txId: z.string(), fx: FxAppliedSchema.nullable() }))
		.optional(),
	peakPriceUsd: nullableAmount,
	peakDate: date.nullable(),
	peakValueUsd: nullableAmount,
	peakValueInr: nullableAmount,
	peakFx: FxAppliedSchema.nullable(),
	closingPriceUsd: nullableAmount,
	closingValueUsd: nullableAmount,
	closingValueInr: nullableAmount,
	closingFx: FxAppliedSchema.nullable(),
	grossDividendsPaidUsd: nullableAmount,
	grossDividendsPaidInr: nullableAmount,
	grossSaleProceedsUsd: nullableAmount,
	grossSaleProceedsInr: nullableAmount,
	flowFx: z
		.array(z.object({ txId: z.string(), fx: FxAppliedSchema.nullable() }))
		.optional(),
	trail: z.array(RawRefSchema),
	reviewFlags: z.array(ReviewFlagSchema),
});

export const UsEquityReportSchema = z.object({
	taxYear: TaxYearSchema,
	act: z.string(),
	calendarYear: z.number().int(),
	generatedFrom: z.object({
		txCount: count,
		ruleFile: z.string(),
		settings: EngineSettingsSchema,
	}),
	sectionsVerified: z.boolean(),
	sections: UsEquitySectionsSchema,
	dtaa: UsEquityDtaaSchema,
	capitalGains: z.object({
		rows: z.array(UsEquityGainRowSchema),
		summary: UsEquityCapitalGainsSummarySchema,
	}),
	dividends: z.object({
		rows: z.array(UsEquityDividendRowSchema),
		totals: UsEquityDividendTotalsSchema,
	}),
	form67: z.object({
		countryName: z.string(),
		countryCode: z.string(),
		dtaaArticle: z.string(),
		rows: z.array(Form67RowSchema),
		totals: Form67TotalsSchema,
		notes: z.array(z.string()),
	}),
	scheduleFa: z.object({
		calendarYear: z.number().int(),
		period: z.object({ start: date, end: date }),
		rows: z.array(ScheduleFaRowSchema),
		notes: z.array(z.string()),
	}),
	balances: z.array(BalanceSchema),
	unresolved: z.array(UnresolvedSchema),
	excluded: z.array(ReportExcludedSchema),
	warnings: z.array(ReportWarningSchema),
	ledger: z.array(LedgerTxSchema),
	disclaimer: z.string(),
	includesDemoData: z.boolean().optional(),
	incomplete: z.boolean().optional(),
	stale: z.literal(true).optional(),
});

export type EquityMetadata = z.infer<typeof EquityMetadataSchema>;
export type EquityCyPrice = z.infer<typeof EquityCyPriceSchema>;
export type FxApplied = z.infer<typeof FxAppliedSchema>;
export type UsEquitySections = z.infer<typeof UsEquitySectionsSchema>;
export type UsEquityDtaa = z.infer<typeof UsEquityDtaaSchema>;
export type UsEquityGainRow = z.infer<typeof UsEquityGainRowSchema>;
export type UsEquityTermSummary = z.infer<typeof UsEquityTermSummarySchema>;
export type UsEquityCapitalGainsSummary = z.infer<
	typeof UsEquityCapitalGainsSummarySchema
>;
export type UsEquityDividendRow = z.infer<typeof UsEquityDividendRowSchema>;
export type UsEquityDividendTotals = z.infer<
	typeof UsEquityDividendTotalsSchema
>;
export type Form67Row = z.infer<typeof Form67RowSchema>;
export type Form67Totals = z.infer<typeof Form67TotalsSchema>;
export type ScheduleFaRow = z.infer<typeof ScheduleFaRowSchema>;
export type UsEquityReport = z.infer<typeof UsEquityReportSchema>;
