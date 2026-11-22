import { ArrowRight, BookOpen, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";

const NAV_LINKS = [
	{ href: "#features", label: "Features" },
	{ href: "#why-better", label: "Why Better" },
	{ href: "#workflow", label: "Workflow" },
	{ href: "#self-host", label: "Self-Host" },
] as const;

export function WelcomeNav() {
	return (
		<header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-surface)]/95 backdrop-blur-sm">
			<div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
				<div className="flex items-center gap-3">
					<Link
						href="/welcome"
						className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-[var(--text-primary)]"
					>
						<span className="flex h-7 w-7 items-center justify-center rounded bg-[var(--accent)] text-xs font-bold text-white">
							₹
						</span>
						<span>Tax Tracker</span>
					</Link>
					<Badge tone="neutral" className="hidden sm:inline-flex">
						<ShieldCheck className="h-3 w-3" aria-hidden="true" />
						AGPL-3.0 · Self-Hosted
					</Badge>
				</div>

				<nav
					aria-label="Landing page sections"
					className="hidden items-center gap-6 text-sm text-[var(--text-secondary)] md:flex"
				>
					{NAV_LINKS.map((item) => (
						<a
							key={item.href}
							href={item.href}
							className="transition-colors hover:text-[var(--text-primary)]"
						>
							{item.label}
						</a>
					))}
				</nav>

				<div className="flex items-center gap-2.5">
					<Link
						href="/docs"
						className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
					>
						<BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
						<span>Docs</span>
					</Link>
					<Link
						href="/"
						className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
					>
						<span>Open App</span>
						<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
					</Link>
				</div>
			</div>
		</header>
	);
}
