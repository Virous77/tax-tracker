"use client";

import {
	AlertTriangle,
	ArrowLeftRight,
	FileSpreadsheet,
	FolderClock,
	LayoutDashboard,
	Link2,
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
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { AppFooter } from "@/components/shell/AppFooter";
import { DisclaimerGate } from "@/components/shell/DisclaimerGate";

type ThemePref = "system" | "light" | "dark";

const NAV_ITEMS = [
	{ href: "/", label: "Overview", icon: LayoutDashboard },
	{ href: "/import", label: "Import", icon: Upload },
	{ href: "/imports", label: "Imports", icon: FolderClock },
	{ href: "/connections", label: "Connections", icon: Link2 },
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

/** Table-heavy pages that benefit from the full content width. */
const WIDE_ROUTES = new Set(["/imports"]);

export function AppShell({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [theme, setTheme] = useState<ThemePref>("system");
	const mobileToggleRef = useRef<HTMLButtonElement>(null);
	const mobilePanelRef = useRef<HTMLElement>(null);
	const restoreFocusOnCloseRef = useRef(true);
	const wasMobileOpenRef = useRef(false);

	useEffect(() => {
		const saved = localStorage.getItem("tax-tracker-theme");
		if (saved === "light" || saved === "dark" || saved === "system") {
			setTheme(saved);
			applyTheme(saved);
		}
	}, []);

	const closeMobileMenu = useCallback((restoreFocus = true) => {
		restoreFocusOnCloseRef.current = restoreFocus;
		setMobileOpen(false);
	}, []);

	useEffect(() => {
		if (mobileOpen) {
			wasMobileOpenRef.current = true;
			restoreFocusOnCloseRef.current = true;
			const panel = mobilePanelRef.current;
			if (panel) {
				const focusable = panel.querySelector<HTMLElement>(
					'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
				);
				focusable?.focus();
			}

			const onKeyDown = (e: KeyboardEvent) => {
				if (e.key === "Escape") {
					e.preventDefault();
					closeMobileMenu(true);
					return;
				}
				if (e.key === "Tab" && panel) {
					const items = [
						...panel.querySelectorAll<HTMLElement>(
							'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
						),
					];
					if (items.length === 0) return;
					const first = items[0];
					const last = items[items.length - 1];
					const active = document.activeElement;
					if (!panel.contains(active)) {
						e.preventDefault();
						first?.focus();
						return;
					}
					if (e.shiftKey && active === first) {
						e.preventDefault();
						last?.focus();
					} else if (!e.shiftKey && active === last) {
						e.preventDefault();
						first?.focus();
					}
				}
			};
			window.addEventListener("keydown", onKeyDown);
			return () => window.removeEventListener("keydown", onKeyDown);
		}
		if (wasMobileOpenRef.current) {
			wasMobileOpenRef.current = false;
			if (restoreFocusOnCloseRef.current) {
				mobileToggleRef.current?.focus();
			}
		}
	}, [mobileOpen, closeMobileMenu]);

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
				<AppFooter />
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
						onClick={() => closeMobileMenu(false)}
						className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--text-primary)]"
					>
						<span className="flex h-7 w-7 items-center justify-center rounded bg-[var(--accent)] text-xs font-bold text-white">
							₹
						</span>
						<span>Tax Tracker</span>
					</Link>
					<button
						type="button"
						onClick={() => closeMobileMenu(true)}
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
								onClick={() => closeMobileMenu(false)}
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
						ref={mobileToggleRef}
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
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Navigation menu"
					className="fixed inset-0 z-40 flex lg:hidden"
				>
					<button
						type="button"
						tabIndex={-1}
						aria-label="Close navigation menu"
						onClick={() => closeMobileMenu(true)}
						className="fixed inset-0 bg-black/50"
					/>
					<aside
						ref={mobilePanelRef}
						className="relative z-10 h-full w-64 border-r border-[var(--border)] bg-[var(--bg-surface)]"
					>
						{navContent}
					</aside>
				</div>
			) : null}

			{/* Main Content + Footer */}
			<div className="flex min-w-0 flex-1 flex-col lg:pl-60">
				<DemoBanner />
				<main
					className={`mx-auto w-full flex-1 px-4 py-6 sm:px-6 lg:px-8 ${
						WIDE_ROUTES.has(pathname) ? "max-w-screen-2xl" : "max-w-6xl"
					}`}
				>
					{children}
				</main>
				<AppFooter className="sm:px-6" />
			</div>
			<DisclaimerGate />
		</div>
	);
}
