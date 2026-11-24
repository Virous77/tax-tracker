"use client";

import { ArrowRight, CheckCircle2, Info } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import type {
	Connection,
	ConnectionBalances,
	SyncSummary,
} from "@/lib/client/api";
import { formatIstDateTime, isZeroDecimal } from "@/lib/client/format";

export type IncompleteSyncKind =
	| "synced_with_notes"
	| "incomplete_with_diff"
	| "incomplete_unverified";

export function collectSyncNotes(
	summary: SyncSummary | null | undefined,
): string[] {
	if (!summary) return [];
	const seen = new Set<string>();
	const notes: string[] = [];
	for (const notice of summary.notices) {
		const trimmed = notice.trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			notes.push(trimmed);
		}
	}
	for (const st of summary.streams) {
		const trimmed = st.incomplete?.trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			notes.push(trimmed);
		}
	}
	return notes;
}

export function hasBalanceDifference(
	summary: SyncSummary | null | undefined,
	balances: ConnectionBalances | null | undefined,
): boolean {
	const rows = balances ? balances.rows : summary?.balanceCheck;
	return Boolean(rows?.some((r) => !isZeroDecimal(r.difference)));
}

export function classifyIncompleteSync(
	summary: SyncSummary | null | undefined,
	balances: ConnectionBalances | null | undefined,
): IncompleteSyncKind {
	const rows = balances ? balances.rows : summary?.balanceCheck;
	const balanceChecked = Boolean(
		(balances && balances.fetchedAt !== null) ||
			(summary && summary.balanceCheck.length > 0),
	);
	if (!balanceChecked || !rows) return "incomplete_unverified";
	const hasDiff = rows.some((r) => !isZeroDecimal(r.difference));
	return hasDiff ? "incomplete_with_diff" : "synced_with_notes";
}

function hasIncompleteHistory(
	summary: SyncSummary | null | undefined,
	lastSyncStatus: string | null | undefined,
): boolean {
	if (lastSyncStatus === "incomplete") return true;
	if (!summary) return false;
	if (summary.streams.some((st) => Boolean(st.incomplete))) return true;
	return summary.notices.some((notice) =>
		/incomplete|no deposit\/withdrawal|import .*export|older .*file/i.test(
			notice,
		),
	);
}

