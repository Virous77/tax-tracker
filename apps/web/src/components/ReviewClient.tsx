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
	isNegativeDecimal,
	pluralise,
} from "@/lib/client/format";
import { REVIEW_CODE_INFO } from "@/lib/client/review-codes";

function reportItemActions(
	code: keyof typeof REVIEW_CODE_INFO,
	item: ReportReviewItem,
): {
	txHref: string | null;
	txLabel: string | null;
	fixHref: string | null;
	fixLabel: string | null;
} {
	if (item.kind === "balance") {
		const txCount = item.balance.txIds.length;
		const txParams = new URLSearchParams({ asset: item.balance.asset });
		if (item.balance.source) txParams.set("source", item.balance.source);
		const txHref = txCount > 0 ? `/transactions?${txParams.toString()}` : null;
		const txLabel =
			txCount > 0
				? `View ${txCount} ${pluralise(txCount, "transaction")}`
				: null;

		if (code === "missing_history") {
			const params = new URLSearchParams({
				add: "buy",
				asset: item.balance.asset,
				taxYear: item.taxYear,
			});
			return {
				txHref,
				txLabel,
				fixHref: `/transactions?${params.toString()}`,
				fixLabel: "Add missing buy",
			};
		}
		return {
			txHref,
			txLabel,
			fixHref: `/report?taxYear=${encodeURIComponent(item.taxYear)}#balances`,
			fixLabel: REVIEW_CODE_INFO[code].fixLabel,
		};
	}

	if (item.kind === "unresolved") {
		const reason = item.unresolved.reason;
		const txParams = new URLSearchParams({
			taxYear: item.taxYear,
			asset: item.unresolved.asset,
		});
		const txHref = `/transactions?${txParams.toString()}`;
		const txLabel = "View transaction";

		if (reason === "missing_history") {
			const params = new URLSearchParams({
				add: "buy",
				asset: item.unresolved.asset,
				taxYear: item.taxYear,
			});
			return {
				txHref,
				txLabel,
				fixHref: `/transactions?${params.toString()}`,
				fixLabel: "Add missing buy",
			};
		}
		if (reason === "missing_inr_value" || reason === "fx_unavailable") {
			const params = new URLSearchParams({
				taxYear: item.taxYear,
				asset: item.unresolved.asset,
				flagged: "true",
			});
			return {
				txHref,
				txLabel,
				fixHref: `/transactions?${params.toString()}`,
				fixLabel: REVIEW_CODE_INFO[reason].fixLabel,
			};
		}
		return {
			txHref,
			txLabel,
			fixHref: `/report?taxYear=${encodeURIComponent(item.taxYear)}#unresolved`,
			fixLabel:
				REVIEW_CODE_INFO[reason]?.fixLabel ?? REVIEW_CODE_INFO[code].fixLabel,
		};
	}

	const txIds = [
		...new Set([
			...(item.warning.txIds ?? []),
			...(item.warning.txId ? [item.warning.txId] : []),
		]),
	];
	let txHref: string | null = null;
	let txLabel: string | null = null;
	if (txIds.length > 0 || item.warning.asset) {
		const params = new URLSearchParams();
		if (item.warning.asset) params.set("asset", item.warning.asset);
		if (item.warning.source) params.set("source", item.warning.source);
		if (txIds.length > 0) params.set("flagged", "true");
		txHref = `/transactions?${params.toString()}`;
		txLabel =
			txIds.length > 0
				? `View ${txIds.length} ${pluralise(txIds.length, "transaction")}`
				: `View ${item.warning.asset} transactions`;
	}

	if (code === "import_incomplete") {
		return {
			txHref,
			txLabel,
			fixHref: "/imports",
			fixLabel: "Inspect imports",
		};
	}
	if (code === "ca_verification_pending") {
		return {
			txHref,
			txLabel,
			fixHref: `/report?taxYear=${encodeURIComponent(item.taxYear)}`,
			fixLabel: REVIEW_CODE_INFO[code].fixLabel,
		};
	}
	if (code === "missing_history" && item.warning.asset) {
		const params = new URLSearchParams({
			add: "buy",
			asset: item.warning.asset,
			taxYear: item.taxYear,
		});
		return {
			txHref,
			txLabel,
			fixHref: `/transactions?${params.toString()}`,
			fixLabel: "Add missing buy",
		};
	}
	if (code === "tds_not_deducted") {
		return {
			txHref,
			txLabel,
			fixHref: `/report?taxYear=${encodeURIComponent(item.taxYear)}#tds`,
			fixLabel: REVIEW_CODE_INFO[code].fixLabel,
		};
	}

	return {
		txHref,
		txLabel,
		fixHref: txHref
			? null
			: `/report?taxYear=${encodeURIComponent(item.taxYear)}`,
		fixLabel: txHref ? null : REVIEW_CODE_INFO[code].fixLabel,
	};
}

