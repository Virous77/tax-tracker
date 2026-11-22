"use client";

import { D, type UsEquityDividendRow, type UsEquityReport } from "@tax/core";
import { Info } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import {
	formatInrNullable,
	formatIstDate,
	formatUsdNullable,
	pluralise,
} from "@/lib/client/format";

function formatRatePct(rate: string | null | undefined): string {
	if (!rate) return "—";
	try {
		return `${D(rate).mul("100").toDecimalPlaces(2).toString()}%`;
	} catch {
		return rate;
	}
}

export function DividendsForm67Tab({ report }: { report: UsEquityReport }) {
	const [inspectRow, setInspectRow] = useState<UsEquityDividendRow | null>(
		null,
	);
	const { rows: divRows, totals: divTotals } = report.dividends;
	const { rows: f67Rows, totals: f67Totals, notes } = report.form67;

	return (
		<div className="space-y-6">
			{/* Dividends table */}
			<section className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="text-base font-semibold tracking-tight">
						US Stock Dividends ({divRows.length}{" "}
						{pluralise(divRows.length, "payout")})
					</h3>
					<span className="text-xs text-[var(--text-secondary)]">
						Taxed at normal slab rates under Income from Other Sources
					</span>
				</div>

				{divRows.length === 0 ? (
					<EmptyState
						title="No US stock dividends in this tax year"
						description="No dividend or foreign withholding tax rows occurred between 1 April and 31 March."
					/>
				) : (
					<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-left text-xs sm:text-sm">
								<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
									<tr>
										<th className="px-3 py-2.5 font-medium whitespace-nowrap">
											Date
										</th>
										<th className="px-3 py-2.5 font-medium whitespace-nowrap">
											Ticker
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											Gross (USD)
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											Tax Withheld (USD)
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											WHT %
										</th>
										<th className="px-3 py-2.5 font-medium whitespace-nowrap">
											SBI TT Rate &amp; Date
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											Gross (INR)
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											Tax Withheld (INR)
										</th>
										<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
											Net (INR)
										</th>
										<th className="px-3 py-2.5 text-right font-medium">Raw</th>
									</tr>
								</thead>
								<tbody>
									{divRows.map((row) => (
										<tr
											key={row.txId}
											className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]/60"
										>
											<td className="px-3 py-2.5 whitespace-nowrap">
												{formatIstDate(row.date)}
											</td>
											<td className="px-3 py-2.5 font-semibold whitespace-nowrap">
												{row.asset ?? "—"}
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap">
												{formatUsdNullable(row.grossUsd)}
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap">
												{formatUsdNullable(row.taxWithheldUsd)}
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
												{formatRatePct(row.withholdingRate)}
											</td>
											<td className="num px-3 py-2.5 text-xs whitespace-nowrap text-[var(--text-secondary)]">
												{row.fx
													? `₹${row.fx.rate} (${formatIstDate(row.fx.rateDate)})`
													: "Unavailable"}
											</td>
											<td className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
												{formatInrNullable(row.grossInr)}
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap">
												{formatInrNullable(row.taxWithheldInr)}
											</td>
											<td className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
												{formatInrNullable(row.netInr)}
											</td>
											<td className="px-3 py-2.5 text-right whitespace-nowrap">
												<button
													type="button"
													onClick={() => setInspectRow(row)}
													className="rounded border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
												>
													Raw
												</button>
											</td>
										</tr>
									))}
								</tbody>
								<tfoot className="border-t border-[var(--border-strong)] bg-[var(--bg-subtle)] text-xs font-semibold">
									<tr>
										<td colSpan={2} className="px-3 py-2.5">
											Total
										</td>
										<td className="num-right px-3 py-2.5 whitespace-nowrap">
											{formatUsdNullable(divTotals.grossUsd)}
										</td>
										<td className="num-right px-3 py-2.5 whitespace-nowrap">
											{formatUsdNullable(divTotals.taxWithheldUsd)}
										</td>
										<td colSpan={2} />
										<td className="num-right px-3 py-2.5 whitespace-nowrap">
											{formatInrNullable(divTotals.grossInr)}
										</td>
										<td className="num-right px-3 py-2.5 whitespace-nowrap">
											{formatInrNullable(divTotals.taxWithheldInr)}
										</td>
										<td className="num-right px-3 py-2.5 whitespace-nowrap">
											{formatInrNullable(divTotals.netInr)}
										</td>
										<td />
									</tr>
								</tfoot>
							</table>
						</div>
					</div>
				)}
			</section>

			{/* Form 67 Worksheet */}
			<section className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h3 className="text-base font-semibold tracking-tight">
							Form 67 Foreign Tax Credit Worksheet
						</h3>
						<p className="text-xs text-[var(--text-secondary)]">
							{report.form67.countryName} (Country code{" "}
							{report.form67.countryCode}) · {report.form67.dtaaArticle}
						</p>
					</div>
					<Badge tone="neutral">File before ITR due date</Badge>
				</div>

				<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
					<div className="overflow-x-auto">
						<table className="w-full border-collapse text-left text-xs sm:text-sm">
							<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
								<tr>
									<th className="px-3 py-2.5 font-medium whitespace-nowrap">
										Country &amp; Code
									</th>
									<th className="px-3 py-2.5 font-medium whitespace-nowrap">
										Nature of Income
									</th>
									<th className="px-3 py-2.5 font-medium whitespace-nowrap">
										DTAA Article
									</th>
									<th className="px-3 py-2.5 font-medium whitespace-nowrap">
										Ticker
									</th>
									<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
										Foreign Income (INR)
									</th>
									<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
										Foreign Tax Paid (USD / INR)
									</th>
									<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
										Max Eligible Credit (INR)
									</th>
								</tr>
							</thead>
							<tbody>
								{f67Rows.length === 0 ? (
									<tr>
										<td
											colSpan={7}
											className="px-4 py-6 text-center text-xs text-[var(--text-muted)]"
										>
											No foreign tax credit entries for this tax year.
										</td>
									</tr>
								) : (
									f67Rows.map((row) => (
										<tr
											key={`${row.countryCode}:${row.asset ?? "ALL"}:${row.txIds.join(",")}`}
											className="border-b border-[var(--border)] last:border-b-0"
										>
											<td className="px-3 py-2.5 whitespace-nowrap">
												{row.countryName} ({row.countryCode})
											</td>
											<td className="px-3 py-2.5 whitespace-nowrap">
												{row.natureOfIncome}
											</td>
											<td className="px-3 py-2.5 whitespace-nowrap">
												{row.dtaaArticle}
											</td>
											<td className="px-3 py-2.5 font-semibold whitespace-nowrap">
												{row.asset ?? "Unmatched"}
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap">
												<div className="font-medium">
													{formatInrNullable(row.foreignIncomeInr)}
												</div>
												<div className="text-[11px] text-[var(--text-muted)]">
													{formatUsdNullable(row.foreignIncomeUsd)}
												</div>
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap">
												<div className="font-medium">
													{formatInrNullable(row.foreignTaxPaidInr)}
												</div>
												<div className="text-[11px] text-[var(--text-muted)]">
													{formatUsdNullable(row.foreignTaxPaidUsd)}
													{row.effectiveForeignTaxRate
														? ` (${formatRatePct(row.effectiveForeignTaxRate)})`
														: ""}
												</div>
											</td>
											<td className="num-right px-3 py-2.5 font-semibold whitespace-nowrap text-[var(--positive)]">
												{formatInrNullable(row.maxCreditEligibleInr)}
											</td>
										</tr>
									))
								)}
							</tbody>
							{f67Rows.length > 0 ? (
								<tfoot className="border-t border-[var(--border-strong)] bg-[var(--bg-subtle)] text-xs font-semibold">
									<tr>
										<td colSpan={4} className="px-3 py-2.5">
											Total
										</td>
										<td className="num-right px-3 py-2.5 whitespace-nowrap">
											{formatInrNullable(f67Totals.foreignIncomeInr)}{" "}
											<span className="font-normal text-[var(--text-muted)]">
												({formatUsdNullable(f67Totals.foreignIncomeUsd)})
											</span>
										</td>
										<td className="num-right px-3 py-2.5 whitespace-nowrap">
											{formatInrNullable(f67Totals.foreignTaxPaidInr)}{" "}
											<span className="font-normal text-[var(--text-muted)]">
												({formatUsdNullable(f67Totals.foreignTaxPaidUsd)})
											</span>
										</td>
										<td className="num-right px-3 py-2.5 whitespace-nowrap text-[var(--positive)]">
											{formatInrNullable(f67Totals.maxCreditEligibleInr)}
										</td>
									</tr>
								</tfoot>
							) : null}
						</table>
					</div>
				</div>

				{notes.length > 0 ? (
					<div className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-4 text-xs text-[var(--text-secondary)]">
						<p className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
							<Info
								className="h-3.5 w-3.5 text-[var(--accent-text)]"
								aria-hidden="true"
							/>
							Form 67 Filing Notes
						</p>
						<ul className="list-disc space-y-1 pl-5">
							{notes.map((note) => (
								<li key={note}>{note}</li>
							))}
						</ul>
					</div>
				) : null}
			</section>

			<Drawer
				open={Boolean(inspectRow)}
				onClose={() => setInspectRow(null)}
				title={
					inspectRow
						? `Raw Dividend Trail · ${inspectRow.asset ?? "Dividend"}`
						: "Raw Trail"
				}
				subtitle={inspectRow ? formatIstDate(inspectRow.date) : undefined}
			>
				<pre className="font-mono-code overflow-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs text-[var(--text-secondary)]">
					{JSON.stringify(inspectRow?.trail, null, 2)}
				</pre>
			</Drawer>
		</div>
	);
}
