"use client";

import { D, type VdaReport } from "@tax/core";
import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import {
	describeDisposal,
	missingExportHints,
	saleSourceLabel,
	transactionHref,
	type UnresolvedSale,
	unresolvedSaleCount,
	unresolvedSales,
} from "@/lib/client/disposals";
import {
	formatIncompleteSummary,
	formatIstDateTime,
	formatQty,
	isReportIncomplete,
	pluralise,
} from "@/lib/client/format";
import {
	addMissingBuyHref,
	REVIEW_CODE_INFO,
	reviewGroupHref,
} from "@/lib/client/review-codes";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

/** Above this many rows, sales are grouped by coin with a subtotal each. */
const GROUP_BY_ASSET_FROM = 8;

function SaleRow({ sale, taxYear }: { sale: UnresolvedSale; taxYear: string }) {
	const sourceLabel = useSourceLabel();
	const { tx } = sale;
	const noHistory = sale.reasons.includes("missing_history");
	const otherReasons = sale.reasons.filter((r) => r !== "missing_history");
	const fixINR = otherReasons.some(
		(r) => r === "missing_inr_value" || r === "fx_unavailable",
	);
	return (
		<li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0 space-y-0.5">
				<p className="font-medium text-[var(--text-primary)]">
					{tx ? describeDisposal(tx, sale.asset) : `Sale of ${sale.asset}`}
				</p>
				<p className="text-[11px] text-[var(--text-secondary)]">
					{tx
						? `${formatIstDateTime(tx.timestamp)} · ${saleSourceLabel(tx, sourceLabel)}`
						: "This row is no longer in your transactions"}
				</p>
				<p className="text-[11px] text-[var(--text-primary)]">
					{noHistory ? (
						<>
							No purchase record for{" "}
							<span className="num font-medium">
								{formatQty(sale.quantity)} {sale.asset}
							</span>
						</>
					) : (
						<>
							<span className="num font-medium">
								{formatQty(sale.quantity)} {sale.asset}
							</span>{" "}
							left out
						</>
					)}
					{otherReasons.length > 0
						? ` · ${otherReasons.map((r) => REVIEW_CODE_INFO[r]?.title ?? r).join(", ")}`
						: ""}
				</p>
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
				{tx ? (
					<Link
						href={transactionHref(tx, taxYear)}
						className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
					>
						View transaction
					</Link>
				) : null}
				{noHistory ? (
					<Link
						href={addMissingBuyHref(
							sale.asset,
							taxYear,
							tx?.timestamp,
							tx ? sale.txId : undefined,
						)}
						className="inline-flex items-center gap-1 rounded bg-[var(--accent-soft)] px-2.5 py-1 font-medium text-[var(--accent-text)] hover:underline"
					>
						Add missing buy
						<ArrowRight className="h-3 w-3" aria-hidden="true" />
					</Link>
				) : fixINR && tx ? (
					<Link
						href={`${transactionHref(tx, taxYear)}&flagged=true`}
						className="inline-flex items-center gap-1 rounded bg-[var(--accent-soft)] px-2.5 py-1 font-medium text-[var(--accent-text)] hover:underline"
					>
						Edit INR value
						<ArrowRight className="h-3 w-3" aria-hidden="true" />
					</Link>
				) : null}
			</div>
		</li>
	);
}

function SaleList({
	sales,
	taxYear,
}: {
	sales: UnresolvedSale[];
	taxYear: string;
}) {
	return (
		<ul className="divide-y divide-[var(--border)]">
			{sales.map((sale) => (
				<SaleRow
					key={`${sale.txId}:${sale.asset}`}
					sale={sale}
					taxYear={taxYear}
				/>
			))}
		</ul>
	);
}

function groupByAsset(sales: UnresolvedSale[]) {
	const groups = new Map<string, UnresolvedSale[]>();
	for (const sale of sales) {
		const list = groups.get(sale.asset) ?? [];
		list.push(sale);
		groups.set(sale.asset, list);
	}
	return [...groups]
		.map(([asset, list]) => ({
			asset,
			sales: list,
			total: list.reduce((sum, s) => sum.plus(s.quantity), D("0")).toString(),
		}))
		.sort((a, b) => b.sales.length - a.sales.length);
}

