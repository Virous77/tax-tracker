import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { csvRecords, generic, readSheets, recipeSheet } from "@tax/importers";
import { readLibrary } from "./library.mjs";

export function checkRecipe({ folder, recipe }) {
	const sample = readFileSync(new URL("sample.csv", folder), "utf8");
	const expected = JSON.parse(
		readFileSync(new URL("expected.json", folder), "utf8"),
	);
	const readme = readFileSync(new URL("README.md", folder), "utf8");
	const [header, ...rows] = csvRecords(sample);
	assert.ok(
		rows.length > 0 && rows.length <= 20,
		"Sample must contain 1–20 data rows.",
	);
	assert.ok(
		rows.every((row) => row.length === header.length),
		"Sample cells must match the header.",
	);
	assert.match(
		readme,
		/^verified: (?:true|false)$/m,
		"Document whether the recipe is verified.",
	);
	assert.ok(
		!/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/i.test(sample),
		"Sample must not contain email addresses.",
	);
	const documented = readme.match(/^Test addresses: (.*)$/m)?.[1] ?? "";
	const testAddresses = new Set(
		[...documented.matchAll(/`(0x[0-9a-f]{40})`/gi)].map((match) =>
			match[1].toLowerCase(),
		),
	);
	for (const [address] of sample.matchAll(/\b0x[0-9a-f]{40}\b/gi))
		assert.ok(
			testAddresses.has(address.toLowerCase()),
			"Document synthetic wallet addresses in the sample README.",
		);

	const file = { name: "sample.csv", bytes: new TextEncoder().encode(sample) };
	recipeSheet(readSheets(file), recipe);
	const result = generic.parse(file, {
		timezone: recipe.timezone ?? "UTC",
		recipe,
	});
	assert.deepEqual(
		result.rowErrors.map(({ rowIndex, field }) => ({ rowIndex, field })),
		[],
	);
	assert.equal(result.rowsRead, rows.length);
	assert.equal(result.transactions.length, rows.length);
	assert.ok(
		isDeepStrictEqual(
			result.transactions.map(({ id: _id, ...row }) => row),
			expected,
		),
		"Imported ledger rows differ from expected.json.",
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const entries = readLibrary();
	for (const entry of entries) {
		try {
			checkRecipe(entry);
		} catch (error) {
			throw new Error(
				`Recipe check failed for ${entry.recipe.id}: ${error.message}`,
			);
		}
	}
	console.log(`Checked ${entries.length} recipe(s).`);
}
