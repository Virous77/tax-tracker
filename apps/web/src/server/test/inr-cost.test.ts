import type { LedgerTx } from "@tax/core";
import { expect, it } from "vitest";
import {
	describeOtherValue,
	implausibleCostWarning,
	inrTotalFromEntry,
	perUnitFromEntry,
	pricedLeg,
	referenceFromLedger,
	referenceFromReport,
	referenceFromSale,
} from "../../lib/client/inr-cost";

function tx(fields: Partial<LedgerTx>): LedgerTx {
	return {
		id: crypto.randomUUID(),
		source: "binance",
		sourceRef: "r",
		importId: null,
		timestamp: "2026-06-01T00:00:00.000Z",
		type: "buy",
		raw: {},
		reviewFlags: [],
		...fields,
	} as LedgerTx;
}

it("stores the total: per-unit × quantity, unrounded; a typed total is kept as typed", () => {
	expect(inrTotalFromEntry("perUnit", "95", "1234.5")).toBe("117277.5");
	expect(inrTotalFromEntry("perUnit", "88.123", "0.333")).toBe("29.344959");
	expect(inrTotalFromEntry("total", "117277.50", "1234.5")).toBe("117277.50");
	expect(inrTotalFromEntry("perUnit", "95", "")).toBeNull();
	expect(inrTotalFromEntry("perUnit", "95", "0")).toBeNull();
	expect(inrTotalFromEntry("perUnit", "abc", "1")).toBeNull();
	expect(perUnitFromEntry("total", "95", "1234.5")).toMatch(/^0\.0769/);
});

it("always shows the other reading of the amount", () => {
	expect(describeOtherValue("perUnit", "95", "1234.5", "USDT")).toBe(
		"= ₹1,17,277.50 total for 1234.5 USDT",
	);
	expect(describeOtherValue("total", "117277.5", "1234.5", "USDT")).toBe(
		"= ₹95.00 per USDT",
	);
	expect(describeOtherValue("total", "95", "1234.5", "USDT")).toBe(
		"= ₹0.077 per USDT",
	);
	expect(describeOtherValue("perUnit", "95", "", "USDT")).toBe(
		"Enter the quantity to work out the total.",
	);
	expect(describeOtherValue("total", "", "1", "USDT")).toBeNull();
});

it("warns when a total looks like a per-unit price, and never otherwise changes anything", () => {
	const reference = { perUnit: "88", basis: "your other USDT transactions" };
	expect(
		implausibleCostWarning("total", "95", "1234.5", "USDT", reference),
	).toBe(
		"₹0.077 per USDT looks very low next to about ₹88.00 per USDT (your other USDT transactions). Did you mean ₹95.00 per USDT? Then choose “Per unit”. You can still save as it is.",
	);
	expect(
		implausibleCostWarning("perUnit", "95", "1234.5", "USDT", reference),
	).toBeNull();
	expect(
		implausibleCostWarning("total", "117277.5", "1234.5", "USDT", reference),
	).toBeNull();
	expect(
		implausibleCostWarning("perUnit", "117277.5", "1234.5", "USDT", reference),
	).toMatch(/looks very high .* Did you type the total\? Then choose “Total”/);
	expect(
		implausibleCostWarning("total", "95", "1234.5", "USDT", null),
	).toBeNull();
});

it("takes the reference from the sale, or the median of imported rows (never manual ones)", () => {
	const sale = tx({
		type: "swap",
		assetOut: "USDC",
		amountOut: "250",
		assetIn: "USDT",
		amountIn: "250.21",
		inrValue: "22000",
	});
	expect(referenceFromSale(sale, "USDC")?.perUnit).toBe("88");
	const rows = [
		tx({ type: "sell", assetOut: "USDT", amountOut: "100", inrValue: "8700" }),
		tx({ type: "buy", assetIn: "USDT", amountIn: "10", inrValue: "880" }),
		tx({
			type: "buy",
			assetIn: "BTC",
			amountIn: "1",
			assetOut: "USDT",
			amountOut: "1000",
			inrValue: "90000",
		}),
		tx({
			source: "manual",
			assetIn: "USDT",
			amountIn: "1234.5",
			inrValue: "95",
		}),
	];
	expect(referenceFromLedger(rows, "USDT")?.perUnit).toBe("88");
	expect(referenceFromLedger([], "USDT")).toBeNull();
});

it("prices the received coin of a buy and the sold coin of a sale", () => {
	const swap = tx({
		assetIn: "BTC",
		amountIn: "1",
		assetOut: "USDT",
		amountOut: "9",
	});
	expect(pricedLeg(swap, "buy")).toEqual({ asset: "BTC", quantity: "1" });
	expect(pricedLeg(swap, "sell")).toEqual({ asset: "USDT", quantity: "9" });
	expect(pricedLeg(tx({ type: "fee" }))).toBeNull();
});

it("falls back to the computed report's INR values for USDT-quoted trades", () => {
	const trade = tx({
		assetIn: "BTC",
		amountIn: "0.01",
		assetOut: "USDT",
		amountOut: "1000",
	});
	const manual = tx({ source: "manual", assetIn: "USDT", amountIn: "1234.5" });
	const report = {
		taxYear: "2026-27",
		ledger: [trade, manual],
		valuations: [
			{ txId: trade.id, valueInr: "88000" },
			{ txId: manual.id, valueInr: "95" },
		],
	} as never;
	expect(referenceFromReport(report, "USDT")).toEqual({
		perUnit: "88",
		basis: "USDT values in your 2026-27 report",
	});
	expect(referenceFromReport(report, "BTC")?.perUnit).toBe("8800000");
});
