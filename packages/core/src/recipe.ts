import { z } from "zod";
export const RecipeSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	version: z.literal(1),
	fingerprint: z.string().min(1),
	sheet: z.string().optional(),
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
		id: z.string().optional(),
		txHash: z.string().optional(),
	}),
	dateFormat: z.string().min(1),
	timezone: z.enum(["IST", "UTC"]).optional(),
	sideMap: z
		.record(
			z.string(),
			z.enum(["buy", "sell", "deposit", "withdrawal", "income"]),
		)
		.optional(),
	signStyle: z.enum(["side_column", "negative_is_sell"]),
	pairSplit: z
		.object({ knownQuotes: z.array(z.string().min(1)).min(1) })
		.optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;