export function UnresolvedSalesSection({
	report,
	taxYear,
}: {
	report: VdaReport;
	taxYear: string;
}) {
	const sales = unresolvedSales(report);
	const saleCount = unresolvedSaleCount(report);
	const hints = missingExportHints(
		sales.flatMap((s) => (s.tx ? [s.tx.source] : [])),
	);
	const anyNoHistory = sales.some((s) => s.reasons.includes("missing_history"));
	const grouped =
		sales.length >= GROUP_BY_ASSET_FROM ? groupByAsset(sales) : null;

	return (
		<section
			id="unresolved"
			aria-labelledby="unresolved-title"
			className="scroll-mt-16 space-y-3 rounded-lg border border-[var(--loss)]/40 bg-[var(--loss-soft)] p-4 lg:scroll-mt-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<AlertTriangle
						className="h-4 w-4 text-[var(--loss)]"
						aria-hidden="true"
					/>
					<h2
						id="unresolved-title"
						className="text-sm font-semibold text-[var(--loss)]"
					>
						{saleCount} {pluralise(saleCount, "sale", "sales")} left out of your
						totals
					</h2>
				</div>
				<Link
					href={reviewGroupHref("missing_history", taxYear)}
					className="text-xs font-medium text-[var(--loss)] underline"
				>
					Same items in Review
				</Link>
			</div>

			<div className="space-y-2 text-xs text-[var(--text-primary)]">
				{isReportIncomplete(report) ? (
					<p>
						{formatIncompleteSummary(report)}. These sales are left out of
						Schedule VDA and net payable is not shown until you fix them.
					</p>
				) : null}
				{anyNoHistory ? (
					<>
						<p>
							None of your imported files show how you got the coins below, so
							the app doesn't know what you paid. It never guesses a cost. Fix
							them in this order:
						</p>
						<ol className="list-decimal space-y-1.5 pl-5">
							<li>
								<span className="font-semibold">
									Import the exports that are missing.
								</span>{" "}
								Most of these sales fill in on their own once the purchase,
								deposit or convert is imported.
								{hints.length > 0 ? (
									<ul className="mt-1 space-y-1 text-[var(--text-secondary)]">
										{hints.map((hint) => (
											<li key={hint.venue}>
												<span className="font-medium text-[var(--text-primary)]">
													{hint.venue}:
												</span>
												<ul className="list-disc pl-4">
													{hint.exports.map((e) => (
														<li key={e.name}>
															<span className="text-[var(--text-primary)]">
																{e.name}
															</span>{" "}
															— {e.where}
														</li>
													))}
												</ul>
											</li>
										))}
									</ul>
								) : null}
								<span className="mt-1 block text-[var(--text-secondary)]">
									Coins moved in from another exchange or wallet? Import that
									one too. The user guide, section 2, lists every export.
								</span>
							</li>
							<li>
								<span className="font-semibold">Compute the report again</span>{" "}
								and check what is still listed here.
							</li>
							<li>
								<span className="font-semibold">
									Only then use “Add missing buy”
								</span>{" "}
								for a sale whose purchase isn't in any export, with the date and
								the rupee amount you actually paid.
							</li>
						</ol>
						<Link
							href="/import"
							className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline"
						>
							Import files
							<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
						</Link>
					</>
				) : null}
			</div>

			<div className="overflow-hidden rounded border border-[var(--loss)]/25 bg-[var(--bg-surface)] text-xs">
				{grouped ? (
					grouped.map((group) => (
						<div
							key={group.asset}
							className="border-b border-[var(--border)] last:border-b-0"
						>
							<h3 className="flex flex-wrap justify-between gap-2 bg-[var(--bg-subtle)] px-3 py-2 font-semibold">
								<span>{group.asset}</span>
								<span className="num font-normal text-[var(--text-secondary)]">
									{group.sales.length} {pluralise(group.sales.length, "sale")} ·{" "}
									{formatQty(group.total)} {group.asset} left out
								</span>
							</h3>
							<SaleList sales={group.sales} taxYear={taxYear} />
						</div>
					))
				) : (
					<SaleList sales={sales} taxYear={taxYear} />
				)}
			</div>
		</section>
	);
}
