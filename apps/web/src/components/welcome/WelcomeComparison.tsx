import { Check, Minus } from "lucide-react";
import { COMPARISON_ROWS } from "./welcome-data";

export function WelcomeComparison() {
	return (
		<section
			id="why-better"
			aria-labelledby="why-better-heading"
			className="scroll-mt-20 border-t border-[var(--border)] py-14"
		>
			<div className="mx-auto max-w-6xl space-y-8 px-4 sm:px-6 lg:px-8">
				<header className="max-w-2xl space-y-2">
					<p className="text-xs font-semibold tracking-wide text-[var(--accent-text)] uppercase">
						Why Tax Tracker is better
					</p>
					<h2
						id="why-better-heading"
						className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]"
					>
						Built for verification and privacy, not subscription lock-in
					</h2>
					<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
						Your tax records should stay yours, and an unverified gap should
						never be disguised as a clean number.
					</p>
				</header>

				<div className="min-w-0 max-w-full overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
					<table className="w-full min-w-[640px] text-left text-sm">
						<thead className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-xs uppercase tracking-wide">
							<tr>
								<th
									scope="col"
									className="w-1/5 px-5 py-3.5 font-semibold text-[var(--text-muted)] whitespace-nowrap"
								>
									Dimension
								</th>
								<th
									scope="col"
									className="w-2/5 px-5 py-3.5 font-semibold text-[var(--accent-text)] whitespace-nowrap"
								>
									Tax Tracker (Open Source, Local-First)
								</th>
								<th
									scope="col"
									className="w-2/5 px-5 py-3.5 font-semibold text-[var(--text-muted)] whitespace-nowrap"
								>
									Typical Hosted Tax Platforms
								</th>
							</tr>
						</thead>
						<tbody>
							{COMPARISON_ROWS.map((row) => (
								<tr
									key={row.criterion}
									className="border-t border-[var(--border)] align-top"
								>
									<th
										scope="row"
										className="px-5 py-4 font-semibold text-[var(--text-primary)] whitespace-nowrap"
									>
										{row.criterion}
									</th>
									<td className="min-w-[220px] bg-[var(--accent-soft)]/35 px-5 py-4 text-[var(--text-primary)] whitespace-normal">
										<div className="flex items-start gap-2.5">
											<Check
												className="mt-0.5 h-4 w-4 shrink-0 text-[var(--positive)]"
												aria-hidden="true"
											/>
											<span className="leading-relaxed">{row.taxTracker}</span>
										</div>
									</td>
									<td className="min-w-[220px] px-5 py-4 text-[var(--text-secondary)] whitespace-normal">
										<div className="flex items-start gap-2.5">
											<Minus
												className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]"
												aria-hidden="true"
											/>
											<span className="leading-relaxed">
												{row.hostedPlatforms}
											</span>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	);
}
