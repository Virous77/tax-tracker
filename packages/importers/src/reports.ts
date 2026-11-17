import type { LedgerTx, ReviewFlag } from "@tax/core";
import { normaliseHeader } from "./spreadsheet.js";
import { timezoneFromFileName, timezoneOffsetMinutes } from "./timezone.js";
import type {
	ImportOptions,
	ImportResult,
	ImportTimezone,
	TableSheet,
} from "./types.js";
import { RowParseError, sourceReferences } from "./values.js";

export interface ReportContext {
	options: ImportOptions;
	fileName: string;
	reference: (raw: unknown, id?: string) => string;
}
export type ReportRowResult = LedgerTx | { skip: string };
export type ReportParser = (
	raw: Record<string, string>,
	sheet: TableSheet,
	context: ReportContext,
) => ReportRowResult;
export interface ReportKind {
	id: string;
	verified?: boolean;
	prepare?: (sheet: TableSheet, context: ReportContext) => ReportParser;
	detect: (sheet: TableSheet) => boolean;
	parse: (
		raw: Record<string, string>,
		sheet: TableSheet,
		context: ReportContext,
	) => LedgerTx | { skip: string };
	allowDuplicateHeaders?: boolean;
	timezone?: ImportTimezone;
	warnings?: ReviewFlag[];
}
export function hasHeaders(sheet: TableSheet, headers: string[]): boolean {
	return headers.every((key) =>
		sheet.headers.some(
			(header) => normaliseHeader(header) === normaliseHeader(key),
		),
	);
}
export function headerWarnings(sheet: TableSheet): ReviewFlag[] {
	return sheet.duplicateHeaders?.length
		? [
				{
					code: "parse_warning",
					message: `Duplicate columns were renamed (${sheet.duplicateHeaders.join(", ")}); both original values are preserved under distinct keys.`,
				},
			]
		: [];
}
export function parseReports(
	venue: "binance" | "coindcx",
	kinds: readonly ReportKind[],
	sheets: TableSheet[],
	options: ImportOptions,
	fileName = "export.csv",
): ImportResult {
	timezoneOffsetMinutes(options.timezone);
	const detected = sheets.map((sheet) =>
		kinds.find((kind) => kind.detect(sheet)),
	);
	const ids = [...new Set(detected.flatMap((kind) => (kind ? [kind.id] : [])))];
	const fileTimezone =
		venue === "binance" ? timezoneFromFileName(fileName) : undefined;
	const headerTimezone = (sheet: TableSheet): ImportTimezone | undefined =>
		sheet.headers.some(
			(h) => h === "UTC_Time" || /^Date\(UTC(?:\+0)?\)$/i.test(h),
		)
			? "UTC"
			: undefined;
	const sheetTimezones = detected.map(
		(kind, i) =>
			kind?.timezone ?? (sheets[i] ? headerTimezone(sheets[i]) : undefined),
	);
	const explicitTimezones = [
		...new Set(sheetTimezones.flatMap((zone) => (zone ? [zone] : []))),
	];
	const detectedTimezone =
		fileTimezone ??
		(explicitTimezones.length === 1 &&
		detected.every((kind, i) => !kind || sheetTimezones[i])
			? explicitTimezones[0]
			: undefined);
	const result: ImportResult = {
		transactions: [],
		rowsRead: 0,
		warnings: [],
		rowErrors: [],
		skippedRows: [],
		sheets: [],
		reportKind:
			ids.length === 1 ? ids[0] : ids.length > 1 ? `${venue}:mixed` : undefined,
		detectedTimezone,
		timezoneSource: detectedTimezone ? "file" : "user",
	};
	if (
		fileTimezone &&
		timezoneOffsetMinutes(fileTimezone) !==
			timezoneOffsetMinutes(options.timezone)
	)
		result.warnings.push({
			code: "parse_warning",
			message: `Used ${fileTimezone} from the Binance file name instead of the selected ${options.timezone}; exported times use the file's UTC offset.`,
		});
	const coverage = new Map<
		string,
		{ firstTimestamp: string; lastTimestamp: string }
	>();
	const reference = sourceReferences();
	const warned = new Set<string>();
	for (const [index, sheet] of sheets.entries()) {
		const kind = detected[index];
		result.rowsRead += sheet.rows.length;
		result.sheets?.push({
			name: sheet.name,
			rowsRead: sheet.rows.length,
			reportKind: kind?.id,
		});
		result.warnings.push(...headerWarnings(sheet));
		if (kind && !warned.has(kind.id)) {
			result.warnings.push(...(kind.warnings ?? []));
			if (kind.verified === false)
				result.warnings.push({
					code: "parse_warning",
					message: `The ${kind.id} layout is unverified; check the imported rows against the original export.`,
				});
			warned.add(kind.id);
		}
		const context: ReportContext = {
			options: {
				...options,
				timezone: fileTimezone ?? sheetTimezones[index] ?? options.timezone,
			},
			fileName,
			reference,
		};
		const parser = kind?.prepare?.(sheet, context) ?? kind?.parse;
		sheet.rows.forEach((raw, rowIndex) => {
			try {
				if (!kind)
					throw new RowParseError(
						`Unsupported or unverified ${venue} sheet; use a reviewed recipe.`,
					);
				if (sheet.duplicateHeaders?.length && !kind.allowDuplicateHeaders)
					throw new RowParseError(
						"Duplicate headers are not supported by this report kind.",
					);
				if (raw.__extraColumns)
					throw new RowParseError("Row has more cells than the header.");
				if (!parser) throw new RowParseError("Report parser is unavailable.");
				const parsed = parser(raw, sheet, context);
				if ("skip" in parsed)
					result.skippedRows?.push({
						rowIndex,
						sheet: sheet.name,
						reason: parsed.skip,
						raw,
					});
				else {
					if (
						venue === "binance" &&
						!fileTimezone &&
						sheet.headers.includes("Time")
					)
						parsed.reviewFlags.push({
							code: "ambiguous_timezone",
							message:
								"The Time header has no timezone and the file name has no UTC offset; confirm the selected timezone.",
						});
					const range = coverage.get(kind.id);
					coverage.set(kind.id, {
						firstTimestamp:
							range && range.firstTimestamp < parsed.timestamp
								? range.firstTimestamp
								: parsed.timestamp,
						lastTimestamp:
							range && range.lastTimestamp > parsed.timestamp
								? range.lastTimestamp
								: parsed.timestamp,
					});
					result.transactions.push(parsed);
				}
			} catch (error) {
				result.rowErrors.push({
					rowIndex,
					sheet: sheet.name,
					message: error instanceof Error ? error.message : "Invalid row",
					raw,
					field: error instanceof RowParseError ? error.field : "other",
				});
			}
		});
	}
	if (result.rowErrors.length)
		result.warnings.push({
			code: "parse_warning",
			message:
				"Unsupported sheets and invalid rows are listed in row errors and are excluded from calculations.",
		});
	result.coverage = [...coverage]
		.map(([reportKind, range]) => ({ reportKind, ...range }))
		.sort((a, b) => a.reportKind.localeCompare(b.reportKind));
	return result;
}
