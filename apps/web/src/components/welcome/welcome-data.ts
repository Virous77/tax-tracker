import { D, formatInr } from "@tax/core";
import type { UsEquityRules, VdaRules } from "@tax/rules";

export interface WelcomeYear {
	vda: VdaRules;
	equity: UsEquityRules;
}

export const formatPercent = (value: string): string =>
	`${D(value).mul("100").toFixed()}%`;

export interface ComparisonRow {
	readonly criterion: string;
	readonly taxTracker: string;
	readonly hostedPlatforms: string;
}

export const COMPARISON_ROWS: readonly ComparisonRow[] = [
	{
		criterion: "Privacy & data ownership",
		taxTracker:
			"100% local SQLite + AES-256-GCM encrypted Secrets Vault on your machine or private server. Zero telemetry or central account.",
		hostedPlatforms:
			"Full exchange & wallet history uploaded to vendor cloud servers, behind mandatory account signup.",
	},
	{
		criterion: "Cost & paywalls",
		taxTracker:
			"Free forever under AGPL-3.0. Unlimited transactions, wallets, Schedule VDA rows, Form 67 & CSV/XLSX exports.",
		hostedPlatforms:
			"Tiered annual paywalls keyed by transaction count; full exports and tax schedules locked behind paid plans.",
	},
	{
		criterion: "Honesty on missing data",
		taxTracker:
			"Explicit reviewFlags on every gap. Unresolved disposals are isolated from totals and never given a silent zero cost basis.",
		hostedPlatforms:
			"Missing purchase history is often silently treated as zero cost, artificially inflating taxable gains.",
	},
	{
		criterion: "Auditability & trail",
		taxTracker:
			"Every normalized ledger row preserves the untouched original source row, FIFO lot-by-lot Trail drawer, and formula-safe exports.",
		hostedPlatforms:
			"Opaque summary totals with limited traceability back to raw exchange CSV rows or FX publication dates.",
	},
	{
		criterion: "CA configurability",
		taxTracker:
			"Tax rules live in versioned JSON files per regime & year. Active assumptions print on every report for your CA to review.",
		hostedPlatforms:
			"Black-box calculations with hard-coded assumptions that cannot be inspected or adjusted with your CA.",
	},
	{
		criterion: "Fast UX for messy data",
		taxTracker:
			"1-click combined missing buy per asset, live per-unit INR calculator, priority-sorted Review Queue, and installable PWA.",
		hostedPlatforms:
			"Slow multi-page web forms requiring tedious per-transaction manual edits across hundreds of rows.",
	},
];

export interface UxHighlight {
	readonly id: string;
	readonly badge: string;
	readonly title: string;
	readonly description: string;
	readonly details: readonly string[];
}

export const UX_HIGHLIGHTS: readonly UxHighlight[] = [
	{
		id: "imports",
		badge: "Idempotent ingestion",
		title: "Smart Auto-Detection & Idempotent Re-Imports",
		description:
			"Drop CSV, XLSX, or PDF statements without manual pre-formatting. Re-importing the same file deduplicates safely on source and sourceRef while preserving manual edits.",
		details: [
			"Auto-detects Binance, CoinDCX, Vested PDF/XLSX, and saved CSV recipes",
			"Grouped skipped-row summary separates duplicates from true parse errors",
			"Untouched raw source rows stay attached for audit trail verification",
		],
	},
	{
		id: "review-queue",
		badge: "Signal over noise",
		title: "Priority-Sorted Review Queue",
		description:
			"Action-blocking issues surface first so you fix missing history, missing INR valuations, and unmatched transfers before computing final workpapers.",
		details: [
			"Blocking items ranked ahead of advisory notices and file notes",
			"High-volume advisory groups auto-collapse until you expand them",
			"Inline transaction drawer lets you inspect raw rows and fix in place",
		],
	},
	{
		id: "missing-buy",
		badge: "Hours saved",
		title: "1-Click Combined Missing Buy & Live Per-Unit Calculator",
		description:
			"Instead of entering dozens of tiny missing purchases one by one, bundle unresolved sales for an asset into one prefilled acquisition—or enter per-unit INR prices directly.",
		details: [
			"Combined missing buy prefills total unresolved asset quantity",
			"Toggle between Total INR and Per-Unit INR with live calculation preview",
			"Every manual fix stays clearly marked for CA review",
		],
	},
	{
		id: "price-autofill",
		badge: "Opt-in only",
		title: "Opt-In Free-Tier Price Auto-Fill with Staleness Guards",
		description:
			"Fetch missing historical prices only when you explicitly turn them on. Built-in host pacing and strict staleness caps keep valuations transparent.",
		details: [
			"Binance public daily klines + CoinGecko 5-chain EVM contract resolution",
			"Polygon.io unadjusted daily bars & Finnhub fallback for Schedule FA",
			"14-day ledger USDT/INR cap & 22-day SBI TT FX staleness guard",
		],
	},
	{
		id: "pwa",
		badge: "Snappy & private",
		title: "Installable PWA & Instant Tab Switching",
		description:
			"Install Tax Tracker to your desktop or home screen as a standalone app. Smooth stale-while-revalidate navigation never sacrifices security or freshness.",
		details: [
			"Service Worker caches static shell & docs with clean /offline fallback",
			"/api/* tax data is never cached by the Service Worker",
			"In-memory SWR cache clears automatically on edits and logout",
		],
	},
];

