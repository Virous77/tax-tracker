"use client";

import { Check, Circle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const DISMISSED_KEY = "tax-tracker-getting-started-dismissed";

export type GettingStartedFacts = {
	taxYear: string;
	settingsSaved: boolean;
	/** At least one import that is not sample data. */
	hasOwnImport: boolean;
	/** The report for this year is computed and the year has something in it. */
	reportReady: boolean;
	openReviewItems: number;
	/** The Review queue was built from the current report, not a stale one. */
	reviewCurrent: boolean;
};

type Step = {
	title: string;
	hint: string;
	href: string;
	done: boolean;
};

function buildSteps(facts: GettingStartedFacts): Step[] {
	const year = encodeURIComponent(facts.taxYear);
	return [
		{
			title: "Choose your tax year and settings",
			hint: "The defaults suit most people; open this to confirm them.",
			href: "/settings",
			done: facts.settingsSaved,
		},
		{
			title: "Import a file or connect an exchange",
			hint: "Crypto (Binance, CoinDCX, EVM wallets/APIs) or US Stocks (Vested, Schwab, IBKR, or any CSV/XLSX/PDF).",
			href: "/import",
			done: facts.hasOwnImport,
		},
		{
			title: "Resolve Review items",
			hint: "Missing buy history, unmatched transfers and other flagged rows.",
			href: `/review?taxYear=${year}`,
			done:
				facts.reportReady && facts.reviewCurrent && facts.openReviewItems === 0,
		},
		{
			title: "Open the report",
			hint: "Schedule VDA rows, tax and TDS credit in Report, or Capital Gains, Form 67 and Schedule FA in US Stocks.",
			href: `/report?taxYear=${year}`,
			done: facts.reportReady,
		},
		{
			title: "Export",
			hint: "Download CSV or XLSX from Report or US Stocks. Downloads are not tracked, so dismiss this list when you are done.",
			href: `/report?taxYear=${year}`,
			done: false,
		},
	];
}

function readDismissed(): boolean {
	try {
		return localStorage.getItem(DISMISSED_KEY) === "1";
	} catch {
		return false;
	}
}

export function GettingStarted({ facts }: { facts: GettingStartedFacts }) {
	const [dismissed, setDismissed] = useState(true);

	useEffect(() => {
		setDismissed(readDismissed());
	}, []);

	function dismiss() {
		setDismissed(true);
		try {
			localStorage.setItem(DISMISSED_KEY, "1");
		} catch {}
	}

	if (dismissed) return null;

	const steps = buildSteps(facts);
	const doneCount = steps.filter((s) => s.done).length;

	return (
		<section
			aria-labelledby="getting-started-title"
			className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4"
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<h2
						id="getting-started-title"
						className="text-sm font-semibold tracking-tight"
					>
						Getting started
					</h2>
					<p className="mt-0.5 text-xs text-[var(--text-secondary)]">
						<span className="num">{doneCount}</span> of{" "}
						<span className="num">{steps.length}</span> steps done
					</p>
				</div>
				<button
					type="button"
					onClick={dismiss}
					aria-label="Dismiss getting started checklist"
					className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
				>
					<X className="h-4 w-4" aria-hidden="true" />
				</button>
			</div>
			<ol className="mt-3 space-y-1">
				{steps.map((step, i) => (
					<li key={step.title}>
						<Link
							href={step.href}
							className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-[var(--bg-hover)]"
						>
							{step.done ? (
								<Check
									className="mt-0.5 h-4 w-4 shrink-0 text-[var(--positive)]"
									aria-hidden="true"
								/>
							) : (
								<Circle
									className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]"
									aria-hidden="true"
								/>
							)}
							<span className="min-w-0">
								<span className="block text-sm font-medium text-[var(--text-primary)]">
									{i + 1}. {step.title}
									<span className="sr-only">
										{step.done ? " — done" : " — not done"}
									</span>
								</span>
								<span className="block text-xs text-[var(--text-secondary)]">
									{step.hint}
								</span>
							</span>
						</Link>
					</li>
				))}
			</ol>
		</section>
	);
}
