import { z } from "zod";
import {
	AssetSchema,
	DecimalStringSchema,
	IncomeKindSchema,
	InrRateSourceSchema,
	LedgerTxSchema,
	ReviewCodeSchema,
	ReviewFlagSchema,
	TaxYearSchema,
} from "./ledger.js";
import { EngineSettingsSchema } from "./settings.js";
export const DISCLAIMER =
	"Not tax advice. Have a Chartered Accountant review before filing.";
export const RawRefSchema = z.object({
	txId: z.string(),
	source: z.string(),
	sourceRef: z.string(),
	raw: z.unknown(),
});
export const TrailSchema = z.object({
	disposalTxId: z.string(),
	lotTxIds: z.array(z.string()),
	rawRefs: z.array(RawRefSchema),
});
export const AmountValuationSchema = z.object({
	txId: z.string(),
	valueInr: DecimalStringSchema.nullable(),
	inrRateSource: InrRateSourceSchema.optional(),
	fx: z
		.object({
			currency: z.string(),
			rate: DecimalStringSchema,
			rateDate: z.string(),
			source: z.string(),
		})
		.optional(),
	rateTxId: z.string().optional(),
});
export const ValuationSchema = AmountValuationSchema.extend({
	fee: AmountValuationSchema.optional(),
});
export const ScheduleVdaRowSchema = z.object({
	dateOfAcquisition: z.string().nullable(),
	dateOfTransfer: z.string(),
	headOfIncome: z.enum(["capital_gains", "business"]),
	asset: AssetSchema,
	quantity: DecimalStringSchema,
	costOfAcquisition: DecimalStringSchema.nullable(),
	considerationReceived: DecimalStringSchema.nullable(),
	income: DecimalStringSchema.nullable(),
	loss: DecimalStringSchema.nullable(),
	trail: TrailSchema,
	reviewFlags: z.array(ReviewFlagSchema),
});
export const IncomeRowSchema = z.object({
	txId: z.string(),
	type: z.enum(["income", "gift"]),
	incomeKind: IncomeKindSchema.optional(),
	date: z.string(),
	asset: AssetSchema,
	quantity: DecimalStringSchema,
	fmvInr: DecimalStringSchema.nullable(),
	trail: z.array(RawRefSchema),
});
export const VdaTotalsSchema = z.object({
	consideration: DecimalStringSchema,
	cost: DecimalStringSchema,
	taxableIncome: DecimalStringSchema,
	lossesNotSetOff: DecimalStringSchema,
	baseTax: DecimalStringSchema,
	surcharge: DecimalStringSchema,
	cess: DecimalStringSchema,
	totalTax: DecimalStringSchema,
	totalTaxRounded: DecimalStringSchema,
	tdsCredit: DecimalStringSchema,
	netPayable: DecimalStringSchema,
});
export const TdsSourceSchema = z.object({
	source: z.string(),
	deductedByPlatform: z.boolean().nullable(),
	tdsInr: DecimalStringSchema,
	transferValueInr: DecimalStringSchema,
	possiblyDueInr: DecimalStringSchema,
	txIds: z.array(z.string()),
});
export const BalanceSchema = z.object({
	asset: AssetSchema,
	source: z.string().optional(),
	computed: DecimalStringSchema,
	actual: DecimalStringSchema.optional(),
	difference: DecimalStringSchema.describe(
		"Actual minus computed quantity",
	).optional(),
	txIds: z.array(z.string()),
});
export const UnresolvedSchema = z.object({
	txId: z.string(),
	asset: AssetSchema,
	quantity: DecimalStringSchema,
	reason: ReviewCodeSchema,
});
export const ReportWarningSchema = ReviewFlagSchema.extend({
	asset: AssetSchema.optional(),
	source: z.string().optional(),
	count: z.number().int().positive().optional(),
	txIds: z.array(z.string()).optional(),
});
export type ReportWarning = z.infer<typeof ReportWarningSchema>;
export const VdaReportSchema = z.object({
	taxYear: TaxYearSchema,
	act: z.string(),
	generatedFrom: z.object({
		txCount: z.number().int().nonnegative(),
		ruleFile: z.string(),
		settings: EngineSettingsSchema,
	}),
	sectionsVerified: z.boolean(),
	sections: z.record(z.string(), z.string()),
	scheduleVdaRows: z.array(ScheduleVdaRowSchema),
	totals: VdaTotalsSchema,
	tds: z.object({
		bySource: z.array(TdsSourceSchema),
		checklist: z.array(z.string()),
	}),
	income: z.object({
		rows: z.array(IncomeRowSchema),
		giftsTotalInr: DecimalStringSchema,
		giftsOverThreshold: z.boolean(),
		note: z.string().optional(),
	}),
	balances: z.array(BalanceSchema),
	unresolved: z.array(UnresolvedSchema),
	warnings: z.array(ReportWarningSchema),
	valuations: z.array(ValuationSchema),
	ledger: z.array(LedgerTxSchema),
	disclaimer: z.string(),
});
export type VdaReport = z.infer<typeof VdaReportSchema>;
export type VdaTotals = z.infer<typeof VdaTotalsSchema>;
export type ScheduleVdaRow = z.infer<typeof ScheduleVdaRowSchema>;
export type IncomeRow = z.infer<typeof IncomeRowSchema>;
export type Valuation = z.infer<typeof ValuationSchema>;
export type Balance = z.infer<typeof BalanceSchema>;
export type TdsSource = z.infer<typeof TdsSourceSchema>;
export type Unresolved = z.infer<typeof UnresolvedSchema>;

export type AmountValuation = z.infer<typeof AmountValuationSchema>;
