import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { checkRecipe } from "../scripts/check.mjs";
import { readLibrary } from "../scripts/library.mjs";

const entries = readLibrary();

it("finds recipes in the source library", () => {
	expect(entries.length).toBeGreaterThan(0);
});

it.each(entries)("parses the synthetic sample for $recipe.id", (entry) => {
	checkRecipe(entry);
});

it("reports the path and values of a mismatched ledger field", () => {
	const entry = entries.find(({ recipe }) => recipe.id === "generic-trades-v1");
	if (!entry) throw new Error("Seed recipe is missing.");
	const directory = mkdtempSync(join(tmpdir(), "tax-recipe-check-"));
	try {
		cpSync(entry.folder, directory, { recursive: true });
		const folder = pathToFileURL(`${directory}/`);
		const expectedFile = new URL("expected.json", folder);
		const expected = JSON.parse(readFileSync(expectedFile, "utf8"));
		expected[0].priceQuote.price = "999";
		writeFileSync(expectedFile, JSON.stringify(expected));
		expect(() => checkRecipe({ folder, recipe: entry.recipe })).toThrow(
			'rows[0].priceQuote.price: expected "999", received "200000"',
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
