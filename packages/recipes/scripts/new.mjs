import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { csvRecords, headerFingerprint, normaliseHeader } from "@tax/importers";
import { library, recipeId } from "./library.mjs";

const {
	positionals: [id, ...extra],
	values: { header },
} = parseArgs({
	allowPositionals: true,
	options: { header: { type: "string" } },
});
if (
	!id ||
	!recipeId.test(id) ||
	extra.length ||
	!header ||
	/[\r\n]/.test(header)
)
	throw new Error('Usage: pnpm recipes:new <id> --header "Date,Pair,Quantity"');

const records = csvRecords(header);
const columns = records[0] ?? [];
if (
	columns.length < 2 ||
	columns.some((column) => !column.trim()) ||
	new Set(columns.map(normaliseHeader)).size !== columns.length
)
	throw new Error(
		"Provide a single CSV header with distinct, nonempty column names.",
	);

const folder = new URL(`${id}/`, library);
mkdirSync(folder);
const recipe = {
	id,
	name: id,
	version: 1,
	fingerprint: headerFingerprint(columns, "CSV"),
	sheet: "CSV",
	columns: { timestamp: "", amount: "" },
	dateFormat: "yyyy-MM-dd HH:mm:ss",
	signStyle: "side_column",
};
writeFileSync(
	new URL("recipe.json", folder),
	`${JSON.stringify(recipe, null, "\t")}\n`,
);
writeFileSync(new URL("sample.csv", folder), `${header}\n`);
writeFileSync(new URL("expected.json", folder), "[]\n");
writeFileSync(
	new URL("README.md", folder),
	`# ${id}

verified: false

- Link the public export format and describe how to download it.
- Document the timezone, columns, and quirks. Set the recipe mappings.
- Add at most 20 synthetic rows and their expected ledger rows (omit generated IDs).
`,
);
console.log(
	`Created packages/recipes/library/${id}. Complete the mappings and add synthetic examples before running pnpm recipes:check.`,
);
