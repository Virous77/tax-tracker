import { expect, it } from "vitest";
import { checkRecipe } from "../scripts/check.mjs";
import { readLibrary } from "../scripts/library.mjs";
import { libraryRecipes } from "../src/index.js";

const entries = readLibrary();

it("builds the full validated library", () => {
	expect(entries.length).toBeGreaterThan(0);
	expect(libraryRecipes).toEqual(entries.map(({ recipe }) => recipe));
});

it.each(entries)("parses the synthetic sample for $recipe.id", (entry) => {
	checkRecipe(entry);
});
