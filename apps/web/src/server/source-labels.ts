import type { ReportWarning } from "@tax/core";
import type { TaxDatabase } from "@tax/db";
import { chains } from "@tax/evm";
import { libraryRecipes } from "@tax/recipes";

export function sourceLabels(db: TaxDatabase) {
	const recipes = new Map(
		[...libraryRecipes, ...db.recipes.list()].map((recipe) => [
			recipe.fingerprint,
			recipe.name,
		]),
	);
	return (source: string): string => {
		switch (source) {
			case "binance":
				return "Binance";
			case "coindcx":
				return "CoinDCX";
			case "manual":
				return "Manual";
		}
		if (source.startsWith("evm:")) {
			const chain = chains.find(({ chainId }) => `evm:${chainId}` === source);
			return chain ? `${chain.name} wallet` : "EVM wallet";
		}
		if (source.startsWith("csv:")) {
			const recipe = recipes.get(source.slice(4));
			return recipe ? `Generic CSV · ${recipe}` : "Generic CSV";
		}
		return source;
	};
}

export function presentWarningMessage(
	warning: ReportWarning,
	label: (source: string) => string,
): string {
	if (warning.code === "import_incomplete") {
		const legacy =
			/^Import (.*): \d+ excluded rows; status pending_recipe\./s.exec(
				warning.message,
			);
		if (legacy) return pendingMappingMessage(legacy[1] ?? "");
	}
	return warning.message.replace(/csv:[0-9a-f]{64}\b/g, label);
}

export function pendingMappingMessage(fileName: string): string {
	return `${fileName} is still waiting for a column mapping — open Imports → Map columns, or delete it.`;
}
