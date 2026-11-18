import { LedgerTxSchema } from "@tax/core";
import type { ReportContext } from "./reports.js";
import type { TableSheet } from "./types.js";
import { baseTransaction, RowParseError } from "./values.js";
export function reviewOnly(
	venue: string,
	kind: string,
	raw: Record<string, string>,
	sheet: TableSheet,
	context: ReportContext,
	timeColumn: string,
) {
	if (!raw[timeColumn])
		throw new RowParseError(
			"Review-only row requires a documented timestamp; use a reviewed recipe.",
			"date",
		);
	const tx = baseTransaction(
		venue,
		`${kind}:${context.reference(raw, raw["Transaction ID"] ?? raw["Position ID"])}`,
		context.parseTimestamp(
			raw[timeColumn],
			"yyyy-MM-dd HH:mm:ss",
			sheet.excelDate1904,
		),
		raw,
	);
	tx.reviewFlags.push(
		{
			code: "complex_onchain",
			message:
				"Futures, margin and options tax treatment is a CA question; this row is review-only and has no spot ledger effect.",
		},
		{
			code: "unknown_type",
			message: "Derivative contract or balance event; not a spot trade.",
		},
	);
	return LedgerTxSchema.parse(tx);
}
