"use client";

import type { ScheduleFaRow, UsEquityReport } from "@tax/core";
import {
	AlertTriangle,
	Calendar,
	CheckCircle2,
	Info,
	Pencil,
	RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Select, SelectItem } from "@/components/ui/Select";
import type {
	EquityPriceFillSummary,
	EquityPricesStatus,
	JobStatus,
} from "@/lib/client/api";
import {
	formatInrNullable,
	formatIstDate,
	formatQty,
	formatUsdNullable,
	isZeroDecimal,
	pluralise,
} from "@/lib/client/format";

export type EquityPriceProvider = "auto" | "polygon" | "finnhub";

const waitTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});

function formatWaitUntil(utcIso: string): string | null {
	const d = new Date(utcIso);
	if (!Number.isFinite(d.getTime())) return null;
	return waitTimeFormatter.format(d);
}

function formatEquityProviderLabel(
	provider: EquityPriceFillSummary["providerUsed"],
): string | null {
	if (provider === "polygon") return "Polygon.io";
	if (provider === "finnhub") return "Finnhub";
	if (provider === "mixed") return "Polygon.io & Finnhub";
	return null;
}

export function ScheduleFaTab({
	report,
	priceStatus,
	priceFillRunning,
	priceFillJob,
	priceFillResult,
	priceFillError,
	onAutoFill,
	onEditRow,
}: {
	report: UsEquityReport;
	priceStatus: EquityPricesStatus | null;
	priceFillRunning: boolean;
	priceFillJob: JobStatus | null;
	priceFillResult: EquityPriceFillSummary | null;
	priceFillError: string | null;
	onAutoFill: (provider: EquityPriceProvider, overwrite: boolean) => void;
	onEditRow: (row: ScheduleFaRow) => void;
}) {
	const { calendarYear, period, rows, notes } = report.scheduleFa;
	const [selectedProvider, setSelectedProvider] =
		useState<EquityPriceProvider>("auto");
	const [overwriteForYear, setOverwriteForYear] = useState<number | null>(null);
	const providerSelectId = useId();
	const overwriteId = useId();

	const overwrite = overwriteForYear === calendarYear;

	const missingPricesCount = rows.filter(
		(r) =>
			r.peakValueInr === null ||
			(!isZeroDecimal(r.closingQty) && r.closingValueInr === null),
	).length;

	const polygonReady = priceStatus?.sources.polygon.keySet ?? false;
	const finnhubReady = priceStatus?.sources.finnhub.keySet ?? false;
	const hasAnyProviderKey = polygonReady || finnhubReady;
	const effectiveProvider: EquityPriceProvider =
		selectedProvider === "polygon" && !polygonReady
			? "auto"
			: selectedProvider === "finnhub" && !finnhubReady
				? "auto"
				: selectedProvider;
	const allPricesFilled =
		priceStatus !== null &&
		priceStatus.needed > 0 &&
		priceStatus.missing.length === 0;

	return (
		<div className="space-y-5">
			{/* Calendar year period banner */}
			<div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-xs">
				<div className="flex flex-wrap items-center gap-2">
					<Calendar
						className="h-4 w-4 text-[var(--accent-text)]"
						aria-hidden="true"
					/>
					<span className="font-semibold text-[var(--text-primary)]">
						Schedule FA (Table A3) — Calendar Year {calendarYear}
					</span>
					<Badge tone="neutral">
						{formatIstDate(period.start)} – {formatIstDate(period.end)}
					</Badge>
				</div>
				<span className="text-[var(--text-secondary)]">
					Schedule FA uses the foreign calendar year (1 Jan – 31 Dec), not the
					Indian financial year.
				</span>
			</div>

			{/* Auto-fill Schedule FA prices bar */}
			{priceStatus && rows.length > 0 ? (
				<section
					aria-label="Auto-fill Schedule FA prices"
					className="space-y-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-xs"
				>
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
							<span className="font-semibold text-[var(--text-primary)]">
								Auto-fill Schedule FA prices
							</span>
							<span className="num text-[var(--text-secondary)]">
								Needed: <strong>{priceStatus.needed}</strong>
							</span>
							<span className="num text-[var(--positive)]">
								Filled: <strong>{priceStatus.filled}</strong>
							</span>
							<span
								className={`num ${
									priceStatus.missing.length > 0
										? "text-[var(--warning)]"
										: "text-[var(--text-secondary)]"
								}`}
							>
								Missing: <strong>{priceStatus.missing.length}</strong>
							</span>
						</div>

						{!priceStatus.enabled ? (
							<span className="text-[var(--text-secondary)]">
								Enable market price lookups in{" "}
								<Link
									href="/settings"
									className="font-medium text-[var(--accent-text)] underline"
								>
									Settings
								</Link>{" "}
								to fetch CY {calendarYear} prices automatically.
							</span>
						) : !hasAnyProviderKey ? (
							<span className="text-[var(--text-secondary)]">
								Add a free Polygon.io or Finnhub API key in{" "}
								<Link
									href="/connections"
									className="font-medium text-[var(--accent-text)] underline"
								>
									Connections
								</Link>{" "}
								to auto-fill prices.
							</span>
						) : !priceStatus.vaultUnlocked ? (
							<span className="text-[var(--text-secondary)]">
								Unlock your vault in{" "}
								<Link
									href="/connections"
									className="font-medium text-[var(--accent-text)] underline"
								>
									Connections
								</Link>{" "}
								to use your saved Polygon.io / Finnhub key.
							</span>
						) : (
							<div className="flex flex-wrap items-center gap-3">
								{allPricesFilled ? (
									<label
										htmlFor={overwriteId}
										className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] select-none"
									>
										<input
											id={overwriteId}
											type="checkbox"
											checked={overwrite}
											disabled={priceFillRunning}
											onChange={(e) =>
												setOverwriteForYear(
													e.target.checked ? calendarYear : null,
												)
											}
										/>
										<span>Overwrite existing prices</span>
									</label>
								) : null}

								<div className="flex items-center gap-2">
									<label htmlFor={providerSelectId} className="sr-only">
										Price provider
									</label>
									<Select
										id={providerSelectId}
										size="sm"
										value={effectiveProvider}
										disabled={priceFillRunning}
										onValueChange={(value) =>
											setSelectedProvider(value as EquityPriceProvider)
										}
										className="w-40"
									>
										<SelectItem value="auto">Auto</SelectItem>
										<SelectItem value="polygon" disabled={!polygonReady}>
											{polygonReady ? "Polygon.io" : "Polygon.io (no key)"}
										</SelectItem>
										<SelectItem value="finnhub" disabled={!finnhubReady}>
											{finnhubReady ? "Finnhub" : "Finnhub (no key)"}
										</SelectItem>
									</Select>

									<button
										type="button"
										disabled={
											priceFillRunning ||
											priceStatus.needed === 0 ||
											(allPricesFilled && !overwrite)
										}
										onClick={() => onAutoFill(effectiveProvider, overwrite)}
										className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 py-1.5 font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
									>
										<RefreshCw
											className={`h-3.5 w-3.5 ${priceFillRunning ? "animate-spin" : ""}`}
											aria-hidden="true"
										/>
										{priceFillRunning
											? `Filling CY ${calendarYear} prices…`
											: `Auto-fill CY ${calendarYear} prices`}
									</button>
								</div>
							</div>
						)}
					</div>

					{priceFillRunning ? (
						<div
							aria-live="polite"
							className="rounded border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1.5 text-[var(--accent-text)]"
						>
							{priceFillJob?.progress
								? (() => {
										const p = priceFillJob.progress;
										const ticker = p.stream.includes(":")
											? (p.stream.split(":").pop() ?? p.stream)
											: p.stream;
										const countLabel =
											p.streamsTotal !== null
												? `(${p.streamsDone}/${p.streamsTotal})`
												: `(${p.streamsDone})`;
										const waitUntil = p.waitingUntil
											? formatWaitUntil(p.waitingUntil)
											: null;
										if (p.waitingUntil) {
											return (
												<>
													Waiting for free-tier rate limit until{" "}
													<span className="num font-medium">
														{waitUntil ?? "shortly"}
													</span>
													…{" "}
													<span className="text-[var(--text-secondary)]">
														({ticker} {countLabel})
													</span>
												</>
											);
										}
										return `Fetching ${ticker} ${countLabel}…`;
									})()
								: priceFillResult
									? "Refreshing Schedule FA prices and recomputing report…"
									: `Fetching CY ${calendarYear} US stock prices…`}
						</div>
					) : null}

					{priceFillError ? <ErrorBanner message={priceFillError} /> : null}

					{!priceFillRunning && priceFillResult ? (
						<div
							aria-live="polite"
							className={`space-y-1.5 rounded border px-3 py-2 ${
								priceFillResult.failed.length > 0 &&
								priceFillResult.filled === 0
									? "border-[var(--warning)]/40 bg-[var(--warning-soft)] text-[var(--text-primary)]"
									: priceFillResult.failed.length > 0
										? "border-[var(--warning)]/40 bg-[var(--bg-subtle)] text-[var(--text-primary)]"
										: "border-[var(--positive)]/35 bg-[var(--positive-soft)] text-[var(--positive)]"
							}`}
						>
							<p className="flex flex-wrap items-center gap-2 font-medium">
								{priceFillResult.failed.length > 0 &&
								priceFillResult.filled === 0 ? (
									<AlertTriangle
										className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]"
										aria-hidden="true"
									/>
								) : (
									<CheckCircle2
										className="h-3.5 w-3.5 shrink-0 text-[var(--positive)]"
										aria-hidden="true"
									/>
								)}
								<span>
									{(() => {
										const providerLabel = formatEquityProviderLabel(
											priceFillResult.providerUsed,
										);
										return `Filled ${priceFillResult.filled} ${pluralise(priceFillResult.filled, "holding")}${providerLabel ? ` via ${providerLabel}` : ""}${priceFillResult.skipped > 0 ? ` · ${priceFillResult.skipped} already cached` : ""}.`;
									})()}
								</span>
							</p>
							{priceFillResult.failed.length > 0 ? (
								<ul className="list-disc space-y-0.5 pl-5 text-[var(--text-secondary)]">
									{priceFillResult.failed.map((f) => (
										<li key={`${f.symbol}:${f.reason}`}>
											<span className="font-mono-code font-semibold text-[var(--text-primary)]">
												{f.symbol}
											</span>
											: {f.reason}
										</li>
									))}
								</ul>
							) : null}
						</div>
					) : null}

					<div className="space-y-1 border-t border-[var(--border)] pt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
						<p>
							Auto-fill uses{" "}
							<strong className="font-medium text-[var(--text-primary)]">
								unadjusted historical daily closing prices
							</strong>{" "}
							to match historical share counts; if a stock had a split, merger,
							or spin-off (
							<code className="font-mono-code text-[var(--text-primary)]">
								corporate_action
							</code>{" "}
							flag), verify share quantities and prices before filing.
						</p>
						<p>
							Table A3 covers foreign equity holdings; if you held uninvested
							USD cash in a foreign brokerage account, verify{" "}
							<strong className="font-medium text-[var(--text-primary)]">
								Table A1 / A2
							</strong>{" "}
							foreign depository/custodial cash disclosures with your CA.
						</p>
					</div>
				</section>
			) : null}

			{missingPricesCount > 0 ? (
				<div
					role="status"
					className="flex items-start gap-2.5 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-3 text-xs text-[var(--text-primary)]"
				>
					<AlertTriangle
						className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
						aria-hidden="true"
					/>
					<div>
						<p className="font-semibold">
							{missingPricesCount} holding
							{missingPricesCount === 1 ? "" : "s"} missing CY {calendarYear}{" "}
							peak or Dec 31 closing USD price
						</p>
						<p className="mt-0.5 text-[var(--text-secondary)]">
							Market prices are never guessed. Click &ldquo;Edit prices &amp;
							entity details&rdquo; on any row below to enter the peak price
							(with date) and year-end closing price, or use Auto-fill above.
						</p>
					</div>
				</div>
			) : null}

			{rows.length === 0 ? (
				<EmptyState
					title={`No US stock holdings during CY ${calendarYear}`}
					description={`No US equities were held at any point between 1 Jan ${calendarYear} and 31 Dec ${calendarYear}.`}
				/>
			) : (
				<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
					<div className="min-w-0 overflow-x-auto">
						<table className="w-full border-collapse text-left text-xs">
							<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
								<tr>
									<th className="px-3 py-2.5 font-medium whitespace-nowrap">
										Sl.
									</th>
									<th className="px-3 py-2.5 font-medium whitespace-nowrap">
										Country &amp; Code
									</th>
									<th className="px-3 py-2.5 font-medium whitespace-nowrap">
										Entity Name &amp; Ticker
									</th>
									<th className="px-3 py-2.5 font-medium whitespace-nowrap">
										Nature
									</th>
									<th className="px-3 py-2.5 font-medium whitespace-nowrap">
										Date Acquired
									</th>
									<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
										Initial Value
									</th>
									<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
										Peak Value &amp; Date
									</th>
									<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
										Closing Balance
									</th>
									<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
										Gross Dividends
									</th>
									<th className="num-right px-3 py-2.5 font-medium whitespace-nowrap">
										Gross Sale Proceeds
									</th>
									<th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
										Edit
									</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => {
									const exited = isZeroDecimal(row.closingQty);
									return (
										<tr
											key={`${row.slNo}:${row.asset}`}
											className="border-b border-[var(--border)] align-top last:border-b-0 hover:bg-[var(--bg-hover)]/60"
										>
											<td className="num px-3 py-2.5 text-[var(--text-muted)] whitespace-nowrap">
												{row.slNo}
											</td>
											<td className="px-3 py-2.5 whitespace-nowrap">
												<div>{row.countryName}</div>
												<div className="text-[11px] text-[var(--text-muted)]">
													Code: {row.countryCode}
												</div>
											</td>
											<td className="min-w-[220px] px-3 py-2.5 wrap-anywhere whitespace-normal">
												<div className="font-semibold text-[var(--text-primary)]">
													{row.entityName}{" "}
													<span className="font-mono-code text-[11px] font-normal whitespace-nowrap text-[var(--text-secondary)]">
														({row.asset})
													</span>
												</div>
												{row.entityAddress || row.zipCode ? (
													<div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
														{[row.entityAddress, row.zipCode]
															.filter(Boolean)
															.join(", ")}
													</div>
												) : null}
											</td>
											<td className="px-3 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
												{row.natureOfEntity}
											</td>
											<td className="px-3 py-2.5 whitespace-nowrap">
												<div>
													{row.dateOfAcquiring
														? formatIstDate(row.dateOfAcquiring)
														: "—"}
												</div>
												<div className="num text-[11px] text-[var(--text-muted)]">
													{row.lotCount} lot{row.lotCount === 1 ? "" : "s"}
												</div>
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap">
												<div className="font-medium">
													{formatInrNullable(row.initialValueInr)}
												</div>
												<div className="text-[11px] text-[var(--text-muted)]">
													{formatUsdNullable(row.initialValueUsd)}
												</div>
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap">
												{row.peakValueInr !== null ? (
													<>
														<div className="font-medium">
															{formatInrNullable(row.peakValueInr)}
														</div>
														<div className="text-[11px] text-[var(--text-muted)]">
															{formatUsdNullable(row.peakValueUsd)}
															{row.peakDate
																? ` · ${formatIstDate(row.peakDate)}`
																: ""}
														</div>
														{row.peakPriceUsd ? (
															<div className="text-[11px] text-[var(--text-muted)]">
																@{" "}
																{formatUsdNullable(row.peakPriceUsd, {
																	preservePrecision: true,
																})}
															</div>
														) : null}
													</>
												) : (
													<Badge tone="warning">Missing peak price</Badge>
												)}
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap">
												{exited || row.closingValueInr !== null ? (
													<>
														<div className="font-medium">
															{formatInrNullable(row.closingValueInr)}
														</div>
														<div className="text-[11px] text-[var(--text-muted)]">
															{formatUsdNullable(row.closingValueUsd)} ·{" "}
															{formatQty(row.closingQty)} sh
														</div>
														{row.closingPriceUsd ? (
															<div className="text-[11px] text-[var(--text-muted)]">
																@{" "}
																{formatUsdNullable(row.closingPriceUsd, {
																	preservePrecision: true,
																})}
															</div>
														) : null}
													</>
												) : (
													<div className="space-y-0.5">
														<Badge tone="warning">Missing closing price</Badge>
														<div className="text-[11px] text-[var(--text-muted)]">
															{formatQty(row.closingQty)} sh held
														</div>
													</div>
												)}
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap">
												<div className="font-medium">
													{formatInrNullable(row.grossDividendsPaidInr)}
												</div>
												<div className="text-[11px] text-[var(--text-muted)]">
													{formatUsdNullable(row.grossDividendsPaidUsd)}
												</div>
											</td>
											<td className="num-right px-3 py-2.5 whitespace-nowrap">
												<div className="font-medium">
													{formatInrNullable(row.grossSaleProceedsInr)}
												</div>
												<div className="text-[11px] text-[var(--text-muted)]">
													{formatUsdNullable(row.grossSaleProceedsUsd)}
												</div>
											</td>
											<td className="px-3 py-2.5 text-right whitespace-nowrap">
												<button
													type="button"
													onClick={() => onEditRow(row)}
													className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
												>
													<Pencil className="h-3 w-3" aria-hidden="true" />
													Edit prices &amp; entity details
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

			{notes.length > 0 ? (
				<div className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-4 text-xs text-[var(--text-secondary)]">
					<p className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
						<Info
							className="h-3.5 w-3.5 text-[var(--accent-text)]"
							aria-hidden="true"
						/>
						Schedule FA &amp; CA Notes
					</p>
					<ul className="list-disc space-y-1 pl-5">
						{notes.map((note) => (
							<li key={note}>{note}</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}
