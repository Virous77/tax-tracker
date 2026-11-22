import type { ReviewCode } from "@tax/core";
import type { ReferenceRow } from "./docs-data";

export const REVIEW_FIXES: Record<ReviewCode, string> = {
	missing_history:
		"Import earlier purchases and both transfer sides. Add a manual acquisition only from evidence; unknown cost is not nil cost.",
	missing_inr_value:
		"Inspect the raw trade and FX trail. Fetch eligible prices or enter a supported INR value, then recompute.",
	unknown_type:
		"Review the original action and correct the type or recipe; unsupported actions require separate treatment.",
	unmatched_transfer:
		"Import the other wallet, exchange or broker statement; verify asset, time and quantity before treating it as a self-transfer.",
	tds_not_deducted:
		"Reconcile Form 26AS / AIS and payer obligations with your CA; acknowledge only after checking.",
	ambiguous_timezone:
		"Confirm the export’s timezone from the broker/exchange, then correct the import or mapping. Boundary dates affect the tax year.",
	balance_mismatch:
		"Compare year-end computed holdings with actual balances; look for missing history, transfers or fees.",
	parse_warning:
		"Read the specific warning and raw row, correct the source mapping or transaction, then preview/recompute.",
	complex_onchain:
		"Review DeFi, bridge or multi-leg activity from the transaction hash; classify and value with evidence.",
	ca_verification_pending:
		"Ask your CA to verify rule-file citations and settings. A completed calculation does not verify tax law.",
	import_incomplete:
		"Inspect Imports for row errors or missing statement sections; fix them and re-import before relying on totals.",
	fx_unavailable:
		"Inspect the requested date and bundled SBI coverage (a freshness guard emits fx_unavailable past the bundled archive rather than using a stale rate). Obtain a supported rate or corrected history; never substitute a guessed rate.",
	ambiguous_transfer:
		"Inspect all candidate deposits/withdrawals and transaction hashes; confirm the actual match.",
	fee_review_required:
		"Check fee asset, amount and GST; confirm deductibility and any separate crypto disposal treatment with your CA.",
	suspected_spam:
		"Verify the token or transaction on-chain before clearing. Suspected spam is excluded until reviewed.",
	possible_duplicate:
		"Compare raw rows and source references across overlapping exports or API sync before counting both.",
	missing_market_price:
		"On US Stocks → Schedule FA, enter peak USD price/date and year-end closing price, or opt in to Auto-fill.",
	unmatched_foreign_tax:
		"Match withholding to the gross dividend by ticker and date; resolve inline/standalone overlap against broker records.",
	corporate_action:
		"Review splits, mergers or spin-offs and document share quantities, acquisition dates and allocated basis. Automatic basis adjustment is not supported.",
};

export const PROVIDER_REFERENCE: ReferenceRow[] = [
	[
		"Polygon.io (Massive)",
		"Unadjusted historical US stock daily closing bars for Schedule FA (to match historical share counts). Configured for a 5 requests/min budget with 12.5-second spacing; provider history, corporate actions and plan restrictions can leave prices missing or require review.",
	],
	[
		"Finnhub",
		"Alternative/fallback US daily stock prices. Configured for 60 requests/min with 1.1-second spacing. Candle access depends on the provider’s plan.",
	],
	[
		"CoinGecko Demo",
		"Optional crypto fallback when Binance has no eligible quote; resolves verified ERC-20 contracts across all 5 supported EVM chains (Ethereum, Base, Arbitrum, Polygon, BNB Chain) within the last 365 days. Configured for a 100 requests/min budget with 700 ms spacing. Uses UTC snapshots.",
	],
	[
		"Binance",
		"Read-only exchange history uses 400 ms minimum spacing plus endpoint weight budgets and response-header accounting (P2P API capped at 6 months; dust capped at latest 100 records; zero-balance pairs need extra symbols or Statement CSVs). HTTP 418 stops the sync. Optional public daily klines require no exchange key.",
	],
	[
		"CoinDCX",
		"Spot Orderbook trade history only, paced at 350 ms between requests. API keys cannot be limited to read-only, and API sync excludes Instant Buy/Sell orders, deposits/withdrawals, Earn/SIP and TDS / Form 16A (supplement with XLSX/PDF exports on Import).",
	],
	[
		"Etherscan V2",
		"EVM explorer history, paced at 350 ms for the configured 3 calls/second budget. Free/paid network coverage is checked; unsupported access requires another configured provider.",
	],
	[
		"Blockscout",
		"Explorer fallback on supported EVM networks, paced at 210 ms.",
	],
	[
		"Alchemy / NodeReal RPC",
		"EVM transfer / transaction history on supported chains, paced at 200 ms for remote RPC. Local RPC endpoints have no artificial pacing.",
	],
];
