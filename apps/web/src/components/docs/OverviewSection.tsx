import { DocLink, DocSection, Topic } from "./DocUi";
import type { DocsYear } from "./docs-data";

const workflow = [
	{
		title: "Set assumptions",
		text: "Choose your tax year, fees, cost basis and surcharge with your CA.",
		href: "/settings",
		label: "Settings",
	},
	{
		title: "Bring in history",
		text: "Import complete statements, including purchases from earlier years.",
		href: "/import",
		label: "Import",
	},
	{
		title: "Inspect the ledger",
		text: "Check trades, income, transfers and each preserved original row.",
		href: "/transactions",
		label: "Transactions",
	},
	{
		title: "Resolve uncertainty",
		text: "Fix missing history, valuations and classifications before computing.",
		href: "/review",
		label: "Review Queue",
	},
	{
		title: "Compute & export",
		text: "Generate workpapers, reconcile tax credits and have your CA review them.",
		href: "/report",
		label: "Report",
	},
];

export function OverviewSection({ vda, equity }: DocsYear) {
	return (
		<DocSection
			id="overview"
			title="Overview & quick start"
			intro="From raw history to reviewable Indian tax workpapers, with a trail back to every imported row."
		>
			<div className="grid gap-3 sm:grid-cols-3">
				{[
					[
						"Crypto / VDA",
						"Indian VDA disposals, TDS reconciliation, income receipts and holdings.",
					],
					[
						"US Stocks",
						"Foreign equity gains, dividends, foreign tax credit and asset disclosures for Indian residents.",
					],
					[
						"Indian market context",
						"Bring domestic broker workpapers alongside these exports for your complete return.",
					],
				].map(([title, text]) => (
					<div
						key={title}
						className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4"
					>
						<p className="mb-2 font-semibold text-[var(--text-primary)]">
							{title}
						</p>
						<p className="text-xs leading-relaxed">{text}</p>
					</div>
				))}
			</div>
			<ol
				aria-label="Five-step workflow"
				className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
			>
				{workflow.map((step, index) => (
					<li
						key={step.href}
						className="flex flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4"
					>
						<span className="num mb-3 text-xs font-semibold text-[var(--accent-text)]">
							0{index + 1}
						</span>
						<h3 className="font-semibold text-[var(--text-primary)]">
							{step.title}
						</h3>
						<p className="my-2 flex-1 text-xs leading-relaxed">{step.text}</p>
						<DocLink href={step.href}>{step.label} →</DocLink>
					</li>
				))}
			</ol>
			<p>
				For read-only exchange APIs and EVM wallets, use{" "}
				<DocLink href="/connections">Connections</DocLink>. Track uploaded
				files, duplicates and row errors in{" "}
				<DocLink href="/imports">Imports</DocLink>. Foreign equity worksheets
				live in <DocLink href="/us-stocks">US Stocks</DocLink>.
			</p>
			<Topic title="Two clocks: tax year and calendar year">
				<p>
					The Indian tax year runs Apr 1–Mar 31 in IST (Asia/Kolkata).
					Timestamps are stored in UTC and classified by their IST date. The
					selected year {vda.taxYear} covers{" "}
					<span className="num">
						{vda.period.start} → {vda.period.end}
					</span>{" "}
					under {vda.act}.
				</p>
				<p>
					Capital gains and dividend totals follow that tax year. Schedule FA
					follows Jan 1–Dec 31 of CY{" "}
					<span className="num">{equity.scheduleFaCalendarYear}</span>, taken
					from the selected rule file. Do not substitute the financial-year
					totals for calendar-year disclosures.
				</p>
			</Topic>
			<Topic title="Your workspace, your data">
				<p>
					Tax Tracker is free, open source and self-hosted. Imports, raw rows
					and reports stay in your local database on your server. There is no
					telemetry, analytics or calling home. Network requests are limited to
					features you enable: exchange or wallet sync, optional price lookups,
					and an AI recipe endpoint you choose. Merely reading this guide sends
					no transaction data to providers.
				</p>
			</Topic>
		</DocSection>
	);
}
