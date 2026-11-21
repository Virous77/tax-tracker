import type { LedgerTx, VdaReport } from "@tax/core";
import { expect, it } from "vitest";
import {
	describeDisposal,
	describeTransaction,
	missingExportHints,
	transactionHref,
	unresolvedSales,
	venueForSource,
} from "../../lib/client/disposals";
import { addMissingBuyHref } from "../../lib/client/review-codes";

function tx(fields: Partial<LedgerTx>): LedgerTx {
	return {
		id: "00000000-0000-4000-8000-000000000001",
		source: "binance",
		sourceRef: "order-1",
		importId: null,
		timestamp: "2026-06-23T14:08:00.000Z",
		type: "swap",
		raw: {},
		reviewFlags: [],
		...fields,
	} as LedgerTx;
}

it("describes the transaction behind an unresolved sale", () => {
	expect(
		describeTransaction(
			tx({
				assetOut: "USDC",
				amountOut: "250",
				assetIn: "USDT",
				amountIn: "250.21",
			}),
		),
	).toBe("Swapped 250 USDC → 250.21 USDT");
	expect(
		describeTransaction(
			tx({
				type: "sell",
				assetOut: "BNB",
				amountOut: "0.1",
				assetIn: "INR",
				amountIn: "5000",
			}),
		),
	).toBe("Sold 0.1 BNB for 5000 INR");
	expect(
		describeTransaction(
			tx({ type: "sell", assetOut: "BNB", amountOut: "0.1", inrValue: "5000" }),
		),
	).toMatch(/^Sold 0\.1 BNB for ₹/);
	expect(
		describeDisposal(
			tx({
				assetOut: "USDC",
				amountOut: "10",
				assetIn: "USDT",
				amountIn: "10",
				feeAsset: "BNB",
				feeAmount: "0.001",
			}),
			"BNB",
		),
	).toBe("Paid 0.001 BNB fee on: Swapped 10 USDC → 10 USDT");
});

it("maps a sale's source to the venue a manual purchase counts toward", () => {
	expect(venueForSource(tx({ source: "binance-api" }))).toBe("binance");
	expect(venueForSource(tx({ source: "coindcx" }))).toBe("coindcx");
	expect(venueForSource(tx({ source: "evm:1" }))).toBe("manual");
	expect(venueForSource(tx({ source: "manual", venue: "coindcx" }))).toBe(
		"coindcx",
	);
});

it("names the exports to import per venue, once each", () => {
	const hints = missingExportHints([
		"binance",
		"binance-api",
		"evm:56",
		"manual",
	]);
	expect(hints.map((h) => h.venue)).toEqual(["Binance", "On-chain wallets"]);
	expect(hints[0]?.exports.map((e) => e.name)).toContain("Deposit history");
});

it("merges FIFO slices of one sale and keeps the ledger row", () => {
	const sale = tx({
		assetOut: "USDC",
		amountOut: "250",
		assetIn: "USDT",
		amountIn: "250.21",
	});
	const report = {
		ledger: [sale],
		unresolved: [
			{
				txId: sale.id,
				asset: "USDC",
				quantity: "200",
				reason: "missing_history",
			},
			{
				txId: sale.id,
				asset: "USDC",
				quantity: "50",
				reason: "missing_history",
			},
		],
	} as unknown as VdaReport;
	const [only, ...rest] = unresolvedSales(report);
	expect(rest).toEqual([]);
	expect(only?.quantity).toBe("250");
	expect(only?.tx).toBe(sale);
	expect(transactionHref(sale, "2026-27")).toBe(
		"/transactions?taxYear=2026-27&q=order-1",
	);
});

it("links Add missing buy to the sale it is for", () => {
	expect(
		addMissingBuyHref("USDC", "2026-27", "2026-06-23T14:08:00.000Z", "abc"),
	).toBe(
		"/transactions?add=buy&asset=USDC&taxYear=2026-27&before=2026-06-23T14%3A08%3A00.000Z&sale=abc",
	);
	expect(addMissingBuyHref("ETH", "2026-27")).toBe(
		"/transactions?add=buy&asset=ETH&taxYear=2026-27",
	);
});
