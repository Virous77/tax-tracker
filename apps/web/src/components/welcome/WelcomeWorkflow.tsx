import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { UX_HIGHLIGHTS } from "./welcome-data";

export function WelcomeWorkflow() {
	return (
		<section
			id="workflow"
			aria-labelledby="workflow-heading"
			className="scroll-mt-20 border-t border-[var(--border)] bg-[var(--bg-surface)] py-14"
		>
			<div className="mx-auto max-w-6xl space-y-8 px-4 sm:px-6 lg:px-8">
				<header className="max-w-2xl space-y-2">
					<p className="text-xs font-semibold tracking-wide text-[var(--accent-text)] uppercase">
						UX built for real messy data
					</p>
					<h2
						id="workflow-heading"
						className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]"
					>
						Workflows that save hours when statements are incomplete
					</h2>
					<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
						Real exchange exports rarely line up cleanly on the first pass. Tax
						Tracker keeps every edge case visible while making bulk cleanup
						fast.
					</p>
				</header>

				<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
					{UX_HIGHLIGHTS.map((item, idx) => (
						<article
							key={item.id}
							className={`flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-canvas)] p-6 ${
								idx === UX_HIGHLIGHTS.length - 1
									? "md:col-span-2 lg:col-span-1"
									: ""
							}`}
						>
							<div className="space-y-3">
								<div className="flex items-center justify-between gap-2">
									<span className="num text-xs font-semibold text-[var(--accent-text)]">
										0{idx + 1}
									</span>
									<Badge tone="neutral">{item.badge}</Badge>
								</div>
								<h3 className="text-base font-semibold text-[var(--text-primary)]">
									{item.title}
								</h3>
								<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
									{item.description}
								</p>
							</div>
							<ul className="mt-4 space-y-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-secondary)]">
								{item.details.map((detail) => (
									<li key={detail} className="flex items-start gap-2">
										<CheckCircle2
											className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--positive)]"
											aria-hidden="true"
										/>
										<span>{detail}</span>
									</li>
								))}
							</ul>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}
