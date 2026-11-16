"use client";

import { DISCLAIMER } from "@tax/core";
import {
	AlertTriangle,
	ArrowLeftRight,
	FileSpreadsheet,
	FolderClock,
	LayoutDashboard,
	Menu,
	Monitor,
	Moon,
	Settings,
	ShieldCheck,
	Sun,
	Upload,
	X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

type ThemePref = "system" | "light" | "dark";

const NAV_ITEMS = [
	{ href: "/", label: "Overview", icon: LayoutDashboard },
	{ href: "/import", label: "Import", icon: Upload },
	{ href: "/imports", label: "Imports", icon: FolderClock },
	{ href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
	{ href: "/review", label: "Review", icon: AlertTriangle },
	{ href: "/report", label: "Report", icon: FileSpreadsheet },
	{ href: "/settings", label: "Settings", icon: Settings },
] as const;

function applyTheme(pref: ThemePref) {
	const root = document.documentElement;
	if (pref === "system") {
		root.removeAttribute("data-theme");
	} else {
		root.setAttribute("data-theme", pref);
	}
}

export function AppShell({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [theme, setTheme] = useState<ThemePref>("system");

	useEffect(() => {
		const saved = localStorage.getItem("tax-tracker-theme");
		if (saved === "light" || saved === "dark" || saved === "system") {
			setTheme(saved);
			applyTheme(saved);
		}
	}, []);

	function cycleTheme() {
		const order: ThemePref[] = ["system", "light", "dark"];
		const next = order[(order.indexOf(theme) + 1) % order.length] ?? "system";
		setTheme(next);
		localStorage.setItem("tax-tracker-theme", next);
		applyTheme(next);
	}

	if (pathname === "/login") {
		return (
			<div className="flex min-h-dvh flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
				<main className="flex flex-1 items-center justify-center p-4">
					{children}
				</main>
				<footer className="border-t border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-center text-xs text-[var(--text-muted)]">
					{DISCLAIMER}
				</footer>
			</div>
		);
	}

	const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
	const themeLabel =
		theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System";

	const navContent = (
		<div className="flex h-full flex-col justify-between">
			<div>
				<div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-4">
					<Link
						href="/"
						onClick={() => setMobileOpen(false)}
						className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--text-primary)]"
					>
						<span className="flex h-7 w-7 items-center justify-center rounded bg-[var(--accent)] text-xs font-bold text-white">
							₹
						</span>
						<span>Tax Tracker</span>
					</Link>
					<button
						type="button"
						onClick={() => setMobileOpen(false)}
						aria-label="Close navigation menu"
						className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] lg:hidden"
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				</div>

				<nav aria-label="Main navigation" className="space-y-0.5 p-2.5">
					{NAV_ITEMS.map((item) => {
						const Icon = item.icon;
						const active =
							item.href === "/"
								? pathname === "/"
								: pathname === item.href ||
									pathname.startsWith(`${item.href}/`);
						return (
							<Link
								key={item.href}
								href={item.href}
								onClick={() => setMobileOpen(false)}
								aria-current={active ? "page" : undefined}
								className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
									active
										? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
										: "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
								}`}
							>
								<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
								<span>{item.label}</span>
							</Link>
						);
					})}
				</nav>
			</div>

			<div className="space-y-2 border-t border-[var(--border)] p-3">
				<button
					type="button"
					onClick={cycleTheme}
					className="flex w-full items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
				>
					<span className="flex items-center gap-2">
						<ThemeIcon className="h-3.5 w-3.5" aria-hidden="true" />
						Theme
					</span>
					<span>{themeLabel}</span>
				</button>
				<div className="flex items-center gap-1.5 px-1 text-[11px] text-[var(--text-muted)]">
					<ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					<span>Self-hosted · Local data</span>
				</div>
			</div>
		</div>
	);

	return (
		<div className="flex min-h-dvh flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)] lg:flex-row">
			{/* Desktop Sidebar */}
			<aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-[var(--border)] lg:bg-[var(--bg-surface)]">
				{navContent}
			</aside>

			{/* Mobile Header */}
			<header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 lg:hidden">
				<div className="flex items-center gap-2.5">
					<button
						type="button"
						onClick={() => setMobileOpen(true)}
						aria-label="Open navigation menu"
						aria-expanded={mobileOpen}
						className="rounded border border-[var(--border)] p-1.5 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
					>
						<Menu className="h-4 w-4" aria-hidden="true" />
					</button>
					<Link href="/" className="text-sm font-semibold tracking-tight">
						Tax Tracker
					</Link>
				</div>
				<button
					type="button"
					onClick={cycleTheme}
					aria-label={`Theme: ${themeLabel}. Click to switch.`}
					className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]"
				>
					<ThemeIcon className="h-3.5 w-3.5" aria-hidden="true" />
					<span>{themeLabel}</span>
				</button>
			</header>

			{/* Mobile Drawer Overlay */}
			{mobileOpen ? (
				<div className="fixed inset-0 z-40 flex lg:hidden">
					<button
						type="button"
						aria-label="Close navigation menu"
						onClick={() => setMobileOpen(false)}
						className="fixed inset-0 bg-black/50"
					/>
					<aside className="relative z-10 h-full w-64 border-r border-[var(--border)] bg-[var(--bg-surface)]">
						{navContent}
					</aside>
				</div>
			) : null}

			{/* Main Content + Footer */}
			<div className="flex min-w-0 flex-1 flex-col lg:pl-60">
				<main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
					{children}
				</main>
				<footer className="border-t border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-center text-xs text-[var(--text-muted)] sm:px-6">
					{DISCLAIMER}
				</footer>
			</div>
		</div>
	);
}