function formatComputeLabel(years: string[]): string {
	if (years.length <= 1) {
		return `Compute ${years[0] ?? ""} report`;
	}
	if (years.length === 2) {
		return `Compute ${years[0]} & ${years[1]} reports`;
	}
	return `Compute all ${years.length} missing reports`;
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
	const [computeProgress, setComputeProgress] = useState<{
		year: string;
		index: number;
		total: number;
	} | null>(null);
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

	const missingYears = data
		? data.reportStatuses
				.filter((entry) => entry.status === "missing")
				.map((entry) => entry.taxYear)
		: [];
	const currentYears = data
		? data.reportStatuses
				.filter((entry) => entry.status === "current")
				.map((entry) => entry.taxYear)
		: [];
	const computeTargets =
		data && data.computeTaxYears.length > 0
			? data.computeTaxYears
			: [taxYear || defaultTaxYear];

	async function handleCompute() {
		setComputing(true);
		setError(null);
		let computedAny = false;
		try {
			for (let i = 0; i < computeTargets.length; i++) {
				const targetYear = computeTargets[i];
				if (!targetYear) continue;
				setComputeProgress({
					year: targetYear,
					index: i + 1,
					total: computeTargets.length,
				});
				await api.computeReport(targetYear);
				computedAny = true;
			}
			await loadReview();
		} catch (err) {
			setError(getErrorMessage(err));
			if (computedAny) {
				await loadReview().catch(() => {});
			}
		} finally {
			setComputing(false);
			setComputeProgress(null);
		}
	}

	const totalItems = data?.groups.reduce((sum, g) => sum + g.count, 0) ?? 0;
	const reportMissing = data && data.reportStatus === "missing";
	const missingListText =
		missingYears.length > 0
			? missingYears.join(", ")
			: taxYear || defaultTaxYear;
	const computeButtonText = computing
		? computeProgress && computeProgress.total > 1
			? `Computing ${computeProgress.year} (${computeProgress.index}/${computeProgress.total})…`
			: computeProgress
				? `Computing ${computeProgress.year}…`
				: "Computing…"
		: formatComputeLabel(computeTargets);

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

			{!loading && reportMissing && totalItems > 0 ? (
				<div
					role="status"
					className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-3 text-sm"
				>
					<div className="flex items-start gap-2.5">
						<AlertTriangle
							className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
							aria-hidden="true"
						/>
						<div className="space-y-0.5">
							<p className="font-medium text-[var(--text-primary)]">
								{missingYears.length > 1
									? `Reports not computed for ${missingListText} — some checks (balances, missing history) appear only after computing.`
									: `Report not computed for ${missingListText} — some checks (balances, missing history) appear only after computing.`}
							</p>
							{!taxYear && currentYears.length > 0 ? (
								<p className="text-xs text-[var(--text-secondary)]">
									Computed: {currentYears.join(", ")} · Not computed:{" "}
									{missingYears.join(", ")}
								</p>
							) : null}
						</div>
					</div>
					<button
						type="button"
						disabled={computing}
						onClick={handleCompute}
						className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						<Calculator className="h-3.5 w-3.5" aria-hidden="true" />
						{computeButtonText}
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
							missingYears.length > 1
								? `Reports not computed for ${missingListText}`
								: `Report not computed for ${missingListText}`
						}
						description={`Some checks (balances, missing history, FIFO valuation) appear only after computing ${missingYears.length > 1 ? `reports for ${missingListText}` : `the ${missingListText} report`}.`}
						action={
							<button
								type="button"
								disabled={computing}
								onClick={handleCompute}
								className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
							>
								<Calculator className="h-4 w-4" aria-hidden="true" />
								{computeButtonText}
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
												<span className="num">{group.count}</span>{" "}
												{pluralise(group.count, "item")}
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
												const matchingFlags = tx.reviewFlags.filter(
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
															{matchingFlags.length === 0 ? (
																"—"
															) : matchingFlags.length === 1 ? (
																<span>{matchingFlags[0]?.message}</span>
															) : (
																<ul className="list-disc space-y-1 pl-4">
																	{matchingFlags.map((flag) => (
																		<li key={flag.message}>{flag.message}</li>
																	))}
																</ul>
															)}
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
														? `${group.code}-bal-${ri.taxYear}-${ri.balance.asset}-${ri.balance.source ?? "global"}-${idx}`
														: ri.kind === "unresolved"
															? `${group.code}-unres-${ri.taxYear}-${ri.unresolved.txId}-${ri.unresolved.asset}-${ri.unresolved.reason}-${idx}`
															: `${group.code}-warn-${ri.taxYear}-${ri.warning.asset ?? ""}-${ri.warning.source ?? ""}-${idx}`;
												const actions = reportItemActions(group.code, ri);
												const isNegativeBalance =
													ri.kind === "balance" &&
													isNegativeDecimal(ri.balance.computed) &&
													group.code === "missing_history";
												return (
													<tr
														key={key}
														className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60"
													>
														<td className="px-4 py-2.5 whitespace-nowrap">
															Tax year {ri.taxYear}
														</td>
														<td className="px-4 py-2.5 whitespace-nowrap">
															{ri.kind === "balance" ? (
																<Badge
																	tone={isNegativeBalance ? "loss" : "neutral"}
																>
																	{isNegativeBalance
																		? "Negative holding"
																		: "Year-end balance"}
																</Badge>
															) : ri.kind === "unresolved" ? (
																<Badge tone="loss">Unresolved slice</Badge>
															) : (
																<Badge
																	tone={
																		group.code === "ca_verification_pending"
																			? "accent"
																			: "neutral"
																	}
																>
																	{group.code === "ca_verification_pending"
																		? "Report notice"
																		: "Report warning"}
																</Badge>
															)}
														</td>
														<td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
															{ri.kind === "balance"
																? ri.balance.source
																	? formatSourceLabel(ri.balance.source)
																	: "Global"
																: ri.kind === "warning" && ri.warning.source
																	? formatSourceLabel(ri.warning.source)
																	: "Computed report"}
														</td>
														<td className="num px-4 py-2.5 whitespace-nowrap">
															{ri.kind === "balance"
																? `${ri.balance.asset}: computed ${formatQty(ri.balance.computed)}${
																		ri.balance.actual !== undefined
																			? `, actual ${formatQty(ri.balance.actual)}`
																			: ""
																	}`
																: ri.kind === "unresolved"
																	? `${formatQty(ri.unresolved.quantity)} ${ri.unresolved.asset}`
																	: (ri.warning.asset ?? "—")}
														</td>
														<td className="num-right px-4 py-2.5 whitespace-nowrap text-[var(--text-muted)]">
															—
														</td>
														<td className="max-w-xs px-4 py-2.5 text-[var(--text-secondary)]">
															{ri.kind === "unresolved" ? (
																<div className="space-y-0.5">
																	<p>{ri.message}</p>
																	<p className="text-[11px] text-[var(--text-muted)]">
																		Reason:{" "}
																		{REVIEW_CODE_INFO[ri.unresolved.reason]
																			?.title ?? ri.unresolved.reason}
																	</p>
																</div>
															) : ri.kind === "warning" &&
																ri.warning.count &&
																ri.warning.count > 1 ? (
																<span>
																	{ri.message}{" "}
																	<span className="font-medium text-[var(--text-primary)]">
																		(×{ri.warning.count})
																	</span>
																</span>
															) : (
																ri.message
															)}
														</td>
														<td className="px-4 py-2.5 text-right whitespace-nowrap">
															<div className="inline-flex items-center gap-2">
																{actions.txHref && actions.txLabel ? (
																	<Link
																		href={actions.txHref}
																		className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
																	>
																		{actions.txLabel}
																	</Link>
																) : null}
																{actions.fixHref && actions.fixLabel ? (
																	<Link
																		href={actions.fixHref}
																		className="inline-flex items-center gap-1 rounded bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent-text)] hover:underline"
																	>
																		{actions.fixLabel}
																		<ArrowRight
																			className="h-3 w-3"
																			aria-hidden="true"
																		/>
																	</Link>
																) : null}
															</div>
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
