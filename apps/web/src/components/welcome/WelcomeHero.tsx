"use client";

import { ArrowRight, BookOpen, FileCheck2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { buildPreviewData, type WelcomeYear } from "./welcome-data";

export function WelcomeHero({
	years,
	selectedYear,
	onSelectYear,
}: {
	years: readonly [WelcomeYear, ...WelcomeYear[]];
	selectedYear: WelcomeYear;
	onSelectYear: (taxYear: string) => void;
}) {
	const [previewTab, setPreviewTab] = useState<"vda" | "equity">("vda");
	const preview = buildPreviewData(selectedYear.vda, selectedYear.equity);
	const pendingVerification =
		selectedYear.vda.sectionsVerified === false ||
		selectedYear.equity.sectionsVerified === false;

	return (
		<section className="mx-auto max-w-6xl px-4 pt-10 pb-14 sm:px-6 sm:pt-14 lg:px-8 lg:pt-16">
			<div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-12">
				<div className="space-y-6">
					<div className="flex flex-wrap items-center gap-2">
						<Badge tone="accent">
							Free · Open Source (AGPL-3.0) · Local-First · Installable PWA
						</Badge>
						{pendingVerification ? (
							<Badge tone="warning">Pending CA verification</Badge>
						) : null}
					</div>

					<h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-4xl lg:text-[2.6rem] lg:leading-[1.14]">
						Indian Crypto &amp; US Stock Tax Workpapers — Without Uploading Your
						Financial Life to the Cloud.
					</h1>

					<p className="max-w-2xl text-base leading-relaxed text-[var(--text-secondary)]">
						Prepare auditable Indian income-tax worksheets—Schedule VDA, TDS
						reconciliation, US stock capital gains, dividends &amp; Form 67, and
						calendar-year{" "}
						<span className="font-medium text-[var(--text-primary)]">
							{selectedYear.equity.sections.foreignAssets}
						</span>
						—on your own machine or private server. Live rule files cover{" "}
						<span className="num font-medium text-[var(--text-primary)]">
							{years.map((y) => `${y.vda.taxYear} (${y.vda.act})`).join(" & ")}
						</span>
						.
					</p>

					<div className="flex flex-wrap items-center gap-3 pt-1">
						<Link
							href="/"
							className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
						>
							<span>Launch Local Workspace</span>
							<ArrowRight className="h-4 w-4" aria-hidden="true" />
						</Link>
						<Link
							href="/docs"
							className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
						>
							<BookOpen
								className="h-4 w-4 text-[var(--accent-text)]"
								aria-hidden="true"
							/>
							<span>Read Calculation Docs</span>
						</Link>
						<Link
							href="/import"
							className="inline-flex items-center gap-1.5 rounded-md px-3 py-2.5 text-sm font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-soft)]"
						>
							<Sparkles className="h-4 w-4" aria-hidden="true" />
							<span>Try Sample Data</span>
						</Link>
					</div>

					<div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-5 text-xs text-[var(--text-muted)]">
						<span className="font-medium text-[var(--text-secondary)]">
							Previewing live rules:
						</span>
						<fieldset
							aria-label="Select tax year rules to preview"
							className="inline-flex gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-0.5"
						>
							{years.map(({ vda }) => {
								const active = selectedYear.vda.taxYear === vda.taxYear;
								return (
									<button
										key={vda.taxYear}
										type="button"
										aria-pressed={active}
										onClick={() => onSelectYear(vda.taxYear)}
										className={`num rounded px-2.5 py-1 text-xs font-medium transition-colors ${
											active
												? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
												: "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
										}`}
									>
										{vda.taxYear}
									</button>
								);
							})}
						</fieldset>
						<span className="num">
							{selectedYear.vda.period.start} → {selectedYear.vda.period.end}{" "}
							IST
						</span>
					</div>
				</div>

				{/* Live Product Preview Mockup Card (synthetic figures computed from live rules) */}
				<aside
					aria-label="Synthetic product preview"
					className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm"
				>
					<div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-3">
						<div className="flex items-center gap-2">
							<FileCheck2
								className="h-4 w-4 text-[var(--accent-text)]"
								aria-hidden="true"
							/>
							<span className="text-xs font-semibold text-[var(--text-primary)]">
								Workpaper Preview · Synthetic Data
							</span>
						</div>
						<div className="inline-flex gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-0.5">
							<button
								type="button"
								aria-pressed={previewTab === "vda"}
								onClick={() => setPreviewTab("vda")}
								className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
									previewTab === "vda"
										? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
										: "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
								}`}
							>
								Schedule VDA
							</button>
							<button
								type="button"
								aria-pressed={previewTab === "equity"}
								onClick={() => setPreviewTab("equity")}
								className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
									previewTab === "equity"
										? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
										: "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
								}`}
							>
								US Stocks &amp; FA
							</button>
						</div>
					</div>

					<div className="space-y-4 p-4 sm:p-5">
						{previewTab === "vda" ? (
							<>
								<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
									<span className="font-medium text-[var(--text-secondary)]">
										{preview.vda.act} · TY {preview.vda.taxYear}
									</span>
									<span className="num rounded bg-[var(--accent-soft)] px-2 py-0.5 font-medium text-[var(--accent-text)]">
										{preview.vda.sectionTax} · {preview.vda.rateLabel}
									</span>
								</div>

								<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
									<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
										<p className="text-[11px] text-[var(--text-muted)]">
											Taxable VDA Gain
										</p>
										<p className="num mt-1 text-sm font-semibold text-[var(--positive)]">
											{preview.vda.gainInr}
										</p>
									</div>
									<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
										<p className="text-[11px] text-[var(--text-muted)]">
											Tax + Cess ({preview.vda.cessLabel})
										</p>
										<p className="num mt-1 text-sm font-semibold text-[var(--text-primary)]">
											{preview.vda.baseTaxInr} + {preview.vda.cessInr}
										</p>
									</div>
									<div className="col-span-2 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 sm:col-span-1">
										<p className="text-[11px] text-[var(--text-muted)]">
											{preview.vda.sectionTds} ({preview.vda.tdsRateLabel})
										</p>
										<p className="num mt-1 text-sm font-semibold text-[var(--text-primary)]">
											{preview.vda.estimatedTdsInr}
										</p>
									</div>
								</div>

								<div className="overflow-x-auto rounded-lg border border-[var(--border)]">
									<table className="w-full text-left text-xs">
										<thead className="bg-[var(--bg-subtle)] text-[var(--text-muted)]">
											<tr>
												<th scope="col" className="px-3 py-2 font-medium">
													Asset
												</th>
												<th scope="col" className="px-3 py-2 font-medium">
													Qty
												</th>
												<th
													scope="col"
													className="px-3 py-2 text-right font-medium"
												>
													Cost
												</th>
												<th
													scope="col"
													className="px-3 py-2 text-right font-medium"
												>
													Proceeds
												</th>
											</tr>
										</thead>
										<tbody>
											<tr className="border-t border-[var(--border)]">
												<td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">
													{preview.vda.asset}
												</td>
												<td className="num px-3 py-2.5 text-[var(--text-secondary)]">
													{preview.vda.quantity}
												</td>
												<td className="num-right px-3 py-2.5 text-[var(--text-secondary)]">
													{preview.vda.costInr}
												</td>
												<td className="num-right px-3 py-2.5 font-medium text-[var(--text-primary)]">
													{preview.vda.considerationInr}
												</td>
											</tr>
										</tbody>
									</table>
								</div>

								<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs">
									<div className="flex items-center justify-between gap-2">
										<span className="font-medium text-[var(--text-primary)]">
											Audit Trail · Lot-by-lot match
										</span>
										<Badge tone="positive">Raw row preserved</Badge>
									</div>
									<p className="mt-1.5 text-[var(--text-secondary)]">
										FIFO lot matched across venues · Original Binance Spot CSV
										row attached · Manual edits never overwritten on re-import.
									</p>
								</div>
							</>
						) : (
							<>
								<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
									<span className="font-medium text-[var(--text-secondary)]">
										{preview.equity.sectionForeignAssets} · CY{" "}
										<span className="num">{preview.equity.scheduleFaCy}</span>
									</span>
									<span className="num rounded bg-[var(--accent-soft)] px-2 py-0.5 font-medium text-[var(--accent-text)]">
										LTCG {preview.equity.longTermRateLabel} (
										{preview.equity.holdingMonthsLabel})
									</span>
								</div>

								<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
									<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
										<p className="text-[11px] text-[var(--text-muted)]">
											INR LTCG Gain
										</p>
										<p className="num mt-1 text-sm font-semibold text-[var(--positive)]">
											{preview.equity.gainInr}
										</p>
									</div>
									<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
										<p className="text-[11px] text-[var(--text-muted)]">
											Base LTCG Tax
										</p>
										<p className="num mt-1 text-sm font-semibold text-[var(--text-primary)]">
											{preview.equity.ltcgTaxInr}
										</p>
									</div>
									<div className="col-span-2 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 sm:col-span-1">
										<p className="text-[11px] text-[var(--text-muted)]">
											CY Peak Value
										</p>
										<p className="num mt-1 text-sm font-semibold text-[var(--text-primary)]">
											{preview.equity.peakValueInr}
										</p>
									</div>
								</div>

								<div className="overflow-x-auto rounded-lg border border-[var(--border)]">
									<table className="w-full text-left text-xs">
										<thead className="bg-[var(--bg-subtle)] text-[var(--text-muted)]">
											<tr>
												<th scope="col" className="px-3 py-2 font-medium">
													Ticker
												</th>
												<th scope="col" className="px-3 py-2 font-medium">
													Shares
												</th>
												<th
													scope="col"
													className="px-3 py-2 text-right font-medium"
												>
													Cost (SBI FX)
												</th>
												<th
													scope="col"
													className="px-3 py-2 text-right font-medium"
												>
													Closing
												</th>
											</tr>
										</thead>
										<tbody>
											<tr className="border-t border-[var(--border)]">
												<td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">
													{preview.equity.ticker}
												</td>
												<td className="num px-3 py-2.5 text-[var(--text-secondary)]">
													{preview.equity.shares}
												</td>
												<td className="num-right px-3 py-2.5 text-[var(--text-secondary)]">
													{preview.equity.costInr}
												</td>
												<td className="num-right px-3 py-2.5 font-medium text-[var(--text-primary)]">
													{preview.equity.closingValueInr}
												</td>
											</tr>
										</tbody>
									</table>
								</div>

								<div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs">
									<div className="flex items-center justify-between gap-2">
										<span className="font-medium text-[var(--text-primary)]">
											{preview.equity.sectionForeignTaxCredit} ·{" "}
											{preview.equity.dtaaArticle}
										</span>
										<Badge tone="accent">SBI TT FX</Badge>
									</div>
									<p className="mt-1.5 text-[var(--text-secondary)]">
										Previous month-end SBI TT buying FX for trades &amp;
										dividends; peak &amp; year-end dates for{" "}
										{preview.equity.sectionForeignAssets}.
									</p>
								</div>
							</>
						)}
					</div>
				</aside>
			</div>
		</section>
	);
}
