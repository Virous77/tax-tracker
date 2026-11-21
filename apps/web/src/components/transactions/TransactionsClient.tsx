"use client";

import { istDate, type LedgerTx, type TxType, TxTypeSchema } from "@tax/core";
import { Calculator, CheckCircle2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import {
	AddManualTxDrawer,
	type ManualPreset,
	type SaleContext,
} from "@/components/transactions/AddManualTxDrawer";
import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Pagination } from "@/components/ui/Pagination";
import { Select, SelectItem } from "@/components/ui/Select";
import {
	FALLBACK_TAX_YEARS,
	TaxYearSelect,
} from "@/components/ui/TaxYearSelect";
import {
	api,
	getErrorMessage,
	type ManualVenue,
	type TaxYearInfo,
	type TransactionsPage,
} from "@/lib/client/api";
import { EVM_CHAINS } from "@/lib/client/chains";
import { unresolvedSales, venueForSource } from "@/lib/client/disposals";
import {
	defaultMissingBuyDateTime,
	formatInrNullable,
	formatIstDateTime,
	formatManualVenueLabel,
	formatQty,
	formatTxType,
	pluralise,
} from "@/lib/client/format";
import { groupReviewFlags, REVIEW_CODE_INFO } from "@/lib/client/review-codes";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

const SOURCE_FILTER_OPTIONS: readonly string[] = [
	"binance",
	"binance-api",
	"coindcx",
	"coindcx-api",
	...EVM_CHAINS.map((chain) => `evm:${chain.chainId}`),
	"manual",
];

