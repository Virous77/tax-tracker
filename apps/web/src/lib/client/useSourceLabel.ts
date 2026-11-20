"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { formatSourceLabel, type RecipeNames } from "@/lib/client/format";

/** A `formatSourceLabel` that shows the saved recipe's name for generic CSV sources. */
export function useSourceLabel(): (source: string) => string {
	const [recipeNames, setRecipeNames] = useState<RecipeNames>(new Map());

	useEffect(() => {
		let cancelled = false;
		api
			.listRecipes()
			.then((recipes) => {
				if (cancelled) return;
				setRecipeNames(new Map(recipes.map((r) => [r.fingerprint, r.name])));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	return useMemo(
		() => (source: string) => formatSourceLabel(source, recipeNames),
		[recipeNames],
	);
}
