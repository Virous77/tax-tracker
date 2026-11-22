import { z } from "zod";
import { AssetClassSchema, AssetSchema } from "./ledger.js";
import { TimezoneSchema } from "./time.js";
export const RecipeSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	version: z.literal(1),
	fingerprint: z.string().min(1),
	sheet: z.string().optional(),
	assetClass: AssetClassSchema.optional(),
	defaultQuoteAsset: AssetSchema.optional(),
	defaultFeeAsset: AssetSchema.optional(),
	dateAsOf: z.enum(["as_of", "first"]).optional(),
	columns: z.object({
		timestamp: z.string(),
		type: z.string().optional(),
		side: z.string().optional(),
		pair: z.string().optional(),
		baseAsset: z.string().optional(),
		quoteAsset: z.string().optional(),
		amount: z.string(),
		price: z.string().optional(),
		total: z.string().optional(),
		feeAmount: z.string().optional(),
		feeAsset: z.string().optional(),
		tds: z.string().optional(),
		withholdingTax: z.string().optional(),
		withholdingTaxAsset: z.string().optional(),
		description: z.string().optional(),
		currency: z.string().optional(),
		id: z.string().optional(),
		txHash: z.string().optional(),
	}),
	dateFormat: z.string().min(1),
	timezone: TimezoneSchema.optional(),
	sideMap: z
		.record(
			z.string(),
			z.enum([
				"buy",
				"sell",
				"deposit",
				"withdrawal",
				"income",
				"dividend",
				"foreign_tax",
				"skip",
			]),
		)
		.optional(),
	signStyle: z.enum(["side_column", "negative_is_sell"]),
	pairSplit: z
		.object({ knownQuotes: z.array(z.string().min(1)).min(1) })
		.optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;
