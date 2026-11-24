import type { Metadata, Viewport } from "next";

export const SITE_CONFIG = {
	name: "Tax Tracker",
	shortName: "Tax Tracker",
	tagline: "Indian Crypto, VDA & US Stock Tax Helper",
	defaultTitle: "Tax Tracker — Indian Crypto, VDA & US Stock Tax Helper",
	titleTemplate: "%s — Tax Tracker",
	description:
		"Self-hosted ledger and tax report helper for Indian Crypto & VDA (Schedule VDA, Section 194S/393 TDS) and US Stocks (Capital Gains, Form 67, Schedule FA).",
	keywords: [
		"Tax Tracker",
		"Indian crypto tax",
		"Schedule VDA",
		"Section 194S",
		"Section 393",
		"TDS",
		"US stocks capital gains",
		"Form 67",
		"Schedule FA",
		"self-hosted tax ledger",
	],
	themeColor: "#1e4d6b",
	darkThemeColor: "#2f78a3",
	backgroundColor: "#f7f7f5",
	robots: {
		index: false,
		follow: false,
	},
	openGraph: {
		type: "website",
		locale: "en_IN",
		siteName: "Tax Tracker",
		title: "Tax Tracker — Indian Crypto, VDA & US Stock Tax Helper",
		description:
			"Self-hosted ledger and tax report helper for Indian Crypto & VDA (Schedule VDA, Section 194S/393 TDS) and US Stocks (Capital Gains, Form 67, Schedule FA).",
	},
	twitter: {
		card: "summary",
		title: "Tax Tracker — Indian Crypto, VDA & US Stock Tax Helper",
		description:
			"Self-hosted ledger and tax report helper for Indian Crypto & VDA (Schedule VDA, Section 194S/393 TDS) and US Stocks (Capital Gains, Form 67, Schedule FA).",
	},
} as const;

export const PAGE_SEO = {
	overview: {
		title: "Overview",
		description:
			"Summary of imported Indian VDA and US stock tax years, capital gains, TDS totals, and pending review items.",
	},
	import: {
		title: "Import Data",
		description:
			"Import Binance, CoinDCX, EVM wallet, or US stock broker CSV and PDF statements into your local tax ledger.",
	},
	imports: {
		title: "Import History",
		description:
			"Inspect past statement imports, row counts, duplicate skips, and batch status.",
	},
	connections: {
		title: "Connections",
		description:
			"Manage exchange API syncs, EVM wallet addresses, and automated data connections.",
	},
	transactions: {
		title: "Transactions",
		description:
			"Browse, filter, and inspect normalized crypto, VDA, and US stock ledger transactions.",
	},
	review: {
		title: "Review Queue",
		description:
			"Resolve flagged transactions, missing cost basis lots, and valuation warnings before generating tax schedules.",
	},
	report: {
		title: "Tax Report",
		description:
			"Generate Indian ITR Schedule VDA, Section 194S/393 TDS summaries, and exportable tax workpapers.",
	},
	usStocks: {
		title: "US Stocks",
		description:
			"Track US equity capital gains, dividends, SBI TT buying rates, Form 67 foreign tax credit, and Schedule FA holdings.",
	},
	settings: {
		title: "Settings",
		description:
			"Configure tax year rules, valuation preferences, security password, and local workspace backups.",
	},
	docs: {
		title: "Documentation & Tax Calculation Guide",
		description:
			"Understand Tax Tracker’s Indian crypto and US stock calculations, tax-year rules, import workflows, review flags, and complete ITR preparation.",
	},
	login: {
		title: "Sign In",
		description: "Sign in to unlock your self-hosted Tax Tracker workspace.",
	},
	offline: {
		title: "Offline",
		description:
			"Reconnect to your Tax Tracker server to load or save tax data.",
	},
	welcome: {
		title: "Self-Hosted Indian Crypto & US Stock Tax Helper",
		description:
			"Free, open-source (AGPL-3.0), local-first tax ledger and workpaper generator for Indian Crypto (Schedule VDA & TDS) and US Stocks (Capital Gains, Form 67 & Schedule FA).",
	},
} as const satisfies Record<string, { title: string; description: string }>;

export type PageSeoKey = keyof typeof PAGE_SEO;

export function rootMetadata(): Metadata {
	return {
		title: {
			default: SITE_CONFIG.defaultTitle,
			template: SITE_CONFIG.titleTemplate,
		},
		description: SITE_CONFIG.description,
		applicationName: SITE_CONFIG.name,
		appleWebApp: {
			capable: true,
			title: SITE_CONFIG.shortName,
			statusBarStyle: "default",
		},
		icons: {
			icon: [
				{ url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
				{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
			],
			apple: [
				{
					url: "/icons/apple-touch-icon.png",
					sizes: "180x180",
					type: "image/png",
				},
			],
		},
		formatDetection: { telephone: false },
		keywords: [...SITE_CONFIG.keywords],
		robots: { ...SITE_CONFIG.robots },
		openGraph: { ...SITE_CONFIG.openGraph },
		twitter: { ...SITE_CONFIG.twitter },
	};
}

export function rootViewport(): Viewport {
	return {
		width: "device-width",
		initialScale: 1,
		themeColor: [
			{ media: "(prefers-color-scheme: light)", color: SITE_CONFIG.themeColor },
			{
				media: "(prefers-color-scheme: dark)",
				color: SITE_CONFIG.darkThemeColor,
			},
		],
	};
}

export function pageMetadata(page: PageSeoKey): Metadata {
	const entry = PAGE_SEO[page];
	const fullTitle = `${entry.title} — ${SITE_CONFIG.name}`;
	return {
		title: page === "overview" ? { absolute: fullTitle } : entry.title,
		description: entry.description,
		openGraph: {
			title: fullTitle,
			description: entry.description,
		},
		twitter: {
			title: fullTitle,
			description: entry.description,
		},
	};
}
