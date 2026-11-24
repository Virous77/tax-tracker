"use client";

import type {
	ActualBalance,
	EquityCyPrice,
	EquityMetadata,
	ScheduleFaRow,
	UsEquityGainRow,
	UsEquityReport,
} from "@tax/core";
import type { UsEquityExportKind } from "@tax/core/api";
import {
	AlertTriangle,
	Calculator,
	ChevronDown,
	ChevronUp,
	Download,
	FileSpreadsheet,
	Plus,
	TrendingUp,
	Upload,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { StaleReportBanner } from "@/components/report/StaleReportBanner";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { TaxYearSelect } from "@/components/ui/TaxYearSelect";
import { CapitalGainsTab } from "@/components/us-stocks/CapitalGainsTab";
import { DividendsForm67Tab } from "@/components/us-stocks/DividendsForm67Tab";
import { EquityHoldingsTab } from "@/components/us-stocks/EquityHoldingsTab";
import { ScheduleFaEditorDrawer } from "@/components/us-stocks/ScheduleFaEditorDrawer";
import {
	type EquityPriceProvider,
	ScheduleFaTab,
} from "@/components/us-stocks/ScheduleFaTab";
import { UsEquityTrailDrawer } from "@/components/us-stocks/UsEquityTrailDrawer";
import {
	api,
	type EquityPriceFillSummary,
	type EquityPricesStatus,
	getErrorMessage,
	type JobStatus,
} from "@/lib/client/api";
import {
	formatEngineSettingLabel,
	formatEngineSettingValue,
	formatInr,
	formatInrNullable,
	formatSectionLabel,
	formatUsdNullable,
	isZeroDecimal,
	pluralise,
} from "@/lib/client/format";
import { useSelectedTaxYear } from "@/lib/client/useSelectedTaxYear";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

type TabId = "capital-gains" | "dividends" | "schedule-fa" | "holdings";

const EXPORT_ITEMS: ReadonlyArray<{ kind: UsEquityExportKind; label: string }> =
	[
		{ kind: "capital-gains", label: "Capital Gains" },
		{ kind: "dividends", label: "Dividends" },
		{ kind: "form67", label: "Form 67" },
		{ kind: "schedule-fa", label: "Schedule FA" },
		{ kind: "full", label: "Full Workbook" },
	];

function parseInitialTab(param: string | null): TabId {
	if (
		param === "capital-gains" ||
		param === "dividends" ||
		param === "schedule-fa" ||
		param === "holdings"
	) {
		return param;
	}
	return "capital-gains";
}

function defaultCalendarYear(taxYear: string): number {
	const parsed = Number.parseInt(taxYear.slice(0, 4), 10);
	return Number.isFinite(parsed) ? parsed : 2025;
}

export function UsStocksClient() {
	const sourceLabel = useSourceLabel();
	const searchParams = useSearchParams();
	const { taxYear, taxYears, selectTaxYear } = useSelectedTaxYear("/us-stocks");
	const tabParam = searchParams.get("tab");

	const [activeTab, setActiveTab] = useState<TabId>(() =>
		parseInitialTab(tabParam),
	);
	const [report, setReport] = useState<UsEquityReport | null>(null);
	const [hasUsEquityTx, setHasUsEquityTx] = useState(false);
	const [metadata, setMetadata] = useState<EquityMetadata[]>([]);
	const [prices, setPrices] = useState<EquityCyPrice[]>([]);
	const [pricesStatus, setPricesStatus] = useState<EquityPricesStatus | null>(
		null,
	);
	const [priceFillRunning, setPriceFillRunning] = useState(false);
	const [priceFillJob, setPriceFillJob] = useState<JobStatus | null>(null);
	const [priceFillResult, setPriceFillResult] =
		useState<EquityPriceFillSummary | null>(null);
	const [priceFillError, setPriceFillError] = useState<string | null>(null);
	const [actualBalances, setActualBalances] = useState<ActualBalance[]>([]);
	const [loading, setLoading] = useState(true);
	const [computing, setComputing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [trailRow, setTrailRow] = useState<UsEquityGainRow | null>(null);
	const [editingFaRow, setEditingFaRow] = useState<ScheduleFaRow | null>(null);
	const [rulesExpanded, setRulesExpanded] = useState(false);

	const tabListId = useId();
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
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

	useEffect(() => {
		if (tabParam) {
			setActiveTab(parseInitialTab(tabParam));
		}
	}, [tabParam]);

	const loadData = useCallback(async (year: string) => {
		if (pricePollRef.current) {
			clearTimeout(pricePollRef.current);
			pricePollRef.current = null;
		}
		setLoading(true);
		setError(null);
		setPriceFillRunning(false);
		setPriceFillJob(null);
		setPriceFillResult(null);
		setPriceFillError(null);
		try {
			const [txPage, rep, meta, actuals, pStatus] = await Promise.all([
				api
					.listTransactions({ assetClass: "us_equity", page: 1, pageSize: 1 })
					.catch(() => null),
				api.getUsEquityReportOrNull(year, true),
				api.getEquityMetadata().catch(() => []),
				api.getUsEquityActualBalances(year).catch(() => []),
				api.getEquityPricesStatus(year).catch(() => null),
			]);
			const cy = rep?.calendarYear ?? defaultCalendarYear(year);
			const cyPrices = await api.getEquityPrices(cy).catch(() => []);
			if (!mountedRef.current || activeTaxYearRef.current !== year) return;
			setHasUsEquityTx((txPage?.total ?? 0) > 0);
			setReport(rep);
			setMetadata(meta);
			setPrices(cyPrices);
			setPricesStatus(pStatus);
			setActualBalances(actuals);
		} catch (err) {
			if (!mountedRef.current || activeTaxYearRef.current !== year) return;
			setError(getErrorMessage(err));
		} finally {
			if (mountedRef.current) setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (taxYear) loadData(taxYear);
	}, [taxYear, loadData]);

	async function handleCompute() {
		if (!taxYear) return;
		setComputing(true);
		setError(null);
		try {
			const rep = await api.computeUsEquityReport(taxYear);
			const [meta, cyPrices, actuals, pStatus] = await Promise.all([
				api.getEquityMetadata().catch(() => metadata),
				api.getEquityPrices(rep.calendarYear).catch(() => prices),
				api.getUsEquityActualBalances(taxYear).catch(() => actualBalances),
				api.getEquityPricesStatus(taxYear).catch(() => pricesStatus),
			]);
			if (!mountedRef.current) return;
			setReport(rep);
			setMetadata(meta);
			setPrices(cyPrices);
			setPricesStatus(pStatus);
			setActualBalances(actuals);
		} catch (err) {
			if (!mountedRef.current) return;
			setError(getErrorMessage(err));
		} finally {
			if (mountedRef.current) setComputing(false);
		}
	}

	function pollEquityPriceJob(jobId: string, year: string) {
		if (pricePollRef.current) clearTimeout(pricePollRef.current);

		const tick = async () => {
			if (!mountedRef.current || activeTaxYearRef.current !== year) return;
			try {
				const job = await api.getJob(jobId);
				if (!mountedRef.current || activeTaxYearRef.current !== year) return;

				if (job.status === "pending" || job.status === "running") {
					setPriceFillJob(job);
					pricePollRef.current = setTimeout(tick, 1200);
					return;
				}

				pricePollRef.current = null;
				setPriceFillJob(null);

				if (job.status === "completed") {
					if (job.result && "calendarYear" in job.result) {
						setPriceFillResult(job.result);
					}
					try {
						const [rep, pStatus] = await Promise.all([
							api.computeUsEquityReport(year),
							api.getEquityPricesStatus(year).catch(() => null),
						]);
						const cyPrices = await api
							.getEquityPrices(rep.calendarYear)
							.catch(() => null);
						if (!mountedRef.current || activeTaxYearRef.current !== year)
							return;
						setReport(rep);
						if (cyPrices) setPrices(cyPrices);
						if (pStatus) setPricesStatus(pStatus);
					} catch (refreshErr) {
						if (!mountedRef.current || activeTaxYearRef.current !== year)
							return;
						setPriceFillError(getErrorMessage(refreshErr));
					} finally {
						if (mountedRef.current && activeTaxYearRef.current === year) {
							setPriceFillRunning(false);
						}
					}
				} else if (job.status === "failed") {
					setPriceFillRunning(false);
					setPriceFillError(job.error ?? "Failed to fetch US stock prices.");
				}
			} catch (err) {
				if (!mountedRef.current || activeTaxYearRef.current !== year) return;
				pricePollRef.current = null;
				setPriceFillRunning(false);
				setPriceFillJob(null);
				setPriceFillError(getErrorMessage(err));
			}
		};

		pricePollRef.current = setTimeout(tick, 1200);
	}

	async function handleAutoFillEquityPrices(
		provider: EquityPriceProvider,
		overwrite: boolean,
	) {
		if (!taxYear) return;
		setPriceFillRunning(true);
		setPriceFillError(null);
		setPriceFillResult(null);
		setPriceFillJob(null);
		try {
			const { jobId } = await api.fillEquityPrices({
				taxYear,
				provider,
				overwrite,
			});
			if (!mountedRef.current) return;
			pollEquityPriceJob(jobId, taxYear);
		} catch (err) {
			if (!mountedRef.current) return;
			setPriceFillRunning(false);
			setPriceFillError(getErrorMessage(err));
		}
	}

	const tabs: Array<{ id: TabId; label: string }> = [
		{
			id: "capital-gains",
			label: `Capital Gains (${report?.capitalGains.rows.length ?? 0})`,
		},
		{
			id: "dividends",
			label: `Dividends & Form 67 (${report?.dividends.rows.length ?? 0})`,
		},
		{
			id: "schedule-fa",
			label: `Schedule FA (CY ${report?.calendarYear ?? defaultCalendarYear(taxYear)})`,
		},
		{
			id: "holdings",
			label: `Holdings (${report?.balances.length ?? 0})`,
		},
	];

	function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
		let nextIdx: number | null = null;
		if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
		else if (e.key === "ArrowLeft")
			nextIdx = (idx - 1 + tabs.length) % tabs.length;
		else if (e.key === "Home") nextIdx = 0;
		else if (e.key === "End") nextIdx = tabs.length - 1;
		if (nextIdx === null) return;
		e.preventDefault();
		const target = tabs[nextIdx];
		if (target) {
			setActiveTab(target.id);
			tabRefs.current[nextIdx]?.focus();
		}
	}

	const missingFaPrices = report
		? report.scheduleFa.rows.filter(
				(r) =>
					r.peakValueInr === null ||
					(!isZeroDecimal(r.closingQty) && r.closingValueInr === null),
			).length
		: 0;

	return (
		<div className="space-y-6">
			<PageHeader
				title="US Stocks"
				description="US equity capital gains, dividends &amp; Form 67 credit, and Schedule FA."
				actions={
					<>
						<TaxYearSelect
							value={taxYear}
							onChange={selectTaxYear}
							taxYears={taxYears}
						/>
						<button
							type="button"
							disabled={computing || !taxYear}
							onClick={handleCompute}
							className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
						>
							<Calculator className="h-4 w-4" aria-hidden="true" />
							{computing
								? "Computing…"
								: report
									? "Recompute"
									: "Compute report"}
						</button>
					</>
				}
			/>

			{error ? (
				<ErrorBanner message={error} onRetry={() => loadData(taxYear)} />
			) : null}

			{!loading && report && report.stale ? (
				<StaleReportBanner computing={computing} onRecompute={handleCompute} />
			) : null}

			{loading ? (
				<div className="h-64 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			) : !report ? (
				!hasUsEquityTx ? (
					<EmptyState
						icon={<TrendingUp className="h-8 w-8" />}
						title="No US stock transactions yet"
						description="Import a US broker CSV or add a manual US stock entry. Charles Schwab, Interactive Brokers (IBKR), and Generic US Stocks CSVs auto-detect via built-in recipes."
						action={
							<div className="flex flex-wrap justify-center gap-3">
								<Link
									href="/import"
									className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
								>
									<Upload className="h-4 w-4" aria-hidden="true" />
									Import broker CSV
								</Link>
								<Link
									href={`/transactions?add=buy&assetClass=us_equity${taxYear ? `&taxYear=${encodeURIComponent(taxYear)}` : ""}`}
									className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
								>
									<Plus className="h-4 w-4" aria-hidden="true" />
									Add US stock entry
								</Link>
							</div>
						}
					/>
				) : (
					<EmptyState
						icon={<FileSpreadsheet className="h-8 w-8" />}
						title={`No US Stocks report computed for ${taxYear}`}
						description="Your US stock transactions are in the ledger. Compute the report to calculate capital gains, Form 67 foreign tax credit, and Schedule FA (Table A3)."
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
				)
			) : (
				<>
					{/* Report metadata + Verification / Incomplete banners */}
					<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-medium text-[var(--text-primary)]">
								{report.act}
							</span>
							<span>·</span>
							<span>CY {report.calendarYear} Schedule FA</span>
							<span>·</span>
							<span className="num">
								{report.generatedFrom.txCount}{" "}
								{pluralise(report.generatedFrom.txCount, "transaction")}{" "}
								evaluated
							</span>
							{!report.sectionsVerified ? (
								<Badge tone="warning">Pending CA verification</Badge>
							) : (
								<Badge tone="positive">Sections verified</Badge>
							)}
							{report.includesDemoData ? (
								<Badge tone="warning">Includes sample data</Badge>
							) : null}
							{report.incomplete ? (
								<Badge tone="loss">
									{report.unresolved.length > 0
										? "Incomplete — unresolved disposals"
										: "Incomplete — missing inputs"}
								</Badge>
							) : null}
						</div>
					</div>

					{report.incomplete || report.warnings.length > 0 ? (
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-3 text-xs">
							<div className="flex items-start gap-2">
								<AlertTriangle
									className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
									aria-hidden="true"
								/>
								<div>
									<p className="font-semibold text-[var(--text-primary)]">
										{report.unresolved.length > 0
											? `${report.unresolved.length} unresolved disposal${report.unresolved.length === 1 ? "" : "s"} · `
											: ""}
										{report.warnings.length} report{" "}
										{pluralise(report.warnings.length, "warning")}
										{missingFaPrices > 0
											? ` (${missingFaPrices} Schedule FA holding${missingFaPrices === 1 ? "" : "s"} missing market price)`
											: ""}
									</p>
									<p className="mt-0.5 text-[var(--text-secondary)]">
										Review warnings in the Rules &amp; Warnings panel below
										{missingFaPrices > 0
											? " or enter missing Schedule FA prices in the Schedule FA tab."
											: "."}
									</p>
								</div>
							</div>
							{missingFaPrices > 0 && activeTab !== "schedule-fa" ? (
								<button
									type="button"
									onClick={() => setActiveTab("schedule-fa")}
									className="rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1 font-medium text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
								>
									Enter Schedule FA prices
								</button>
							) : null}
						</div>
					) : null}

					{/* KPI Summary Cards */}
					<section
						aria-label="US Stocks summary KPIs"
						className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
					>
						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<div className="flex items-center justify-between gap-2">
								<p className="text-xs font-medium text-[var(--text-secondary)]">
									LTCG Tax
								</p>
								{report.capitalGains.summary.ltcgTax.surchargeCapped ? (
									<Badge tone="accent">15% cap</Badge>
								) : null}
							</div>
							<p className="num mt-1.5 text-2xl font-semibold tracking-tight">
								{formatInr(
									report.capitalGains.summary.ltcgTax.totalLtcgTaxRoundedInr,
								)}
							</p>
							<p className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-muted)]">
								12.5% + surcharge + 4% cess (rounded)
							</p>
						</div>

						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<p className="text-xs font-medium text-[var(--text-secondary)]">
								Net Capital Gains
							</p>
							<p className="num mt-1.5 text-xl font-semibold tracking-tight">
								{formatInr(
									report.capitalGains.summary.setOff.netTaxableLtcgInr,
								)}{" "}
								<span className="text-xs font-normal text-[var(--text-muted)]">
									LTCG
								</span>
							</p>
							<dl className="mt-2 space-y-0.5 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-secondary)]">
								<div className="flex justify-between">
									<dt>Net STCG (slab rate)</dt>
									<dd className="num font-medium text-[var(--text-primary)]">
										{formatInr(
											report.capitalGains.summary.setOff.netTaxableStcgInr,
										)}
									</dd>
								</div>
							</dl>
						</div>

						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<p className="text-xs font-medium text-[var(--text-secondary)]">
								Gross Dividends
							</p>
							<p className="num mt-1.5 text-2xl font-semibold tracking-tight">
								{formatInrNullable(report.dividends.totals.grossInr)}
							</p>
							<p className="num mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-muted)]">
								{formatUsdNullable(report.dividends.totals.grossUsd)} · Taxed at
								slab rate
							</p>
						</div>

						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<p className="text-xs font-medium text-[var(--text-secondary)]">
								Form 67 Foreign Tax Paid
							</p>
							<p className="num mt-1.5 text-2xl font-semibold tracking-tight text-[var(--positive)]">
								{formatInrNullable(report.form67.totals.foreignTaxPaidInr)}
							</p>
							<p className="num mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-muted)]">
								{formatUsdNullable(report.form67.totals.foreignTaxPaidUsd)} US
								withholding
							</p>
						</div>

						<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
							<p className="text-xs font-medium text-[var(--text-secondary)]">
								Schedule FA Holdings (CY {report.calendarYear})
							</p>
							<p className="num mt-1.5 text-2xl font-semibold tracking-tight">
								{report.scheduleFa.rows.length}
							</p>
							<p className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-muted)]">
								{missingFaPrices > 0 ? (
									<span className="font-medium text-[var(--warning)]">
										{missingFaPrices} missing market price
									</span>
								) : (
									"All market prices supplied"
								)}
							</p>
						</div>
					</section>

					{/* Exports Bar */}
					<section
						aria-label="Download US Stocks worksheets"
						className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3"
					>
						<span className="text-xs font-semibold text-[var(--text-secondary)]">
							Exports ({taxYear})
						</span>
						<div className="flex flex-wrap gap-2">
							{EXPORT_ITEMS.map((exp) => (
								<div
									key={exp.kind}
									className="inline-flex items-center overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-canvas)] text-xs"
								>
									<span className="px-2.5 py-1 font-medium text-[var(--text-secondary)]">
										{exp.label}
									</span>
									<a
										href={api.usEquityExportUrl(taxYear, "csv", exp.kind)}
										download
										aria-label={`Download ${exp.label} as CSV`}
										className="inline-flex items-center gap-1 border-l border-[var(--border)] px-2 py-1 font-medium text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
									>
										<Download className="h-3 w-3" aria-hidden="true" />
										CSV
									</a>
									<a
										href={api.usEquityExportUrl(taxYear, "xlsx", exp.kind)}
										download
										aria-label={`Download ${exp.label} as XLSX`}
										className="inline-flex items-center gap-1 border-l border-[var(--border)] px-2 py-1 font-medium text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
									>
										XLSX
									</a>
								</div>
							))}
						</div>
					</section>

					{/* Tabbed Workspace */}
					<div className="space-y-4">
						<div
							role="tablist"
							aria-label="US Stocks report sections"
							className="flex flex-wrap gap-1 border-b border-[var(--border)]"
						>
							{tabs.map((tab, idx) => {
								const selected = activeTab === tab.id;
								return (
									<button
										key={tab.id}
										ref={(el) => {
											tabRefs.current[idx] = el;
										}}
										id={`${tabListId}-tab-${tab.id}`}
										type="button"
										role="tab"
										aria-selected={selected}
										aria-controls={`${tabListId}-panel-${tab.id}`}
										tabIndex={selected ? 0 : -1}
										onClick={() => setActiveTab(tab.id)}
										onKeyDown={(e) => handleTabKeyDown(e, idx)}
										className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
											selected
												? "border-[var(--accent)] text-[var(--accent-text)]"
												: "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
										}`}
									>
										{tab.label}
									</button>
								);
							})}
						</div>

						<div
							id={`${tabListId}-panel-${activeTab}`}
							role="tabpanel"
							aria-labelledby={`${tabListId}-tab-${activeTab}`}
						>
							{activeTab === "capital-gains" ? (
								<CapitalGainsTab
									report={report}
									taxYear={taxYear}
									onInspectTrail={setTrailRow}
								/>
							) : activeTab === "dividends" ? (
								<DividendsForm67Tab report={report} />
							) : activeTab === "schedule-fa" ? (
								<ScheduleFaTab
									report={report}
									priceStatus={pricesStatus}
									priceFillRunning={priceFillRunning}
									priceFillJob={priceFillJob}
									priceFillResult={priceFillResult}
									priceFillError={priceFillError}
									onAutoFill={handleAutoFillEquityPrices}
									onEditRow={setEditingFaRow}
								/>
							) : (
								<EquityHoldingsTab
									report={report}
									taxYear={taxYear}
									savedActuals={actualBalances}
									onReportUpdated={(nextReport, nextActuals) => {
										setReport(nextReport);
										setActualBalances(nextActuals);
									}}
								/>
							)}
						</div>
					</div>

					{/* Settings, Rules & Warnings Disclosure */}
					<section className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
						<button
							type="button"
							aria-expanded={rulesExpanded}
							onClick={() => setRulesExpanded((prev) => !prev)}
							className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold"
						>
							<span className="flex flex-wrap items-center gap-2">
								<span>Settings, Rules &amp; Warnings</span>
								{!report.sectionsVerified ? (
									<Badge tone="warning">Pending CA verification</Badge>
								) : null}
								{report.warnings.length > 0 ? (
									<Badge tone="neutral">
										{report.warnings.length}{" "}
										{pluralise(report.warnings.length, "warning")}
									</Badge>
								) : null}
							</span>
							{rulesExpanded ? (
								<ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
							) : (
								<ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
							)}
						</button>

						{rulesExpanded ? (
							<div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4 text-xs">
								<div className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
									<span>{report.act}</span>
									<span>·</span>
									<span>
										Rule file:{" "}
										<code className="font-mono-code">
											{report.generatedFrom.ruleFile}
										</code>
									</span>
									<span>·</span>
									<span>
										DTAA: {report.dtaa.countryName} ({report.dtaa.countryCode})
										· {report.dtaa.dividendArticle}
									</span>
								</div>

								<div className="flex flex-wrap gap-2">
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

								<div>
									<h3 className="mb-2 font-semibold text-[var(--text-primary)]">
										Engine Settings Used
									</h3>
									<dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
										{Object.entries(report.generatedFrom.settings).map(
											([k, v]) => (
												<div key={k}>
													<dt className="text-[var(--text-muted)]">
														{formatEngineSettingLabel(k)}
													</dt>
													<dd className="mt-0.5 font-medium">
														{formatEngineSettingValue(k, v)}
													</dd>
												</div>
											),
										)}
									</dl>
								</div>

								{report.warnings.length > 0 ? (
									<div className="space-y-1.5 border-t border-[var(--border)] pt-3">
										<h3 className="font-semibold text-[var(--warning)]">
											Warnings ({report.warnings.length})
										</h3>
										<ul className="list-disc space-y-1 pl-5 text-[var(--text-secondary)]">
											{report.warnings.map((w) => (
												<li
													key={`${w.code}:${w.severity ?? ""}:${w.asset ?? ""}:${w.source ?? ""}:${w.importId ?? ""}:${w.txId ?? ""}:${w.message}`}
												>
													<code className="font-mono-code font-medium">
														{w.code}
													</code>
													: {w.message}
													{w.asset || w.source ? (
														<span className="ml-1.5 text-[11px] text-[var(--text-muted)]">
															(
															{[
																w.asset,
																w.source ? sourceLabel(w.source) : null,
															]
																.filter(Boolean)
																.join(" · ")}
															)
														</span>
													) : null}
												</li>
											))}
										</ul>
									</div>
								) : null}

								<p className="border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)]">
									{report.disclaimer}
								</p>
							</div>
						) : null}
					</section>
				</>
			)}

			<UsEquityTrailDrawer
				row={trailRow}
				report={report}
				onClose={() => setTrailRow(null)}
			/>

			<ScheduleFaEditorDrawer
				row={editingFaRow}
				calendarYear={report?.calendarYear ?? defaultCalendarYear(taxYear)}
				taxYear={taxYear}
				allMetadata={metadata}
				allPrices={prices}
				onClose={() => setEditingFaRow(null)}
				onSaved={({
					metadata: nextMeta,
					prices: nextPrices,
					report: nextReport,
				}) => {
					setMetadata(nextMeta);
					setPrices(nextPrices);
					setReport(nextReport);
					setEditingFaRow(null);
					if (taxYear) {
						const yearForStatus = taxYear;
						void api
							.getEquityPricesStatus(yearForStatus)
							.then((pStatus) => {
								if (
									mountedRef.current &&
									activeTaxYearRef.current === yearForStatus
								) {
									setPricesStatus(pStatus);
								}
							})
							.catch(() => null);
					}
				}}
			/>
		</div>
	);
}
