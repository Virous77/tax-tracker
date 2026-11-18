import { beforeAll, describe, expect, it } from "vitest";
import { taxYearOf } from "../../packages/core/dist/time.js";
import { addManual, allTx, compute } from "./lib";
import {
	addEvm,
	allProviders,
	api,
	call,
	clearRequests,
	fail,
	HASH,
	istDay,
	MOCK_SYNC,
	mockDay,
	mockTxTime,
	ok,
	requests,
	syncOk,
	WALLET_A,
	waitJob,
	wipeP2,
} from "./p2";

// Fixture dates follow the mock's clock: the year under test is the one holding the mainnet ETH
// swap, and OLD_YEAR holds a date more than 365 days back (beyond CoinGecko's demo window). 500
// days keeps the two in different tax years.
let YEAR = "";
let OLD_YEAR = "";
let swapDay = "";
let oldDay = "";
const ddmmyyyy = (day: string) => day.split("-").reverse().join("-");
const status = async (year = YEAR) =>
	ok(
		await call("GET", `/api/prices/status?taxYear=${year}`),
		200,
		api.PricesStatusSchema,
	);
const setPrices = async (patch: Record<string, unknown>) =>
	ok(
		await call("PUT", "/api/settings", { json: patch }),
		200,
		api.PutSettingsResponseSchema,
	);
async function fill(year = YEAR) {
	const { jobId } = ok(
		await call("POST", "/api/prices/fill", { json: { taxYear: year } }),
		202,
		api.JobStartedSchema,
	);
	const job = await waitJob(jobId);
	expect(job.kind).toBe("price_fill");
	expect(job.status, job.error ?? "").toBe("completed");
	return api.PriceFillSummarySchema.parse(job.result);
}
const priceHosts = (log: Awaited<ReturnType<typeof requests>>) =>
	log.filter(
		(r) =>
			r.path.startsWith("/binance-data") || r.path.startsWith("/coingecko"),
	);

let base8453 = "";
let ethSwapId = "";
let xrpRecentId = "";
let usdcSwapId = "";
const enabledLog: Awaited<ReturnType<typeof requests>> = [];

