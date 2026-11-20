import type { ReviewFlag, ReviewSeverity, VdaReport } from "@tax/core";
import { chains } from "@tax/evm";

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

function venueLabel(source: string): string {
	switch (source) {
		case "binance":
			return "Binance";
		case "coindcx":
			return "CoinDCX";
		case "manual":
			return "Manual";
	}
	if (source.startsWith("evm:")) {
		const chain = chains.find(({ chainId }) => `evm:${chainId}` === source);
		return chain ? `${chain.name} wallet` : "EVM wallet";
	}
	return source.startsWith("csv:") ? "Generic CSV" : source;
}

export function presentReport(
	report: VdaReport,
	includesDemoData: boolean,
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
			severity: warningSeverity(warning),
		})),
		tds: {
			...report.tds,
			checklist: report.tds.checklist.map((item) => {
				const row = report.tds.bySource.find(({ source }) =>
					item.startsWith(`${source}: `),
				);
				return row
					? `${venueLabel(row.source)}${item.slice(row.source.length)}`
					: item;
			}),
		},
	};
}
