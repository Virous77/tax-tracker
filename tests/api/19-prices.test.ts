import { beforeAll, describe, expect, it } from "vitest";
import { addManual, allTx, compute } from "./lib";
import {
	addEvm,
	allProviders,
	api,
	call,
	clearRequests,
	fail,
	HASH,
	ok,
	requests,
	syncOk,
	WALLET_A,
	waitJob,
	wipeP2,
} from "./p2";

const YEAR = "2025-26";
const status = async () =>
	ok(
		await call("GET", `/api/prices/status?taxYear=${YEAR}`),
		200,
		api.PricesStatusSchema,
	);
const setPrices = async (patch: Record<string, unknown>) =>
	ok(
		await call("PUT", "/api/settings", { json: patch }),
		200,
		api.PutSettingsResponseSchema,
	);
async function fill() {
	const { jobId } = ok(
		await call("POST", "/api/prices/fill", { json: { taxYear: YEAR } }),
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

describe("prices", () => {
	beforeAll(async () => {
		await wipeP2();
		await allProviders();
		await syncOk((await addEvm(WALLET_A, 1)).id);
		base8453 = (await addEvm(WALLET_A, 8453)).id;
		await addManual({
			timestamp: "2025-05-01T06:00:00.000Z",
			type: "swap",
			source: "binance",
			assetOut: "XRP",
			amountOut: "10",
			assetIn: "ETH",
			amountIn: "0.005",
		});
		xrpRecentId = (
			await addManual({
				timestamp: "2026-02-10T06:00:00.000Z",
				type: "swap",
				source: "binance",
				assetOut: "XRP",
				amountOut: "20",
				assetIn: "ETH",
				amountIn: "0.01",
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
			expect(s.needed).toBe(3);
			expect(s.missing).toEqual(
				expect.arrayContaining([
					{ asset: "XRP", date: "2025-05-01" },
					{ asset: "XRP", date: "2026-02-10" },
				]),
			);
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
			await clearRequests();
			const s = await fill();
			expect(s.missing).toContainEqual({ asset: "XRP", date: "2025-05-01" });
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
						r.params.date === "10-02-2026",
				),
			).toBe(true);
			for (const r of cg) expect(r.params.x_cg_demo_api_key).toBeUndefined();
		});
		it("CoinGecko is not asked for a date older than 365 days; it stays missing", async () => {
			const cg = (await requests()).filter((r) => r.path.includes("/history"));
			expect(cg.some((r) => r.params.date === "01-05-2025")).toBe(false);
			expect((await status()).missing).toContainEqual({
				asset: "XRP",
				date: "2025-05-01",
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
				date: "2025-06-10",
				quote: expect.stringMatching(/USD/),
			});
			expect(eth?.marketPrice?.source).toMatch(/binance/i);
			// The CoinGecko cache path cannot be shown: the mock's /history has no INR price (mock issue M2).
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
		it("vwap is a separate cache entry: the kline dates are missing again and fill requests them", async () => {
			const before = await status();
			expect(before.missing.some((m) => m.asset === "ETH")).toBe(true);
			await clearRequests();
			await fill();
			expect(
				(await requests()).some(
					(r) =>
						r.path === "/binance-data/api/v3/klines" &&
						r.params.symbol === "ETHUSDT",
				),
			).toBe(true);
			// Whether a VWAP row is then cached cannot be shown: mock klines have zero base volume (mock issue M3).
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
