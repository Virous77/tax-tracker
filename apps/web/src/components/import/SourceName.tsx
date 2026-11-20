"use client";

import { formatImportSource } from "@/lib/client/format";
import { useRecipeNames } from "@/lib/client/useSourceLabel";

/** Mounts after the recipe wizard saved its recipe, so the name it loads is current. */
export function SourceName({
	imp,
}: {
	imp: { source: string; sourceLabel?: string };
}) {
	const recipeNames = useRecipeNames();
	return <>{formatImportSource(imp, recipeNames)}</>;
}
