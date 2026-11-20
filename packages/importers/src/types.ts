import type { LedgerTx, Recipe, ReviewFlag } from "@tax/core";
import type { ImportSummary } from "@tax/core/api";
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
	pdfPassword?: string;
	recipe?: Recipe;
}
export interface RowError {
	rowIndex: number;
	sheet?: string;
	message: string;
	raw?: unknown;
	field?: "date" | "number" | "other";
}
export interface TdsSummaryRow {
	source: string;
	tdsInr: string;
	period?: string;
	raw: unknown;
}
export interface BalanceSnapshot {
	asOf: string;
	timezone: ImportTimezone;
	rows: { asset: string; amount: string; wallet?: string; raw: unknown }[];
}
export interface ImportResult {
	coverage?: {
		reportKind: string;
		firstTimestamp: string;
		lastTimestamp: string;
	}[];
	balanceSnapshot?: BalanceSnapshot;
	tdsSummary?: TdsSummaryRow[];
	reportKind?: string;
	detectedTimezone?: string;
	timezoneSource: "file" | "user";
	timezoneOrigin: NonNullable<ImportSummary["timezoneOrigin"]> | null;
	transactions: LedgerTx[];
	rowsRead: number;
	warnings: ReviewFlag[];
	sheets?: { name: string; rowsRead: number; reportKind?: string }[];
	rowErrors: RowError[];
	skippedRows?: (ImportSummary["skippedRows"][number] & { raw?: unknown })[];
}
export interface Importer {
	id: "binance" | "coindcx" | "generic";
	detect(file: InputFile): boolean;
	parse(file: InputFile, opts: ImportOptions): ImportResult;
}
