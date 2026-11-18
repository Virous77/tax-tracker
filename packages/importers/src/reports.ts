import type { LedgerTx, ReviewFlag } from "@tax/core";
import { normaliseHeader } from "./spreadsheet.js";
import {
	timezoneConflict,
	timezoneFromFileName,
	timezoneFromHeader,
	timezoneFromTimestamp,
	timezoneOffsetMinutes,
} from "./timezone.js";
import type {
	ImportOptions,
	ImportResult,
	ImportTimezone,
	TableSheet,
} from "./types.js";
import { parseTimestamp, RowParseError, sourceReferences } from "./values.js";

export interface ReportContext {
	fileName: string;
	parseTimestamp: (value: string, format: string, date1904?: boolean) => string;
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
	const fileTimezone = timezoneFromFileName(fileName);
	const headerTimezones = sheets.map(
		(sheet, index) =>
			detected[index] && sheet.headers.map(timezoneFromHeader).find(Boolean),
	);
	const sheetTimezones = detected.map(
		(kind, index) => headerTimezones[index] ?? kind?.timezone,
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
	const suffixes = new Set<ImportTimezone>();
	if (fileTimezone)
		result.warnings.push(
			...timezoneConflict(options.timezone, fileTimezone, "the file name"),
		);
	else
		for (const zone of explicitTimezones)
			result.warnings.push(
				...timezoneConflict(
					options.timezone,
					zone,
					headerTimezones.includes(zone)
						? "the file header"
						: "the export format",
				),
			);
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
			parseTimestamp(value, format, date1904) {
				const timestamp = parseTimestamp(
					value,
					format,
					fileTimezone ?? sheetTimezones[index] ?? options.timezone,
					date1904,
				);
				const suffix = timezoneFromTimestamp(value);
				if (suffix) suffixes.add(suffix);
				return timestamp;
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
						!sheetTimezones[index] &&
						sheet.headers.includes("Time") &&
						!timezoneFromTimestamp(raw["Time#2"] ?? raw.Time ?? "")
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
	for (const suffix of suffixes)
		if (
			fileTimezone
				? fileTimezone !== suffix
				: !explicitTimezones.includes(suffix)
		)
			result.warnings.push(
				...timezoneConflict(options.timezone, suffix, "the timestamps"),
			);
	result.coverage = [...coverage]
		.map(([reportKind, range]) => ({ reportKind, ...range }))
		.sort((a, b) => a.reportKind.localeCompare(b.reportKind));
	return result;
}
