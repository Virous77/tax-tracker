"use client";

import { type ActualBalance, D, type UsEquityReport } from "@tax/core";
import { CheckCircle2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { api, getErrorMessage } from "@/lib/client/api";
import { formatQty, isZeroDecimal } from "@/lib/client/format";
import { useSourceLabel } from "@/lib/client/useSourceLabel";

function balanceKey(asset: string, source?: string): string {
	return `${asset}::${source ?? ""}`;
}

export function EquityHoldingsTab({
	report,
	taxYear,
	savedActuals,
	onReportUpdated,
}: {
	report: UsEquityReport;
	taxYear: string;
	savedActuals: ActualBalance[];
	onReportUpdated: (report: UsEquityReport, actuals: ActualBalance[]) => void;
}) {
	const sourceLabel = useSourceLabel();
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [savedMsg, setSavedMsg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const next: Record<string, string> = {};
		for (const b of report.balances) {
			if (b.actual !== undefined) {
				next[balanceKey(b.asset, b.source)] = b.actual;
			}
		}
		for (const a of savedActuals) {
			next[balanceKey(a.asset, a.source)] = a.amount;
		}
		setDrafts(next);
	}, [report.balances, savedActuals]);

	async function handleSave() {
		setSaving(true);
		setError(null);
		setSavedMsg(null);
		try {
			const payload: ActualBalance[] = [];
			for (const row of report.balances) {
				const raw = drafts[balanceKey(row.asset, row.source)]?.trim();
				if (raw) {
					payload.push({
						asset: row.asset,
						...(row.source ? { source: row.source } : {}),
						amount: raw,
					});
				}
			}
			const nextActuals = await api.putUsEquityActualBalances(taxYear, payload);
			const nextReport = await api.computeUsEquityReport(taxYear);
			onReportUpdated(nextReport, nextActuals);
			setSavedMsg("Actual US stock balances saved and reconciled.");
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<section className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h3 className="text-base font-semibold tracking-tight">
						Year-End Share Holdings ({report.balances.length})
					</h3>
					<p className="text-xs text-[var(--text-secondary)]">
						Compare computed 31 March share holdings against your broker
						statement (Difference = Actual − Computed).
					</p>
				</div>
				{report.balances.length > 0 ? (
					<button
						type="button"
						disabled={saving}
						onClick={handleSave}
						className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
					>
						<Save className="h-3.5 w-3.5" aria-hidden="true" />
						{saving ? "Saving…" : "Save actual balances"}
					</button>
				) : null}
			</div>

			{error ? <ErrorBanner message={error} /> : null}
			{savedMsg ? (
				<p
					aria-live="polite"
					className="flex items-center gap-2 rounded border border-[var(--positive)]/40 bg-[var(--positive-soft)] px-3 py-2 text-xs text-[var(--positive)]"
				>
					<CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
					{savedMsg}
				</p>
			) : null}

			<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-left text-sm">
						<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
							<tr>
								<th className="px-4 py-2.5 font-medium">Ticker</th>
								<th className="px-4 py-2.5 font-medium">Pool / Source</th>
								<th className="num-right px-4 py-2.5 font-medium">Computed</th>
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
										No US stock share holdings at 31 March.
									</td>
								</tr>
							) : (
								report.balances.map((b) => {
									const key = balanceKey(b.asset, b.source);
									const draft = drafts[key] ?? "";
									let liveDiff: string | null = b.difference ?? null;
									if (draft.trim() !== "") {
										try {
											liveDiff = D(draft.trim()).minus(b.computed).toFixed();
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
											<td className="px-4 py-2.5 font-semibold">{b.asset}</td>
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
														setDrafts((prev) => ({
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
		</section>
	);
}
