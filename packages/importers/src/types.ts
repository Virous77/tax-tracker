import type { LedgerTx, Recipe, ReviewFlag } from "@tax/core";
export interface InputFile {
	name: string;
	bytes: Uint8Array;
}
export interface TableSheet {
	name: string;
	headers: string[];
	rows: Record<string, string>[];
	excelDate1904?: boolean;
	duplicateHeaders?: string[];
}
export type ImportTimezone = "IST" | "UTC" | `${"+" | "-"}${string}`;
export interface ImportOptions {
	timezone: ImportTimezone;
	recipe?: Recipe;
}
export interface RowError {
	rowIndex: number;
	sheet?: string;
	message: string;
	raw?: unknown;
	field?: "date" | "number" | "other";
}
export interface ImportResult {
	reportKind?: string;
	detectedTimezone?: string;
	timezoneSource: "file" | "user";
	transactions: LedgerTx[];
	rowsRead: number;
	warnings: ReviewFlag[];
	sheets?: { name: string; rowsRead: number; reportKind?: string }[];
	rowErrors: RowError[];
	skippedRows?: { rowIndex: number; sheet: string; reason: string }[];
}
export interface Importer {
	id: "binance" | "coindcx" | "generic";
	detect(file: InputFile): boolean;
	parse(file: InputFile, opts: ImportOptions): ImportResult;
}
