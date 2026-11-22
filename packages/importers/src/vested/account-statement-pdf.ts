import { pdfError } from "../pdf/text.js";
import type { PdfLine } from "../pdf/types.js";
import { normaliseHeader } from "../spreadsheet.js";
import type { ImportOptions, ImportResult } from "../types.js";
import {
	columnKey,
	mapStatement,
	type Section,
	type StatementRow,
	type StatementTable,
	sectionColumns,
	sectionForHeaders,
} from "./mapping.js";

const id = "vested:account-statement-pdf";
const dateStamp = "\\d{2}\\.\\d{2}\\.\\d{4}";
const dateRange = new RegExp(`${dateStamp}\\s*[-–—]\\s*${dateStamp}$`);
const footer = new RegExp(
	`^(?:Page\\s+\\d+(?:\\s+(?:of|/)\\s*\\d+)?(?:\\s+${dateStamp})?|${dateStamp}(?:\\s+Page\\s+\\d+)?)$`,
	"i",
);

function title(text: string): Section | "Glossary" | undefined {
	switch (text.replace(/^vested\s+/i, "").toLowerCase()) {
		case "all transactions":
			return "All Transactions";
		case "trades":
			return "Trades";
		case "income":
			return "Income";
		case "glossary":
			return "Glossary";
	}
}

function bucketRow(line: PdfLine, header: PdfLine): Record<string, string> {
	const columns = header.cells.map((cell) => ({
		...cell,
		key: columnKey(cell.str),
	}));
	const values = new Map<string, string[]>();
	for (const cell of line.cells) {
		const start = columns.findLastIndex(
			({ x }) => cell.x >= x - header.height * 0.4,
		);
		const end = cell.x + cell.width;
		const next = columns[start + 1];
		// A long right-aligned amount can start in the preceding column.
		const column =
			next &&
			numericColumns.has(next.key) &&
			/^[\s$+\d,().-]+$/.test(cell.str) &&
			Math.abs(end - next.x - next.width) <= header.height * 0.4
				? next
				: columns[start];
		if (column) {
			const parts = values.get(column.key) ?? [];
			parts.push(cell.str.trim());
			values.set(column.key, parts);
		}
	}
	return Object.fromEntries(
		[...values].map(([key, parts]) => [key, parts.join(" ")]),
	);
}

const numericColumns = new Set([
	"quantity",
	"pricepershare",
	"cashamount",
	"commissioncharges",
	"grosscashamount",
	"amount",
	"accountbalance",
]);

type PositionedRow = StatementRow & {
	raw: { line: PdfLine; wrappedLines: PdfLine[] };
};

function parse(
	lines: PdfLine[],
	options: ImportOptions,
	_fileName = "",
): ImportResult {
	const tables = new Map<Section, StatementTable>();
	let current: Section | undefined;
	let header: PdfLine | undefined;
	let last: PositionedRow | undefined;
	for (const line of lines) {
		const text = line.cells
			.map(({ str }) => str.trim())
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		const heading = text.replace(dateRange, "").trim();
		if (
			!heading ||
			/^vested(?: account statement)?$/i.test(heading) ||
			footer.test(text)
		)
			continue;

		const sectionTitle = title(heading);
		const isGlossaryHeader = /^(?:transaction type)\s+description$/i.test(text);
		if (sectionTitle || isGlossaryHeader) {
			const next =
				isGlossaryHeader || sectionTitle === "Glossary"
					? undefined
					: sectionTitle;
			if (current !== next) header = undefined;
			current = next;
			last = undefined;
			continue;
		}

		const section = sectionForHeaders(line.cells.map(({ str }) => str));
		if (section) {
			current = section;
			header = line;
			last = undefined;
			const existing = tables.get(section);
			if (existing) existing.section = section;
			else tables.set(section, { name: section, section, rows: [] });
			continue;
		}
		if (!current) continue;
		const raw = { line, wrappedLines: [] };
		if (!header) {
			if (/^\d{4}-\d{2}-\d{2}\b/.test(text)) {
				const table: StatementTable = tables.get(current) ?? {
					name: current,
					rows: [],
				};
				table.rows.push({
					values: {},
					raw,
					error: "Missing Vested table column headers.",
				});
				tables.set(current, table);
			}
			continue;
		}
		const values = bucketRow(line, header);
		const wrappedColumn =
			current === "Trades"
				? "name"
				: current === "All Transactions"
					? "comment"
					: undefined;
		if (
			last?.raw.line.page === line.page &&
			wrappedColumn &&
			Object.keys(values).length === 1 &&
			values[wrappedColumn]
		) {
			last.values[wrappedColumn] = [
				last.values[wrappedColumn],
				values[wrappedColumn],
			]
				.filter(Boolean)
				.join(" ");
			last.raw.wrappedLines.push(line);
			continue;
		}
		last = { values, raw };
		tables.get(current)?.rows.push(last);
	}
	if (![...tables.values()].some(({ section }) => section))
		throw pdfError("pdf_unknown_layout", id);
	return mapStatement([...tables.values()], options, id);
}

export const reportKind = {
	id,
	verified: true,
	detect(text: string) {
		if (
			!/\bvested\b/i.test(text) &&
			!/drivewealth\s+account\s+number/i.test(text)
		)
			return false;
		return text.split("\n").some((line) => {
			const key = normaliseHeader(line).replace(
				"comissioncharges",
				"commissioncharges",
			);
			return Object.values(sectionColumns).some((columns) =>
				columns.every((column) => key.includes(columnKey(column))),
			);
		});
	},
	parse,
};
