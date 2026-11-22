import {
	NonNegativeDecimalSchema,
	PositiveDecimalSchema,
	TaxYearSchema,
	UsEquityDtaaSchema,
	UsEquitySectionsSchema,
} from "@tax/core";
import { z } from "zod";

const PeriodSchema = z.object({
	start: z.iso.date(),
	end: z.iso.date(),
	timezone: z.literal("Asia/Kolkata"),
});
const CommonSchema = z.object({
	taxYear: TaxYearSchema,
	act: z.enum(["Income-tax Act, 1961", "Income-tax Act, 2025"]),
	period: PeriodSchema,
	sectionsVerified: z.boolean(),
	sources: z.array(z.url()).min(1),
});
export const VdaRulesSchema = CommonSchema.extend({
	rate: PositiveDecimalSchema,
	cess: NonNegativeDecimalSchema,
	surchargeSlabs: z.array(
		z.object({
			aboveInr: NonNegativeDecimalSchema,
			rate: NonNegativeDecimalSchema,
		}),
	),
	lossSetOff: z.literal(false),
	lossCarryForward: z.literal(false),
	deductions: z.tuple([z.literal("cost_of_acquisition")]),
	tds: z.object({
		rate: PositiveDecimalSchema,
		thresholdInr: NonNegativeDecimalSchema,
		specifiedPersonThresholdInr: NonNegativeDecimalSchema,
	}),
	giftThresholdInr: NonNegativeDecimalSchema,
	sections: z.object({
		vdaTax: z.string(),
		vdaTds: z.string(),
		vdaDefinition: z.string(),
		platformReporting: z.string(),
		currencyConversionRule: z.string(),
	}),
});
export const UsEquityRulesSchema = CommonSchema.extend({
	scheduleFaCalendarYear: z.number().int().min(2020).max(2100),
	cess: NonNegativeDecimalSchema,
	surchargeCapLtcg: NonNegativeDecimalSchema,
	lossSetOff: z.object({
		stclAgainst: z.array(z.enum(["stcg", "ltcg"])),
		ltclAgainst: z.array(z.enum(["ltcg"])),
		carryForwardYears: z.number().int().positive(),
	}),
	dtaa: UsEquityDtaaSchema,
	sections: UsEquitySectionsSchema,
	longTermHoldingMonths: z.number().int().positive(),
	longTermRate: PositiveDecimalSchema,
	indexation: z.literal(false),
	shortTermRate: z.literal("slab"),
	dividendRate: z.literal("slab"),
	usWithholdingDefault: PositiveDecimalSchema,
	fxRule: z.literal("sbi_tt_buying_last_day_of_previous_month"),
});
export type VdaRules = z.infer<typeof VdaRulesSchema>;
export type UsEquityRules = z.infer<typeof UsEquityRulesSchema>;
