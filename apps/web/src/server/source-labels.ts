import type { Recipe, ReportWarning } from "@tax/core";
import type { ImportSummary } from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import { chains } from "@tax/evm";
import { libraryRecipes } from "@tax/recipes";

export function sourceLabels(db: TaxDatabase) {
	return sourceLabelFor([...libraryRecipes, ...db.recipes.list()]);
}

function genericSourceLabel(recipeName?: string): string {
	return recipeName ? `Generic CSV · ${recipeName}` : "Generic CSV";
}

function sourceLabelFor(recipes: Recipe[]) {
	const names = new Map(
		recipes.map(({ fingerprint, name }) => [fingerprint, name]),
	);
	return (source: string): string => {
		switch (source) {
			case "binance":
				return "Binance";
			case "binance-api":
				return "Binance (API)";
			case "coindcx":
				return "CoinDCX";
			case "coindcx-api":
				return "CoinDCX (API)";
			case "manual":
				return "Manual";
			case "generic":
				return genericSourceLabel();
		}
		if (source.startsWith("evm:")) {
			const chain = chains.find(({ chainId }) => `evm:${chainId}` === source);
			return chain ? `${chain.name} wallet` : "EVM wallet";
		}
		if (source.startsWith("csv:")) {
			return genericSourceLabel(names.get(source.slice(4)));
		}
		return source;
	};
}

export function importLabels(db: TaxDatabase) {
	const recipes = [...libraryRecipes, ...db.recipes.list()];
	const names = new Map(recipes.map(({ id, name }) => [id, name]));
	const label = sourceLabelFor(recipes);
	return <T extends ImportSummary>(imported: T) => {
		const recipeName =
			imported.sheets?.find((sheet) => sheet.recipeName)?.recipeName ??
			(imported.recipeId ? names.get(imported.recipeId) : undefined);
		return {
			...imported,
			sourceLabel:
				imported.source === "generic"
					? genericSourceLabel(recipeName)
					: label(imported.source),
		};
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
