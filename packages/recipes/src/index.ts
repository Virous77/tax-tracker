import type { Recipe } from "@tax/core";
import recipes from "./library.generated.json" with { type: "json" };

export const libraryRecipes: readonly Recipe[] = recipes as Recipe[];
