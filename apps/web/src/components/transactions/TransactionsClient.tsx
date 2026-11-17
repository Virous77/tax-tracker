"use client";

import { type LedgerTx, type TxType, TxTypeSchema } from "@tax/core";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import {
	AddManualTxDrawer,
	type ManualPreset,
} from "@/components/transactions/AddManualTxDrawer";
import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Pagination } from "@/components/ui/Pagination";
import {
	FALLBACK_TAX_YEARS,
	TaxYearSelect,
} from "@/components/ui/TaxYearSelect";
import {
	api,
	getErrorMessage,
	type TaxYearInfo,
	type TransactionsPage,
} from "@/lib/client/api";
import { EVM_CHAINS } from "@/lib/client/chains";
import {
	formatInrNullable,
	formatIstDateTime,
	formatQty,
	formatSourceLabel,
	formatTxType,
} from "@/lib/client/format";
import { REVIEW_CODE_INFO } from "@/lib/client/review-codes";

const SOURCE_FILTER_OPTIONS: readonly string[] = [
	"binance",
	"binance-api",
	"coindcx",
	"coindcx-api",
	...EVM_CHAINS.map((chain) => `evm:${chain.chainId}`),
	"manual",
];

export function TransactionsClient() {
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

	const [taxYears, setTaxYears] = useState<TaxYearInfo[]>(FALLBACK_TAX_YEARS);
	const [data, setData] = useState<TransactionsPage | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedTx, setSelectedTx] = useState<LedgerTx | null>(null);
	const [addOpen, setAddOpen] = useState(false);

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
			addParam === "buy" ||
			addParam === "gift" ||
			addParam === "income" ||
			addParam === "sell"
		) {
			setAddOpen(true);
		}
	}, [addParam]);

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
						className="flex-col items-stretch! gap-1!"
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
						className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm uppercase"
					/>
				</div>

				<div>
					<label
						htmlFor={typeFilterId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Type
					</label>
					<select
						id={typeFilterId}
						value={type}
						onChange={(e) => updateParams({ type: e.target.value || null })}
						className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
					>
						<option value="">All types</option>
						{TxTypeSchema.options.map((opt) => (
							<option key={opt} value={opt}>
								{formatTxType(opt)}
							</option>
						))}
					</select>
				</div>

				<div>
					<label
						htmlFor={sourceFilterId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Source
					</label>
					<select
						id={sourceFilterId}
						value={source}
						onChange={(e) => updateParams({ source: e.target.value || null })}
						className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
					>
						<option value="">All sources</option>
						{SOURCE_FILTER_OPTIONS.map((opt) => (
							<option key={opt} value={opt}>
								{formatSourceLabel(opt)}
							</option>
						))}
						{source && !SOURCE_FILTER_OPTIONS.includes(source) ? (
							<option value={source}>{formatSourceLabel(source)}</option>
						) : null}
					</select>
				</div>

				<div>
					<label
						htmlFor={sortFilterId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Sort
					</label>
					<select
						id={sortFilterId}
						value={sort}
						onChange={(e) => updateParams({ sort: e.target.value })}
						className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-sm"
					>
						<option value="timestamp:desc">Newest first</option>
						<option value="timestamp:asc">Oldest first</option>
						<option value="asset:asc">Asset A→Z</option>
						<option value="asset:desc">Asset Z→A</option>
						<option value="source:asc">Source A→Z</option>
						<option value="source:desc">Source Z→A</option>
					</select>
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
							: "No transactions yet — import an export file or add a manual transaction."
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
								{data.items.map((tx) => (
									<tr
										key={tx.id}
										className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60"
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
											<Badge tone="neutral">
												{formatTxType(tx.type)}
												{tx.incomeKind ? ` · ${tx.incomeKind}` : ""}
											</Badge>
										</td>
										<td className="px-4 py-2.5 text-xs whitespace-nowrap text-[var(--text-secondary)]">
											{formatSourceLabel(tx.source)}
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
												{[
													...new Set(tx.reviewFlags.map((flag) => flag.code)),
												].map((code) => {
													const info = REVIEW_CODE_INFO[code];
													const tone =
														info?.severity === "error"
															? "loss"
															: info?.severity === "info"
																? "accent"
																: "warning";
													return (
														<span key={code} title={info?.title ?? code}>
															<Badge tone={tone}>{code}</Badge>
														</span>
													);
												})}
											</div>
										</td>
									</tr>
								))}
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
				onClose={() => {
					setAddOpen(false);
					if (addParam) updateParams({ add: null }, false);
				}}
				onCreated={() => {
					setAddOpen(false);
					if (addParam) updateParams({ add: null }, false);
					loadTransactions();
				}}
			/>
		</div>
	);
}
