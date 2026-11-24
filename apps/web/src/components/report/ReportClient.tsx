"use client";

import {
	type ActualBalance,
	D,
	type ScheduleVdaRow,
	type VdaReport,
} from "@tax/core";
import {
	Calculator,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Download,
	FileSpreadsheet,
	Info,
	RefreshCw,
	Save,
	Upload,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TrySampleDataButton } from "@/components/demo/TrySampleDataButton";
import { StaleReportBanner } from "@/components/report/StaleReportBanner";
import { TrailDrawer } from "@/components/report/TrailDrawer";
import { UnresolvedSalesSection } from "@/components/report/UnresolvedSalesSection";
import { Badge } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { TaxYearSelect } from "@/components/ui/TaxYearSelect";
import {
	ApiError,
	api,
	type BalanceSnapshotWithComparison,
	getErrorMessage,
	type JobStatus,
	type PriceFillSummary,
	type PricesStatus,
	REPORT_NOT_COMPUTED,
	type ReportMissingDetails,
} from "@/lib/client/api";
import {
	formatEngineSettingLabel,
	formatEngineSettingValue,
	formatExcludedReason,
	formatIncomeKind,
	formatIncompleteSummary,
	formatInr,
	formatInrNullable,
	formatIstDate,
	formatQty,
	formatReportMissingState,
	formatSectionLabel,
	formatSourceLabel,
	formatTxType,
	isPositiveDecimal,
	isReportIncomplete,
	isZeroDecimal,
	pluralise,
} from "@/lib/client/format";
import { useScrollToHash } from "@/lib/client/useScrollToHash";
import { useSelectedTaxYear } from "@/lib/client/useSelectedTaxYear";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

function balanceKey(asset: string, source?: string): string {
	return `${asset}::${source ?? ""}`;
}

interface GroupedWarning {
	code: VdaReport["warnings"][number]["code"];
	message: string;
	asset?: string;
	source?: string;
	count: number;
	txIds: string[];
}

function groupReportWarnings(
	warnings: VdaReport["warnings"],
): GroupedWarning[] {
	const byKey = new Map<string, GroupedWarning & { txIdSet: Set<string> }>();
	for (const w of warnings) {
		const key = `${w.code}\0${w.message}\0${w.asset ?? ""}\0${w.source ?? ""}`;
		let entry = byKey.get(key);
		if (!entry) {
			entry = {
				code: w.code,
				message: w.message,
				...(w.asset ? { asset: w.asset } : {}),
				...(w.source ? { source: w.source } : {}),
				count: 0,
				txIds: [],
				txIdSet: new Set<string>(),
			};
			byKey.set(key, entry);
		}
		entry.count += w.count ?? 1;
		if (w.txId) entry.txIdSet.add(w.txId);
		if (w.txIds) {
			for (const id of w.txIds) entry.txIdSet.add(id);
		}
	}
	return [...byKey.values()].map(({ txIdSet, ...rest }) => ({
		...rest,
		txIds: [...txIdSet],
	}));
}

function warningTxHref(
	taxYear: string,
	txIds: string[],
	ledger: VdaReport["ledger"],
	asset?: string,
	source?: string,
): string | null {
	if (txIds.length === 0) return null;
	if (txIds.length === 1) {
		const tx = ledger.find((t) => t.id === txIds[0]);
		const params = new URLSearchParams({ taxYear });
		if (tx) params.set("q", tx.sourceRef);
		else {
			params.set("flagged", "true");
			if (asset) params.set("asset", asset);
			if (source) params.set("source", source);
		}
		return `/transactions?${params.toString()}`;
	}
	const matching = ledger.filter((t) => txIds.includes(t.id));
	const sources = new Set(matching.map((t) => t.source));
	const params = new URLSearchParams({ taxYear, flagged: "true" });
	if (asset) params.set("asset", asset);
	if (source) {
		params.set("source", source);
	} else if (sources.size === 1) {
		const only = [...sources][0];
		if (only) params.set("source", only);
	}
	return `/transactions?${params.toString()}`;
}

