"use client";

import { D, type LedgerTx, taxYearOf } from "@tax/core";
import type { ReportReviewItem } from "@tax/core/api";
import {
	AlertTriangle,
	ArrowRight,
	Calculator,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Edit3,
	Upload,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StaleReportBanner } from "@/components/report/StaleReportBanner";
import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { TaxYearSelect } from "@/components/ui/TaxYearSelect";
import { api, getErrorMessage, type ReviewData } from "@/lib/client/api";
import { getEvmChainName } from "@/lib/client/chains";
import {
	formatAssetAmount,
	formatInrNullable,
	formatIstDateTime,
	formatQty,
	formatTxType,
	isNegativeDecimal,
	pluralise,
} from "@/lib/client/format";
import {
	addMissingBuyHref,
	groupReviewFlags,
	REVIEW_CODE_INFO,
	reviewActionCount,
	splitReviewGroups,
} from "@/lib/client/review-codes";
import { useScrollToHash } from "@/lib/client/useScrollToHash";
import { ALL_YEARS, useSelectedTaxYear } from "@/lib/client/useSelectedTaxYear";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

type ReviewGroup = ReviewData["groups"][number];

const BLOCKING_GROUP_ORDER: readonly string[] = [
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

const ADVISORY_GROUP_ORDER: readonly string[] = [
	"fee_review_required",
	"parse_warning",
	"tds_not_deducted",
	"ambiguous_timezone",
	"suspected_spam",
	"possible_duplicate",
	"ca_verification_pending",
];

const ADVISORY_GROUP_CODES: ReadonlySet<string> = new Set(ADVISORY_GROUP_ORDER);
const ADVISORY_COLLAPSE_THRESHOLD = 15;
const EXPANDED_PREVIEW_LIMIT = 10;

function reviewGroupRank(code: string): number {
	const blockingIdx = BLOCKING_GROUP_ORDER.indexOf(code);
	if (blockingIdx !== -1) return blockingIdx;
	const advisoryIdx = ADVISORY_GROUP_ORDER.indexOf(code);
	if (advisoryIdx !== -1) return BLOCKING_GROUP_ORDER.length + 1 + advisoryIdx;
	return BLOCKING_GROUP_ORDER.length;
}

/** Notices about the computed report itself; every other note says how a file was read. */
const REPORT_NOTICE_CODES: ReadonlySet<string> = new Set([
	"ca_verification_pending",
]);

function isReportNotice(group: ReviewGroup): boolean {
	return (
		REPORT_NOTICE_CODES.has(group.code) &&
		group.items.length === 0 &&
		group.reportItems.every((item) => item.kind === "warning")
	);
}

type ReportItemActions = {
	txHref: string | null;
	txLabel: string | null;
	fixHref: string | null;
	fixLabel: string | null;
};

/** A stale report can still list an item whose row was deleted; there is nothing to open. */
function reportItemActions(
	code: keyof typeof REVIEW_CODE_INFO,
	item: ReportReviewItem,
	options: { note: boolean; saleTimestamp: string | undefined },
): ReportItemActions {
	const actions = buildReportItemActions(code, item, options);
	return item.rowDeleted
		? { ...actions, txHref: null, txLabel: null }
		: actions;
}

function buildReportItemActions(
	code: keyof typeof REVIEW_CODE_INFO,
	item: ReportReviewItem,
	options: { note: boolean; saleTimestamp: string | undefined },
): ReportItemActions {
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
			return {
				txHref,
				txLabel,
				fixHref: addMissingBuyHref(item.balance.asset, item.taxYear),
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
			return {
				txHref,
				txLabel,
				fixHref: addMissingBuyHref(
					item.unresolved.asset,
					item.taxYear,
					options.saleTimestamp,
					item.unresolved.txId,
				),
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

	if (options.note) {
		return { txHref, txLabel, fixHref: "/imports", fixLabel: "View import" };
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
		return {
			txHref,
			txLabel,
			fixHref: addMissingBuyHref(item.warning.asset, item.taxYear),
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
		fixLabel: txHref ? null : "View in Report",
	};
}

function groupTaxYears(group: ReviewGroup): string[] {
	return [
		...new Set([
			...group.items.map((tx) => taxYearOf(tx.timestamp)),
			...group.reportItems.map((item) => item.taxYear),
		]),
	];
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
	const sourceLabel = useSourceLabel();
	const {
		taxYear: selectedYear,
		taxYears,
		settings,
		selectTaxYear,
	} = useSelectedTaxYear("/review");
	const yearReady = selectedYear !== "";
	const taxYear = selectedYear === ALL_YEARS ? "" : selectedYear;
	const defaultTaxYear = settings?.defaultTaxYear ?? taxYears[0]?.id ?? "";
	const [data, setData] = useState<ReviewData | null>(null);
	const [yearsWithRows, setYearsWithRows] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [loading, setLoading] = useState(true);
	const [computing, setComputing] = useState(false);
	const [computeProgress, setComputeProgress] = useState<{
		year: string;
		index: number;
		total: number;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selectedTx, setSelectedTx] = useState<LedgerTx | null>(null);
	const [confirmGroup, setConfirmGroup] = useState<ReviewGroup | null>(null);
	const [resolving, setResolving] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [groupView, setGroupView] = useState<
		Record<string, "collapsed" | "preview" | "all">
	>({});

	const loadReview = useCallback(
		async (options?: { keepContent?: boolean }) => {
			if (!options?.keepContent) setLoading(true);
			setError(null);
			try {
				const res = await api.getReview(taxYear || undefined);
				const counts = await Promise.all(
					res.reportStatuses.map(async ({ taxYear: year }) => {
						const page = await api
							.listTransactions({ taxYear: year, page: 1, pageSize: 1 })
							.catch(() => null);
						return [year, page === null || page.total > 0] as const;
					}),
				);
				setYearsWithRows(
					new Set(counts.filter(([, has]) => has).map(([year]) => year)),
				);
				setData(res);
			} catch (err) {
				setError(getErrorMessage(err));
			} finally {
				setLoading(false);
			}
		},
		[taxYear],
	);

	useEffect(() => {
		if (yearReady) loadReview();
	}, [yearReady, loadReview]);
	useScrollToHash(!loading && data !== null);

	function handleTaxYearChange(next: string) {
		selectTaxYear(next || ALL_YEARS);
	}

	// A year with no ledger rows has nothing to compute, so it is never "not computed".
	const missingYears = data
		? data.reportStatuses
				.filter(
					(entry) =>
						entry.status === "missing" && yearsWithRows.has(entry.taxYear),
				)
				.map((entry) => entry.taxYear)
		: [];
	const currentYears = data
		? data.reportStatuses
				.filter((entry) => entry.status === "current")
				.map((entry) => entry.taxYear)
		: [];
	const staleYears = data
		? data.reportStatuses
				.filter((entry) => entry.status === "stale")
				.map((entry) => entry.taxYear)
		: [];
	const outdatedYears = [
		...new Set([
			...(data?.computeTaxYears ?? []).filter(
				(year) => yearsWithRows.has(year) || staleYears.includes(year),
			),
			...staleYears,
		]),
	];
	const computeTargets =
		outdatedYears.length > 0 ? outdatedYears : [taxYear || defaultTaxYear];

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

	async function resolveItems(
		group: ReviewGroup,
		scope: { tx: LedgerTx } | { all: true },
	) {
		setResolving(true);
		setError(null);
		setNotice(null);
		try {
			let resolved = 0;
			if ("tx" in scope) {
				resolved = await api.resolveReview({
					code: group.code,
					taxYear: taxYear || taxYearOf(scope.tx.timestamp),
					txIds: [scope.tx.id],
				});
			} else {
				const years = taxYear ? [taxYear] : groupTaxYears(group);
				for (const year of years) {
					resolved += await api.resolveReview({
						code: group.code,
						taxYear: year,
					});
				}
			}
			setNotice(
				`Marked ${resolved} ${pluralise(resolved, "item")} as checked. Your tax figures are unchanged.`,
			);
			setConfirmGroup(null);
			await loadReview({ keepContent: true });
		} catch (err) {
			setError(getErrorMessage(err));
			setConfirmGroup(null);
		} finally {
			setResolving(false);
		}
	}

	const connectionIssues = data?.connections ?? [];
	const actionTotal = data ? reviewActionCount(data) : 0;
	const { action: rawActionGroups, info: infoGroups } = splitReviewGroups(
		data?.groups ?? [],
	);
	const actionGroups = [...rawActionGroups].sort(
		(a, b) => reviewGroupRank(a.code) - reviewGroupRank(b.code),
	);
	const noteGroups = infoGroups.filter((g) => !isReportNotice(g));
	const reportNoteGroups = infoGroups.filter(isReportNotice);
	const noActionItems = actionTotal === 0 && connectionIssues.length === 0;
	const noteTotal = noteGroups.reduce((sum, g) => sum + g.count, 0);
	const reportNoteTotal = reportNoteGroups.reduce((sum, g) => sum + g.count, 0);
	const saleTimestamps = new Map(
		(data?.groups ?? []).flatMap((g) =>
			g.items.map((tx) => [tx.id, tx.timestamp] as const),
		),
	);
	const reportMissing = missingYears.length > 0;
	const reportStale = data?.reportStatus === "stale";
	const ledgerEmpty = taxYear
		? !yearsWithRows.has(taxYear)
		: yearsWithRows.size === 0;
	const showMissingEmptyState =
		noActionItems && !reportStale && !ledgerEmpty && reportMissing;
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

	function renderGroup(group: ReviewGroup, neutral: boolean) {
		const info = REVIEW_CODE_INFO[group.code];
		const tone = neutral
			? "neutral"
			: info.severity === "error"
				? "loss"
				: info.severity === "warning"
					? "warning"
					: "accent";
		const totalRows = group.items.length + group.reportItems.length;
		const startsCollapsed =
			!neutral &&
			ADVISORY_GROUP_CODES.has(group.code) &&
			totalRows > ADVISORY_COLLAPSE_THRESHOLD;
		const defaultView: "collapsed" | "preview" | "all" = startsCollapsed
			? "collapsed"
			: totalRows > EXPANDED_PREVIEW_LIMIT
				? "preview"
				: "all";
		const view = groupView[group.code] ?? defaultView;
		const showMarkAll = !neutral && group.code !== "missing_history";

		const missingHistoryHeaderAction = (() => {
			if (neutral || group.code !== "missing_history") return null;
			const assets = new Set<string>();
			let earliestTs: string | undefined;
			let totalUnresolvedQty = D("0");
			let unresolvedCount = 0;
			let targetYear = taxYear;
			for (const ri of group.reportItems) {
				if (!targetYear) targetYear = ri.taxYear;
				if (ri.kind === "unresolved") {
					assets.add(ri.unresolved.asset);
					totalUnresolvedQty = totalUnresolvedQty.plus(ri.unresolved.quantity);
					unresolvedCount += 1;
					const ts = saleTimestamps.get(ri.unresolved.txId);
					if (ts && (!earliestTs || ts < earliestTs)) earliestTs = ts;
				} else if (ri.kind === "balance") {
					assets.add(ri.balance.asset);
				} else if (ri.warning.asset) {
					assets.add(ri.warning.asset);
				}
			}
			for (const tx of group.items) {
				const a = tx.assetOut ?? tx.assetIn;
				if (a) assets.add(a);
				if (!earliestTs || tx.timestamp < earliestTs) earliestTs = tx.timestamp;
			}
			if (assets.size !== 1) return null;
			const [onlyAsset] = [...assets];
			if (!onlyAsset) return null;
			const sp = new URLSearchParams({ add: "buy", asset: onlyAsset });
			if (unresolvedCount > 1 && totalUnresolvedQty.gt("0")) {
				sp.set("qty", totalUnresolvedQty.toFixed());
			}
			if (earliestTs) sp.set("before", earliestTs);
			if (targetYear) sp.set("taxYear", targetYear);
			return {
				href: `/transactions?${sp.toString()}`,
				label:
					unresolvedCount > 1 && totalUnresolvedQty.gt("0")
						? `Add missing buy (${formatQty(totalUnresolvedQty.toFixed())} ${onlyAsset})`
						: "Add missing buy",
			};
		})();

		const visibleItems =
			view === "collapsed"
				? []
				: view === "preview"
					? group.items.slice(0, EXPANDED_PREVIEW_LIMIT)
					: group.items;
		const visibleReportItems =
			view === "collapsed"
				? []
				: view === "preview"
					? group.reportItems.slice(
							0,
							Math.max(0, EXPANDED_PREVIEW_LIMIT - visibleItems.length),
						)
					: group.reportItems;

		return (
			<section
				key={group.code}
				id={`review-${group.code}`}
				className="scroll-mt-16 overflow-hidden lg:scroll-mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]"
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
						<div className="flex flex-wrap items-center gap-2.5">
							<code className="font-mono-code text-xs text-[var(--text-muted)]">
								{group.code}
							</code>
							{startsCollapsed ? (
								<button
									type="button"
									aria-expanded={view !== "collapsed"}
									onClick={() =>
										setGroupView((prev) => ({
											...prev,
											[group.code]:
												(prev[group.code] ?? defaultView) === "collapsed"
													? "all"
													: "collapsed",
										}))
									}
									className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
								>
									{view === "collapsed" ? (
										<>
											Show all {totalRows} {pluralise(totalRows, "item")}
											<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
										</>
									) : (
										<>
											Hide items
											<ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
										</>
									)}
								</button>
							) : null}
							{missingHistoryHeaderAction ? (
								<Link
									href={missingHistoryHeaderAction.href}
									className="inline-flex items-center gap-1 rounded bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
								>
									{missingHistoryHeaderAction.label}
									<ArrowRight className="h-3 w-3" aria-hidden="true" />
								</Link>
							) : null}
							{showMarkAll ? (
								<button
									type="button"
									disabled={resolving}
									onClick={() => setConfirmGroup(group)}
									className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
								>
									<Check className="h-3 w-3" aria-hidden="true" />
									Mark all as checked
									<span className="sr-only"> in {info.title}</span>
								</button>
							) : null}
						</div>
					</div>
					<p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
						{info.explanation}
					</p>
				</div>

				{view !== "collapsed" ? (
					<>
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-left text-xs">
								<thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
									<tr>
										<th className="px-3 py-2 font-medium whitespace-nowrap">
											Date (IST)
										</th>
										<th className="px-3 py-2 font-medium whitespace-nowrap">
											Type
										</th>
										<th className="px-3 py-2 font-medium whitespace-nowrap">
											Source
										</th>
										<th className="px-3 py-2 font-medium whitespace-nowrap">
											Amounts
										</th>
										<th className="num-right px-3 py-2 font-medium whitespace-nowrap">
											INR Value
										</th>
										<th className="min-w-[240px] px-3 py-2 font-medium">
											Details
										</th>
										<th className="px-3 py-2 text-right font-medium whitespace-nowrap">
											Fix Action
										</th>
									</tr>
								</thead>
								<tbody>
									{visibleItems.map((tx) => {
										const matchingMessages =
											groupReviewFlags(
												tx.reviewFlags.filter((f) => f.code === group.code),
											)[0]?.messages ?? [];
										const showFixLink =
											info.fixLabel !== "Inspect in Transactions";
										return (
											<tr
												key={`${group.code}-${tx.id}`}
												className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60"
											>
												<td className="px-3 py-2.5 whitespace-nowrap">
													{formatIstDateTime(tx.timestamp)}
												</td>
												<td className="px-3 py-2.5 whitespace-nowrap">
													<Badge tone="neutral">{formatTxType(tx.type)}</Badge>
												</td>
												<td className="px-3 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
													{sourceLabel(tx.source)}
												</td>
												<td className="num px-3 py-2.5 whitespace-nowrap">
													{tx.assetIn
														? `+${formatAssetAmount(tx.amountIn, tx.assetIn)}`
														: ""}
													{tx.assetIn && tx.assetOut ? " / " : ""}
													{tx.assetOut
														? `-${formatAssetAmount(tx.amountOut, tx.assetOut)}`
														: ""}
												</td>
												<td className="num-right px-3 py-2.5 whitespace-nowrap">
													{formatInrNullable(tx.inrValue)}
												</td>
												<td className="min-w-[240px] max-w-md px-3 py-2.5 text-[var(--text-secondary)]">
													{matchingMessages.length === 0 ? (
														"—"
													) : matchingMessages.length === 1 ? (
														<span>{matchingMessages[0]}</span>
													) : (
														<ul className="list-disc space-y-1 pl-4">
															{matchingMessages.map((msg) => (
																<li key={msg}>{msg}</li>
															))}
														</ul>
													)}
												</td>
												<td className="px-3 py-2.5 text-right whitespace-nowrap">
													<div className="inline-flex flex-wrap items-center justify-end gap-1.5">
														<button
															type="button"
															onClick={() => setSelectedTx(tx)}
															className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--bg-hover)]"
														>
															<Edit3 className="h-3 w-3" aria-hidden="true" />
															Inspect
														</button>
														{neutral ? null : (
															<button
																type="button"
																disabled={resolving}
																onClick={() => resolveItems(group, { tx })}
																className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
															>
																<Check className="h-3 w-3" aria-hidden="true" />
																Mark checked
															</button>
														)}
														{showFixLink ? (
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
														) : null}
													</div>
												</td>
											</tr>
										);
									})}
									{visibleReportItems.map((ri, idx) => {
										const key =
											ri.kind === "balance"
												? `${group.code}-bal-${ri.taxYear}-${ri.balance.asset}-${ri.balance.source ?? "global"}-${idx}`
												: ri.kind === "unresolved"
													? `${group.code}-unres-${ri.taxYear}-${ri.unresolved.txId}-${ri.unresolved.asset}-${ri.unresolved.reason}-${idx}`
													: `${group.code}-warn-${ri.taxYear}-${ri.warning.asset ?? ""}-${ri.warning.source ?? ""}-${idx}`;
										const actions = reportItemActions(group.code, ri, {
											note: neutral && !REPORT_NOTICE_CODES.has(group.code),
											saleTimestamp:
												ri.kind === "unresolved"
													? saleTimestamps.get(ri.unresolved.txId)
													: undefined,
										});
										const isNegativeBalance =
											ri.kind === "balance" &&
											isNegativeDecimal(ri.balance.computed) &&
											group.code === "missing_history";
										return (
											<tr
												key={key}
												className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60"
											>
												<td className="px-3 py-2.5 whitespace-nowrap">
													Tax year {ri.taxYear}
												</td>
												<td className="px-3 py-2.5 whitespace-nowrap">
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
												<td className="px-3 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
													{ri.kind === "balance"
														? ri.balance.source
															? sourceLabel(ri.balance.source)
															: "Global"
														: ri.kind === "warning" && ri.warning.source
															? sourceLabel(ri.warning.source)
															: "Computed report"}
												</td>
												<td className="num px-3 py-2.5 whitespace-nowrap">
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
												<td className="num-right px-3 py-2.5 whitespace-nowrap text-[var(--text-muted)]">
													—
												</td>
												<td className="min-w-[240px] max-w-md px-3 py-2.5 text-[var(--text-secondary)]">
													{ri.kind === "unresolved" ? (
														<div className="space-y-0.5">
															<p>{ri.message}</p>
															<p className="text-[11px] text-[var(--text-muted)]">
																Reason:{" "}
																{REVIEW_CODE_INFO[ri.unresolved.reason]
																	?.title ?? ri.unresolved.reason}
															</p>
														</div>
													) : (
														ri.message
													)}
												</td>
												<td className="px-3 py-2.5 text-right whitespace-nowrap">
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
						{totalRows > EXPANDED_PREVIEW_LIMIT ? (
							<div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2 text-xs">
								<span className="num text-[var(--text-secondary)]">
									{view === "preview"
										? `Showing ${visibleItems.length + visibleReportItems.length} of ${totalRows} items`
										: `Showing all ${totalRows} items`}
								</span>
								<button
									type="button"
									onClick={() =>
										setGroupView((prev) => ({
											...prev,
											[group.code]: view === "preview" ? "all" : "preview",
										}))
									}
									className="font-medium text-[var(--accent-text)] hover:underline"
								>
									{view === "preview"
										? `Show all ${totalRows} items`
										: `Show first ${EXPANDED_PREVIEW_LIMIT}`}
								</button>
							</div>
						) : null}
					</>
				) : null}
			</section>
		);
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title="Review Queue"
				description="Uncertain or incomplete rows are never guessed silently. Resolve each group below before filing."
				actions={
					<TaxYearSelect
						value={taxYear}
						onChange={handleTaxYearChange}
						taxYears={taxYears}
						includeAllOption
					/>
				}
			/>

			{error ? <ErrorBanner message={error} onRetry={loadReview} /> : null}

			<div role="status">
				{notice ? (
					<div className="flex items-center gap-2 rounded-lg border border-[var(--positive)]/40 bg-[var(--positive-soft)] px-4 py-2.5 text-sm text-[var(--positive)]">
						<CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
						<span>{notice}</span>
					</div>
				) : null}
			</div>

			{!loading && reportStale ? (
				<StaleReportBanner computing={computing} onRecompute={handleCompute} />
			) : null}

			{!loading && reportMissing && !showMissingEmptyState ? (
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
						className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						<Calculator className="h-3.5 w-3.5" aria-hidden="true" />
						{computeButtonText}
					</button>
				</div>
			) : null}

			{loading ? (
				<div className="h-48 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			) : !data ? null : (
				<div className="space-y-5">
					{noActionItems && !reportStale ? (
						ledgerEmpty ? (
							<EmptyState
								icon={<Upload className="h-8 w-8" />}
								title={
									taxYear
										? `No transactions in ${taxYear}`
										: "No transactions yet"
								}
								description="There is nothing to review until transactions are imported or added."
								action={
									<Link
										href="/import"
										className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
									>
										Import file
										<ArrowRight className="h-4 w-4" aria-hidden="true" />
									</Link>
								}
							/>
						) : showMissingEmptyState ? (
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
										className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
									>
										<Calculator className="h-4 w-4" aria-hidden="true" />
										{computeButtonText}
									</button>
								}
							/>
						) : (
							<EmptyState
								icon={
									<CheckCircle2 className="h-8 w-8 text-[var(--positive)]" />
								}
								title="All items reviewed"
								description={`Nothing${taxYear ? ` in ${taxYear}` : ""} needs your attention. Items you marked as checked stay checked until their data changes.`}
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
						)
					) : null}
					{connectionIssues.length > 0 ? (
						<section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
							<div className="border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="flex items-center gap-2">
										<h2 className="text-sm font-semibold">
											Failed or incomplete connection syncs
										</h2>
										<Badge tone="warning">
											<span className="num">{connectionIssues.length}</span>{" "}
											{pluralise(connectionIssues.length, "connection")}
										</Badge>
									</div>
									<code className="font-mono-code text-xs text-[var(--text-muted)]">
										connections
									</code>
								</div>
								<p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
									One or more API or wallet connections reported a failed sync
									or partial API history (such as endpoints with a six-month or
									history-start limit). Re-sync failed connections, or check
									sync notes and balance comparisons in Connections to see if
									older exports are needed.
								</p>
							</div>

							<div className="overflow-x-auto">
								<table className="w-full border-collapse text-left text-xs">
									<thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
										<tr>
											<th className="px-4 py-2 font-medium">Connection</th>
											<th className="px-4 py-2 font-medium">Type</th>
											<th className="px-4 py-2 font-medium">Sync Status</th>
											<th className="px-4 py-2 font-medium">Last Sync</th>
											<th className="px-4 py-2 font-medium">Details</th>
											<th className="px-4 py-2 text-right font-medium">
												Fix Action
											</th>
										</tr>
									</thead>
									<tbody>
										{connectionIssues.map((conn) => (
											<tr
												key={conn.id}
												className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60"
											>
												<td className="px-4 py-2.5 font-medium">
													{conn.label}
												</td>
												<td className="px-4 py-2.5 whitespace-nowrap">
													<Badge tone="neutral">
														{conn.kind === "binance"
															? "Binance"
															: conn.kind === "coindcx"
																? "CoinDCX"
																: getEvmChainName(conn.chainId)}
													</Badge>
												</td>
												<td className="px-4 py-2.5 whitespace-nowrap">
													<Badge
														tone={
															conn.lastSyncStatus === "failed"
																? "loss"
																: "warning"
														}
													>
														{conn.lastSyncStatus ?? "Unknown"}
													</Badge>
												</td>
												<td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
													{conn.lastSyncAt
														? formatIstDateTime(conn.lastSyncAt)
														: "Never"}
												</td>
												<td className="max-w-xs px-4 py-2.5 text-[var(--text-secondary)]">
													{conn.lastSyncStatus === "incomplete" &&
													(!conn.lastSyncError ||
														conn.lastSyncError ===
															"One or more streams were incomplete; review the sync summary.")
														? "Partial API history; check sync notes and balance check in Connections."
														: (conn.lastSyncError ??
															"Last sync did not complete.")}
												</td>
												<td className="px-4 py-2.5 text-right whitespace-nowrap">
													<Link
														href="/connections"
														className="inline-flex items-center gap-1 rounded bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent-text)] hover:underline"
													>
														{conn.lastSyncStatus === "failed"
															? "Fix in Connections"
															: "Review in Connections"}
														<ArrowRight
															className="h-3 w-3"
															aria-hidden="true"
														/>
													</Link>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</section>
					) : null}
					{actionGroups.map((group) => renderGroup(group, false))}
					{noteGroups.length > 0 ? (
						<details className="group rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
							<summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 hover:bg-[var(--bg-hover)]/60">
								<span className="flex flex-wrap items-center gap-2">
									<span className="text-sm font-semibold">
										Notes about your files
									</span>
									<Badge tone="neutral">
										<span className="num">{noteTotal}</span>{" "}
										{pluralise(noteTotal, "note")}
									</Badge>
								</span>
								<ChevronDown
									className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-180"
									aria-hidden="true"
								/>
							</summary>
							<div className="space-y-4 border-t border-[var(--border)] p-4">
								<p className="text-xs text-[var(--text-secondary)]">
									How your files were read. Nothing here needs action and none
									of it counts as a review item.
								</p>
								{noteGroups.map((group) => renderGroup(group, true))}
							</div>
						</details>
					) : null}
					{reportNoteGroups.length > 0 ? (
						<details className="group rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
							<summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 hover:bg-[var(--bg-hover)]/60">
								<span className="flex flex-wrap items-center gap-2">
									<span className="text-sm font-semibold">Report notes</span>
									<Badge tone="neutral">
										<span className="num">{reportNoteTotal}</span>{" "}
										{pluralise(reportNoteTotal, "note")}
									</Badge>
								</span>
								<ChevronDown
									className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-180"
									aria-hidden="true"
								/>
							</summary>
							<div className="space-y-4 border-t border-[var(--border)] p-4">
								<p className="text-xs text-[var(--text-secondary)]">
									About the computed report, not your files. Nothing here needs
									action and none of it counts as a review item.
								</p>
								{reportNoteGroups.map((group) => renderGroup(group, true))}
							</div>
						</details>
					) : null}
				</div>
			)}

			<ConfirmDialog
				open={confirmGroup !== null}
				title={
					confirmGroup
						? `Mark all ${confirmGroup.count} ${pluralise(confirmGroup.count, "item")} as checked?`
						: ""
				}
				description={`This only records that you have looked at ${
					confirmGroup
						? `the "${REVIEW_CODE_INFO[confirmGroup.code].title}" items`
						: "these items"
				}. It does not change any tax figure, and your checks are kept when you recompute the report.`}
				confirmLabel="Mark all as checked"
				busy={resolving}
				onConfirm={() =>
					confirmGroup && resolveItems(confirmGroup, { all: true })
				}
				onCancel={() => setConfirmGroup(null)}
			/>

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
