import { EngineSettingsSchema, type LedgerTx } from "@tax/core";
import { describe, expect, it, vi } from "vitest";
import {
	deriveScheduleFaPrices,
	finnhubDailyBars,
	planEquityPriceFill,
	polygonDailyBars,
} from "../src/index.js";

const range = {
	apiKey: "secret",
	symbol: "X:Y",
	from: "2025-01-01",
	to: "2025-12-31",
};
const utc = (date: string) => Date.parse(`${date}T05:00:00Z`);

describe("historical stock bar clients", () => {
	it("uses only a Polygon bearer header and preserves valid decimal prices", async () => {
		const request = vi.fn(async () => ({
			results: [
				{ t: utc("2025-03-03"), h: "205.123456789012345678", c: "2.01e2" },
				{ t: utc("2024-12-31"), h: "210", c: "101" },
				{ t: utc("2026-01-01"), h: "220", c: "109" },
				{ t: utc("2025-03-04"), h: "210", c: "0" },
				{ t: utc("2025-03-05"), h: "broken", c: "135" },
				{ t: "not-a-timestamp", h: "210", c: "135" },
				null,
			],
		}));
		expect(await polygonDailyBars({ ...range, request })).toEqual([
			{ date: "2025-03-03", high: "205.123456789012345678", close: "201" },
		]);
		expect(request).toHaveBeenCalledWith(
			"https://api.polygon.io/v2/aggs/ticker/X%3AY/range/1/day/2025-01-01/2025-12-31?adjusted=false&sort=asc&limit=50000",
			{ headers: { Authorization: "Bearer secret" } },
		);
		expect(
			await polygonDailyBars({ ...range, request: async () => ({}) }),
		).toEqual([]);
		await expect(
			polygonDailyBars({ ...range, request: async () => ({ results: "bad" }) }),
		).rejects.toThrow("Invalid Polygon bars response");
	});

	it("zips Finnhub bars, includes December 31, and sends credentials in a header", async () => {
		const request = vi.fn(async () => ({
			s: "ok",
			t: [
				utc("2025-12-31") / 1000,
				utc("2026-01-01") / 1000,
				utc("2025-03-04") / 1000,
			],
			h: ["240.50", "260", "Infinity"],
			c: ["201.4", "204", "140"],
		}));
		expect(await finnhubDailyBars({ ...range, request })).toEqual([
			{ date: "2025-12-31", high: "240.5", close: "201.4" },
		]);
		expect(request).toHaveBeenCalledWith(
			"https://finnhub.io/api/v1/stock/candle?symbol=X%3AY&resolution=D&from=1735689600&to=1767225599",
			{ headers: { "X-Finnhub-Token": "secret" } },
		);
		expect(
			await finnhubDailyBars({
				...range,
				request: async () => ({ s: "no_data" }),
			}),
		).toEqual([]);
		await expect(
			finnhubDailyBars({
				...range,
				request: async () => ({
					s: "ok",
					t: [utc("2025-12-31") / 1000],
					h: [],
					c: [],
				}),
			}),
		).rejects.toThrow("Invalid Finnhub candles response");
	});
});

const priceInput = { calendarYear: 2025, symbol: "ACME", source: "polygon" };

it("uses the highest daily close value across fractional buys, breaks ties by earliest date and uses the last close", () => {
	const bars = [
		{ date: "2025-05-03", high: "200", close: "140" },
		{ date: "2025-05-01", high: "400", close: "200" },
		{ date: "2025-05-02", high: "150", close: "140" },
		{ date: "2025-04-30", high: "700", close: "500" },
		{ date: "2026-01-01", high: "4000", close: "2000" },
		{ date: "2025-12-30", high: "135", close: "130" },
	];
	expect(
		deriveScheduleFaPrices({
			...priceInput,
			bars,
			events: [
				{ date: "2025-05-01", quantity: "0.75" },
				{ date: "2025-05-02", quantity: "1.25" },
				{ date: "2025-12-03", quantity: "0.25" },
			],
			closingQty: "0.25",
		}),
	).toEqual({
		...priceInput,
		peakDate: "2025-05-02",
		peakPriceUsd: "140",
		closingPriceUsd: "130",
	});
});

