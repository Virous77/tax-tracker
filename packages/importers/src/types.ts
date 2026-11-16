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
}
export interface ImportOptions {
	timezone: "IST" | "UTC";
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
	transactions: LedgerTx[];
	rowsRead: number;
	warnings: ReviewFlag[];
	sheets?: { name: string; rowsRead: number }[];
	rowErrors: RowError[];
}
export interface Importer {
	id: "binance" | "coindcx" | "generic";
	detect(file: InputFile): boolean;
	parse(file: InputFile, opts: ImportOptions): ImportResult;
}
