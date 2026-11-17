import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	addManual,
	api,
	call,
	compute,
	csv,
	edge,
	fail,
	fixture,
	importOk,
	ok,
	wipe,
} from "./lib";

const review = async (q = "") =>
	ok(await call("GET", `/api/review${q}`), 200, api.ReviewResponseSchema);
const group = (r: Awaited<ReturnType<typeof review>>, code: string) =>
	r.groups.find((g) => g.code === code);

beforeAll(async () => {
	await wipe();
	await importOk(edge("sell-without-buy.csv"), "swb.csv", {
		source: "binance",
		timezone: "UTC",
	});
	await importOk(fixture("binance-withdrawals.csv"), "wd.csv", {
		source: "binance",
		timezone: "IST",
	});
	// Phase 2: explicit UTC headers win over the selection, so ambiguity now comes from a bare
	// Binance order Time with no offset in the file name.
	await importOk(
		csv([
			"Time,OrderNo,Pair,Type¹,Side,Order Price,Order Amount,Time,Executed²,Average Price,Trading total³,Status",
			"2025-08-02 10:00:00,amb-1,BTCUSDT,Limit,BUY,100,1BTC,2025-08-02 10:01:00,1BTC,100,100USDT,FILLED",
		]),
		"orders.csv",
		{ source: "binance", timezone: "IST" },
	);
	await importOk(
		csv([
			"Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
			"2026-06-10 10:00:00,ETHINR,BUY,200000,1ETH,200000INR,0INR",
			"2026-06-20 10:00:00,ETHINR,SELL,300000,1ETH,300000INR,0INR",
		]),
		"binance-inr.csv",
		{ source: "binance", timezone: "UTC" },
	);
	await compute("2025-26");
	await compute("2026-27");
});
afterAll(wipe);

describe("GET /api/review", () => {
	it("every group's count equals its items and every item carries that code", async () => {
		const r = await review();
		expect(r.groups.length).toBeGreaterThan(0);
		for (const g of r.groups) {
			expect(g.count, g.code).toBe(g.items.length + g.reportItems.length);
			for (const tx of g.items)
				expect(
					tx.reviewFlags.map((f) => f.code),
					g.code,
				).toContain(g.code);
		}
		expect(new Set(r.groups.map((g) => g.code)).size).toBe(r.groups.length);
	});

	it("missing_history: the ETH sell with no buy (2026-27)", async () => {
		const g = group(await review("?taxYear=2026-27"), "missing_history");
		expect(g?.items).toEqual([]);
		expect(
			g?.reportItems.find((item) => item.kind === "unresolved"),
		).toMatchObject({
			kind: "unresolved",
			taxYear: "2026-27",
			unresolved: { asset: "ETH", quantity: "0.01", reason: "missing_history" },
		});
	});

	it("tds_not_deducted: Binance sell after compute", async () => {
		const g = group(await review("?taxYear=2026-27"), "tds_not_deducted");
		expect(
			g?.items.some((t) => t.source === "binance" && t.assetOut === "ETH"),
		).toBe(true);
		expect(g?.items.every((t) => t.source !== "coindcx")).toBe(true);
	});

	it("unmatched_transfer: withdrawal with no matching deposit", async () => {
		const g = group(await review("?taxYear=2025-26"), "unmatched_transfer");
		expect(g?.items.map((t) => t.type)).toContain("withdrawal");
	});

	it("ambiguous_timezone: Binance orders with a bare Time and no file-name offset", async () => {
		const g = group(await review(), "ambiguous_timezone");
		expect(g?.items.map((t) => t.type)).toEqual(["swap"]);
	});

	it("taxYear filter narrows to that IST year", async () => {
		const r = await review("?taxYear=2025-26");
		for (const g of r.groups)
			for (const t of g.items)
				expect(
					t.timestamp >= "2025-03-31T18:30:00.000Z" &&
						t.timestamp < "2026-03-31T18:30:00.000Z",
				).toBe(true);
	});

	it("resolving a flag removes the row from that group", async () => {
		const before = group(await review(), "ambiguous_timezone");
		const id = before?.items[0].id;
		ok(
			await call("PATCH", `/api/transactions/${id}`, {
				json: { resolveFlags: ["ambiguous_timezone"] },
			}),
			200,
			api.PatchTransactionResponseSchema,
		);
		const after = group(await review(), "ambiguous_timezone");
		expect(after?.items.map((t) => t.id) ?? []).not.toContain(id);
	});

	it("a manual buy that covers the history clears missing_history after recompute", async () => {
		await addManual({
			timestamp: "2026-04-10T00:00:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "0.01",
			inrValue: "3000",
		});
		await compute("2026-27");
		const remaining = group(
			await review("?taxYear=2026-27"),
			"missing_history",
		);
		expect(remaining?.items ?? []).toEqual([]);
		expect(
			remaining?.reportItems.some(
				(item) =>
					item.kind === "unresolved" ||
					(item.kind === "balance" && item.balance.asset === "ETH"),
			),
		).toBe(false);
	});

	it("parse_warning: CoinDCX fee/GST notes show up once imported", async () => {
		await importOk(fixture("coindcx-report.xlsx"), "c.xlsx", {
			source: "coindcx",
			timezone: "IST",
		});
		const g = group(await review(), "parse_warning");
		expect(g?.items.some((t) => t.source === "coindcx")).toBe(true);
	});

	it("bad taxYear → 400", async () => {
		fail(
			await call("GET", "/api/review?taxYear=nope"),
			400,
			"validation_error",
		);
	});
});

describe("report review status and balance items", () => {
	it("tracks invalidation through ledger, settings and actual balance changes", async () => {
		await wipe();
		expect((await review("?taxYear=2026-27")).reportStatus).toBe("missing");
		await compute("2026-27");
		expect((await review("?taxYear=2026-27")).reportStatus).toBe("current");
		const tx = await addManual({
			timestamp: "2026-05-01T00:00:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "1",
			inrValue: "100",
		});
		expect((await review("?taxYear=2026-27")).reportStatus).toBe("missing");
		await compute("2026-27");
		ok(
			await call("PUT", "/api/settings", { json: { feeTreatment: "include" } }),
			200,
			api.SettingsResponseSchema,
		);
		expect((await review("?taxYear=2026-27")).reportStatus).toBe("missing");
		await compute("2026-27");
		ok(
			await call("PUT", "/api/balances/actual?taxYear=2026-27", {
				json: [
					{ asset: "ETH", amount: "0.5" },
					{ asset: "BTC", amount: "2" },
				],
			}),
			200,
			api.PutActualBalancesResponseSchema,
		);
		expect((await review("?taxYear=2026-27")).reportStatus).toBe("missing");
		await compute("2026-27");
		const r = await review("?taxYear=2026-27");
		expect(r.reportStatus).toBe("current");
		const g = group(r, "balance_mismatch");
		expect(g?.count).toBe(2);
		expect(g?.reportItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "balance",
					balance: {
						asset: "ETH",
						computed: "1",
						actual: "0.5",
						difference: "-0.5",
						txIds: [tx.id],
					},
				}),
				expect.objectContaining({
					kind: "balance",
					balance: {
						asset: "BTC",
						computed: "0",
						actual: "2",
						difference: "2",
						txIds: [],
					},
				}),
			]),
		);
	});
});