export function ReportClient() {
	const sourceLabel = useSourceLabel();
	const { taxYear, taxYears, selectTaxYear } = useSelectedTaxYear("/report");
	const [report, setReport] = useState<VdaReport | null>(null);
	const [reportMissing, setReportMissing] =
		useState<ReportMissingDetails | null>(null);
	const [actualDrafts, setActualDrafts] = useState<Record<string, string>>({});
	const [checkedChecklist, setCheckedChecklist] = useState<
		Record<string, boolean>
	>({});
	const [loading, setLoading] = useState(true);
	const [computing, setComputing] = useState(false);
	const [savingBalances, setSavingBalances] = useState(false);
	const [balanceSavedMsg, setBalanceSavedMsg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [trailRow, setTrailRow] = useState<ScheduleVdaRow | null>(null);
	const [incomeRawInspect, setIncomeRawInspect] = useState<{
		title: string;
		raw: unknown;
	} | null>(null);

	const [pricesStatus, setPricesStatus] = useState<PricesStatus | null>(null);
	const [snapshots, setSnapshots] = useState<BalanceSnapshotWithComparison[]>(
		[],
	);
	const [applyingSnapshotId, setApplyingSnapshotId] = useState<string | null>(
		null,
	);
	const [snapshotNotices, setSnapshotNotices] = useState<
		Record<string, { tone: "info" | "positive" | "error"; message: string }>
	>({});
	const [priceFillRunning, setPriceFillRunning] = useState(false);
	const [priceFillJob, setPriceFillJob] = useState<JobStatus | null>(null);
	const [priceFillResult, setPriceFillResult] =
		useState<PriceFillSummary | null>(null);
	const [priceFillAutoRecomputed, setPriceFillAutoRecomputed] = useState(false);
	const [priceFillError, setPriceFillError] = useState<string | null>(null);
	const [missingExpanded, setMissingExpanded] = useState(false);
	const [ledgerEmpty, setLedgerEmpty] = useState(false);
	const [reportStale, setReportStale] = useState(false);

	useScrollToHash(!loading && report !== null);

	const mountedRef = useRef(true);
	const activeTaxYearRef = useRef(taxYear);
	const pricePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		activeTaxYearRef.current = taxYear;
	}, [taxYear]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			if (pricePollRef.current) {
				clearTimeout(pricePollRef.current);
				pricePollRef.current = null;
			}
		};
	}, []);

	const loadReport = useCallback(async (year: string) => {
		if (pricePollRef.current) {
			clearTimeout(pricePollRef.current);
			pricePollRef.current = null;
		}
		setLoading(true);
		setError(null);
		setBalanceSavedMsg(null);
		setSnapshotNotices({});
		setPriceFillRunning(false);
		setPriceFillJob(null);
		setPriceFillResult(null);
		setPriceFillAutoRecomputed(false);
		setPriceFillError(null);
		setMissingExpanded(false);
		try {
			const txPage = await api
				.listTransactions({ page: 1, pageSize: 1 })
				.catch(() => null);
			const [repState, savedActuals, pStatus, snapList, review] =
				await Promise.all([
					txPage?.total === 0
						? Promise.resolve(REPORT_NOT_COMPUTED)
						: api.getReportState(year),
					api.getActualBalances(year).catch(() => []),
					api.getPricesStatus(year).catch(() => null),
					api.listBalanceSnapshots().catch(() => []),
					api.getReview(year).catch(() => null),
				]);
			if (!mountedRef.current) return;
			setLedgerEmpty(txPage?.total === 0);
			const rep = repState.status === "ready" ? repState.report : null;
			setReportStale(rep?.stale === true || review?.reportStatus === "stale");
			setReport(rep);
			setReportMissing(repState.status === "missing" ? repState.missing : null);
			setPricesStatus(pStatus);
			setSnapshots(snapList);

			const drafts: Record<string, string> = {};
			if (rep) {
				for (const b of rep.balances) {
					if (b.actual !== undefined) {
						drafts[balanceKey(b.asset, b.source)] = b.actual;
					}
				}
			}
			for (const a of savedActuals) {
				drafts[balanceKey(a.asset, a.source)] = a.amount;
			}
			setActualDrafts(drafts);
		} catch (err) {
			if (!mountedRef.current) return;
			setError(getErrorMessage(err));
		} finally {
			if (mountedRef.current) setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (taxYear) loadReport(taxYear);
	}, [taxYear, loadReport]);

	async function handleCompute() {
		setComputing(true);
		setError(null);
		setBalanceSavedMsg(null);
		try {
			const [rep, pStatus] = await Promise.all([
				api.computeReport(taxYear),
				api.getPricesStatus(taxYear).catch(() => null),
			]);
			if (!mountedRef.current) return;
			setReport(rep);
			setReportStale(false);
			setReportMissing(null);
			if (pStatus) setPricesStatus(pStatus);
		} catch (err) {
			if (!mountedRef.current) return;
			setError(getErrorMessage(err));
		} finally {
			if (mountedRef.current) setComputing(false);
		}
	}

	function pollPriceJob(jobId: string, year: string) {
		if (pricePollRef.current) clearTimeout(pricePollRef.current);

		const tick = async () => {
			if (!mountedRef.current || activeTaxYearRef.current !== year) return;
			try {
				const job = await api.getJob(jobId);
				if (!mountedRef.current || activeTaxYearRef.current !== year) return;

				if (job.status === "pending" || job.status === "running") {
					setPriceFillJob(job);
					pricePollRef.current = setTimeout(tick, 1000);
					return;
				}

				pricePollRef.current = null;
				setPriceFillJob(null);

				if (job.status === "completed") {
					const fillResult =
						job.result && "fromCache" in job.result ? job.result : null;
					if (fillResult && fillResult.fetched > 0) {
						try {
							const [rep, pStatus] = await Promise.all([
								api.computeReport(year),
								api.getPricesStatus(year).catch(() => null),
							]);
							if (!mountedRef.current || activeTaxYearRef.current !== year)
								return;
							setReport(rep);
							setReportStale(false);
							setReportMissing(null);
							if (pStatus) setPricesStatus(pStatus);
							setPriceFillResult(fillResult);
							setPriceFillAutoRecomputed(true);
						} catch (refreshErr) {
							if (!mountedRef.current || activeTaxYearRef.current !== year)
								return;
							const pStatus = await api.getPricesStatus(year).catch(() => null);
							if (mountedRef.current && activeTaxYearRef.current === year) {
								if (pStatus) setPricesStatus(pStatus);
								setPriceFillResult(fillResult);
								setPriceFillAutoRecomputed(false);
								setPriceFillError(getErrorMessage(refreshErr));
							}
						} finally {
							if (mountedRef.current && activeTaxYearRef.current === year) {
								setPriceFillRunning(false);
							}
						}
					} else {
						setPriceFillRunning(false);
						if (fillResult) setPriceFillResult(fillResult);
						setPriceFillAutoRecomputed(false);
						const pStatus = await api.getPricesStatus(year).catch(() => null);
						if (
							mountedRef.current &&
							activeTaxYearRef.current === year &&
							pStatus
						) {
							setPricesStatus(pStatus);
						}
					}
				} else if (job.status === "failed") {
					setPriceFillRunning(false);
					setPriceFillError(job.error ?? "Failed to fetch missing prices.");
				}
			} catch (err) {
				if (!mountedRef.current || activeTaxYearRef.current !== year) return;
				pricePollRef.current = null;
				setPriceFillRunning(false);
				setPriceFillJob(null);
				setPriceFillError(getErrorMessage(err));
			}
		};

		pricePollRef.current = setTimeout(tick, 1000);
	}

	async function handleFetchMissingPrices() {
		setPriceFillRunning(true);
		setPriceFillError(null);
		setPriceFillResult(null);
		setPriceFillAutoRecomputed(false);
		setPriceFillJob(null);
		try {
			const { jobId } = await api.fillPrices(taxYear);
			if (!mountedRef.current) return;
			pollPriceJob(jobId, taxYear);
		} catch (err) {
			if (!mountedRef.current) return;
			setPriceFillRunning(false);
			setPriceFillError(getErrorMessage(err));
		}
	}

	async function handleSaveBalances() {
		if (!report) return;
		setSavingBalances(true);
		setError(null);
		setBalanceSavedMsg(null);
		try {
			const payload: ActualBalance[] = [];
			for (const row of report.balances) {
				const raw = actualDrafts[balanceKey(row.asset, row.source)]?.trim();
				if (raw) {
					payload.push({
						asset: row.asset,
						...(row.source ? { source: row.source } : {}),
						amount: raw,
					});
				}
			}
			await api.putActualBalances(taxYear, payload);
			const rep = await api.computeReport(taxYear);
			setReport(rep);
			setReportStale(false);
			setReportMissing(null);
			setBalanceSavedMsg(
				"Actual balances saved and reconciliation checks updated.",
			);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setSavingBalances(false);
		}
	}

	async function handleApplySnapshot(snap: BalanceSnapshotWithComparison) {
		setApplyingSnapshotId(snap.id);
		setSnapshotNotices((prev) => {
			const next = { ...prev };
			delete next[snap.id];
			return next;
		});
		try {
			const savedActuals = await api.applyBalanceSnapshot(snap.id, taxYear);
			if (!mountedRef.current) return;

			const drafts: Record<string, string> = {};
			for (const a of savedActuals) {
				drafts[balanceKey(a.asset, a.source)] = a.amount;
			}
			setActualDrafts((prev) => ({ ...prev, ...drafts }));

			if (report) {
				const rep = await api.computeReport(taxYear);
				if (!mountedRef.current) return;
				setReport(rep);
				setReportStale(false);
				setReportMissing(null);
			}
			setSnapshotNotices((prev) => ({
				...prev,
				[snap.id]: {
					tone: "positive",
					message: report
						? `Applied ${formatSourceLabel(snap.venue)} statement balances (${formatIstDate(snap.asOf)}) as actual balances for ${taxYear} and updated reconciliation.`
						: `Saved ${formatSourceLabel(snap.venue)} statement balances (${formatIstDate(snap.asOf)}) as actual balances for ${taxYear}. Compute the report to review year-end reconciliation.`,
				},
			}));
		} catch (err) {
			if (!mountedRef.current) return;
			if (err instanceof ApiError && err.code === "snapshot_not_year_end") {
				setSnapshotNotices((prev) => ({
					...prev,
					[snap.id]: {
						tone: "info",
						message: `This statement is dated ${formatIstDate(snap.asOf)} (${snap.asOf}). To use it as actual balances for ${taxYear}, the statement must be dated at the tax year end (31 March).`,
					},
				}));
			} else {
				setSnapshotNotices((prev) => ({
					...prev,
					[snap.id]: {
						tone: "error",
						message: getErrorMessage(err),
					},
				}));
			}
		} finally {
			if (mountedRef.current) setApplyingSnapshotId(null);
		}
	}

	function renderStatementsSection() {
		return (
			<div id="statements" className="space-y-3 pt-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h3 className="text-sm font-semibold tracking-tight">
							Statements ({snapshots.length})
						</h3>
						<p className="text-xs text-[var(--text-secondary)]">
							Imported PDF balance statements compared against computed ledger
							holdings at the statement&apos;s as-of date.
						</p>
					</div>
					<Link
						href="/import"
						className="text-xs font-medium text-[var(--accent-text)] hover:underline"
					>
						Import PDF statement
					</Link>
				</div>

				{snapshots.length === 0 ? (
					<div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-4 text-xs text-[var(--text-muted)]">
						No balance statements imported yet. Upload a Binance PDF account
						statement on the Import page to compare statement vs computed
						balances.
					</div>
				) : (
					<div className="space-y-4">
						{snapshots.map((snap) => {
							const notice = snapshotNotices[snap.id];
							const isApplying = applyingSnapshotId === snap.id;
							return (
								<div
									key={snap.id}
									className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4"
								>
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div>
											<div className="flex flex-wrap items-center gap-2">
												<h4 className="text-sm font-semibold">
													{formatSourceLabel(snap.venue)}
												</h4>
												<Badge tone="neutral">
													As of {formatIstDate(snap.asOf)}
												</Badge>
												<span className="num text-xs text-[var(--text-muted)]">
													{snap.asOf} ({snap.timezone})
												</span>
											</div>
										</div>
										<button
											type="button"
											disabled={isApplying}
											onClick={() => handleApplySnapshot(snap)}
											className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
										>
											<Save className="h-3.5 w-3.5" aria-hidden="true" />
											{isApplying
												? "Applying…"
												: `Use as actual balances for ${taxYear}`}
										</button>
									</div>

									{notice ? (
										<div
											aria-live="polite"
											className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${
												notice.tone === "positive"
													? "border-[var(--positive)]/40 bg-[var(--positive-soft)] text-[var(--positive)]"
													: notice.tone === "error"
														? "border-[var(--loss)]/40 bg-[var(--loss-soft)] text-[var(--loss)]"
														: "border-[var(--border-strong)] bg-[var(--bg-subtle)] text-[var(--text-primary)]"
											}`}
										>
											{notice.tone === "positive" ? (
												<CheckCircle2
													className="mt-0.5 h-3.5 w-3.5 shrink-0"
													aria-hidden="true"
												/>
											) : (
												<Info
													className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]"
													aria-hidden="true"
												/>
											)}
											<span>{notice.message}</span>
										</div>
									) : null}

									<div className="overflow-x-auto rounded border border-[var(--border)]">
										<table className="w-full border-collapse text-left text-xs">
											<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
												<tr>
													<th className="px-3 py-2 font-medium">Asset</th>
													<th className="num-right px-3 py-2 font-medium">
														Statement
													</th>
													<th className="num-right px-3 py-2 font-medium">
														Computed
													</th>
													<th className="num-right px-3 py-2 font-medium">
														Difference
													</th>
												</tr>
											</thead>
											<tbody>
												{snap.comparison.length === 0 ? (
													<tr>
														<td
															colSpan={4}
															className="px-3 py-4 text-center text-[var(--text-muted)]"
														>
															No assets to compare.
														</td>
													</tr>
												) : (
													snap.comparison.map((row) => {
														const hasDiff = !isZeroDecimal(row.difference);
														return (
															<tr
																key={row.asset}
																className={`border-b border-[var(--border)] last:border-b-0 ${
																	hasDiff ? "bg-[var(--warning-soft)]/50" : ""
																}`}
															>
																<td className="px-3 py-2 font-semibold">
																	{row.asset}
																</td>
																<td className="num-right px-3 py-2">
																	{formatQty(row.statement)}
																</td>
																<td className="num-right px-3 py-2">
																	{formatQty(row.computed)}
																</td>
																<td
																	className={`num-right px-3 py-2 ${
																		hasDiff
																			? "font-semibold text-[var(--warning)]"
																			: "text-[var(--text-muted)]"
																	}`}
																>
																	{formatQty(row.difference)}
																</td>
															</tr>
														);
													})
												)}
											</tbody>
										</table>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title="Schedule VDA &amp; Tax Report"
				description="ITR-ready Schedule VDA rows, TDS summary, income &amp; gifts, and year-end balances."
				actions={
					<>
						<TaxYearSelect
							value={taxYear}
							onChange={selectTaxYear}
							taxYears={taxYears}
						/>
						<button
							type="button"
							disabled={computing}
							onClick={handleCompute}
							className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
						>
							<Calculator className="h-4 w-4" aria-hidden="true" />
							{computing
								? "Computing…"
								: report
									? "Recompute report"
									: "Compute report"}
						</button>
					</>
				}
			/>

			{error ? (
				<ErrorBanner message={error} onRetry={() => loadReport(taxYear)} />
			) : null}

			{report && reportStale ? (
				<StaleReportBanner computing={computing} onRecompute={handleCompute} />
			) : null}

			{/* Prices status line */}
			{pricesStatus ? (
				<section className="space-y-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-xs">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
							<span className="font-semibold text-[var(--text-primary)]">
								Market prices ({taxYear})
							</span>
							<span className="num text-[var(--text-secondary)]">
								Needed: <strong>{pricesStatus.needed}</strong>
							</span>
							<span className="num text-[var(--positive)]">
								Cached: <strong>{pricesStatus.cached}</strong>
							</span>
							<span
								className={`num ${
									pricesStatus.missing.length > 0
										? "text-[var(--warning)]"
										: "text-[var(--text-secondary)]"
								}`}
							>
								Missing: <strong>{pricesStatus.missing.length}</strong>
							</span>
							{pricesStatus.missing.length > 0 ? (
								<button
									type="button"
									aria-expanded={missingExpanded}
									onClick={() => setMissingExpanded((prev) => !prev)}
									className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline"
								>
									{missingExpanded ? (
										<>
											Hide missing
											<ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
										</>
									) : (
										<>
											Show missing ({pricesStatus.missing.length})
											<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
										</>
									)}
								</button>
							) : null}
						</div>

						<div className="flex flex-wrap items-center gap-3">
							{!pricesStatus.enabled ? (
								<span className="text-[var(--text-secondary)]">
									Price lookups are off —{" "}
									<Link
										href="/settings"
										className="font-medium text-[var(--accent-text)] underline"
									>
										enable in Settings
									</Link>
								</span>
							) : null}
							<button
								type="button"
								disabled={
									!pricesStatus.enabled ||
									priceFillRunning ||
									pricesStatus.missing.length === 0
								}
								title={
									!pricesStatus.enabled
										? "Price lookups are off in Settings."
										: pricesStatus.missing.length === 0
											? "No missing prices for this tax year."
											: undefined
								}
								onClick={handleFetchMissingPrices}
								className="inline-flex items-center gap-1.5 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 py-1.5 font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
							>
								<RefreshCw
									className={`h-3.5 w-3.5 ${priceFillRunning ? "animate-spin" : ""}`}
									aria-hidden="true"
								/>
								{priceFillRunning ? "Fetching prices…" : "Fetch missing prices"}
							</button>
						</div>
					</div>

					{priceFillRunning ? (
						<div
							aria-live="polite"
							className="rounded border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1.5 text-[var(--accent-text)]"
						>
							{priceFillJob?.progress
								? `Fetching prices (${priceFillJob.progress.stream}) · ${priceFillJob.progress.streamsDone}${
										priceFillJob.progress.streamsTotal !== null
											? `/${priceFillJob.progress.streamsTotal}`
											: ""
									}`
								: "Fetching missing historical prices…"}
						</div>
					) : null}

					{priceFillError ? <ErrorBanner message={priceFillError} /> : null}

					{priceFillResult ? (
						<p
							aria-live="polite"
							className="flex flex-wrap items-center gap-2 rounded border border-[var(--positive)]/35 bg-[var(--positive-soft)] px-3 py-1.5 text-[var(--positive)]"
						>
							<CheckCircle2
								className="h-3.5 w-3.5 shrink-0"
								aria-hidden="true"
							/>
							<span>
								Price lookup complete: {priceFillResult.fetched} fetched,{" "}
								{priceFillResult.fromCache} already cached
								{priceFillResult.missing.length > 0
									? `, ${priceFillResult.missing.length} still missing`
									: ""}
								{priceFillAutoRecomputed
									? " — report updated."
									: ". Recompute the report to apply updated valuations."}
							</span>
						</p>
					) : null}

					{missingExpanded && pricesStatus.missing.length > 0 ? (
						<div className="max-h-40 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5">
							<ul className="flex flex-wrap gap-1.5">
								{pricesStatus.missing.map((m) => (
									<li
										key={`${m.asset}:${m.date}`}
										className="font-mono-code rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px]"
									>
										{m.asset} · {formatIstDate(m.date)}
									</li>
								))}
							</ul>
						</div>
					) : null}
				</section>
			) : null}

			{loading ? (
				<div className="h-64 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			) : !report ? (
				(() => {
					const missingCopy = formatReportMissingState(
						reportMissing,
						taxYear,
						"report",
					);
					const emptyState = ledgerEmpty ? (
						<EmptyState
							icon={<Upload className="h-8 w-8" />}
							title="No transactions yet — import an export file"
							description="The report is built from your ledger. Import a Binance, CoinDCX, or CSV export, or load sample data to see a full report first."
							action={
								<div className="flex flex-wrap justify-center gap-3">
									<Link
										href="/import"
										className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
									>
										<Upload className="h-4 w-4" aria-hidden="true" />
										Import file
									</Link>
									<TrySampleDataButton />
								</div>
							}
						/>
					) : (
						<EmptyState
							icon={<FileSpreadsheet className="h-8 w-8" />}
							title={missingCopy.title}
							description={missingCopy.description}
							action={
								<button
									type="button"
									disabled={computing}
									onClick={handleCompute}
									className="shrink-0 whitespace-nowrap inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
								>
									<Calculator className="h-4 w-4" aria-hidden="true" />
									{computing ? "Computing…" : `Compute ${taxYear} report`}
								</button>
							}
						/>
					);
					return (
						<div className="space-y-6">
							{emptyState}
							{snapshots.length > 0 ? renderStatementsSection() : null}
						</div>
					);
				})()
			) : (
				<>
					{/* Exports & Legal Section Labels */}
					<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
						<div className="flex flex-wrap items-start justify-between gap-4">
							<div className="space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<h2 className="text-sm font-semibold">{report.act}</h2>
									{report.includesDemoData ? (
										<Badge tone="warning">Includes sample data</Badge>
									) : null}
									{!report.sectionsVerified ? (
										<Badge tone="warning">Pending CA verification</Badge>
									) : (
										<Badge tone="positive">Sections verified</Badge>
									)}
								</div>
								<p className="text-xs text-[var(--text-secondary)]">
									Rule file:{" "}
									<code className="font-mono-code">
										{report.generatedFrom.ruleFile}
									</code>{" "}
									· {report.generatedFrom.txCount}{" "}
									{pluralise(report.generatedFrom.txCount, "transaction")}{" "}
									evaluated
								</p>
							</div>

							{/* Export buttons */}
							<div className="flex flex-wrap gap-2">
								{(
									[
										{ kind: "schedule-vda", label: "Schedule VDA" },
										{ kind: "tds", label: "TDS" },
										{ kind: "income", label: "Income" },
										{ kind: "full", label: "Full Report" },
									] as const
								).map((exp) => (
									<div
										key={exp.kind}
										className="inline-flex items-center overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-canvas)] text-xs"
									>
										<span className="px-2.5 py-1 font-medium text-[var(--text-secondary)]">
											{exp.label}
										</span>
										<a
											href={api.getExportUrl(taxYear, "csv", exp.kind)}
											download
											aria-label={`Download ${exp.label} as CSV`}
											className="inline-flex items-center gap-1 border-l border-[var(--border)] px-2 py-1 font-medium text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
										>
											<Download className="h-3 w-3" aria-hidden="true" />
											CSV
										</a>
										<a
											href={api.getExportUrl(taxYear, "xlsx", exp.kind)}
											download
											aria-label={`Download ${exp.label} as XLSX`}
											className="inline-flex items-center gap-1 border-l border-[var(--border)] px-2 py-1 font-medium text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
										>
											XLSX
										</a>
									</div>
								))}
							</div>
						</div>

						{/* Section labels */}
						<div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3 text-xs">
							{Object.entries(report.sections).map(([k, v]) => (
								<div
									key={k}
									className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 py-1"
								>
									<span className="text-[var(--text-muted)]">
										{formatSectionLabel(k)}:{" "}
									</span>
									<span className="font-medium">{v}</span>
								</div>
							))}
						</div>
					</section>

					{/* Totals strip */}
					<section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
						{[
							{
								label: "Consideration",
								val: formatInr(report.totals.consideration),
							},
							{ label: "Cost", val: formatInr(report.totals.cost) },
							{
								label: "Taxable Income",
								val: formatInr(report.totals.taxableIncome),
							},
							{
								label: "Total Tax",
								val: formatInr(report.totals.totalTax),
							},
							{
								label: "TDS Credit",
								val: formatInr(report.totals.tdsCredit),
								tone: "positive" as const,
							},
							isReportIncomplete(report)
								? {
										label: "Net Payable",
										val: "Incomplete",
										tone: "loss" as const,
										note: formatIncompleteSummary(report),
									}
								: {
										label: "Net Payable",
										val: formatInr(report.totals.netPayable),
									},
						].map((item) => (
							<div
								key={item.label}
								className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3"
							>
								<p className="text-xs text-[var(--text-secondary)]">
									{item.label}
								</p>
								<p
									className={`num mt-1 text-base font-semibold ${
										item.tone === "positive"
											? "text-[var(--positive)]"
											: item.tone === "loss"
												? "text-[var(--loss)]"
												: ""
									}`}
								>
									{item.val}
								</p>
								{"note" in item ? (
									<p className="mt-1 text-[11px] leading-snug text-[var(--text-secondary)]">
										{item.note}
									</p>
								) : null}
							</div>
						))}
					</section>

					{report.unresolved.length > 0 ? (
						<UnresolvedSalesSection report={report} taxYear={taxYear} />
					) : null}

					{/* Excluded rows (e.g. spam tokens) */}
					{report.excluded.length > 0 ? (
						<section
							id="excluded"
							className="space-y-3 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-4"
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<Info
										className="h-4 w-4 text-[var(--warning)]"
										aria-hidden="true"
									/>
									<h2 className="text-sm font-semibold text-[var(--text-primary)]">
										Excluded Transactions ({report.excluded.length}) — Left Out
										of Tax Calculation
									</h2>
								</div>
								<Link
									href={`/review?taxYear=${encodeURIComponent(taxYear)}`}
									className="text-xs font-medium text-[var(--accent-text)] underline"
								>
									Inspect in Review Queue
								</Link>
							</div>
							<div className="overflow-x-auto rounded border border-[var(--warning)]/25 bg-[var(--bg-surface)]">
								<table className="w-full border-collapse text-left text-xs">
									<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
										<tr>
											<th className="px-3 py-2 font-medium">Transaction</th>
											<th className="px-3 py-2 font-medium">Reason</th>
											<th className="px-3 py-2 text-right font-medium">
												Inspect
											</th>
										</tr>
									</thead>
									<tbody>
										{report.excluded.map((ex) => {
											const tx = report.ledger.find((t) => t.id === ex.txId);
											const txHref = tx
												? `/transactions?taxYear=${encodeURIComponent(taxYear)}&q=${encodeURIComponent(tx.sourceRef)}`
												: `/transactions?taxYear=${encodeURIComponent(taxYear)}&flagged=true`;
											return (
												<tr
													key={`${ex.txId}:${ex.reason}`}
													className="border-b border-[var(--border)] last:border-b-0"
												>
													<td className="px-3 py-2">
														{tx ? (
															<div className="space-y-0.5">
																<p className="font-medium text-[var(--text-primary)]">
																	{formatTxType(tx.type)} ·{" "}
																	{tx.assetIn
																		? `${formatQty(tx.amountIn)} ${tx.assetIn}`
																		: tx.assetOut
																			? `${formatQty(tx.amountOut)} ${tx.assetOut}`
																			: tx.sourceRef}
																</p>
																<p className="text-[11px] text-[var(--text-secondary)]">
																	{formatIstDate(tx.timestamp)} ·{" "}
																	{sourceLabel(tx.source)}
																</p>
															</div>
														) : (
															<code className="font-mono-code text-[11px]">
																{ex.txId}
															</code>
														)}
													</td>
													<td className="px-3 py-2 text-[var(--text-secondary)]">
														{formatExcludedReason(ex.reason)}
													</td>
													<td className="px-3 py-2 text-right whitespace-nowrap">
														<Link
															href={txHref}
															className="font-medium text-[var(--accent-text)] hover:underline"
														>
															View transaction
														</Link>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						</section>
					) : null}

					{/* Schedule VDA Table */}
					<section className="space-y-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h2 className="text-base font-semibold tracking-tight">
								Schedule VDA ({report.scheduleVdaRows.length}{" "}
								{pluralise(report.scheduleVdaRows.length, "row")})
							</h2>
							<p className="text-xs text-[var(--text-secondary)]">
								Losses not set off:{" "}
								<span className="num font-semibold text-[var(--loss)]">
									{formatInr(report.totals.lossesNotSetOff)}
								</span>
							</p>
						</div>

						{report.scheduleVdaRows.length === 0 ? (
							report.unresolved.length > 0 ? (
								(() => {
									const excludedSales = new Set(
										report.unresolved.map((u) => u.txId),
									).size;
									return (
										<EmptyState
											title="No resolved Schedule VDA rows yet"
											description={`No resolved Schedule VDA rows yet — ${excludedSales} ${pluralise(excludedSales, "sale is", "sales are")} excluded above until acquisition cost is added.`}
										/>
									);
								})()
							) : (
								<EmptyState
									title="No VDA disposals in this tax year"
									description="No taxable sells or crypto-to-crypto swaps occurred between 1 April and 31 March."
								/>
							)
						) : (
							<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
								<div className="overflow-x-auto">
									<table className="w-full border-collapse text-left text-xs sm:text-sm">
										<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
											<tr>
												<th className="px-3 py-2.5 font-medium whitespace-nowrap">
													Date of Acquisition
												</th>
												<th className="px-3 py-2.5 font-medium whitespace-nowrap">
													Date of Transfer
												</th>
												<th className="px-3 py-2.5 font-medium whitespace-nowrap">
													Head of Income
												</th>
												<th className="px-3 py-2.5 font-medium whitespace-nowrap">
													Asset &amp; Qty
												</th>
												<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
													Cost of Acquisition
												</th>
												<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
													Consideration Received
												</th>
												<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
													Income
												</th>
												<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
													Loss
												</th>
												<th className="px-3 py-2.5 text-right font-medium">
													Trail
												</th>
											</tr>
										</thead>
										<tbody>
											{report.scheduleVdaRows.map((row) => {
												const hasLoss = isPositiveDecimal(row.loss);
												return (
													<tr
														key={`${row.trail.disposalTxId}:${row.dateOfAcquisition ?? "unk"}:${row.quantity}:${row.trail.lotTxIds.join(",")}`}
														className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60"
													>
														<td className="px-3 py-2.5 whitespace-nowrap">
															{row.dateOfAcquisition ? (
																formatIstDate(row.dateOfAcquisition)
															) : (
																<Badge tone="loss">Unknown</Badge>
															)}
														</td>
														<td className="px-3 py-2.5 whitespace-nowrap">
															{formatIstDate(row.dateOfTransfer)}
														</td>
														<td className="px-3 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
															{row.headOfIncome === "capital_gains"
																? "Capital Gains"
																: "Business"}
														</td>
														<td className="num px-3 py-2.5 whitespace-nowrap">
															<span className="font-medium">{row.asset}</span>{" "}
															<span className="text-xs text-[var(--text-secondary)]">
																{formatQty(row.quantity)}
															</span>
														</td>
														<td className="num-right px-3 py-2.5 whitespace-nowrap">
															{row.costOfAcquisition !== null ? (
																formatInr(row.costOfAcquisition)
															) : (
																<span className="text-[var(--loss)]">
																	Missing
																</span>
															)}
														</td>
														<td className="num-right px-3 py-2.5 whitespace-nowrap">
															{row.considerationReceived !== null ? (
																formatInr(row.considerationReceived)
															) : (
																<span className="text-[var(--loss)]">
																	Missing
																</span>
															)}
														</td>
														<td className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
															{formatInrNullable(row.income)}
														</td>
														<td
															className={`num-right px-3 py-2.5 whitespace-nowrap ${
																hasLoss
																	? "font-medium text-[var(--loss)]"
																	: "text-[var(--text-muted)]"
															}`}
														>
															{formatInrNullable(row.loss)}
														</td>
														<td className="px-3 py-2.5 text-right whitespace-nowrap">
															<button
																type="button"
																onClick={() => setTrailRow(row)}
																className="rounded border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
															>
																Trail
															</button>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							</div>
						)}
					</section>

					{/* TDS Section */}
					<section id="tds" className="space-y-3">
						<h2 className="text-base font-semibold tracking-tight">
							TDS Summary &amp; Form 26AS / AIS Reconciliation
						</h2>
						<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
							<div className="overflow-x-auto">
								<table className="w-full border-collapse text-left text-sm">
									<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
										<tr>
											<th className="px-4 py-2.5 font-medium">Source</th>
											<th className="px-4 py-2.5 font-medium">
												Platform Deducts TDS
											</th>
											<th className="num-right px-4 py-2.5 font-medium">
												Gross Transfer Value
											</th>
											<th className="num-right px-4 py-2.5 font-medium">
												TDS Deducted
											</th>
											<th className="num-right px-4 py-2.5 font-medium">
												TDS Possibly Due
											</th>
										</tr>
									</thead>
									<tbody>
										{report.tds.bySource.length === 0 ? (
											<tr>
												<td
													colSpan={5}
													className="px-4 py-6 text-center text-xs text-[var(--text-muted)]"
												>
													No VDA transfers recorded in this tax year.
												</td>
											</tr>
										) : (
											report.tds.bySource.map((src) => {
												const possiblyDuePositive = isPositiveDecimal(
													src.possiblyDueInr,
												);
												const shortfall = D(src.possiblyDueInr).minus(
													src.tdsInr,
												);
												const coveredByRecorded =
													possiblyDuePositive &&
													shortfall.lte("0") &&
													isPositiveDecimal(src.tdsInr);
												const remainingDue =
													shortfall.gt("0") && isPositiveDecimal(src.tdsInr)
														? shortfall.toFixed()
														: src.possiblyDueInr;

												return (
													<tr
														key={src.source}
														className="border-b border-[var(--border)] last:border-b-0"
													>
														<td className="px-4 py-2.5 font-medium">
															{sourceLabel(src.source)}
														</td>
														<td className="px-4 py-2.5">
															{src.deductedByPlatform === true ? (
																<Badge tone="positive">Yes</Badge>
															) : src.deductedByPlatform === false ? (
																<Badge tone="warning">
																	No (offshore / peer)
																</Badge>
															) : (
																<Badge tone="neutral">Unknown</Badge>
															)}
														</td>
														<td className="num-right px-4 py-2.5">
															{formatInr(src.transferValueInr)}
														</td>
														<td className="num-right px-4 py-2.5 font-medium text-[var(--positive)]">
															{formatInr(src.tdsInr)}
														</td>
														<td className="num-right px-4 py-2.5">
															{src.deductedByPlatform === true ? (
																<span className="text-xs text-[var(--text-muted)]">
																	— (deducted by platform)
																</span>
															) : coveredByRecorded ? (
																<Badge tone="positive">
																	Covered by recorded TDS
																</Badge>
															) : possiblyDuePositive ? (
																<div className="inline-flex items-center gap-1.5">
																	<Badge tone="warning">
																		<span className="num">
																			{formatInr(remainingDue)}
																		</span>
																	</Badge>
																	{isPositiveDecimal(src.tdsInr) ? (
																		<span className="text-xs text-[var(--text-muted)]">
																			after recorded TDS
																		</span>
																	) : null}
																</div>
															) : (
																<span className="num text-[var(--text-muted)]">
																	{formatInr(src.possiblyDueInr)}
																</span>
															)}
														</td>
													</tr>
												);
											})
										)}
									</tbody>
								</table>
							</div>

							{report.tds.checklist.length > 0 ? (
								<div className="border-t border-[var(--border)] bg-[var(--bg-subtle)] p-4">
									<h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
										Form 26AS / AIS Matching Checklist
									</h3>
									<ul className="mt-2 space-y-1.5 text-xs">
										{report.tds.checklist.map((item) => (
											<li key={item}>
												<label className="flex items-start gap-2">
													<input
														type="checkbox"
														checked={Boolean(checkedChecklist[item])}
														onChange={(e) =>
															setCheckedChecklist((prev) => ({
																...prev,
																[item]: e.target.checked,
															}))
														}
														className="mt-0.5"
													/>
													<span>{item}</span>
												</label>
											</li>
										))}
									</ul>
								</div>
							) : null}
						</div>
					</section>

					{/* Income & Gifts */}
					<section className="space-y-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h2 className="text-base font-semibold tracking-tight">
								Income &amp; Gifts ({report.income.rows.length})
							</h2>
							<div className="flex items-center gap-2 text-xs">
								<span>
									Gifts total:{" "}
									<strong className="num">
										{formatInr(report.income.giftsTotalInr)}
									</strong>
								</span>
								{report.income.giftsOverThreshold ? (
									<Badge tone="warning">Exceeds gift threshold</Badge>
								) : null}
							</div>
						</div>

						{report.income.note ? (
							<p className="flex items-center gap-2 rounded border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--text-primary)]">
								<Info
									className="h-4 w-4 shrink-0 text-[var(--warning)]"
									aria-hidden="true"
								/>
								{report.income.note}
							</p>
						) : null}

						<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
							<div className="overflow-x-auto">
								<table className="w-full border-collapse text-left text-sm">
									<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
										<tr>
											<th className="px-4 py-2.5 font-medium">Date</th>
											<th className="px-4 py-2.5 font-medium">Type</th>
											<th className="px-4 py-2.5 font-medium">Kind</th>
											<th className="px-4 py-2.5 font-medium">
												Asset &amp; Qty
											</th>
											<th className="num-right px-4 py-2.5 font-medium">
												FMV (INR)
											</th>
											<th className="px-4 py-2.5 text-right font-medium">
												Raw
											</th>
										</tr>
									</thead>
									<tbody>
										{report.income.rows.length === 0 ? (
											<tr>
												<td
													colSpan={6}
													className="px-4 py-6 text-center text-xs text-[var(--text-muted)]"
												>
													No staking, airdrop, or gift receipts in this tax
													year.
												</td>
											</tr>
										) : (
											report.income.rows.map((inc) => (
												<tr
													key={inc.txId}
													className="border-b border-[var(--border)] last:border-b-0"
												>
													<td className="px-4 py-2.5 text-xs whitespace-nowrap">
														{formatIstDate(inc.date)}
													</td>
													<td className="px-4 py-2.5">
														<Badge tone="neutral">
															{formatTxType(inc.type)}
														</Badge>
													</td>
													<td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">
														{inc.incomeKind
															? formatIncomeKind(inc.incomeKind)
															: "—"}
													</td>
													<td className="num px-4 py-2.5 whitespace-nowrap">
														{formatQty(inc.quantity)} {inc.asset}
													</td>
													<td className="num-right px-4 py-2.5 font-medium">
														{inc.fmvInr !== null ? (
															formatInr(inc.fmvInr)
														) : (
															<span className="text-[var(--warning)]">
																Missing FMV
															</span>
														)}
													</td>
													<td className="px-4 py-2.5 text-right">
														<button
															type="button"
															onClick={() =>
																setIncomeRawInspect({
																	title: `${formatTxType(inc.type)} · ${inc.asset}`,
																	raw: inc.trail,
																})
															}
															className="rounded border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
														>
															Trail
														</button>
													</td>
												</tr>
											))
										)}
									</tbody>
								</table>
							</div>
						</div>
					</section>

					{/* Year-end Balances with editable actual balances */}
					<section id="balances" className="space-y-3">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div>
								<h2 className="text-base font-semibold tracking-tight">
									Year-End Balances ({report.balances.length})
								</h2>
								<p className="text-xs text-[var(--text-secondary)]">
									Compare computed year-end holdings against your actual wallet
									or exchange balances (Difference = Actual − Computed).
								</p>
							</div>
							{report.balances.length > 0 ? (
								<button
									type="button"
									disabled={savingBalances}
									onClick={handleSaveBalances}
									className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
								>
									<Save className="h-3.5 w-3.5" aria-hidden="true" />
									{savingBalances ? "Saving…" : "Save actual balances"}
								</button>
							) : null}
						</div>

						{balanceSavedMsg ? (
							<p className="flex items-center gap-2 rounded border border-[var(--positive)]/40 bg-[var(--positive-soft)] px-3 py-2 text-xs text-[var(--positive)]">
								<CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
								{balanceSavedMsg}
							</p>
						) : null}

						<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
							<div className="overflow-x-auto">
								<table className="w-full border-collapse text-left text-sm">
									<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
										<tr>
											<th className="px-4 py-2.5 font-medium">Asset</th>
											<th className="px-4 py-2.5 font-medium">Pool / Source</th>
											<th className="num-right px-4 py-2.5 font-medium">
												Computed
											</th>
											<th className="num-right px-4 py-2.5 font-medium">
												Actual Balance
											</th>
											<th className="num-right px-4 py-2.5 font-medium">
												Difference
											</th>
										</tr>
									</thead>
									<tbody>
										{report.balances.length === 0 ? (
											<tr>
												<td
													colSpan={5}
													className="px-4 py-6 text-center text-xs text-[var(--text-muted)]"
												>
													No asset holdings at year end.
												</td>
											</tr>
										) : (
											report.balances.map((b) => {
												const key = balanceKey(b.asset, b.source);
												const draft = actualDrafts[key] ?? "";
												let liveDiff: string | null = b.difference ?? null;
												if (draft.trim() !== "") {
													try {
														liveDiff = D(draft.trim())
															.minus(b.computed)
															.toFixed();
													} catch {
														liveDiff = null;
													}
												}
												const hasMismatch =
													liveDiff !== null && !isZeroDecimal(liveDiff);

												return (
													<tr
														key={key}
														className="border-b border-[var(--border)] last:border-b-0"
													>
														<td className="px-4 py-2.5 font-medium">
															{b.asset}
														</td>
														<td className="px-4 py-2.5 text-xs text-[var(--text-secondary)]">
															{b.source ? sourceLabel(b.source) : "Global"}
														</td>
														<td className="num-right px-4 py-2.5">
															{formatQty(b.computed)}
														</td>
														<td className="px-4 py-2 text-right">
															<input
																type="text"
																inputMode="decimal"
																aria-label={`Actual balance for ${b.asset}${b.source ? ` on ${b.source}` : ""}`}
																value={draft}
																onChange={(e) =>
																	setActualDrafts((prev) => ({
																		...prev,
																		[key]: e.target.value,
																	}))
																}
																placeholder="Enter actual…"
																className="num w-36 rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2 py-1 text-right text-xs"
															/>
														</td>
														<td
															className={`num-right px-4 py-2.5 text-xs ${
																hasMismatch
																	? "font-medium text-[var(--warning)]"
																	: "text-[var(--text-muted)]"
															}`}
														>
															{liveDiff !== null ? formatQty(liveDiff) : "—"}
														</td>
													</tr>
												);
											})
										)}
									</tbody>
								</table>
							</div>
						</div>

						{renderStatementsSection()}
					</section>

					{/* Settings used & warnings */}
					<section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
						<h2 className="text-sm font-semibold">
							Engine Settings Used for This Report
						</h2>
						<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-5">
							{Object.entries(report.generatedFrom.settings).map(([k, v]) => (
								<div key={k}>
									<dt className="text-[var(--text-muted)]">
										{formatEngineSettingLabel(k)}
									</dt>
									<dd className="mt-0.5 font-medium">
										{formatEngineSettingValue(k, v)}
									</dd>
								</div>
							))}
						</dl>

						{(() => {
							const groupedWarnings = groupReportWarnings(report.warnings);
							if (groupedWarnings.length === 0) return null;
							const totalOccurrences = groupedWarnings.reduce(
								(sum, w) => sum + w.count,
								0,
							);
							return (
								<div className="space-y-1.5 border-t border-[var(--border)] pt-3 text-xs">
									<h3 className="font-semibold text-[var(--warning)]">
										Report Warnings ({groupedWarnings.length}
										{totalOccurrences !== groupedWarnings.length
											? ` distinct · ${totalOccurrences} total`
											: ""}
										)
									</h3>
									<ul className="list-disc space-y-1 pl-5 text-[var(--text-secondary)]">
										{groupedWarnings.map((w) => {
											const href = warningTxHref(
												taxYear,
												w.txIds,
												report.ledger,
												w.asset,
												w.source,
											);
											const isNotice = w.code === "ca_verification_pending";
											return (
												<li
													key={`${w.code}:${w.message}:${w.asset ?? ""}:${w.source ?? ""}`}
												>
													<code
														className={`font-mono-code font-medium ${
															isNotice ? "text-[var(--accent-text)]" : ""
														}`}
													>
														{w.code}
													</code>
													: {w.message}
													{w.asset || w.source ? (
														<>
															{" "}
															<span className="ml-1 inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
																{w.asset ?? ""}
																{w.asset && w.source ? " · " : ""}
																{w.source ? sourceLabel(w.source) : ""}
															</span>
														</>
													) : null}
													{w.count > 1 ? (
														<>
															{" "}
															<span className="ml-1 font-medium text-[var(--text-primary)]">
																(×{w.count})
															</span>
														</>
													) : null}
													{href ? (
														<>
															{" "}
															<Link
																href={href}
																className="font-medium text-[var(--accent-text)] underline"
															>
																{w.txIds.length === 1
																	? "View transaction"
																	: `View ${w.txIds.length} ${pluralise(w.txIds.length, "transaction")}`}
															</Link>
														</>
													) : null}
												</li>
											);
										})}
									</ul>
								</div>
							);
						})()}
					</section>
				</>
			)}

			<TrailDrawer
				row={trailRow}
				report={report}
				onClose={() => setTrailRow(null)}
			/>

			<Drawer
				open={Boolean(incomeRawInspect)}
				onClose={() => setIncomeRawInspect(null)}
				title={incomeRawInspect?.title ?? "Raw Trail"}
			>
				<pre className="font-mono-code overflow-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs text-[var(--text-secondary)]">
					{JSON.stringify(incomeRawInspect?.raw, null, 2)}
				</pre>
			</Drawer>
		</div>
	);
}
