import {
	type CachedPrice,
	EngineSettingsSchema,
	type LedgerTx,
} from "@tax/core";
import { describe, expect, it } from "vitest";
import {
	binanceKlines,
	coingeckoHistory,
	planPriceFill,
	priceLookupFromCache,
} from "../src/index.js";

const settings = EngineSettingsSchema.parse({});
const tx: LedgerTx = {
	id: "00000000-0000-4000-8000-000000000001",
	importId: null,
	source: "evm:1",
	sourceRef: "1",
	timestamp: "2026-05-01T00:00:00Z",
	type: "swap",
	assetOut: "ETH",
	amountOut: "1",
	assetIn: "USDC",
	amountIn: "2000",
	raw: {},
	reviewFlags: [],
};
const cached: CachedPrice = {
	source: "binance_klines",
	sourceId: "ETHUSDT",
	quote: "USDT",
	dayBasis: "IST",
	date: "2026-05-01",
	kind: "close",
	price: "2000",
	final: true,
	fetchedAt: "2026-05-05T00:00:00Z",
};
describe("offline planning and cache lookup", () => {
	it("plans the outgoing asset, income FMV and third-asset fees, never spam", () => {
		const plan = planPriceFill({
			transactions: [
				{ ...tx, feeAsset: "BNB", feeAmount: "0.1" },
				{ ...tx, sourceRef: "2", type: "income", assetIn: "LINK" },
				{
					...tx,
					sourceRef: "3",
					assetOut: "SPAM",
					reviewFlags: [{ code: "suspected_spam", message: "test" }],
				},
			],
			taxYear: "2026-27",
			settings: { ...settings, feeTreatment: "include" },
			cache: [],
		});
		expect(plan.needed).toEqual([
			{ asset: "BNB", date: "2026-05-01" },
			{ asset: "ETH", date: "2026-05-01" },
			{ asset: "LINK", date: "2026-05-01" },
		]);
	});
	it("subtracts final prices and refreshes nonfinal rows", () => {
		expect(
			planPriceFill({
				transactions: [tx],
				taxYear: "2026-27",
				settings,
				cache: [cached],
			}).missing,
		).toEqual([]);
		expect(
			planPriceFill({
				transactions: [tx],
				taxYear: "2026-27",
				settings,
				cache: [{ ...cached, final: false }],
			}).ranges,
		).toHaveLength(1);
	});
	it("uses basis and explicit provider identity, including unknown contracts", () => {
		const factory = priceLookupFromCache([
			cached,
			{
				...cached,
				source: "coingecko",
				sourceId: "ethereum",
				quote: "INR",
				dayBasis: "UTC",
				kind: "snapshot_00utc",
				price: "180000",
			},
		]);
		expect(factory("ETH", cached.date, "close")?.price).toBe("2000");
		expect(factory("ETH", cached.date, "vwap")?.price).toBe("180000");
		expect(factory("ERC20:1:0XABC", cached.date, "close")).toBeNull();
	});
	it("groups consecutive dates and never refetches a final middle day", () => {
		const rows = [1, 2, 3].map((day) => ({
			...tx,
			id: `00000000-0000-4000-8000-00000000000${day}`,
			sourceRef: String(day),
			timestamp: `2026-05-0${day}T00:00:00Z`,
		}));
		expect(
			planPriceFill({
				transactions: rows,
				taxYear: "2026-27",
				settings,
				cache: [],
			}).ranges,
		).toHaveLength(1);
		expect(
			planPriceFill({
				transactions: rows,
				taxYear: "2026-27",
				settings,
				cache: [{ ...cached, date: "2026-05-02" }],
			}).ranges,
		).toHaveLength(2);
	});
	it("uses an IST-aligned ranged kline request and exact decimal VWAP", async () => {
		let requested: URL | undefined;
		const rows = await binanceKlines({
			symbol: "ETHUSDT",
			start: "2026-05-01",
			end: "2026-05-01",
			now: Date.parse("2026-05-05"),
			request: async (url) => {
				requested = new URL(url);
				return [
					[
						String(Date.parse("2026-04-30T18:30:00Z")),
						"1",
						"3",
						"1",
						"2.123456789012345678",
						"3",
						"0",
						"7",
					],
				];
			},
		});
		expect(requested?.searchParams.get("timeZone")).toBe("5:30");
		expect(requested?.searchParams.get("limit")).toBe("1000");
		expect(rows[0]).toMatchObject({
			date: "2026-05-01",
			price: "2.123456789012345678",
			final: true,
		});
		expect(rows[1]?.price.startsWith("2.333333333333333333")).toBe(true);
	});
	it("sends the Demo key only in a header and enforces its history limit", async () => {
		let calls = 0;
		const request = async (url: string, init?: RequestInit) => {
			calls++;
			expect(url).not.toContain("secret-key");
			expect(init?.headers).toEqual({ "x-cg-demo-api-key": "secret-key" });
			return {
				market_data: { current_price: { inr: "123.4567890123456789" } },
			};
		};
		const args = {
			request,
			apiKey: "secret-key",
			coinId: "ethereum",
			date: "2026-05-01",
			now: Date.parse("2026-05-05"),
		};
		expect(await coingeckoHistory(args)).toMatchObject({
			price: "123.4567890123456789",
			dayBasis: "UTC",
			kind: "snapshot_00utc",
		});
		expect(await coingeckoHistory({ ...args, date: "2020-01-01" })).toBeNull();
		expect(calls).toBe(1);
	});
});
