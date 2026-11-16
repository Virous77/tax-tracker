import { D, type ReviewCode, type VdaReport } from "@tax/core";
import type { ReportReviewItem } from "@tax/core/api";

export function reportReviewItems(
	reports: VdaReport[],
	visibleTxIds: ReadonlySet<string>,
): { code: ReviewCode; item: ReportReviewItem }[] {
	const items: { code: ReviewCode; item: ReportReviewItem }[] = [];
	for (const report of reports) {
		for (const balance of report.balances) {
			const context = `${balance.asset}${balance.source ? ` at ${balance.source}` : ""}`;
			if (balance.difference !== undefined && !D(balance.difference).isZero())
				items.push({
					code: "balance_mismatch",
					item: {
						kind: "balance",
						taxYear: report.taxYear,
						message: `${context}: computed ${balance.computed}, actual ${balance.actual}`,
						balance,
					},
				});
			if (D(balance.computed).lt("0"))
				items.push({
					code: "missing_history",
					item: {
						kind: "balance",
						taxYear: report.taxYear,
						message: `Negative ${balance.asset} holding${balance.source ? ` at ${balance.source}` : ""}: ${balance.computed}`,
						balance,
					},
				});
		}
		for (const unresolved of report.unresolved)
			items.push({
				code: unresolved.reason,
				item: {
					kind: "unresolved",
					taxYear: report.taxYear,
					message: `Unresolved ${unresolved.quantity} ${unresolved.asset}: ${unresolved.reason}.`,
					unresolved,
				},
			});
		for (const warning of report.warnings) {
			if (
				items.some(
					({ code, item }) =>
						item.taxYear === report.taxYear &&
						item.kind === "balance" &&
						code === warning.code &&
						item.message === warning.message,
				)
			)
				continue;
			const ids = [
				...(warning.txIds ?? []),
				...(warning.txId ? [warning.txId] : []),
			];
			if (ids.some((id) => visibleTxIds.has(id))) continue;
			if (
				report.unresolved.some(
					(row) => row.reason === warning.code && ids.includes(row.txId),
				)
			)
				continue;
			items.push({
				code: warning.code,
				item: {
					kind: "warning",
					taxYear: report.taxYear,
					message: warning.message,
					warning,
				},
			});
		}
	}
	return items;
}