export interface DeployOption {
	readonly id: string;
	readonly title: string;
	readonly badge: string;
	readonly summary: string;
	readonly commands: string;
	readonly note: string;
	readonly docHref?: string;
	readonly docLabel?: string;
}

export const DEPLOY_OPTIONS: readonly DeployOption[] = [
	{
		id: "docker",
		title: "Run Locally with Docker",
		badge: "Local computer",
		summary:
			"Keep everything on localhost with a single persistent ./data directory. No external accounts required.",
		commands: `git clone https://github.com/Virous77/tax-tracker.git
cd tax-tracker
cp .env.example .env
docker compose up -d --build`,
		note: "Open http://localhost:3000. Bound to localhost unless APP_PASSWORD and APP_BIND_ADDRESS are set.",
	},
	{
		id: "railway",
		title: "Deploy Private Instance on Railway",
		badge: "Cloud self-host",
		summary:
			"Connect your GitHub repository, attach a persistent /data volume, and paste .env.railway.example into Variables.",
		commands: `# In Railway Variables → Raw Editor (from .env.railway.example):
APP_PASSWORD=replace-with-a-strong-passphrase
DATA_DIR=/data
RAILWAY_RUN_UID=0
RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15`,
		note: "Keep 1 replica for SQLite, set Healthcheck Path to /api/health, and generate a Railway HTTPS domain.",
		docHref: "/docs#reference",
		docLabel: "Storage & Railway reference",
	},
	{
		id: "cli",
		title: "CLI & Local Development",
		badge: "Headless / Node 24",
		summary:
			"Run the exact same pure tax engines, importers, and bundled SBI TT tables directly from your terminal.",
		commands: `pnpm install
pnpm --filter @tax/cli build
node apps/cli/dist/index.js compute --ledger ledger.json --year 2026-27 --regime vda --out report.json`,
		note: "Also supports pnpm --filter @tax/web dev for local UI development.",
		docHref: "/docs#reference",
		docLabel: "CLI quick reference",
	},
];

export interface WelcomePreviewData {
	readonly vda: {
		readonly taxYear: string;
		readonly act: string;
		readonly sectionTax: string;
		readonly sectionTds: string;
		readonly asset: string;
		readonly quantity: string;
		readonly considerationInr: string;
		readonly costInr: string;
		readonly gainInr: string;
		readonly baseTaxInr: string;
		readonly cessInr: string;
		readonly estimatedTdsInr: string;
		readonly rateLabel: string;
		readonly cessLabel: string;
		readonly tdsRateLabel: string;
	};
	readonly equity: {
		readonly taxYear: string;
		readonly act: string;
		readonly scheduleFaCy: number;
		readonly sectionLtcg: string;
		readonly sectionForeignAssets: string;
		readonly sectionForeignTaxCredit: string;
		readonly dtaaArticle: string;
		readonly holdingMonthsLabel: string;
		readonly ticker: string;
		readonly shares: string;
		readonly proceedsInr: string;
		readonly costInr: string;
		readonly gainInr: string;
		readonly ltcgTaxInr: string;
		readonly longTermRateLabel: string;
		readonly peakValueInr: string;
		readonly closingValueInr: string;
	};
}

/** Compute synthetic preview figures directly from live rule objects so no tax constants are duplicated. */
export function buildPreviewData(
	vda: VdaRules,
	equity: UsEquityRules,
): WelcomePreviewData {
	const consideration = D("185000");
	const cost = D("125000");
	const vdaGain = consideration.minus(cost);
	const vdaBaseTax = vdaGain.mul(vda.rate);
	const vdaCess = vdaBaseTax.mul(vda.cess);
	const estimatedTds = consideration.mul(vda.tds.rate);

	const eqProceeds = D("4200").mul("84.50");
	const eqCost = D("2600").mul("82.10");
	const eqGain = eqProceeds.minus(eqCost);
	const eqTax = eqGain.mul(equity.longTermRate);
	const peakValue = D("4450").mul("84.80");
	const closingValue = D("0");

	return {
		vda: {
			taxYear: vda.taxYear,
			act: vda.act,
			sectionTax: vda.sections.vdaTax,
			sectionTds: vda.sections.vdaTds,
			asset: "BTC",
			quantity: "0.25",
			considerationInr: formatInr(consideration),
			costInr: formatInr(cost),
			gainInr: formatInr(vdaGain),
			baseTaxInr: formatInr(vdaBaseTax),
			cessInr: formatInr(vdaCess),
			estimatedTdsInr: formatInr(estimatedTds),
			rateLabel: formatPercent(vda.rate),
			cessLabel: formatPercent(vda.cess),
			tdsRateLabel: formatPercent(vda.tds.rate),
		},
		equity: {
			taxYear: equity.taxYear,
			act: equity.act,
			scheduleFaCy: equity.scheduleFaCalendarYear,
			sectionLtcg: equity.sections.ltcgTax,
			sectionForeignAssets: equity.sections.foreignAssets,
			sectionForeignTaxCredit: equity.sections.foreignTaxCredit,
			dtaaArticle: equity.dtaa.dividendArticle,
			holdingMonthsLabel: `> ${equity.longTermHoldingMonths} months`,
			ticker: "MSFT",
			shares: "10",
			proceedsInr: formatInr(eqProceeds),
			costInr: formatInr(eqCost),
			gainInr: formatInr(eqGain),
			ltcgTaxInr: formatInr(eqTax),
			longTermRateLabel: formatPercent(equity.longTermRate),
			peakValueInr: formatInr(peakValue),
			closingValueInr: formatInr(closingValue),
		},
	};
}
