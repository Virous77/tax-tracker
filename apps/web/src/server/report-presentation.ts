import {
	D,
	type ReviewFlag,
	type ReviewSeverity,
	roundInr,
	type VdaReport,
} from "@tax/core";
import { presentWarningMessage } from "./source-labels";

export function warningSeverity(warning: ReviewFlag): ReviewSeverity {
	if (warning.code === "ca_verification_pending") return "info";
	if (warning.severity) return warning.severity;
	// Reports and imports saved before severity was introduced still contain these notes.
	if (
		warning.code === "parse_warning" &&
		/^(?:Used .* from .* instead of the selected |Duplicate columns were renamed \(|Binance Spot Order History has no fees,)/.test(
			warning.message,
		)
	)
		return "info";
	return "action";
}

export function presentReport(
	report: VdaReport,
	includesDemoData: boolean,
	label: (source: string) => string,
): VdaReport {
	return {
		...report,
		includesDemoData,
		incomplete: report.unresolved.length > 0,
		scheduleVdaRows: report.scheduleVdaRows.filter(
			({ income }) => income !== null,
		),
		warnings: report.warnings.map((warning) => ({
			...warning,
			message: presentWarningMessage(warning, label),
			severity: warningSeverity(warning),
		})),
		tds: {
			...report.tds,
			bySource: report.tds.bySource.map((row) => {
				const shortfall = D(row.possiblyDueInr).minus(row.tdsInr);
				return {
					...row,
					sourceLabel: label(row.source),
					remainingDueInr: roundInr(shortfall.gt("0") ? shortfall : "0"),
				};
			}),
			checklist: report.tds.checklist.map((item) => {
				const row = report.tds.bySource.find(({ source }) =>
					item.startsWith(`${source}: `),
				);
				return row
					? `${label(row.source)}${item.slice(row.source.length)}`
					: item;
			}),
		},
	};
}
