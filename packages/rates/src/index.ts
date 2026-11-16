import { readFile } from "node:fs/promises";
import { D, type FxLookup } from "@tax/core";
export interface FxRow {
	currency: string;
	date: string;
	rate: string;
	source: string;
}
export const SBI_COLUMNS = { date: "DATE", ttBuy: "TT BUY" } as const;
function dateOnly(value: string): string {
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
		new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
	)
		throw new Error(`Invalid date: ${value}`);
	return value;
}
export function createFxLookup(rows: readonly FxRow[]): FxLookup {
	const copy = rows
		.map((row) => {
			dateOnly(row.date);
			if (!D(row.rate).isFinite() || !D(row.rate).gt("0"))
				throw new Error("Invalid FX rate");
			return { ...row };
		})
		.sort((a, b) => a.date.localeCompare(b.date));
	return (currency, date) => {
		dateOnly(date);
		let found: FxRow | undefined;
		for (const row of copy)
			if (row.currency === currency && row.date <= date) found = row;
		return found
			? { rate: found.rate, rateDate: found.date, source: found.source }
			: null;
	};
}
function csvRecords(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			if (quoted && text[i + 1] === '"') {
				field += '"';
				i++;
			} else quoted = !quoted;
		} else if (!quoted && (c === "," || c === "\n")) {
			row.push(field.trim());
			field = "";
			if (c === "\n") {
				rows.push(row);
				row = [];
			}
		} else if (c !== "\r" || quoted) field += c;
	}
	if (quoted) throw new Error("Unclosed CSV quote");
	if (field || row.length) {
		row.push(field.trim());
		rows.push(row);
	}
	return rows.filter((r) => r.some(Boolean));
}
export function parseSbiCsv(text: string): FxRow[] {
	const [headers, ...rows] = csvRecords(text.replace(/^\uFEFF/, ""));
	const dateIndex = headers?.indexOf(SBI_COLUMNS.date) ?? -1;
	const buyIndex = headers?.indexOf(SBI_COLUMNS.ttBuy) ?? -1;
	if (dateIndex < 0 || buyIndex < 0)
		throw new Error("SBI CSV requires DATE and TT BUY columns");
	const ordered = rows
		.map((r, index) => {
			const published = r[dateIndex] ?? "";
			if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?$/.test(published))
				throw new Error(`Invalid SBI publication date on row ${index + 2}`);
			const date = dateOnly(published.slice(0, 10));
			const rate = (r[buyIndex] ?? "").replaceAll(",", "");
			if (!D(rate).isFinite() || D(rate).lt("0"))
				throw new Error(`Invalid TT BUY on row ${index + 2}`);
			return {
				published,
				currency: "USD",
				date,
				rate,
				source: "SBI TT buying",
			};
		})
		.sort((a, b) => a.published.localeCompare(b.published));
	// The archive uses zero when a TT buying quote was not published.
	return ordered
		.filter((row) => !D(row.rate).isZero())
		.map(({ published: _published, ...row }) => row);
}
export async function loadSbiCsv(
	path: string | URL = new URL(
		"../data/SBI_REFERENCE_RATES_USD.csv",
		import.meta.url,
	),
): Promise<FxLookup> {
	return createFxLookup(parseSbiCsv(await readFile(path, "utf8")));
}
export function lastDayOfPreviousMonth(date: string): string {
	dateOnly(date);
	const value = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
	value.setUTCDate(0);
	return value.toISOString().slice(0, 10);
}
