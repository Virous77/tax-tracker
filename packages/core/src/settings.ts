import { z } from "zod";
import { D } from "./decimal.js";
import {
	AssetSchema,
	DecimalStringSchema,
	NonNegativeDecimalSchema,
} from "./ledger.js";
export const EngineSettingsSchema = z.object({
	feeTreatment: z.enum(["exclude", "include"]).default("exclude"),
	lotMethod: z.literal("FIFO").default("FIFO"),
	lotPool: z.enum(["global", "per_source"]).default("global"),
	usdtInrRate: z
		.enum(["sbi_usd_tt", "ledger_usdt_inr"])
		.default("ledger_usdt_inr"),
	incomeCostBasis: z.enum(["zero", "fmv_at_receipt"]).default("zero"),
	headOfIncome: z.enum(["capital_gains", "business"]).default("capital_gains"),
	surchargeRate: z.enum(["0", "0.10", "0.15", "0.25", "0.37"]).default("0"),
	specifiedPerson: z.boolean().default(false),
	transferMatchWindowHours: z.number().finite().nonnegative().default(72),
	transferAmountTolerance: NonNegativeDecimalSchema.pipe(
		z.string().refine((v) => D(v).lte("1")),
	).default("0.01"),
});
export const EngineSettingsPatchSchema = z.object({
	feeTreatment: EngineSettingsSchema.shape.feeTreatment
		.removeDefault()
		.optional(),
	lotMethod: EngineSettingsSchema.shape.lotMethod.removeDefault().optional(),
	lotPool: EngineSettingsSchema.shape.lotPool.removeDefault().optional(),
	usdtInrRate: EngineSettingsSchema.shape.usdtInrRate
		.removeDefault()
		.optional(),
	incomeCostBasis: EngineSettingsSchema.shape.incomeCostBasis
		.removeDefault()
		.optional(),
	headOfIncome: EngineSettingsSchema.shape.headOfIncome
		.removeDefault()
		.optional(),
	surchargeRate: EngineSettingsSchema.shape.surchargeRate
		.removeDefault()
		.optional(),
	specifiedPerson: EngineSettingsSchema.shape.specifiedPerson
		.removeDefault()
		.optional(),
	transferMatchWindowHours: EngineSettingsSchema.shape.transferMatchWindowHours
		.removeDefault()
		.optional(),
	transferAmountTolerance: EngineSettingsSchema.shape.transferAmountTolerance
		.removeDefault()
		.optional(),
});
export type EngineSettings = z.infer<typeof EngineSettingsSchema>;
export const DEFAULT_ENGINE_SETTINGS: EngineSettings =
	EngineSettingsSchema.parse({});
export const ActualBalanceSchema = z.object({
	asset: AssetSchema,
	source: z.string().optional(),
	amount: DecimalStringSchema,
});
export type ActualBalance = z.infer<typeof ActualBalanceSchema>;
export const FxRateSchema = z.object({
	rate: NonNegativeDecimalSchema.pipe(z.string().refine((v) => D(v).gt("0"))),
	rateDate: z.iso.date(),
	source: z.string().min(1),
});
export type FxRate = z.infer<typeof FxRateSchema>;
export type FxLookup = (currency: string, date: string) => FxRate | null;
