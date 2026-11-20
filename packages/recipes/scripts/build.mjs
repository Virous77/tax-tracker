import { writeFileSync } from "node:fs";
import { readLibrary } from "./library.mjs";

const recipes = readLibrary().map(({ recipe }) => recipe);
writeFileSync(
	new URL("../src/library.generated.json", import.meta.url),
	`${JSON.stringify(recipes, null, "\t")}\n`,
);
