"use client";

import { DISCLAIMER } from "@tax/core";
import { AlertTriangle, ArrowRight, BookOpen, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { WelcomeComparison } from "./WelcomeComparison";
import { WelcomeCoverage } from "./WelcomeCoverage";
import { WelcomeDeploy } from "./WelcomeDeploy";
import { WelcomeHero } from "./WelcomeHero";
import { WelcomeNav } from "./WelcomeNav";
import { WelcomeWorkflow } from "./WelcomeWorkflow";
import type { WelcomeYear } from "./welcome-data";

export function WelcomeClient({
	years,
}: {
	years: readonly [WelcomeYear, ...WelcomeYear[]];
}) {
	const [taxYear, setTaxYear] = useState(years[0].vda.taxYear);
	const selectedYear =
		years.find(({ vda }) => vda.taxYear === taxYear) ?? years[0];
	const unverifiedYears = years.filter(
		({ vda, equity }) => !vda.sectionsVerified || !equity.sectionsVerified,
	);

	return (
		<div className="min-h-dvh bg-[var(--bg-canvas)] text-[var(--text-primary)]">
			<WelcomeNav />
			<main>
				<WelcomeHero
					years={years}
					selectedYear={selectedYear}
					onSelectYear={setTaxYear}
				/>
				<WelcomeCoverage selectedYear={selectedYear} />
				<WelcomeComparison />
				<WelcomeWorkflow />
				<WelcomeDeploy />

				{/* Transparent Pre-Release & CA Disclaimer Band + Final CTA */}
				<section
					aria-labelledby="disclaimer-heading"
					className="border-t border-[var(--border)] bg-[var(--bg-surface)] py-14"
				>
					<div className="mx-auto max-w-6xl space-y-8 px-4 sm:px-6 lg:px-8">
						<div className="rounded-xl border border-[var(--border)] bg-[var(--warning-soft)] p-6 text-[var(--warning)]">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="flex items-start gap-3">
									<AlertTriangle
										className="mt-0.5 h-5 w-5 shrink-0"
										aria-hidden="true"
									/>
									<div className="space-y-1.5">
										<h2
											id="disclaimer-heading"
											className="text-base font-semibold"
										>
											{DISCLAIMER}
										</h2>
										<p className="text-sm leading-relaxed">
											Tax Tracker is pre-release (v0.x) open-source software
											under AGPL-3.0.{" "}
											{unverifiedYears.length > 0
												? `Bundled statutory citations for ${unverifiedYears
														.map(({ vda }) => vda.taxYear)
														.join(
															" and ",
														)} currently have sectionsVerified=false (pending review by a Chartered Accountant).`
												: "Confirm every figure and rule applicability with your Chartered Accountant before filing."}
										</p>
									</div>
								</div>
								{unverifiedYears.length > 0 ? (
									<Badge tone="warning">sectionsVerified: false</Badge>
								) : null}
							</div>
						</div>

						<div className="flex flex-col items-start justify-between gap-6 rounded-xl border border-[var(--border)] bg-[var(--bg-canvas)] p-6 sm:flex-row sm:items-center sm:p-8">
							<div className="space-y-1.5">
								<h3 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
									Ready to inspect your tax history locally?
								</h3>
								<p className="text-sm text-[var(--text-secondary)]">
									Open your local workspace, explore synthetic sample data, or
									read the full calculation handbook first.
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-3">
								<Link
									href="/"
									className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
								>
									<span>Open Workspace</span>
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
									<span>Read Docs</span>
								</Link>
								<Link
									href="/import"
									className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
								>
									<Upload
										className="h-4 w-4 text-[var(--accent-text)]"
										aria-hidden="true"
									/>
									<span>Import Files</span>
								</Link>
							</div>
						</div>
					</div>
				</section>
			</main>

			<footer className="border-t border-[var(--border)] bg-[var(--bg-surface)] px-4 py-6 text-center text-xs text-[var(--text-muted)]">
				<div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 sm:flex-row">
					<p>
						Tax Tracker · AGPL-3.0-only · Self-hosted Indian Crypto &amp; US
						Stock Tax Workpapers
					</p>
					<p>{DISCLAIMER}</p>
				</div>
			</footer>
		</div>
	);
}