it("omits prices when market bars miss the holding window or there are no year-end shares", () => {
	const bars = [{ date: "2025-10-01", high: "200", close: "180" }];
	const events = [
		{ date: "2025-10-02", quantity: "0.01" },
		{ date: "2025-10-03", quantity: "0" },
	];
	expect(
		deriveScheduleFaPrices({ ...priceInput, bars, events, closingQty: "0" }),
	).toEqual(priceInput);
	expect(
		deriveScheduleFaPrices({
			...priceInput,
			bars,
			events: events.slice(0, 1),
			closingQty: "0.01",
		}),
	).toEqual({ ...priceInput, closingPriceUsd: "180" });
	expect(
		deriveScheduleFaPrices({
			...priceInput,
			bars: [],
			events,
			closingQty: "1",
		}),
	).toEqual(priceInput);
});

function transaction(
	sourceRef: string,
	timestamp: string,
	fields: Partial<LedgerTx>,
): LedgerTx {
	return {
		id: sourceRef,
		source: "broker-a",
		sourceRef,
		importId: null,
		assetClass: "us_equity",
		timestamp,
		type: "buy",
		assetIn: "ACME",
		amountIn: "1.125",
		assetOut: "USD",
		amountOut: "100",
		raw: {},
		reviewFlags: [],
		...fields,
	};
}

it("plans opening shares, matches internal moves, retains exited positions and uses end-of-day IST quantities", () => {
	const { holdings, calendarYear } = planEquityPriceFill({
		rules: { scheduleFaCalendarYear: 2025 },
		settings: EngineSettingsSchema.parse({ lotPool: "per_source" }),
		existingPrices: [
			{
				calendarYear: 2025,
				symbol: "ACME",
				peakDate: "2025-06-01",
				peakPriceUsd: "100",
			},
			{
				calendarYear: 2024,
				symbol: "SOLD",
				peakDate: "2024-06-01",
				peakPriceUsd: "100",
			},
		],
		transactions: [
			transaction("6", "2025-06-02T17:00:00Z", {
				type: "sell",
				assetOut: "SOLD",
				amountOut: "0.5",
				assetIn: "USD",
				amountIn: "140",
			}),
			transaction("4", "2025-06-02T08:00:00Z", {
				assetIn: "SOLD",
				amountIn: "0.5",
			}),
			transaction("1", "2024-12-31T10:00:00Z", {}),
			transaction("3", "2025-02-04T00:00:00Z", {
				type: "deposit",
				source: "broker-b",
			}),
			transaction("2", "2025-02-03T00:00:00Z", {
				type: "withdrawal",
				assetOut: "ACME",
				amountOut: "1.125",
			}),
			transaction("5", "2025-06-01T20:00:00Z", { amountIn: "0.375" }),
			transaction("7", "2025-12-31T19:00:00Z", { assetIn: "NEXT" }),
			transaction("8", "2025-12-31T10:00:00Z", {
				assetIn: "IGNORED",
				reviewFlags: [{ code: "corporate_action", message: "test" }],
			}),
			transaction("9", "2025-12-31T10:00:00Z", {
				assetIn: "VDA",
				assetClass: "vda",
			}),
			transaction("10", "2025-12-31T10:00:00Z", {
				type: "deposit",
				assetIn: "USD",
			}),
		],
	});
	expect(calendarYear).toBe(2025);
	expect(holdings).toEqual([
		{
			symbol: "ACME",
			openingQty: "1.125",
			closingQty: "1.5",
			events: [
				{ date: "2025-01-01", quantity: "1.125" },
				{ date: "2025-06-02", quantity: "1.5" },
			],
			needsPeak: false,
			needsClosing: true,
		},
		{
			symbol: "SOLD",
			openingQty: "0",
			closingQty: "0",
			events: [{ date: "2025-06-02", quantity: "0" }],
			needsPeak: true,
			needsClosing: false,
		},
	]);
});
