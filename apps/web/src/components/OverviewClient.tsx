"use client";

import type { VdaReport } from "@tax/core";
import {
	AlertTriangle,
	ArrowRight,
	Calculator,
	CheckCircle2,
	FileSpreadsheet,
	Upload,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TrySampleDataButton } from "@/components/demo/TrySampleDataButton";
import { GettingStarted } from "@/components/GettingStarted";
import { StaleReportBanner } from "@/components/report/StaleReportBanner";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TaxYearSelect } from "@/components/ui/TaxYearSelect";
import {
	api,
	getErrorMessage,
	REPORT_NOT_COMPUTED,
	type ReportMissingDetails,
} from "@/lib/client/api";
import {
	formatIncompleteSummary,
	formatInr,
	formatReportMissingState,
	isNegativeDecimal,
	isPositiveDecimal,
	isReportIncomplete,
	pluralise,
	reportHasActivity,
} from "@/lib/client/format";
import { reviewActionCount } from "@/lib/client/review-codes";
import { useSelectedTaxYear } from "@/lib/client/useSelectedTaxYear";

export function OverviewClient() {
	const { taxYear, taxYears, settings, selectTaxYear } =
		useSelectedTaxYear("/");
	const [report, setReport] = useState<VdaReport | null>(null);
	const [reportMissing, setReportMissing] =
		useState<ReportMissingDetails | null>(null);
	const [txTotal, setTxTotal] = useState<number | null>(null);
	const [reviewCount, setReviewCount] = useState<number>(0);
	const [reviewCurrent, setReviewCurrent] = useState(false);
	const [reportStale, setReportStale] = useState(false);
	const [hasOwnImport, setHasOwnImport] = useState(false);
	const [loading, setLoading] = useState(true);
	const [computing, setComputing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function initMeta() {
			try {
				const imports = await api.listImports().catch(() => []);
				if (cancelled) return;
				setHasOwnImport(imports.some((imp) => !imp.demo));
			} catch {
				// handled by individual fetch
			}
		}
		initMeta();
		return () => {
			cancelled = true;
		};
	}, []);

	const loadData = useCallback(async (year: string) => {
		setLoading(true);
		setError(null);
		try {
			const txPage = await api
				.listTransactions({ page: 1, pageSize: 1 })
				.catch(() => null);
			const [repState, review] = await Promise.all([
				txPage?.total === 0
					? Promise.resolve(REPORT_NOT_COMPUTED)
					: api.getReportState(year),
				api.getReview(year).catch(() => null),
			]);
			if (repState.status === "ready") {
				setReport(repState.report);
				setReportStale(
					repState.report.stale === true || review?.reportStatus === "stale",
				);
				setReportMissing(null);
			} else {
				setReport(null);
				setReportStale(false);
				setReportMissing(repState.missing);
			}
			setReviewCount(review ? reviewActionCount(review) : 0);
			setReviewCurrent(review?.reportStatus === "current");
			setTxTotal(txPage ? txPage.total : null);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (taxYear) loadData(taxYear);
	}, [taxYear, loadData]);

	function handleTaxYearChange(next: string) {
		setStatusMessage(null);
		selectTaxYear(next);
	}

	async function handleCompute() {
		setComputing(true);
		setError(null);
		setStatusMessage(null);
		try {
			const computed = await api.computeReport(taxYear);
			setReport(computed);
			setReportStale(false);
			setReportMissing(null);
			setStatusMessage(
				`Report computed for tax year ${taxYear} (${computed.generatedFrom.txCount} ${pluralise(computed.generatedFrom.txCount, "transaction")} evaluated).`,
			);
			const review = await api.getReview(taxYear).catch(() => null);
			setReviewCount(review ? reviewActionCount(review) : 0);
			setReviewCurrent(review?.reportStatus === "current");
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setComputing(false);
		}
	}

	const incomplete = report ? isReportIncomplete(report) : false;
	const netIsRefund =
		report && !incomplete ? isNegativeDecimal(report.totals.netPayable) : false;
	const hasLosses = report
		? isPositiveDecimal(report.totals.lossesNotSetOff)
		: false;

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Tax Overview</h1>
					<p className="mt-0.5 text-sm text-[var(--text-secondary)]">
						India Schedule VDA summary, tax liability, and TDS credit.
					</p>
				</div>

				<div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
					<TaxYearSelect
						value={taxYear}
						onChange={handleTaxYearChange}
						taxYears={taxYears}
					/>
					<button
						type="button"
						disabled={computing}
						onClick={handleCompute}
						className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 sm:w-auto"
					>
						<Calculator className="h-4 w-4" aria-hidden="true" />
						{computing ? "Computing…" : "Compute report"}
					</button>
				</div>
			</div>

			<div aria-live="polite" className="sr-only">
				{statusMessage ?? ""}
			</div>

			{statusMessage ? (
				<div className="flex items-center gap-2 rounded-lg border border-[var(--positive)]/40 bg-[var(--positive-soft)] px-4 py-2.5 text-sm text-[var(--positive)]">
					<CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
					<span>{statusMessage}</span>
				</div>
			) : null}

			{error ? (
				<ErrorBanner message={error} onRetry={() => loadData(taxYear)} />
			) : null}

			{!loading && report && reportStale ? (
				<StaleReportBanner computing={computing} onRecompute={handleCompute} />
			) : null}

			{reviewCount > 0 ? (
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-3 text-sm">
					<div className="flex items-center gap-2.5">
						<AlertTriangle
							className="h-4 w-4 shrink-0 text-[var(--warning)]"
							aria-hidden="true"
						/>
						<span>
							<strong className="font-semibold num">{reviewCount}</strong>{" "}
							{pluralise(reviewCount, "item")}{" "}
							{pluralise(reviewCount, "needs", "need")} review before filing.
						</span>
					</div>
					<Link
						href={`/review?taxYear=${encodeURIComponent(taxYear)}`}
						className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline"
					>
						Review items
						<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
					</Link>
				</div>
			) : null}

			{report && report.unresolved.length > 0 ? (
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--loss)]/40 bg-[var(--loss-soft)] px-4 py-3 text-sm">
					<div className="flex items-center gap-2.5">
						<AlertTriangle
							className="h-4 w-4 shrink-0 text-[var(--loss)]"
							aria-hidden="true"
						/>
						<span>
							<strong className="font-semibold num">
								{report.unresolved.length}
							</strong>{" "}
							{pluralise(report.unresolved.length, "unresolved disposal slice")}{" "}
							excluded from totals due to missing history or INR value.
						</span>
					</div>
					<Link
						href={`/report?taxYear=${encodeURIComponent(taxYear)}#unresolved`}
						className="inline-flex items-center gap-1 font-medium text-[var(--loss)] hover:underline"
					>
						Inspect unresolved
						<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
					</Link>
				</div>
			) : null}

			{!loading && !error ? (
				<GettingStarted
					facts={{
						taxYear,
						settingsSaved: Boolean(settings?.settingsSavedAt),
						hasOwnImport,
						reportReady: report !== null && reportHasActivity(report),
						openReviewItems: reviewCount,
						reviewCurrent,
					}}
				/>
			) : null}

			{loading ? (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{["a", "b", "c", "d", "e"].map((k) => (
						<div
							key={k}
							className="h-28 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]"
						/>
					))}
				</div>
			) : txTotal === 0 && !report ? (
				<EmptyState
					icon={<Upload className="h-8 w-8" />}
					title="No transactions yet — import an export file"
					description={
						reportMissing && reportMissing.cause !== "never_computed"
							? `${formatReportMissingState(reportMissing, taxYear, "overview").description} Upload your Binance, CoinDCX, or generic CSV/XLSX trade history to build your ledger.`
							: "Upload your Binance, CoinDCX, or generic CSV/XLSX trade history to build your ledger and compute Schedule VDA. Just looking around? Load sample data to see a full report in one click."
					}
					action={
						<div className="flex flex-wrap justify-center gap-3">
							<Link
								href="/import"
								className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
							>
								<Upload className="h-4 w-4" aria-hidden="true" />
								Import file
							</Link>
							<Link
								href="/transactions?add=buy"
								className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
							>
								Add manual transaction
							</Link>
							<TrySampleDataButton />
						</div>
					}
				/>
			) : !report ? (
				(() => {
					const missingCopy = formatReportMissingState(
						reportMissing,
						taxYear,
						"overview",
					);
					return (
						<EmptyState
							icon={<FileSpreadsheet className="h-8 w-8" />}
							title={missingCopy.title}
							description={missingCopy.description}
							action={
								<button
									type="button"
									disabled={computing}
									onClick={handleCompute}
									className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
								>
									<Calculator className="h-4 w-4" aria-hidden="true" />
									{computing ? "Computing…" : `Compute ${taxYear} report`}
								</button>
							}
						/>
					);
				})()
			) : (
				<>
					<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
						<div className="flex flex-wrap items-center gap-2">
							<span>{report.act}</span>
							<span>·</span>
							<span className="num">
								{report.generatedFrom.txCount}{" "}
								{pluralise(report.generatedFrom.txCount, "ledger transaction")}{" "}
								evaluated
							</span>
							<span>·</span>
							<span className="num">
								{report.scheduleVdaRows.length}{" "}
								{pluralise(report.scheduleVdaRows.length, "Schedule VDA row")}
							</span>
							{reportStale ? (
								<Badge tone="warning">From the last computed report</Badge>
							) : null}
							{report.includesDemoData ? (
								<Badge tone="warning">Includes sample data</Badge>
							) : null}
							{!report.sectionsVerified ? (
								<Badge tone="warning">
									Section numbers pending CA verification
								</Badge>
							) : null}
						</div>
						<Link
							href={`/report?taxYear=${encodeURIComponent(taxYear)}`}
							className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline"
						>
							Open full Schedule VDA report
							<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
						</Link>
					</div>

					<section
						aria-label="Tax summary"
						className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
					>
						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<p className="text-xs font-medium text-[var(--text-secondary)]">
								Taxable VDA Income
							</p>
							<p className="num mt-2 text-2xl font-semibold tracking-tight">
								{formatInr(report.totals.taxableIncome)}
							</p>
							<dl className="mt-3 space-y-1 border-t border-[var(--border)] pt-2.5 text-xs text-[var(--text-secondary)]">
								<div className="flex justify-between">
									<dt>Total consideration</dt>
									<dd className="num font-medium text-[var(--text-primary)]">
										{formatInr(report.totals.consideration)}
									</dd>
								</div>
								<div className="flex justify-between">
									<dt>Cost of acquisition</dt>
									<dd className="num font-medium text-[var(--text-primary)]">
										{formatInr(report.totals.cost)}
									</dd>
								</div>
							</dl>
						</div>

						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<div className="flex items-center justify-between">
								<p className="text-xs font-medium text-[var(--text-secondary)]">
									Total Tax (30% + Surcharge + 4% Cess)
								</p>
							</div>
							<p className="num mt-2 text-2xl font-semibold tracking-tight">
								{formatInr(report.totals.totalTax)}
							</p>
							<dl className="mt-3 space-y-1 border-t border-[var(--border)] pt-2.5 text-xs text-[var(--text-secondary)]">
								<div className="flex justify-between">
									<dt>Base tax (30%)</dt>
									<dd className="num font-medium text-[var(--text-primary)]">
										{formatInr(report.totals.baseTax)}
									</dd>
								</div>
								<div className="flex justify-between">
									<dt>Surcharge</dt>
									<dd className="num font-medium text-[var(--text-primary)]">
										{formatInr(report.totals.surcharge)}
									</dd>
								</div>
								<div className="flex justify-between">
									<dt>Health &amp; Education Cess (4%)</dt>
									<dd className="num font-medium text-[var(--text-primary)]">
										{formatInr(report.totals.cess)}
									</dd>
								</div>
							</dl>
						</div>

						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<p className="text-xs font-medium text-[var(--text-secondary)]">
								TDS Credit
							</p>
							<p className="num mt-2 text-2xl font-semibold tracking-tight text-[var(--positive)]">
								{formatInr(report.totals.tdsCredit)}
							</p>
							<p className="mt-3 border-t border-[var(--border)] pt-2.5 text-xs text-[var(--text-secondary)]">
								Sum of VDA TDS recorded across imported &amp; manual entries for{" "}
								{taxYear}. Verify against Form 26AS / AIS.
							</p>
						</div>

						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<p className="text-xs font-medium text-[var(--text-secondary)]">
								{netIsRefund ? "Net Tax Refundable" : "Net Tax Payable"}
							</p>
							{incomplete ? (
								<p className="mt-2 text-base font-semibold leading-snug text-[var(--loss)]">
									{formatIncompleteSummary(report)}
								</p>
							) : (
								<p
									className={`num mt-2 text-2xl font-semibold tracking-tight ${
										netIsRefund ? "text-[var(--positive)]" : ""
									}`}
								>
									{formatInr(report.totals.netPayable)}
								</p>
							)}
							<p className="mt-3 border-t border-[var(--border)] pt-2.5 text-xs text-[var(--text-secondary)]">
								{incomplete ? (
									<>
										Fix the unresolved sales to see what you owe. Total so far
										excludes them.
									</>
								) : (
									<>
										Total tax minus TDS credit. Rounded total tax:{" "}
										<span className="num font-medium text-[var(--text-primary)]">
											{formatInr(report.totals.totalTaxRounded)}
										</span>
									</>
								)}
							</p>
						</div>

						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<p className="text-xs font-medium text-[var(--text-secondary)]">
								Losses Not Set Off
							</p>
							<p
								className={`num mt-2 text-2xl font-semibold tracking-tight ${
									hasLosses ? "text-[var(--loss)]" : ""
								}`}
							>
								{formatInr(report.totals.lossesNotSetOff)}
							</p>
							<p className="mt-3 border-t border-[var(--border)] pt-2.5 text-xs text-[var(--text-secondary)]">
								Indian VDA rules disallow offsetting losses against gains or
								carrying them forward.
							</p>
						</div>

						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<p className="text-xs font-medium text-[var(--text-secondary)]">
								Income &amp; Gifts
							</p>
							<p className="num mt-2 text-2xl font-semibold tracking-tight">
								{report.income.rows.length}{" "}
								{pluralise(report.income.rows.length, "row")}
							</p>
							<dl className="mt-3 space-y-1 border-t border-[var(--border)] pt-2.5 text-xs text-[var(--text-secondary)]">
								<div className="flex justify-between">
									<dt>Gifts total FMV</dt>
									<dd className="num font-medium text-[var(--text-primary)]">
										{formatInr(report.income.giftsTotalInr)}
									</dd>
								</div>
								<div className="flex justify-between">
									<dt>Gift threshold</dt>
									<dd>
										{report.income.giftsOverThreshold ? (
											<Badge tone="warning">Exceeded</Badge>
										) : (
											<Badge tone="neutral">Within limit</Badge>
										)}
									</dd>
								</div>
							</dl>
						</div>
					</section>
				</>
			)}
		</div>
	);
}
