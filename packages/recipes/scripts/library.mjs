import { readdirSync, readFileSync } from "node:fs";
import { RecipeSchema } from "@tax/core";

export const library = new URL("../library/", import.meta.url);
export const recipeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function readLibrary() {
	const entries = readdirSync(library, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.sort((a, b) => a.name.localeCompare(b.name));
	const fingerprints = new Set();
	return entries.map(({ name }) => {
		const folder = new URL(`${name}/`, library);
		const recipe = RecipeSchema.parse(
			JSON.parse(readFileSync(new URL("recipe.json", folder), "utf8")),
		);
		if (!recipeId.test(name) || recipe.id !== name)
			throw new Error(`Recipe ID must match its folder name: ${name}`);
		if (fingerprints.has(recipe.fingerprint))
			throw new Error(`Duplicate recipe fingerprint: ${name}`);
		fingerprints.add(recipe.fingerprint);
		return { folder, recipe };
	});
}
