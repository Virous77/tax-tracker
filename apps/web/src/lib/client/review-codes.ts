import type { LedgerTx, ReviewCode } from "@tax/core";

export interface ReviewCodeInfo {
	code: ReviewCode;
	title: string;
	severity: "error" | "warning" | "info";
	explanation: string;
	fixLabel: string;
	fixHref: (tx: LedgerTx, taxYear?: string) => string;
}

export const REVIEW_CODE_INFO: Record<ReviewCode, ReviewCodeInfo> = {
	missing_history: {
		code: "missing_history",
		title: "Missing acquisition history",
		severity: "error",
		explanation:
			"A disposal (sell or swap) happened for an asset where FIFO lots ran out. Under Indian VDA rules, missing cost of acquisition cannot be guessed silently — these slices are excluded from computed totals until you import earlier history or add a manual missing buy.",
		fixLabel: "Add missing buy",
		fixHref: (tx, taxYear) => {
			const asset = tx.assetOut ?? tx.assetIn ?? "";
			const params = new URLSearchParams({ add: "buy" });
			if (asset) params.set("asset", asset);
			if (taxYear) params.set("taxYear", taxYear);
			return `/transactions?${params.toString()}`;
		},
	},
	missing_inr_value: {
		code: "missing_inr_value",
		title: "Missing INR valuation",
		severity: "error",
		explanation:
			"This transaction has no INR consideration or fair market value, and no USDT/USD price quote to value it automatically. Set an INR value manually or review the raw row.",
		fixLabel: "Edit INR value",
		fixHref: (tx, taxYear) => {
			const params = new URLSearchParams({ flagged: "true", q: tx.sourceRef });
			if (taxYear) params.set("taxYear", taxYear);
			return `/transactions?${params.toString()}`;
		},
	},
	unknown_type: {
		code: "unknown_type",
		title: "Unrecognized transaction type",
		severity: "error",
		explanation:
			"The importer could not map this row's type or side to a known ledger action (buy, sell, swap, deposit, withdrawal, income, or gift). Inspect the raw row and assign the right type.",
		fixLabel: "Assign transaction type",
		fixHref: (tx, taxYear) => {
			const params = new URLSearchParams({ flagged: "true", q: tx.sourceRef });
			if (taxYear) params.set("taxYear", taxYear);
			return `/transactions?${params.toString()}`;
		},
	},
	unmatched_transfer: {
		code: "unmatched_transfer",
		title: "Unmatched withdrawal or deposit",
		severity: "warning",
		explanation:
			"This withdrawal or deposit could not be paired with a matching deposit/withdrawal on another imported source within the transfer-match window. Import the missing exchange/wallet file or verify whether it was a disposal/gift.",
		fixLabel: "Import missing source or edit",
		fixHref: () => "/import",
	},
	tds_not_deducted: {
		code: "tds_not_deducted",
		title: "TDS not deducted by platform",
		severity: "warning",
		explanation:
			"Offshore or non-FIU exchanges (like Binance) generally do not deduct 1% VDA TDS under Section 194S/393. You may still need to verify whether TDS obligation applied and reconcile in your report.",
		fixLabel: "Review TDS in Report",
		fixHref: (_tx, taxYear) =>
			taxYear
				? `/report?taxYear=${encodeURIComponent(taxYear)}#tds`
				: "/report#tds",
	},
	ambiguous_timezone: {
		code: "ambiguous_timezone",
		title: "Ambiguous timestamp timezone",
		severity: "warning",
		explanation:
			"The source file did not include an explicit timezone offset, so timestamps were interpreted using your chosen file timezone. Verify trades near midnight on 31 March / 1 April IST.",
		fixLabel: "Check imports",
		fixHref: () => "/imports",
	},
	balance_mismatch: {
		code: "balance_mismatch",
		title: "Computed vs actual balance mismatch",
		severity: "warning",
		explanation:
			"The computed year-end balance differs from the actual wallet/exchange balance you entered. Missing deposits, unimported trades, or fee conventions can cause this.",
		fixLabel: "Check balances in Report",
		fixHref: (_tx, taxYear) =>
			taxYear
				? `/report?taxYear=${encodeURIComponent(taxYear)}#balances`
				: "/report#balances",
	},
	parse_warning: {
		code: "parse_warning",
		title: "Import parse warning",
		severity: "warning",
		explanation:
			"The row was imported with a minor parsing fallback or unusual format. Check the raw row against the converted fields before relying on it.",
		fixLabel: "Inspect in Transactions",
		fixHref: (tx, taxYear) => {
			const params = new URLSearchParams({ flagged: "true", q: tx.sourceRef });
			if (taxYear) params.set("taxYear", taxYear);
			return `/transactions?${params.toString()}`;
		},
	},
	complex_onchain: {
		code: "complex_onchain",
		title: "Complex on-chain interaction",
		severity: "info",
		explanation:
			"This on-chain transaction involves multi-leg or contract interactions that may need manual classification or CA review.",
		fixLabel: "Inspect in Transactions",
		fixHref: (tx, taxYear) => {
			const params = new URLSearchParams({ flagged: "true", q: tx.sourceRef });
			if (taxYear) params.set("taxYear", taxYear);
			return `/transactions?${params.toString()}`;
		},
	},
};
