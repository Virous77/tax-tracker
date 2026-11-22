"use client";

import { D, type UsEquityGainRow, type UsEquityReport } from "@tax/core";
import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
	formatInr,
	formatInrNullable,
	formatIstDate,
	formatQty,
	formatUsdNullable,
	isNegativeDecimal,
	isPositiveDecimal,
	pluralise,
} from "@/lib/client/format";
import { REVIEW_CODE_INFO } from "@/lib/client/review-codes";

function formatPct(decimalRate: string): string {
	try {
		return `${D(decimalRate).mul("100").toDecimalPlaces(2).toString()}%`;
	} catch {
		return decimalRate;
	}
}

export function CapitalGainsTab({
	report,
	taxYear,
	onInspectTrail,
}: {
	report: UsEquityReport;
	taxYear: string;
	onInspectTrail: (row: UsEquityGainRow) => void;
}) {
	const { rows, summary } = report.capitalGains;

	return (
		<div className="space-y-6">
			{/* Unresolved disposals */}
			{report.unresolved.length > 0 ? (
				<section
					aria-label="Unresolved US stock disposals"
					className="space-y-3 rounded-lg border border-[var(--loss)]/40 bg-[var(--loss-soft)] p-4"
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<AlertTriangle
								className="h-4 w-4 text-[var(--loss)]"
								aria-hidden="true"
							/>
							<h3 className="text-sm font-semibold text-[var(--loss)]">
								{report.unresolved.length} unresolved{" "}
								{pluralise(report.unresolved.length, "disposal")} excluded from
								totals
							</h3>
						</div>
						<Link
							href={`/transactions?assetClass=us_equity&add=buy&taxYear=${encodeURIComponent(taxYear)}`}
							className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-text)] hover:underline"
						>
							Add missing US stock buy
							<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
						</Link>
					</div>
					<div className="overflow-x-auto rounded border border-[var(--loss)]/25 bg-[var(--bg-surface)]">
						<table className="w-full border-collapse text-left text-xs">
							<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
								<tr>
									<th className="px-3 py-2 font-medium">Ticker</th>
									<th className="num-right px-3 py-2 font-medium">Quantity</th>
									<th className="px-3 py-2 font-medium">Reason</th>
									<th className="px-3 py-2 text-right font-medium">Action</th>
								</tr>
							</thead>
							<tbody>
								{report.unresolved.map((u) => {
									const tx = report.ledger.find((t) => t.id === u.txId);
									const href = tx
										? `/transactions?assetClass=us_equity&taxYear=${encodeURIComponent(taxYear)}&q=${encodeURIComponent(tx.sourceRef)}`
										: `/transactions?assetClass=us_equity&taxYear=${encodeURIComponent(taxYear)}`;
									return (
										<tr
											key={`${u.txId}:${u.asset}:${u.reason}`}
											className="border-b border-[var(--border)] last:border-b-0"
										>
											<td className="px-3 py-2 font-semibold">{u.asset}</td>
											<td className="num-right px-3 py-2">
												{formatQty(u.quantity)}
											</td>
											<td className="px-3 py-2 text-[var(--text-secondary)]">
												{REVIEW_CODE_INFO[u.reason]?.title ?? u.reason}
											</td>
											<td className="px-3 py-2 text-right whitespace-nowrap">
												<Link
													href={href}
													className="font-medium text-[var(--accent-text)] hover:underline"
												>
													Inspect
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

			{/* Disposal rows table */}
			<section className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="text-base font-semibold tracking-tight">
						Capital Gains Disposals ({rows.length}{" "}
						{pluralise(rows.length, "lot slice")})
					</h3>
					<span className="text-xs text-[var(--text-secondary)]">
						Held &gt; 24 months = Long-Term (12.5%, no indexation) · ≤ 24 months
						= Short-Term (slab rate)
					</span>
				</div>

				{rows.length === 0 ? (
					<EmptyState
						title="No US stock sales in this tax year"
						description="No US equity disposals occurred between 1 April and 31 March."
					/>
				) : (
					<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-left text-xs sm:text-sm">
								<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
									<tr>
										<th className="px-3 py-2.5 font-medium whitespace-nowrap">
											Ticker
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											Qty
										</th>
										<th className="px-3 py-2.5 font-medium whitespace-nowrap">
											Acquired
										</th>
										<th className="px-3 py-2.5 font-medium whitespace-nowrap">
											Sold
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											Days
										</th>
										<th className="px-3 py-2.5 font-medium whitespace-nowrap">
											Term
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											Cost (USD / INR)
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											Proceeds (USD / INR)
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											Gain / Loss (INR)
										</th>
										<th className="px-3 py-2.5 text-right font-medium">
											Trail
										</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((row) => {
										const isLoss = isNegativeDecimal(row.gainInr);
										const isGain = isPositiveDecimal(row.gainInr);
										return (
											<tr
												key={`${row.trail.disposalTxId}:${row.dateOfAcquisition ?? "unk"}:${row.quantity}:${row.trail.lotTxIds.join(",")}`}
												className="border-b border-[var(--border)] align-top last:border-b-0 hover:bg-[var(--bg-hover)]/60"
											>
												<td className="px-3 py-2.5 font-semibold whitespace-nowrap">
													{row.asset}
												</td>
												<td className="num-right px-3 py-2.5 whitespace-nowrap">
													{formatQty(row.quantity)}
												</td>
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
												<td className="num-right px-3 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
													{row.holdingDays !== null ? row.holdingDays : "—"}
												</td>
												<td className="px-3 py-2.5 whitespace-nowrap">
													{row.term === "long" ? (
														<Badge tone="positive">Long-Term</Badge>
													) : row.term === "short" ? (
														<Badge tone="neutral">Short-Term</Badge>
													) : (
														<Badge tone="loss">Unknown</Badge>
													)}
												</td>
												<td className="num-right px-3 py-2.5 whitespace-nowrap">
													<div className="font-medium">
														{formatInrNullable(row.costInr)}
													</div>
													<div className="text-[11px] text-[var(--text-muted)]">
														{formatUsdNullable(row.costUsd)}
														{row.costFx
															? ` · ₹${row.costFx.rate} (${row.costFx.rateDate})`
															: ""}
													</div>
												</td>
												<td className="num-right px-3 py-2.5 whitespace-nowrap">
													<div className="font-medium">
														{formatInrNullable(row.considerationInr)}
													</div>
													<div className="text-[11px] text-[var(--text-muted)]">
														{formatUsdNullable(row.considerationUsd)}
														{row.considerationFx
															? ` · ₹${row.considerationFx.rate} (${row.considerationFx.rateDate})`
															: ""}
													</div>
												</td>
												<td
													className={`num-right px-3 py-2.5 font-semibold whitespace-nowrap ${
														isLoss
															? "text-[var(--loss)]"
															: isGain
																? "text-[var(--positive)]"
																: ""
													}`}
												>
													{formatInrNullable(row.gainInr)}
												</td>
												<td className="px-3 py-2.5 text-right whitespace-nowrap">
													<button
														type="button"
														onClick={() => onInspectTrail(row)}
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

			{/* Loss Set-Off & LTCG Tax Summary */}
			<section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
					<h3 className="text-sm font-semibold">
						Short-Term &amp; Long-Term Breakdown
					</h3>
					<dl className="space-y-1.5 text-xs">
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">
								STCG Consideration
							</dt>
							<dd className="num font-medium">
								{formatInr(summary.shortTerm.considerationInr)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">STCG Cost</dt>
							<dd className="num font-medium">
								{formatInr(summary.shortTerm.costInr)}
							</dd>
						</div>
						<div className="flex justify-between border-b border-[var(--border)] pb-2">
							<dt className="font-medium">Net Short-Term Gain / Loss</dt>
							<dd
								className={`num font-semibold ${
									isNegativeDecimal(summary.shortTerm.netGainInr)
										? "text-[var(--loss)]"
										: ""
								}`}
							>
								{formatInr(summary.shortTerm.netGainInr)}
							</dd>
						</div>
						<div className="flex justify-between pt-1">
							<dt className="text-[var(--text-secondary)]">
								LTCG Consideration
							</dt>
							<dd className="num font-medium">
								{formatInr(summary.longTerm.considerationInr)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">LTCG Cost</dt>
							<dd className="num font-medium">
								{formatInr(summary.longTerm.costInr)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="font-medium">Net Long-Term Gain / Loss</dt>
							<dd
								className={`num font-semibold ${
									isNegativeDecimal(summary.longTerm.netGainInr)
										? "text-[var(--loss)]"
										: ""
								}`}
							>
								{formatInr(summary.longTerm.netGainInr)}
							</dd>
						</div>
					</dl>
				</div>

				<div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
					<h3 className="text-sm font-semibold">
						Capital Loss Set-Off &amp; Carry-Forward
					</h3>
					<dl className="space-y-1.5 text-xs">
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">
								STCL offset against LTCG
							</dt>
							<dd className="num font-medium">
								{formatInr(summary.setOff.stclAgainstLtcgInr)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">
								Net Taxable STCG (slab rate)
							</dt>
							<dd className="num font-semibold">
								{formatInr(summary.setOff.netTaxableStcgInr)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">
								Net Taxable LTCG ({formatPct(summary.ltcgTax.rate)})
							</dt>
							<dd className="num font-semibold">
								{formatInr(summary.setOff.netTaxableLtcgInr)}
							</dd>
						</div>
						<div className="flex justify-between border-t border-[var(--border)] pt-2">
							<dt className="text-[var(--text-secondary)]">
								Carry-forward STCL (8 yrs)
							</dt>
							<dd className="num font-medium text-[var(--loss)]">
								{formatInr(summary.setOff.carryForwardStclInr)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">
								Carry-forward LTCL (8 yrs)
							</dt>
							<dd className="num font-medium text-[var(--loss)]">
								{formatInr(summary.setOff.carryForwardLtclInr)}
							</dd>
						</div>
					</dl>
					<p className="text-[11px] text-[var(--text-muted)]">
						{summary.stcgNote}
					</p>
				</div>

				<div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
					<div className="flex items-center justify-between gap-2">
						<h3 className="text-sm font-semibold">LTCG Tax Computation</h3>
						{summary.ltcgTax.surchargeCapped ? (
							<Badge tone="accent">Surcharge capped at 15%</Badge>
						) : null}
					</div>
					<dl className="space-y-1.5 text-xs">
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">Taxable LTCG</dt>
							<dd className="num font-medium">
								{formatInr(summary.ltcgTax.taxableLtcgInr)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">
								Base LTCG Tax ({formatPct(summary.ltcgTax.rate)})
							</dt>
							<dd className="num font-medium">
								{formatInr(summary.ltcgTax.baseTaxInr)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">
								Surcharge ({formatPct(summary.ltcgTax.surchargeRateApplied)})
							</dt>
							<dd className="num font-medium">
								{formatInr(summary.ltcgTax.surchargeInr)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="text-[var(--text-secondary)]">
								Health &amp; Education Cess (4%)
							</dt>
							<dd className="num font-medium">
								{formatInr(summary.ltcgTax.cessInr)}
							</dd>
						</div>
						<div className="flex justify-between border-t border-[var(--border)] pt-2">
							<dt className="font-semibold">Total LTCG Tax (exact)</dt>
							<dd className="num font-semibold">
								{formatInr(summary.ltcgTax.totalLtcgTaxInr)}
							</dd>
						</div>
						<div className="flex justify-between">
							<dt className="font-semibold">Total LTCG Tax (rounded)</dt>
							<dd className="num font-semibold text-[var(--accent-text)]">
								{formatInr(summary.ltcgTax.totalLtcgTaxRoundedInr)}
							</dd>
						</div>
					</dl>
				</div>
			</section>
		</div>
	);
}
