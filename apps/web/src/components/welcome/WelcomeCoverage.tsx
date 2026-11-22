import { formatInr } from "@tax/core";
import { ArrowRight, Bitcoin, Building2, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatPercent, type WelcomeYear } from "./welcome-data";

export function WelcomeCoverage({
	selectedYear,
}: {
	selectedYear: WelcomeYear;
}) {
	const { vda, equity } = selectedYear;

	return (
		<section
			id="features"
			aria-labelledby="features-heading"
			className="scroll-mt-20 border-t border-[var(--border)] bg-[var(--bg-surface)] py-14"
		>
			<div className="mx-auto max-w-6xl space-y-8 px-4 sm:px-6 lg:px-8">
				<header className="max-w-2xl space-y-2">
					<p className="text-xs font-semibold tracking-wide text-[var(--accent-text)] uppercase">
						What we cover
					</p>
					<h2
						id="features-heading"
						className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]"
					>
						Purpose-built engines for Indian tax schedules
					</h2>
					<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
						Rule metrics below are read live from the bundled{" "}
						<span className="num font-medium text-[var(--text-primary)]">
							{vda.taxYear}
						</span>{" "}
						({vda.act}) data files, keeping every assumption inspectable.
					</p>
				</header>

				<div className="grid gap-6 lg:grid-cols-3">
					{/* Crypto / VDA */}
					<article className="flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-canvas)] p-6">
						<div className="space-y-4">
							<div className="flex items-center justify-between gap-2">
								<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]">
									<Bitcoin className="h-5 w-5" aria-hidden="true" />
								</span>
								<Badge tone="accent">{vda.sections.vdaTax}</Badge>
							</div>
							<h3 className="text-lg font-semibold text-[var(--text-primary)]">
								Indian Crypto / VDA
							</h3>
							<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
								Imports Binance (12 CSV/XLSX formats, PDF account statements,
								read-only API sync), CoinDCX (Instant/Spot XLSX, Form 16A PDF,
								Spot API), EVM wallets across Ethereum, Base, Arbitrum, Polygon,
								and BNB Chain, plus any CSV via saved or AI-suggested recipes.
							</p>
							<dl className="num grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border)] pt-4 text-xs">
								<div>
									<dt className="text-[var(--text-muted)]">Flat tax + cess</dt>
									<dd className="font-semibold text-[var(--text-primary)]">
										{formatPercent(vda.rate)} + {formatPercent(vda.cess)}
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">
										{vda.sections.vdaTds}
									</dt>
									<dd className="font-semibold text-[var(--text-primary)]">
										{formatPercent(vda.tds.rate)} (
										{formatInr(vda.tds.thresholdInr)} /{" "}
										{formatInr(vda.tds.specifiedPersonThresholdInr)})
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">FIFO &amp; swaps</dt>
									<dd className="font-medium text-[var(--text-primary)]">
										Global or per-venue
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">Loss set-off</dt>
									<dd className="font-medium text-[var(--text-primary)]">
										{vda.lossSetOff ? "Allowed" : "Isolated (disallowed)"}
									</dd>
								</div>
							</dl>
						</div>
						<div className="mt-5 pt-2">
							<Link
								href="/docs#crypto"
								className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-text)] hover:underline"
							>
								<span>Crypto calculation details</span>
								<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
							</Link>
						</div>
					</article>

					{/* US Stocks */}
					<article className="flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-canvas)] p-6">
						<div className="space-y-4">
							<div className="flex items-center justify-between gap-2">
								<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]">
									<TrendingUp className="h-5 w-5" aria-hidden="true" />
								</span>
								<Badge tone="accent">
									{equity.sections.foreignAssets} · CY{" "}
									<span className="num">{equity.scheduleFaCalendarYear}</span>
								</Badge>
							</div>
							<h3 className="text-lg font-semibold text-[var(--text-primary)]">
								US Stocks (Foreign Equity)
							</h3>
							<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
								Parses native Vested Account Statement PDF/XLSX, Charles Schwab,
								IBKR, and generic broker CSVs. Converts trades and dividends
								using bundled SBI TT buying rates, builds Form 67 worksheets,
								and populates Calendar Year Schedule FA with optional Polygon.io
								or Finnhub unadjusted price auto-fill.
							</p>
							<dl className="num grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border)] pt-4 text-xs">
								<div>
									<dt className="text-[var(--text-muted)]">LTCG threshold</dt>
									<dd className="font-semibold text-[var(--text-primary)]">
										&gt; {equity.longTermHoldingMonths} months @{" "}
										{formatPercent(equity.longTermRate)}
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">
										LTCG surcharge cap
									</dt>
									<dd className="font-semibold text-[var(--text-primary)]">
										{formatPercent(equity.surchargeCapLtcg)} +{" "}
										{formatPercent(equity.cess)} cess
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">DTAA reference</dt>
									<dd className="font-medium text-[var(--text-primary)]">
										{equity.dtaa.dividendArticle}
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">
										Loss carry-forward
									</dt>
									<dd className="font-medium text-[var(--text-primary)]">
										Up to {equity.lossSetOff.carryForwardYears} years
									</dd>
								</div>
							</dl>
						</div>
						<div className="mt-5 pt-2">
							<Link
								href="/docs#us-stocks"
								className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-text)] hover:underline"
							>
								<span>US Stocks &amp; Schedule FA guide</span>
								<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
							</Link>
						</div>
					</article>

					{/* Indian Market & ITR Hand-off */}
					<article className="flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-canvas)] p-6">
						<div className="space-y-4">
							<div className="flex items-center justify-between gap-2">
								<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--warning-soft)] text-[var(--warning)]">
									<Building2 className="h-5 w-5" aria-hidden="true" />
								</span>
								<Badge tone="warning">Domestic engine not built</Badge>
							</div>
							<h3 className="text-lg font-semibold text-[var(--text-primary)]">
								Indian Market Context &amp; ITR Hand-Off
							</h3>
							<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
								Domestic NSE/BSE shares, Indian mutual funds, and F&amp;O have
								separate rules and are intentionally not mixed into VDA or US
								equity engines. Pair your domestic broker Tax P&amp;L, CAMS /
								KFintech statements, and Form 26AS / AIS with Tax Tracker’s
								formula-safe CSV/XLSX workpapers for one complete CA review.
							</p>
							<dl className="grid grid-cols-1 gap-y-2 border-t border-[var(--border)] pt-4 text-xs">
								<div>
									<dt className="text-[var(--text-muted)]">Exports included</dt>
									<dd className="font-medium text-[var(--text-primary)]">
										Schedule VDA, TDS, Form 67, Schedule FA &amp; Full Workbook
									</dd>
								</div>
								<div>
									<dt className="text-[var(--text-muted)]">Hand-off design</dt>
									<dd className="font-medium text-[var(--text-primary)]">
										Active rules &amp; settings printed on every workbook
									</dd>
								</div>
							</dl>
						</div>
						<div className="mt-5 pt-2">
							<Link
								href="/docs#indian-market"
								className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-text)] hover:underline"
							>
								<span>Complete ITR hand-off playbook</span>
								<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
							</Link>
						</div>
					</article>
				</div>
			</div>
		</section>
	);
}
