import { readFileSync } from "node:fs";
import { parseJsonWithSource } from "../src/http.js";
import { type ApiRow, object, rows } from "../src/values.js";
export function sample(name: string): unknown {
	return parseJsonWithSource(
		readFileSync(
			new URL(
				`../../../docs/research/phase2-samples/${name}.json`,
				import.meta.url,
			),
			"utf8",
		),
	);
}
export function first(value: unknown): ApiRow {
	const row = rows(value)[0];
	if (!row) throw new Error("Missing sample row");
	return row;
}
export function envelope(name: string, key = "rows"): ApiRow {
	return first(object(sample(name))[key]);
}
