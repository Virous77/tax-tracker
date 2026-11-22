"use client";

import type { VdaReport } from "@tax/core";
import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReviewData } from "@/lib/client/api";
import {
	missingExportHints,
	unresolvedSaleCount,
} from "@/lib/client/disposals";
import { pluralise } from "@/lib/client/format";
import {
	reviewGroupHref,
	splitReviewGroups,
	summariseReviewGroup,
} from "@/lib/client/review-codes";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

const MAX_GROUP_LINES = 5;

/** Report-blocking groups come first; advisory groups appear after. */
const BLOCKING_GROUPS: readonly string[] = [
	"missing_history",
	"missing_inr_value",
	"unmatched_transfer",
	"ambiguous_transfer",
	"corporate_action",
	"unmatched_foreign_tax",
	"missing_market_price",
	"fx_unavailable",
	"unknown_type",
	"complex_onchain",
	"balance_mismatch",
	"import_incomplete",
];

const ADVISORY_GROUPS: readonly string[] = [
	"tds_not_deducted",
	"fee_review_required",
	"parse_warning",
	"ambiguous_timezone",
	"suspected_spam",
	"possible_duplicate",
	"ca_verification_pending",
];

function groupRank(code: string): number {
	const blockingIdx = BLOCKING_GROUPS.indexOf(code);
	if (blockingIdx !== -1) return blockingIdx;
	const advisoryIdx = ADVISORY_GROUPS.indexOf(code);
	if (advisoryIdx !== -1) return BLOCKING_GROUPS.length + 1 + advisoryIdx;
	return BLOCKING_GROUPS.length;
}

function UnresolvedAlert({
	report,
	taxYear,
}: {
	report: VdaReport;
	taxYear: string;
}) {
	const sales = unresolvedSaleCount(report);
	const noHistory = report.unresolved.every(
		(u) => u.reason === "missing_history",
	);
	const saleIds = new Set(report.unresolved.map((u) => u.txId));
	const hints = missingExportHints(
		report.ledger.filter((tx) => saleIds.has(tx.id)).map((tx) => tx.source),
	);
	return (
		<section
			aria-labelledby="overview-unresolved-title"
			className="space-y-2.5 rounded-lg border border-[var(--loss)]/40 bg-[var(--loss-soft)] px-4 py-3 text-sm"
		>
			<div className="flex items-start gap-2.5">
				<AlertTriangle
					className="mt-0.5 h-4 w-4 shrink-0 text-[var(--loss)]"
					aria-hidden="true"
				/>
				<p id="overview-unresolved-title" className="font-medium">
					<strong className="num">{sales}</strong>{" "}
					{pluralise(sales, "sale is", "sales are")} left out of your totals
					{noHistory
						? " because we don't know what you paid for those coins."
						: " because their cost or rupee value is missing."}
				</p>
			</div>
			<div className="space-y-1.5 pl-6.5 text-[var(--text-primary)]">
				<p>
					<strong className="font-semibold">
						Import your other exports — most will fill in automatically.
					</strong>
				</p>
				{hints.length > 0 ? (
					<ul className="list-disc space-y-0.5 pl-4 text-xs text-[var(--text-secondary)]">
						{hints.map((hint) => (
							<li key={hint.venue}>
								<span className="font-medium text-[var(--text-primary)]">
									{hint.venue}:
								</span>{" "}
								{hint.exports.map((e) => e.name).join(", ")}
							</li>
						))}
					</ul>
				) : null}
				<p className="text-xs text-[var(--text-secondary)]">
					Then compute again. Add a purchase by hand only for sales that are
					still listed.
				</p>
				<div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-0.5">
					<Link
						href="/import"
						className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline"
					>
						Import files
						<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
					</Link>
					<Link
						href={`/report?taxYear=${encodeURIComponent(taxYear)}#unresolved`}
						className="inline-flex items-center gap-1 font-medium text-[var(--loss)] hover:underline"
					>
						See the {pluralise(sales, "sale", "sales")} left out
						<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
					</Link>
				</div>
			</div>
		</section>
	);
}

function ReviewAlert({
	review,
	reviewCount,
	unresolvedSales,
	taxYear,
}: {
	review: ReviewData;
	reviewCount: number;
	unresolvedSales: number;
	taxYear: string;
}) {
	const sourceLabel = useSourceLabel();
	const groups = splitReviewGroups(review.groups)
		.action.filter((g) => g.count > 0)
		.sort((a, b) => groupRank(a.code) - groupRank(b.code) || b.count - a.count);
	const shown = groups.slice(0, MAX_GROUP_LINES);
	const hidden = groups.length - shown.length;
	return (
		<section
			aria-labelledby="overview-review-title"
			className="space-y-2.5 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-3 text-sm"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex items-start gap-2.5">
					<AlertTriangle
						className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
						aria-hidden="true"
					/>
					<p id="overview-review-title" className="font-medium">
						<strong className="font-semibold num">{reviewCount}</strong>{" "}
						{pluralise(reviewCount, "item")}{" "}
						{pluralise(reviewCount, "needs", "need")} review before filing.
					</p>
				</div>
				<Link
					href={`/review?taxYear=${encodeURIComponent(taxYear)}`}
					className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline"
				>
					Review items
					<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
				</Link>
			</div>
			{shown.length > 0 ? (
				<ul className="space-y-2 pl-6.5">
					{shown.map((group) => {
						const summary = summariseReviewGroup(group, sourceLabel);
						const sameAsUnresolved =
							group.code === "missing_history" && unresolvedSales > 0;
						return (
							<li key={group.code}>
								<Link
									href={reviewGroupHref(group.code, taxYear)}
									className="font-medium text-[var(--accent-text)] hover:underline"
								>
									{summary.headline}
								</Link>
								<p className="text-xs text-[var(--text-secondary)]">
									{sameAsUnresolved
										? `Same problem as the ${unresolvedSales} ${pluralise(unresolvedSales, "sale", "sales")} left out above, seen from your transactions. Fixing them clears both.`
										: summary.hint}
								</p>
							</li>
						);
					})}
					{hidden > 0 ? (
						<li className="text-xs text-[var(--text-secondary)]">
							and {hidden} more {pluralise(hidden, "kind")} of item in Review.
						</li>
					) : null}
				</ul>
			) : null}
		</section>
	);
}

export function OverviewAlerts({
	report,
	review,
	reviewCount,
	taxYear,
}: {
	report: VdaReport | null;
	review: ReviewData | null;
	reviewCount: number;
	taxYear: string;
}) {
	const hasUnresolved = report !== null && report.unresolved.length > 0;
	return (
		<>
			{hasUnresolved ? (
				<UnresolvedAlert report={report} taxYear={taxYear} />
			) : null}
			{review && reviewCount > 0 ? (
				<ReviewAlert
					review={review}
					reviewCount={reviewCount}
					unresolvedSales={hasUnresolved ? unresolvedSaleCount(report) : 0}
					taxYear={taxYear}
				/>
			) : null}
		</>
	);
}
