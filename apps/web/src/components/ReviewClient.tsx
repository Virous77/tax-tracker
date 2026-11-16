"use client";

import type { LedgerTx } from "@tax/core";
import type { ReportReviewItem } from "@tax/core/api";
import {
	AlertTriangle,
	ArrowRight,
	Calculator,
	CheckCircle2,
	Edit3,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import {
	FALLBACK_TAX_YEARS,
	TaxYearSelect,
} from "@/components/ui/TaxYearSelect";
import {
	api,
	getErrorMessage,
	type ReviewData,
	type TaxYearInfo,
} from "@/lib/client/api";
import {
	formatInrNullable,
	formatIstDateTime,
	formatQty,
	formatSourceLabel,
	formatTxType,
} from "@/lib/client/format";
import { REVIEW_CODE_INFO } from "@/lib/client/review-codes";

function reportItemHref(
	code: keyof typeof REVIEW_CODE_INFO,
	item: ReportReviewItem,
): string {
	if (item.kind === "balance") {
		return `/report?taxYear=${encodeURIComponent(item.taxYear)}#balances`;
	}
	if (code === "missing_history") {
		const params = new URLSearchParams({
			add: "buy",
			asset: item.unresolved.asset,
			taxYear: item.taxYear,
		});
		return `/transactions?${params.toString()}`;
	}
	return `/report?taxYear=${encodeURIComponent(item.taxYear)}#unresolved`;
}

export function ReviewClient() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const taxYear = searchParams.get("taxYear") ?? "";

	const [taxYears, setTaxYears] = useState<TaxYearInfo[]>(FALLBACK_TAX_YEARS);
	const [defaultTaxYear, setDefaultTaxYear] = useState("2026-27");
	const [data, setData] = useState<ReviewData | null>(null);
	const [loading, setLoading] = useState(true);
	const [computing, setComputing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedTx, setSelectedTx] = useState<LedgerTx | null>(null);

	useEffect(() => {
		api
			.getTaxYears()
			.then((list) => {
				if (list.length > 0) setTaxYears(list);
			})
			.catch(() => {});
		api
			.getSettings()
			.then((s) => {
				if (s.defaultTaxYear) setDefaultTaxYear(s.defaultTaxYear);
			})
			.catch(() => {});
	}, []);

	const loadReview = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await api.getReview(taxYear || undefined);
			setData(res);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setLoading(false);
		}
	}, [taxYear]);

	useEffect(() => {
		loadReview();
	}, [loadReview]);

	function handleTaxYearChange(next: string) {
		const params = new URLSearchParams(searchParams.toString());
		if (next) params.set("taxYear", next);
		else params.delete("taxYear");
		const qs = params.toString();
		router.replace(`/review${qs ? `?${qs}` : ""}`);
	}

	const computeTargetYear = taxYear || defaultTaxYear;

	async function handleCompute() {
		setComputing(true);
		setError(null);
		try {
			await api.computeReport(computeTargetYear);
			await loadReview();
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setComputing(false);
		}
	}

	const totalItems = data?.groups.reduce((sum, g) => sum + g.count, 0) ?? 0;
	const reportMissingOrStale = data && data.reportStatus !== "current";

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Review Queue</h1>
					<p className="mt-0.5 text-sm text-[var(--text-secondary)]">
						Uncertain or incomplete rows are never guessed silently. Resolve
						each group below before filing.
					</p>
				</div>
				<TaxYearSelect
					value={taxYear}
					onChange={handleTaxYearChange}
					taxYears={taxYears}
					includeAllOption
				/>
			</div>

			{error ? <ErrorBanner message={error} onRetry={loadReview} /> : null}

			{!loading && reportMissingOrStale && totalItems > 0 ? (
				<div
					role="status"
					className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-3 text-sm"
				>
					<div className="flex items-start gap-2.5">
						<AlertTriangle
							className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
							aria-hidden="true"
						/>
						<div>
							<p className="font-medium text-[var(--text-primary)]">
								{data.reportStatus === "stale"
									? `Report out of date for ${computeTargetYear} — recompute to refresh balance and missing history checks.`
									: `Report not computed for ${computeTargetYear} — some checks (balances, missing history) appear only after computing.`}
							</p>
						</div>
					</div>
					<button
						type="button"
						disabled={computing}
						onClick={handleCompute}
						className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						<Calculator className="h-3.5 w-3.5" aria-hidden="true" />
						{computing
							? "Computing…"
							: data.reportStatus === "stale"
								? `Recompute ${computeTargetYear} report`
								: `Compute ${computeTargetYear} report`}
					</button>
				</div>
			) : null}

			{loading ? (
				<div className="h-48 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			) : !data ? null : totalItems === 0 ? (
				data.reportStatus === "current" ? (
					<EmptyState
						icon={<CheckCircle2 className="h-8 w-8 text-[var(--positive)]" />}
						title="No review flags found"
						description={
							taxYear
								? `All ledger transactions in ${taxYear} are clean.`
								: "All ledger transactions are clean."
						}
						action={
							<Link
								href={
									taxYear
										? `/report?taxYear=${encodeURIComponent(taxYear)}`
										: "/report"
								}
								className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
							>
								Open Schedule VDA report
								<ArrowRight className="h-4 w-4" aria-hidden="true" />
							</Link>
						}
					/>
				) : (
					<EmptyState
						icon={<Calculator className="h-8 w-8 text-[var(--warning)]" />}
						title={
							data.reportStatus === "stale"
								? `Report out of date for ${computeTargetYear}`
								: `Report not computed for ${computeTargetYear}`
						}
						description={
							data.reportStatus === "stale"
								? `Recompute the ${computeTargetYear} report to refresh FIFO lot matching, balance reconciliation, and valuation checks.`
								: `Some checks (balances, missing history, FIFO valuation) appear only after computing the ${computeTargetYear} report.`
						}
						action={
							<button
								type="button"
								disabled={computing}
								onClick={handleCompute}
								className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
							>
								<Calculator className="h-4 w-4" aria-hidden="true" />
								{computing
									? "Computing…"
									: data.reportStatus === "stale"
										? `Recompute ${computeTargetYear} report`
										: `Compute ${computeTargetYear} report`}
							</button>
						}
					/>
				)
			) : (
				<div className="space-y-5">
					{data.groups.map((group) => {
						const info = REVIEW_CODE_INFO[group.code];
						const tone =
							info.severity === "error"
								? "loss"
								: info.severity === "warning"
									? "warning"
									: "accent";
						return (
							<section
								key={group.code}
								className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]"
							>
								<div className="border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-3">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex items-center gap-2">
											<h2 className="text-sm font-semibold">{info.title}</h2>
											<Badge tone={tone}>
												<span className="num">{group.count}</span> item
												{group.count === 1 ? "" : "s"}
											</Badge>
										</div>
										<code className="font-mono-code text-xs text-[var(--text-muted)]">
											{group.code}
										</code>
									</div>
									<p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
										{info.explanation}
									</p>
								</div>

								<div className="overflow-x-auto">
									<table className="w-full border-collapse text-left text-xs">
										<thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
											<tr>
												<th className="px-4 py-2 font-medium">Date (IST)</th>
												<th className="px-4 py-2 font-medium">Type</th>
												<th className="px-4 py-2 font-medium">Source</th>
												<th className="px-4 py-2 font-medium">Amounts</th>
												<th className="num-right px-4 py-2 font-medium">
													INR Value
												</th>
												<th className="px-4 py-2 font-medium">Details</th>
												<th className="px-4 py-2 text-right font-medium">
													Fix Action
												</th>
											</tr>
										</thead>
										<tbody>
											{group.items.map((tx) => {
												const flagDetail = tx.reviewFlags.find(
													(f) => f.code === group.code,
												);
												return (
													<tr
														key={`${group.code}-${tx.id}`}
														className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60"
													>
														<td className="px-4 py-2.5 whitespace-nowrap">
															{formatIstDateTime(tx.timestamp)}
														</td>
														<td className="px-4 py-2.5 whitespace-nowrap">
															<Badge tone="neutral">
																{formatTxType(tx.type)}
															</Badge>
														</td>
														<td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
															{formatSourceLabel(tx.source)}
														</td>
														<td className="num px-4 py-2.5 whitespace-nowrap">
															{tx.assetIn
																? `+${formatQty(tx.amountIn)} ${tx.assetIn}`
																: ""}
															{tx.assetIn && tx.assetOut ? " / " : ""}
															{tx.assetOut
																? `-${formatQty(tx.amountOut)} ${tx.assetOut}`
																: ""}
														</td>
														<td className="num-right px-4 py-2.5 whitespace-nowrap">
															{formatInrNullable(tx.inrValue)}
														</td>
														<td className="max-w-xs px-4 py-2.5 text-[var(--text-secondary)]">
															{flagDetail?.message ?? "—"}
														</td>
														<td className="px-4 py-2.5 text-right whitespace-nowrap">
															<div className="inline-flex items-center gap-2">
																<button
																	type="button"
																	onClick={() => setSelectedTx(tx)}
																	className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--bg-hover)]"
																>
																	<Edit3
																		className="h-3 w-3"
																		aria-hidden="true"
																	/>
																	Inspect
																</button>
																<Link
																	href={info.fixHref(tx, taxYear || undefined)}
																	className="inline-flex items-center gap-1 rounded bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent-text)] hover:underline"
																>
																	{info.fixLabel}
																	<ArrowRight
																		className="h-3 w-3"
																		aria-hidden="true"
																	/>
																</Link>
															</div>
														</td>
													</tr>
												);
											})}
											{group.reportItems.map((ri, idx) => {
												const key =
													ri.kind === "balance"
														? `${group.code}-bal-${ri.taxYear}-${ri.balance.asset}-${ri.balance.source ?? "global"}`
														: `${group.code}-unres-${ri.taxYear}-${ri.unresolved.txId}-${ri.unresolved.asset}-${idx}`;
												return (
													<tr
														key={key}
														className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60"
													>
														<td className="px-4 py-2.5 whitespace-nowrap">
															Tax year {ri.taxYear}
														</td>
														<td className="px-4 py-2.5 whitespace-nowrap">
															<Badge tone="neutral">
																{ri.kind === "balance"
																	? "Year-end balance"
																	: "Unresolved slice"}
															</Badge>
														</td>
														<td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
															{ri.kind === "balance"
																? ri.balance.source
																	? formatSourceLabel(ri.balance.source)
																	: "Global"
																: "Computed report"}
														</td>
														<td className="num px-4 py-2.5 whitespace-nowrap">
															{ri.kind === "balance"
																? `${ri.balance.asset}: computed ${formatQty(ri.balance.computed)}${
																		ri.balance.actual !== undefined
																			? `, actual ${formatQty(ri.balance.actual)}`
																			: ""
																	}`
																: `${formatQty(ri.unresolved.quantity)} ${ri.unresolved.asset}`}
														</td>
														<td className="num-right px-4 py-2.5 whitespace-nowrap text-[var(--text-muted)]">
															—
														</td>
														<td className="max-w-xs px-4 py-2.5 text-[var(--text-secondary)]">
															{ri.message}
														</td>
														<td className="px-4 py-2.5 text-right whitespace-nowrap">
															<Link
																href={reportItemHref(group.code, ri)}
																className="inline-flex items-center gap-1 rounded bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent-text)] hover:underline"
															>
																{info.fixLabel}
																<ArrowRight
																	className="h-3 w-3"
																	aria-hidden="true"
																/>
															</Link>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							</section>
						);
					})}
				</div>
			)}

			<TransactionDrawer
				tx={selectedTx}
				onClose={() => setSelectedTx(null)}
				onUpdated={(updated) => {
					setSelectedTx(updated);
					loadReview();
				}}
				onDeleted={() => {
					setSelectedTx(null);
					loadReview();
				}}
			/>
		</div>
	);
}