export function TransactionsClient() {
	const sourceLabel = useSourceLabel();
	const router = useRouter();
	const searchParams = useSearchParams();

	const taxYear = searchParams.get("taxYear") ?? "";
	const asset = searchParams.get("asset") ?? "";
	const type = (searchParams.get("type") ?? "") as TxType | "";
	const source = searchParams.get("source") ?? "";
	const flagged = searchParams.get("flagged") === "true";
	const q = searchParams.get("q") ?? "";
	const sort = (searchParams.get("sort") ?? "timestamp:desc") as
		| "timestamp:desc"
		| "timestamp:asc"
		| "asset:asc"
		| "asset:desc"
		| "source:asc"
		| "source:desc";
	const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
	const addParam = searchParams.get("add");
	const venueParam = searchParams.get("venue");
	const beforeParam = searchParams.get("before");
	const saleParam = searchParams.get("sale");

	const [taxYears, setTaxYears] = useState<TaxYearInfo[]>(FALLBACK_TAX_YEARS);
	const [data, setData] = useState<TransactionsPage | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedTx, setSelectedTx] = useState<LedgerTx | null>(null);
	const [addOpen, setAddOpen] = useState(false);
	const [saleContext, setSaleContext] = useState<SaleContext | null>(null);
	const [savedForYear, setSavedForYear] = useState<string | null>(null);
	const [recompute, setRecompute] = useState<{
		running: boolean;
		message: string | null;
		error: string | null;
	}>({ running: false, message: null, error: null });

	const [searchDraft, setSearchDraft] = useState(q);
	const [assetDraft, setAssetDraft] = useState(asset);

	const assetFilterId = useId();
	const typeFilterId = useId();
	const sourceFilterId = useId();
	const sortFilterId = useId();
	const searchFilterId = useId();
	const flaggedFilterId = useId();

	useEffect(() => {
		setSearchDraft(q);
		setAssetDraft(asset);
	}, [q, asset]);

	useEffect(() => {
		if (
			addParam !== "buy" &&
			addParam !== "gift" &&
			addParam !== "income" &&
			addParam !== "sell"
		) {
			return;
		}
		if (addParam !== "buy" || !saleParam || !taxYear) {
			setSaleContext(null);
			setAddOpen(true);
			return;
		}
		let cancelled = false;
		api
			.getReportOrNull(taxYear)
			.catch(() => null)
			.then((report) => {
				if (cancelled) return;
				const match = report
					? unresolvedSales(report).find(
							(s) =>
								s.txId === saleParam &&
								(!asset || s.asset === asset.toUpperCase()),
						)
					: undefined;
				setSaleContext(
					match?.tx
						? {
								tx: match.tx,
								asset: match.asset,
								quantity: match.quantity,
								taxYear,
							}
						: null,
				);
				setAddOpen(true);
			});
		return () => {
			cancelled = true;
		};
	}, [addParam, saleParam, taxYear, asset]);

	useEffect(() => {
		api
			.getTaxYears()
			.then((list) => {
				if (list.length > 0) setTaxYears(list);
			})
			.catch(() => {});
	}, []);

	const loadTransactions = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await api.listTransactions({
				...(taxYear ? { taxYear } : {}),
				...(asset ? { asset: asset.toUpperCase() } : {}),
				...(type ? { type } : {}),
				...(source ? { source } : {}),
				...(flagged ? { flagged: true } : {}),
				...(q ? { q } : {}),
				sort,
				page,
				pageSize: 50,
			});
			setData(res);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setLoading(false);
		}
	}, [taxYear, asset, type, source, flagged, q, sort, page]);

	useEffect(() => {
		loadTransactions();
	}, [loadTransactions]);

	function updateParams(
		updates: Record<string, string | null>,
		resetPage = true,
	) {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("add");
		params.delete("venue");
		params.delete("before");
		params.delete("sale");
		for (const [k, v] of Object.entries(updates)) {
			if (v === null || v === "") params.delete(k);
			else params.set(k, v);
		}
		if (resetPage) params.delete("page");
		const qs = params.toString();
		router.replace(`/transactions${qs ? `?${qs}` : ""}`);
	}

	function handleSearchSubmit(e: React.FormEvent) {
		e.preventDefault();
		updateParams({
			q: searchDraft.trim() || null,
			asset: assetDraft.trim().toUpperCase() || null,
		});
	}

	const manualPreset: ManualPreset =
		addParam === "gift" || addParam === "income" || addParam === "sell"
			? addParam
			: "buy";
	const initialVenue: ManualVenue = saleContext
		? venueForSource(saleContext.tx)
		: venueParam === "binance" || venueParam === "coindcx"
			? venueParam
			: "manual";
	const saleTimestamp = saleContext?.tx.timestamp ?? beforeParam;

	const initialDateTime =
		manualPreset === "buy"
			? defaultMissingBuyDateTime(
					saleTimestamp,
					taxYears.find((y) => y.id === taxYear),
				)
			: undefined;

	async function handleRecompute(year: string) {
		setRecompute({ running: true, message: null, error: null });
		try {
			const report = await api.computeReport(year);
			const left = new Set(report.unresolved.map((u) => u.txId)).size;
			setRecompute({
				running: false,
				message:
					left === 0
						? `Report recomputed for ${year}: no sales are left out any more.`
						: `Report recomputed for ${year}: ${left} ${pluralise(left, "sale is", "sales are")} still left out.`,
				error: null,
			});
		} catch (err) {
			setRecompute({
				running: false,
				message: null,
				error: getErrorMessage(err),
			});
		}
	}

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Transactions</h1>
					<p className="mt-0.5 text-sm text-[var(--text-secondary)]">
						Normalized ledger across all exchanges and manual entries. Click any
						row to inspect raw data or edit.
					</p>
				</div>
				<button
					type="button"
					onClick={() => setAddOpen(true)}
					className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
				>
					<Plus className="h-4 w-4" aria-hidden="true" />
					Add manual entry
				</button>
			</div>

			{/* Filter bar */}
			<form
				onSubmit={handleSearchSubmit}
				className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:grid-cols-2 lg:grid-cols-6"
			>
				<div>
					<TaxYearSelect
						value={taxYear}
						onChange={(v) => updateParams({ taxYear: v || null })}
						taxYears={taxYears}
						includeAllOption
						label="Year"
						layout="stacked"
					/>
				</div>

				<div>
					<label
						htmlFor={assetFilterId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Asset
					</label>
					<input
						id={assetFilterId}
						type="text"
						placeholder="e.g. BTC"
						value={assetDraft}
						onChange={(e) => setAssetDraft(e.target.value)}
						className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm uppercase placeholder:normal-case"
					/>
				</div>

				<div>
					<label
						htmlFor={typeFilterId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Type
					</label>
					<Select
						id={typeFilterId}
						value={type}
						onValueChange={(value) => updateParams({ type: value || null })}
						className="mt-1 w-full"
					>
						<SelectItem value="">All types</SelectItem>
						{TxTypeSchema.options.map((opt) => (
							<SelectItem key={opt} value={opt}>
								{formatTxType(opt)}
							</SelectItem>
						))}
					</Select>
				</div>

				<div>
					<label
						htmlFor={sourceFilterId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Source
					</label>
					<Select
						id={sourceFilterId}
						value={source}
						onValueChange={(value) => updateParams({ source: value || null })}
						className="mt-1 w-full"
					>
						<SelectItem value="">All sources</SelectItem>
						{SOURCE_FILTER_OPTIONS.map((opt) => (
							<SelectItem key={opt} value={opt}>
								{sourceLabel(opt)}
							</SelectItem>
						))}
						{source && !SOURCE_FILTER_OPTIONS.includes(source) ? (
							<SelectItem value={source}>{sourceLabel(source)}</SelectItem>
						) : null}
					</Select>
				</div>

				<div>
					<label
						htmlFor={sortFilterId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Sort
					</label>
					<Select
						id={sortFilterId}
						value={sort}
						onValueChange={(value) => updateParams({ sort: value })}
						className="mt-1 w-full"
					>
						<SelectItem value="timestamp:desc">Newest first</SelectItem>
						<SelectItem value="timestamp:asc">Oldest first</SelectItem>
						<SelectItem value="asset:asc">Asset A→Z</SelectItem>
						<SelectItem value="asset:desc">Asset Z→A</SelectItem>
						<SelectItem value="source:asc">Source A→Z</SelectItem>
						<SelectItem value="source:desc">Source Z→A</SelectItem>
					</Select>
				</div>

				<div className="flex flex-col justify-between gap-2">
					<div>
						<label
							htmlFor={searchFilterId}
							className="block text-xs font-medium text-[var(--text-secondary)]"
						>
							Search
						</label>
						<div className="mt-1 flex gap-1.5">
							<input
								id={searchFilterId}
								type="text"
								placeholder="Ref, note, hash…"
								value={searchDraft}
								onChange={(e) => setSearchDraft(e.target.value)}
								className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
							/>
							<button
								type="submit"
								aria-label="Apply search and text filters"
								className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 py-1.5 hover:bg-[var(--bg-hover)]"
							>
								<Search className="h-4 w-4" aria-hidden="true" />
							</button>
						</div>
					</div>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-2.5 sm:col-span-2 lg:col-span-6">
					<label
						htmlFor={flaggedFilterId}
						className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]"
					>
						<input
							id={flaggedFilterId}
							type="checkbox"
							checked={flagged}
							onChange={(e) =>
								updateParams({ flagged: e.target.checked ? "true" : null })
							}
						/>
						<span>Flagged for review only</span>
					</label>

					{taxYear || asset || type || source || flagged || q ? (
						<button
							type="button"
							onClick={() => router.replace("/transactions")}
							className="text-xs font-medium text-[var(--accent-text)] hover:underline"
						>
							Clear all filters
						</button>
					) : null}
				</div>
			</form>

			{savedForYear ? (
				<div
					role="status"
					className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--positive)]/40 bg-[var(--positive-soft)] px-4 py-2.5 text-sm"
				>
					<div className="flex items-center gap-2">
						<CheckCircle2
							className="h-4 w-4 shrink-0 text-[var(--positive)]"
							aria-hidden="true"
						/>
						<span>
							{recompute.message ??
								`Transaction added. Recompute the ${savedForYear} report to see its effect.`}
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<button
							type="button"
							disabled={recompute.running}
							onClick={() => handleRecompute(savedForYear)}
							className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
						>
							<Calculator className="h-3.5 w-3.5" aria-hidden="true" />
							{recompute.running ? "Computing…" : "Recompute report"}
						</button>
						<Link
							href={`/report?taxYear=${encodeURIComponent(savedForYear)}#unresolved`}
							className="text-xs font-medium text-[var(--accent-text)] hover:underline"
						>
							Back to the report
						</Link>
					</div>
					{recompute.error ? (
						<p className="w-full text-xs text-[var(--loss)]">
							{recompute.error}
						</p>
					) : null}
				</div>
			) : null}

			{error ? (
				<ErrorBanner message={error} onRetry={loadTransactions} />
			) : null}

			{loading ? (
				<div className="h-64 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			) : !data || data.items.length === 0 ? (
				<EmptyState
					title="No transactions match"
					description={
						taxYear || asset || type || source || flagged || q
							? "Try clearing your filters or selecting another tax year."
							: "No transactions yet — import an export file, connect an exchange, or add a manual transaction."
					}
					action={
						<Link
							href="/import"
							className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
						>
							Import file
						</Link>
					}
				/>
			) : (
				<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
					<div className="overflow-x-auto">
						<table className="w-full border-collapse text-left text-sm">
							<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
								<tr>
									<th className="px-4 py-2.5 font-medium">Date (IST)</th>
									<th className="px-4 py-2.5 font-medium">Type</th>
									<th className="px-4 py-2.5 font-medium">Source</th>
									<th className="num-right px-4 py-2.5 font-medium">In</th>
									<th className="num-right px-4 py-2.5 font-medium">Out</th>
									<th className="num-right px-4 py-2.5 font-medium">
										INR Value
									</th>
									<th className="num-right px-4 py-2.5 font-medium">TDS</th>
									<th className="px-4 py-2.5 font-medium">Flags</th>
								</tr>
							</thead>
							<tbody>
								{data.items.map((tx) => {
									const supersededBy =
										(tx as LedgerTx & { supersededBy?: string | null })
											.supersededBy ?? null;
									const txVenue = (tx as LedgerTx & { venue?: string }).venue;
									return (
										<tr
											key={tx.id}
											className={`border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60 ${
												supersededBy ? "opacity-75" : ""
											}`}
										>
											<td className="px-4 py-2.5 text-xs whitespace-nowrap">
												<button
													type="button"
													onClick={() => setSelectedTx(tx)}
													className="text-left font-medium text-[var(--accent-text)] hover:underline"
												>
													{formatIstDateTime(tx.timestamp)}
												</button>
											</td>
											<td className="px-4 py-2.5 whitespace-nowrap">
												<div className="flex flex-wrap items-center gap-1.5">
													<Badge tone="neutral">
														{formatTxType(tx.type)}
														{tx.incomeKind ? ` · ${tx.incomeKind}` : ""}
													</Badge>
													{supersededBy ? (
														<Badge tone="neutral">Replaced</Badge>
													) : null}
												</div>
											</td>
											<td className="px-4 py-2.5 text-xs whitespace-nowrap text-[var(--text-secondary)]">
												{sourceLabel(tx.source)}
												{tx.source === "manual" &&
												(txVenue === "binance" || txVenue === "coindcx")
													? ` (${formatManualVenueLabel(txVenue)})`
													: ""}
											</td>
											<td className="num-right px-4 py-2.5 whitespace-nowrap">
												{tx.assetIn ? (
													<span>
														{formatQty(tx.amountIn)}{" "}
														<span className="text-xs text-[var(--text-secondary)]">
															{tx.assetIn}
														</span>
													</span>
												) : (
													<span className="text-[var(--text-muted)]">—</span>
												)}
											</td>
											<td className="num-right px-4 py-2.5 whitespace-nowrap">
												{tx.assetOut ? (
													<span>
														{formatQty(tx.amountOut)}{" "}
														<span className="text-xs text-[var(--text-secondary)]">
															{tx.assetOut}
														</span>
													</span>
												) : (
													<span className="text-[var(--text-muted)]">—</span>
												)}
											</td>
											<td className="num-right px-4 py-2.5 font-medium whitespace-nowrap">
												{formatInrNullable(tx.inrValue)}
											</td>
											<td className="num-right px-4 py-2.5 text-xs whitespace-nowrap text-[var(--text-secondary)]">
												{formatInrNullable(tx.tdsInr)}
											</td>
											<td className="px-4 py-2.5">
												<div className="flex flex-wrap gap-1">
													{groupReviewFlags(tx.reviewFlags).map(
														({ code, messages }) => {
															const info = REVIEW_CODE_INFO[code];
															const tone =
																info?.severity === "error"
																	? "loss"
																	: info?.severity === "info"
																		? "accent"
																		: "warning";
															const title =
																messages.length > 0
																	? `${info?.title ?? code}: ${messages.join(" · ")}`
																	: (info?.title ?? code);
															return (
																<span key={code} title={title}>
																	<Badge tone={tone}>
																		<span>{code}</span>
																	</Badge>
																</span>
															);
														},
													)}
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>

					<Pagination
						page={data.page}
						pageSize={data.pageSize}
						total={data.total}
						onPageChange={(next) => updateParams({ page: String(next) }, false)}
					/>
				</div>
			)}

			<TransactionDrawer
				tx={selectedTx}
				onClose={() => setSelectedTx(null)}
				onUpdated={(updated) => {
					setSelectedTx(updated);
					loadTransactions();
				}}
				onDeleted={() => {
					setSelectedTx(null);
					loadTransactions();
				}}
			/>

			<AddManualTxDrawer
				open={addOpen}
				initialPreset={manualPreset}
				initialAsset={asset}
				initialVenue={initialVenue}
				{...(initialDateTime ? { initialDateTime } : {})}
				{...(saleContext
					? { saleContext, initialAmount: saleContext.quantity }
					: {})}
				{...(saleTimestamp && manualPreset === "buy"
					? { notAfter: saleTimestamp }
					: {})}
				onClose={() => {
					setAddOpen(false);
					setSaleContext(null);
					if (addParam || venueParam) {
						updateParams({ add: null, venue: null }, false);
					}
				}}
				onCreated={(created) => {
					setAddOpen(false);
					setSaleContext(null);
					const day = istDate(created.timestamp);
					setSavedForYear(
						taxYear ||
							taxYears.find((y) => day >= y.start && day <= y.end)?.id ||
							null,
					);
					setRecompute({ running: false, message: null, error: null });
					if (addParam || venueParam) {
						updateParams({ add: null, venue: null }, false);
					}
					loadTransactions();
				}}
			/>
		</div>
	);
}
