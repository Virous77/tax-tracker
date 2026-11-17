import { posix } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { InputFile, TableSheet } from "./types.js";

const expandedLimit = 64 * 1024 * 1024;
export function csvRecords(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	text = text.replace(/^\uFEFF/, "");
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			if (quoted && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (quoted || !cell) quoted = !quoted;
			else throw new Error("Unexpected CSV quote.");
		} else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
			row.push(cell);
			cell = "";
			if (c !== ",") {
				if (c === "\r" && text[i + 1] === "\n") i++;
				if (row.some((v) => v !== "")) rows.push(row);
				row = [];
			}
		} else cell += c;
	}
	if (quoted) throw new Error("Unclosed CSV quote.");
	if (cell || row.length) {
		row.push(cell);
		if (row.some((v) => v !== "")) rows.push(row);
	}
	return rows;
}
export function normaliseHeader(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s*¹²³⁰⁴⁵⁶⁷⁸⁹]+/g, "");
}
export interface ReadSheetOptions {
	allowDuplicateHeaders?: boolean;
}
function sheetTable(
	name: string,
	grid: string[][],
	excelDate1904?: boolean,
	options: ReadSheetOptions = {},
): TableSheet {
	if (!grid.length) return { name, headers: [], rows: [], excelDate1904 };
	const index = grid.findIndex(
		(row) =>
			row.some((v) =>
				[
					"quantity",
					"executed",
					"change",
					"txid",
					"timestamp",
					"txndate",
					"date",
					"transactionid",
					"tradeid",
					"orderid",
				].includes(normaliseHeader(v)),
			) && row.length > 2,
	);
	const headerIndex = Math.max(index, 0);
	const originalHeaders = grid[headerIndex] ?? [];
	const used = new Set<string>();
	const reserved = new Set(originalHeaders.map(normaliseHeader));
	const duplicateHeaders: string[] = [];
	const headers = originalHeaders.map((header) => {
		if (!header.trim())
			throw new Error(`Sheet ${name} contains empty column names.`);
		let renamed = header;
		let ordinal = 2;
		if (used.has(normaliseHeader(header))) {
			if (!options.allowDuplicateHeaders)
				throw new Error(`Sheet ${name} contains duplicate column names.`);
			do {
				renamed = `${header}#${ordinal++}`;
			} while (
				reserved.has(normaliseHeader(renamed)) ||
				used.has(normaliseHeader(renamed))
			);
			duplicateHeaders.push(renamed);
		}
		used.add(normaliseHeader(renamed));
		return renamed;
	});
	const rows = grid.slice(headerIndex + 1).map((values) => {
		const raw = Object.fromEntries(
			headers.map((header, i) => [header, values[i] ?? ""]),
		);
		if (values.length > headers.length)
			raw.__extraColumns = JSON.stringify(values.slice(headers.length));
		return raw;
	});
	return { name, headers, rows, excelDate1904, duplicateHeaders };
}
type XmlNode = Record<string, unknown>;
function object(value: unknown): XmlNode {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as XmlNode)
		: {};
}
function list(value: unknown): unknown[] {
	return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function text(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value !== "object") return String(value);
	const node = object(value);
	return node["#text"] !== undefined
		? text(node["#text"])
		: node.t !== undefined
			? text(node.t)
			: list(node.r).map(text).join("");
}
export function readSheets(
	file: InputFile,
	options: ReadSheetOptions = {},
): TableSheet[] {
	if (file.bytes.length > 25 * 1024 * 1024)
		throw new Error("File exceeds 25 MB.");
	if (file.bytes[0] !== 0x50 || file.bytes[1] !== 0x4b) {
		if (/\.xlsx$/i.test(file.name)) throw new Error("Invalid XLSX signature.");
		const content = new TextDecoder("utf-8", { fatal: true }).decode(
			file.bytes,
		);
		if (content.includes("\0")) throw new Error("Binary content is not CSV.");
		return [sheetTable("CSV", csvRecords(content), undefined, options)];
	}
	let total = 0;
	let entries = 0;
	const files = unzipSync(file.bytes, {
		filter: (entry) => {
			total += entry.originalSize;
			entries++;
			if (
				total > expandedLimit ||
				entries > 2000 ||
				entry.name.includes("..") ||
				entry.name.startsWith("/")
			)
				throw new Error("Unsafe or oversized XLSX archive.");
			return entry.name.endsWith(".xml") || entry.name.endsWith(".rels");
		},
	});
	if (
		Object.values(files).reduce((size, data) => size + data.length, 0) >
		expandedLimit
	)
		throw new Error("Expanded XLSX exceeds 64 MB.");
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: "@",
		parseTagValue: false,
		parseAttributeValue: false,
		trimValues: false,
		removeNSPrefix: true,
	});
	function xml(path: string): XmlNode {
		const bytes = files[path];
		if (!bytes) return {};
		const content = strFromU8(bytes);
		if (/<!DOCTYPE|<!ENTITY/i.test(content))
			throw new Error("XML entities and document types are not supported.");
		return object(parser.parse(content));
	}
	const workbook = object(xml("xl/workbook.xml").workbook);
	if (!Object.keys(workbook).length)
		throw new Error("XLSX workbook is missing.");
	const relationships = list(
		object(xml("xl/_rels/workbook.xml.rels").Relationships).Relationship,
	).map(object);
	const strings = list(object(xml("xl/sharedStrings.xml").sst).si).map(text);
	const date1904 = ["1", "true"].includes(
		String(object(workbook.workbookPr)["@date1904"]),
	);
	return list(object(workbook.sheets).sheet).map((value) => {
		const sheet = object(value);
		const relation = relationships.find(
			(v) => v["@id"] === sheet["@id"] || v["@Id"] === sheet["@id"],
		);
		if (!relation || relation["@TargetMode"] === "External")
			throw new Error("Invalid workbook sheet relationship.");
		const target = String(relation["@Target"] ?? "");
		const path = target.startsWith("/")
			? target.slice(1)
			: posix.normalize(posix.join("xl", target));
		if (!path.startsWith("xl/") || !files[path])
			throw new Error("Worksheet is missing or outside workbook.");
		const grid = list(object(object(xml(path).worksheet).sheetData).row)
			.map((row) => {
				const cells: string[] = [];
				for (const entry of list(object(row).c)) {
					const cell = object(entry);
					const ref = String(cell["@r"] ?? "");
					const letters = ref.match(/^[A-Z]+/)?.[0];
					let index = cells.length;
					if (letters) {
						index = 0;
						for (const c of letters) index = index * 26 + c.charCodeAt(0) - 64;
						index--;
					}
					if (index > 16383) throw new Error("Invalid spreadsheet column.");
					if (cell.f !== undefined) cells[index] = `=${text(cell.f)}`;
					else if (cell["@t"] === "s")
						cells[index] = strings[Number(text(cell.v))] ?? "";
					else if (cell["@t"] === "inlineStr") cells[index] = text(cell.is);
					else cells[index] = text(cell.v);
				}
				return Array.from({ length: cells.length }, (_, i) => cells[i] ?? "");
			})
			.filter((row) => row.some((v) => v !== ""));
		return sheetTable(
			String(sheet["@name"] ?? "Sheet"),
			grid,
			date1904,
			options,
		);
	});
}
function escapeXml(value: string): string {
	return value
		.split("")
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 || [9, 10, 13].includes(code);
		})
		.join("")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
export function writeXlsx(
	sheets: { name: string; rows: string[][] }[],
): Uint8Array {
	const files: Record<string, Uint8Array> = {};
	const add = (path: string, xml: string) => {
		files[path] = strToU8(
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`,
		);
	};
	add(
		"[Content_Types].xml",
		`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
	);
	add(
		"_rels/.rels",
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
	);
	add(
		"xl/workbook.xml",
		`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
	);
	add(
		"xl/_rels/workbook.xml.rels",
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
	);
	sheets.forEach((sheet, i) => {
		add(
			`xl/worksheets/sheet${i + 1}.xml`,
			`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.rows
				.map(
					(row, r) =>
						`<row r="${r + 1}">${row
							.map((value, c) => {
								let column = "";
								for (let n = c + 1; n; n = Math.floor((n - 1) / 26))
									column = String.fromCharCode(65 + ((n - 1) % 26)) + column;
								return `<c r="${column}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
							})
							.join("")}</row>`,
				)
				.join("")}</sheetData></worksheet>`,
		);
	});
	return zipSync(files, { level: 6 });
}