export function SyncSummaryPanel({
	summary,
	balances,
	balancesLoading = false,
	balancesError,
	connectionSource,
	connectionKind,
	connectionLastSyncStatus,
}: {
	summary?: SyncSummary | null;
	balances?: ConnectionBalances | null;
	balancesLoading?: boolean;
	balancesError?: string | null;
	connectionSource?: string;
	connectionKind?: Connection["kind"];
	connectionLastSyncStatus?: string | null;
}) {
	if (!summary && !balances && !balancesLoading && !balancesError) return null;

	const manualVenue =
		connectionKind === "binance" || connectionKind === "coindcx"
			? connectionKind
			: null;
	const incompleteHistory = hasIncompleteHistory(
		summary,
		connectionLastSyncStatus,
	);
	const notes = collectSyncNotes(summary);
	const mismatch = hasBalanceDifference(summary, balances);

	return (
		<div className="space-y-4 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-4 text-xs">
			{summary ? (
				<>
					{/* Per-stream summary */}
					<div className="space-y-2">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<h4 className="font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
								Sync Streams
							</h4>
							<Link
								href="/imports"
								className="font-medium text-[var(--accent-text)] hover:underline"
							>
								View in Imports
							</Link>
						</div>
						<div className="min-w-0 overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg-surface)]">
							<table className="w-full border-collapse text-left text-xs">
								<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
									<tr>
										<th className="px-3 py-2 font-medium whitespace-nowrap">
											Stream
										</th>
										<th className="num-right px-3 py-2 font-medium whitespace-nowrap">
											Fetched
										</th>
										<th className="num-right px-3 py-2 font-medium whitespace-nowrap">
											Inserted
										</th>
										<th className="num-right px-3 py-2 font-medium whitespace-nowrap">
											Duplicate
										</th>
										<th className="num-right px-3 py-2 font-medium whitespace-nowrap">
											Flagged
										</th>
										<th className="px-3 py-2 font-medium whitespace-nowrap">
											Incomplete
										</th>
									</tr>
								</thead>
								<tbody>
									{summary.streams.length === 0 ? (
										<tr>
											<td
												colSpan={6}
												className="px-3 py-4 text-center text-[var(--text-muted)] whitespace-normal"
											>
												No streams reported.
											</td>
										</tr>
									) : (
										summary.streams.map((st) => (
											<tr
												key={st.stream}
												className="border-b border-[var(--border)] last:border-b-0"
											>
												<td className="font-mono-code px-3 py-2 font-medium whitespace-nowrap">
													{st.stream}
												</td>
												<td className="num-right px-3 py-2 whitespace-nowrap">
													{st.rowsFetched}
												</td>
												<td className="num-right px-3 py-2 text-[var(--positive)] whitespace-nowrap">
													{st.rowsInserted}
												</td>
												<td className="num-right px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">
													{st.rowsDuplicate}
												</td>
												<td className="num-right px-3 py-2 whitespace-nowrap">
													{st.rowsFlagged > 0 ? (
														<Link
															href={
																connectionSource
																	? `/transactions?flagged=true&source=${encodeURIComponent(connectionSource)}`
																	: "/review"
															}
															className="font-medium text-[var(--warning)] underline"
														>
															{st.rowsFlagged}
														</Link>
													) : (
														<span className="text-[var(--text-muted)]">0</span>
													)}
												</td>
												<td className="min-w-[240px] px-3 py-2 whitespace-normal">
													{st.incomplete ? (
														<span className="text-[var(--warning)]">
															{st.incomplete}
														</span>
													) : (
														<span className="text-[var(--text-muted)]">—</span>
													)}
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
					</div>

					{/* Notes */}
					{notes.length > 0 ? (
						<div className="space-y-1.5">
							<h4 className="font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
								{mismatch ? "Notices" : "Notes"} ({notes.length})
							</h4>
							<ul className="space-y-1">
								{notes.map((note) => (
									<li
										key={note}
										className={`flex items-start gap-2 rounded border bg-[var(--bg-surface)] px-3 py-2 text-[var(--text-primary)] ${mismatch ? "border-[var(--warning)]" : "border-[var(--border-strong)]"}`}
									>
										<Info
											className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]"
											aria-hidden="true"
										/>
										<span>{note}</span>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</>
			) : null}

			{connectionKind === "coindcx" ? (
				<div className="flex items-start gap-2 rounded border border-[var(--warning)]/40 bg-[var(--bg-surface)] px-3 py-2 text-[var(--text-secondary)]">
					<Info
						className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]"
						aria-hidden="true"
					/>
					<p>
						CoinDCX API sync only includes{" "}
						<strong className="font-medium text-[var(--text-primary)]">
							Spot Orderbook trades
						</strong>{" "}
						— not Instant Buy/Sell orders, deposits/withdrawals, Earn/SIP, or
						TDS / Form 16A.{" "}
						<Link
							href="/import"
							className="font-medium text-[var(--accent-text)] underline"
						>
							Import CoinDCX XLSX &amp; Form 16A files
						</Link>{" "}
						for a complete ledger.
					</p>
				</div>
			) : null}

			{/* Balance check */}
			<div className="space-y-2">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<h4 className="font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
						Balance Check
					</h4>
					{balances?.fetchedAt ? (
						<span className="text-[11px] text-[var(--text-muted)]">
							Fetched {formatIstDateTime(balances.fetchedAt)}
						</span>
					) : null}
				</div>

				{balancesLoading ? (
					<div className="h-20 animate-pulse rounded border border-[var(--border)] bg-[var(--bg-surface)]" />
				) : balancesError ? (
					<p className="rounded border border-[var(--loss)]/40 bg-[var(--loss-soft)] px-3 py-2 text-[var(--loss)]">
						{balancesError}
					</p>
				) : balances ? (
					<div className="min-w-0 overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg-surface)]">
						<table className="w-full border-collapse text-left text-xs">
							<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
								<tr>
									<th className="px-3 py-2 font-medium whitespace-nowrap">
										Asset
									</th>
									<th className="num-right px-3 py-2 font-medium whitespace-nowrap">
										Fetched
									</th>
									<th className="num-right px-3 py-2 font-medium whitespace-nowrap">
										Computed
									</th>
									<th className="num-right px-3 py-2 font-medium whitespace-nowrap">
										Difference
									</th>
									<th className="px-3 py-2 text-right font-medium whitespace-nowrap">
										Status
									</th>
								</tr>
							</thead>
							<tbody>
								{balances.rows.length === 0 ? (
									<tr>
										<td
											colSpan={5}
											className="px-3 py-4 text-center text-[var(--text-muted)] whitespace-normal"
										>
											No balances recorded yet.
										</td>
									</tr>
								) : (
									balances.rows.map((row) => {
										const nonZero = !isZeroDecimal(row.difference);
										const highlight = row.flagged || nonZero;
										const showAddMissing =
											highlight && manualVenue !== null && incompleteHistory;
										const addMissingHref = manualVenue
											? `/transactions?add=buy&asset=${encodeURIComponent(row.asset)}&venue=${encodeURIComponent(manualVenue)}`
											: null;
										return (
											<tr
												key={row.asset}
												className={`border-b border-[var(--border)] last:border-b-0 ${
													highlight ? "bg-[var(--warning-soft)]/50" : ""
												}`}
											>
												<td className="px-3 py-2 font-semibold whitespace-nowrap">
													{row.asset}
												</td>
												<td className="font-mono-code num-right px-3 py-2 whitespace-nowrap">
													{row.fetched}
												</td>
												<td className="font-mono-code num-right px-3 py-2 whitespace-nowrap">
													{row.computed}
												</td>
												<td
													className={`font-mono-code num-right px-3 py-2 whitespace-nowrap ${
														highlight
															? "font-semibold text-[var(--warning)]"
															: "text-[var(--text-secondary)]"
													}`}
												>
													{row.difference}
												</td>
												<td className="px-3 py-2 text-right whitespace-nowrap">
													{row.flagged ? (
														<div className="inline-flex flex-wrap items-center justify-end gap-2">
															{showAddMissing && addMissingHref ? (
																<Link
																	href={addMissingHref}
																	className="inline-flex items-center gap-1 rounded bg-[var(--accent-soft)] px-2 py-0.5 font-medium text-[var(--accent-text)] hover:underline"
																>
																	Add missing transaction
																</Link>
															) : null}
															<Link
																href="/review"
																className="inline-flex items-center gap-1 rounded bg-[var(--warning-soft)] px-2 py-0.5 font-medium text-[var(--warning)] hover:underline"
															>
																Flagged · Review
																<ArrowRight
																	className="h-3 w-3"
																	aria-hidden="true"
																/>
															</Link>
														</div>
													) : nonZero ? (
														<div className="inline-flex flex-wrap items-center justify-end gap-2">
															{showAddMissing && addMissingHref ? (
																<Link
																	href={addMissingHref}
																	className="inline-flex items-center gap-1 rounded bg-[var(--accent-soft)] px-2 py-0.5 font-medium text-[var(--accent-text)] hover:underline"
																>
																	Add missing transaction
																</Link>
															) : null}
															<Badge tone="warning">Difference</Badge>
														</div>
													) : (
														<span className="inline-flex items-center gap-1 text-[var(--positive)]">
															<CheckCircle2
																className="h-3.5 w-3.5"
																aria-hidden="true"
															/>
															Matched
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
				) : null}
			</div>
		</div>
	);
}
