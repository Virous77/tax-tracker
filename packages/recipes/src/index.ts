import { type Recipe, RecipeSchema } from "@tax/core";
import { headerFingerprint } from "@tax/importers";
export const libraryRecipes: readonly Recipe[] = [
	RecipeSchema.parse({
		id: "generic-trades-v1",
		name: "Generic trades (Date, Side, Pair, Quantity)",
		version: 1,
		fingerprint: headerFingerprint([
			"Date",
			"Side",
			"Pair",
			"Quantity",
			"Price",
			"Total",
			"Fee",
			"Fee Asset",
			"ID",
		]),
		sheet: "CSV",
		columns: {
			timestamp: "Date",
			side: "Side",
			pair: "Pair",
			amount: "Quantity",
			price: "Price",
			total: "Total",
			feeAmount: "Fee",
			feeAsset: "Fee Asset",
			id: "ID",
		},
		dateFormat: "yyyy-MM-dd HH:mm:ss",
		signStyle: "side_column",
		sideMap: { BUY: "buy", SELL: "sell" },
		pairSplit: { knownQuotes: ["INR", "USDT", "USD", "BTC", "ETH"] },
	}),
];