describe("prices", () => {
	beforeAll(async () => {
		await wipeP2();
		const swapTime = await mockTxTime(HASH.swap);
		YEAR = taxYearOf(swapTime);
		swapDay = istDay(swapTime);
		const oldTime = await mockDay(500);
		OLD_YEAR = taxYearOf(oldTime);
		oldDay = istDay(oldTime);
		expect(OLD_YEAR).not.toBe(YEAR);
		await allProviders();
		await syncOk((await addEvm(WALLET_A, 1)).id);
		base8453 = (await addEvm(WALLET_A, 8453)).id;
		await addManual({
			timestamp: oldTime,
			type: "swap",
			source: "binance",
			assetOut: "XRP",
			amountOut: "10",
			assetIn: "ETH",
			amountIn: "0.005",
		});
		xrpRecentId = (
			await addManual({
				timestamp: `${swapDay}T06:00:00.000Z`,
				type: "swap",
				source: "binance",
				assetOut: "XRP",
				amountOut: "20",
				assetIn: "ETH",
				amountIn: "0.01",
			})
		).id;
		// USDC has no USDCUSDT kline pair on the mock, so only CoinGecko (usd-coin) can price it.
		usdcSwapId = (
			await addManual({
				timestamp: `${swapDay}T07:00:00.000Z`,
				type: "swap",
				source: "binance",
				assetOut: "USDC",
				amountOut: "50",
				assetIn: "ETH",
				amountIn: "0.02",
			})
		).id;
		ethSwapId =
			(await allTx({ source: "evm:1" })).find((t) => t.txHash === HASH.swap)
				?.id ?? "";
		expect(ethSwapId).not.toBe("");
	}, 300_000);

	describe("disabled (default)", () => {
		it("status reports enabled:false and the dates a report needs", async () => {
			const s = await status();
			expect(s.enabled).toBe(false);
			// The price cache is global and outlives a ledger wipe, so earlier files may have filled some dates.
			// Prices before the year still count: earlier lots need a cost (the old XRP date).
			expect(s.needed).toBe(4);
			expect(s.missing).toEqual(
				expect.arrayContaining([
					{ asset: "XRP", date: swapDay },
					{ asset: "XRP", date: oldDay },
				]),
			);
			expect((await status(OLD_YEAR)).missing).toContainEqual({
				asset: "XRP",
				date: oldDay,
			});
			expect(s.cached + s.missing.length).toBe(s.needed);
			expect(s.sources).toEqual({
				binanceKlines: true,
				coingecko: { keySet: true },
			});
		});
		it("fill → 409 prices_disabled", async () => {
			fail(
				await call("POST", "/api/prices/fill", { json: { taxYear: YEAR } }),
				409,
				"prices_disabled",
			);
		});
		it("compute makes no network calls at all", async () => {
			await clearRequests();
			await compute(YEAR);
			expect(await requests()).toEqual([]);
		});
		it("the XRP swap with no price is missing_inr_value", async () => {
			const tx = (await allTx()).find((t) => t.id === xrpRecentId);
			expect(
				tx?.reviewFlags.some(
					(f) =>
						f.code === "missing_inr_value" &&
						/No recorded INR value/.test(f.message),
				),
			).toBe(true);
		});
		it.each([
			["no taxYear", ""],
			["a bad taxYear", "?taxYear=2025"],
			["an unsupported taxYear", "?taxYear=2001-02"],
		])("status with %s → 4xx", async (_, qs) => {
			const res = await call("GET", `/api/prices/status${qs}`);
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);
		});
	});

	describe("enabled", () => {
		it("a sync with prices enabled starts a price fill for the affected year", async () => {
			await setPrices({ prices: { enabled: true } });
			await clearRequests();
			await syncOk(base8453);
			const deadline = Date.now() + 60_000;
			while (
				!(await requests()).some(
					(r) => r.path === "/binance-data/api/v3/klines",
				)
			) {
				if (Date.now() > deadline)
					throw new Error("no kline request after sync");
				await new Promise((r) => setTimeout(r, 500));
			}
		}, 120_000);

		it("fill → completed job with requested/fetched/fromCache/missing", async () => {
			await new Promise((r) => setTimeout(r, 3000));
			enabledLog.push(...(await requests()));
			await clearRequests();
			const s = await fill();
			enabledLog.push(...(await requests()));
			expect(s.missing).toContainEqual({ asset: "XRP", date: swapDay });
			expect(s.missing.some((m) => m.asset === "ETH")).toBe(false);
			expect(s.requested).toBe((await status()).needed);
		});
		it("klines are requested IST-aligned (timeZone 5:30), daily", async () => {
			const kl = (await requests()).filter(
				(r) => r.path === "/binance-data/api/v3/klines",
			);
			for (const r of kl) expect(r.params).toMatchObject({ interval: "1d" });
			for (const r of kl) expect(r.params.timeZone).toMatch(/^5:30|^\+?05:30$/);
		});
		it("CoinGecko is asked for the recent XRP date (no kline pair); the key travels in a header, not the URL", async () => {
			const cg = (await requests()).filter((r) =>
				r.path.startsWith("/coingecko"),
			);
			expect(
				cg.some(
					(r) =>
						r.path.includes("/coins/ripple/history") &&
						r.params.date === ddmmyyyy(swapDay),
				),
			).toBe(true);
			for (const r of cg) expect(r.params.x_cg_demo_api_key).toBeUndefined();
		});
		it("CoinGecko numeric INR is cached: the USDC swap is valued at the mock's 1 USD × 88", async () => {
			// The automatic fill after the sync or the explicit fill asks for it (on a fresh price cache).
			expect(
				enabledLog.some(
					(r) =>
						r.path === "/coingecko/api/v3/coins/usd-coin/history" &&
						r.params.date === ddmmyyyy(swapDay),
				),
			).toBe(true);
			expect((await status()).missing).not.toContainEqual({
				asset: "USDC",
				date: swapDay,
			});
			const report = await compute(YEAR);
			const usdc = report.valuations.find((v) => v.txId === usdcSwapId);
			expect(usdc).toMatchObject({ inrRateSource: "market_price_cache" });
			expect(usdc?.marketPrice).toMatchObject({
				source: "coingecko",
				sourceId: "usd-coin",
				quote: "INR",
				date: swapDay,
				price: "88",
			});
			expect(usdc?.valueInr).toBe("4400.00");
		});
		it("CoinGecko is not asked for a date older than 365 days; it stays missing", async () => {
			await clearRequests();
			const s = await fill(OLD_YEAR);
			expect(s.missing).toContainEqual({ asset: "XRP", date: oldDay });
			const cg = (await requests()).filter((r) => r.path.includes("/history"));
			expect(cg.some((r) => r.params.date === ddmmyyyy(oldDay))).toBe(false);
			expect((await status(OLD_YEAR)).missing).toContainEqual({
				asset: "XRP",
				date: oldDay,
			});
		});
		it("status counts the cache", async () => {
			const s = await status();
			expect(s.enabled).toBe(true);
			expect(s.cached).toBe(s.needed - s.missing.length);
			expect(s.missing.some((m) => m.asset === "ETH")).toBe(false);
		});
		it("compute uses market_price_cache with the source and date, and still makes no network calls", async () => {
			await clearRequests();
			const report = await compute(YEAR);
			expect(priceHosts(await requests())).toEqual([]);
			const eth = report.valuations.find((v) => v.txId === ethSwapId);
			expect(eth).toMatchObject({ inrRateSource: "market_price_cache" });
			expect(eth?.marketPrice).toMatchObject({
				sourceId: "ETHUSDT",
				date: swapDay,
				quote: expect.stringMatching(/USD/),
			});
			expect(eth?.marketPrice?.source).toMatch(/binance/i);
			// The mock knows `ripple` but serves it no price series, so XRP stays unpriced.
			expect(
				report.valuations.find((v) => v.txId === xrpRecentId)?.inrRateSource,
			).not.toBe("market_price_cache");
		});
		it("the priced swap no longer carries missing_inr_value", async () => {
			const tx = (await allTx({ source: "evm:1" })).find(
				(t) => t.id === ethSwapId,
			);
			expect(
				tx?.reviewFlags.some(
					(f) =>
						f.code === "missing_inr_value" &&
						/No recorded INR value/.test(f.message),
				),
			).toBe(false);
		});
		it("final rows are not fetched again", async () => {
			await clearRequests();
			const s = await fill();
			expect(s.fetched).toBe(0);
			expect(s.fromCache).toBeGreaterThan(0);
			expect(
				(await requests()).filter(
					(r) =>
						r.path === "/binance-data/api/v3/klines" &&
						r.params.symbol === "ETHUSDT",
				),
			).toEqual([]);
		});
	});

	describe("marketPriceBasis", () => {
		it("changing close → vwap invalidates the stored report", async () => {
			await compute(YEAR);
			ok(
				await call("GET", `/api/reports/${YEAR}`),
				200,
				api.GetReportResponseSchema,
			);
			await setPrices({ marketPriceBasis: "vwap" });
			const err = fail(
				await call("GET", `/api/reports/${YEAR}`),
				404,
				"report_not_computed",
			);
			expect(err?.details).toMatchObject({ cause: "settings_changed" });
		});
		it("vwap needs no new fetch: the close fill already cached the VWAP from the same klines", async () => {
			expect((await status()).missing.some((m) => m.asset === "ETH")).toBe(
				false,
			);
			await clearRequests();
			const s = await fill();
			expect(s.fetched).toBe(0);
			expect(
				(await requests()).some(
					(r) =>
						r.path === "/binance-data/api/v3/klines" &&
						r.params.symbol === "ETHUSDT",
				),
			).toBe(false);
		});
		it("the VWAP row is cached and used: quote volume / base volume of the IST day's kline", async () => {
			const start = Date.parse(`${swapDay}T00:00:00+05:30`);
			const [kline] = (await (
				await fetch(
					`${MOCK_SYNC}/binance-data/api/v3/klines?symbol=ETHUSDT&interval=1d&timeZone=5:30&startTime=${start}&limit=1`,
				)
			).json()) as string[][];
			expect(Number(kline?.[0])).toBe(start);
			const vwap = Number(kline?.[7]) / Number(kline?.[5]);
			expect(vwap).toBeGreaterThan(0);
			const report = await compute(YEAR);
			const eth = report.valuations.find((v) => v.txId === ethSwapId);
			expect(eth).toMatchObject({ inrRateSource: "market_price_cache" });
			expect(eth?.marketPrice).toMatchObject({
				sourceId: "ETHUSDT",
				date: swapDay,
				kind: "vwap",
			});
			expect(Number(eth?.marketPrice?.price)).toBeCloseTo(vwap, 6);
			expect(Number(eth?.marketPrice?.price)).not.toBeCloseTo(
				Number(kline?.[4]),
				2,
			);
		});
		it("saving the same basis again does not invalidate", async () => {
			await compute(YEAR);
			await setPrices({ marketPriceBasis: "vwap" });
			ok(
				await call("GET", `/api/reports/${YEAR}`),
				200,
				api.GetReportResponseSchema,
			);
		});
	});

	describe("disabling again", () => {
		it("fill → 409 and compute still reads the cache only", async () => {
			await setPrices({
				prices: { enabled: false },
				marketPriceBasis: "close",
			});
			fail(
				await call("POST", "/api/prices/fill", { json: { taxYear: YEAR } }),
				409,
				"prices_disabled",
			);
			await clearRequests();
			const report = await compute(YEAR);
			expect(await requests()).toEqual([]);
			expect(
				report.valuations.find((v) => v.txId === ethSwapId)?.inrRateSource,
			).toBe("market_price_cache");
		});
	});
});
