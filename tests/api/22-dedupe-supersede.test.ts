import { beforeAll, describe, expect, it } from "vitest";
import { BINANCE_TRADES } from "../../tools/mock-sync/fixtures.mjs";
import { allTx, compute, csv } from "./lib";
import {
	addBinance,
	api,
	call,
	ok,
	SYNC_TIMEOUT,
	syncOk,
	uploadP2,
	wipeP2,
} from "./p2";

const ORDER_HEADER =
	"Time,OrderNo,Pair,Type¹,Side,Order Price,Order Amount,Time,Executed²,Average Price,Trading total³,Status";
const FILL_HEADER = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
const orders = (qty = "1") =>
	csv([
		ORDER_HEADER,
		`2026-04-01 10:00:00,order-sup-1,BTCUSDT,Limit,BUY,100,${qty}BTC,2026-04-01 10:01:00,${qty}BTC,100,100USDT,FILLED`,
	]);
const fills = (second = "0.6") =>
	csv([
		FILL_HEADER,
		"2026-04-01 04:30:10,BTCUSDT,BUY,100,0.4BTC,40USDT,0.01BNB",
		`2026-04-01 04:30:50,BTCUSDT,BUY,100,${second}BTC,${Number(second) * 100}USDT,0.02BNB`,
	]);
const importCsv = async (text: string, name: string) =>
	ok(
		await uploadP2(text, name, { source: "binance" }),
		201,
		api.CreateImportResponseSchema,
	);
const del = async (id: string) =>
	expect((await call("DELETE", `/api/imports/${id}`)).status).toBe(204);
async function tx(query: Record<string, string> = {}) {
	return allTx(query);
}

describe("Order History superseded by Trade History", () => {
	let orderImport = "";
	let fillImport = "";
	let orderTx = "";
	beforeAll(async () => {
		await wipeP2();
		orderImport = (await importCsv(orders(), "orders(UTC+5:30).csv")).id;
		orderTx = (await tx()).find((t) => t.importId === orderImport)?.id ?? "";
		const fill = await importCsv(fills(), "trades.csv");
		fillImport = fill.id;
	});

	it("the fills are inserted; the order row is kept but superseded by the fill import", async () => {
		const all = await tx();
		expect(all.filter((t) => t.importId === fillImport)).toHaveLength(2);
		const order = all.find((t) => t.id === orderTx);
		expect(order?.supersededBy).toBe(fillImport);
		for (const t of all.filter((t) => t.importId === fillImport))
			expect(t.supersededBy).toBeNull();
	});
	it("?superseded=true lists only the order; ?superseded=false hides it", async () => {
		expect((await tx({ superseded: "true" })).map((t) => t.id)).toEqual([
			orderTx,
		]);
		expect((await tx({ superseded: "false" })).map((t) => t.id)).not.toContain(
			orderTx,
		);
		expect(await tx({ superseded: "false" })).toHaveLength(2);
	});
	it("the order's raw original is still stored", async () => {
		expect((await tx()).find((t) => t.id === orderTx)?.raw).toBeTruthy();
	});
	it("the report excludes it with reason superseded and counts the fills once", async () => {
		const r = await compute("2026-27");
		expect(r.excluded).toContainEqual({ txId: orderTx, reason: "superseded" });
		expect(r.balances.find((b) => b.asset === "BTC")?.computed).toBe("1");
	});
	it("re-importing the order file does not un-supersede or duplicate", async () => {
		const again = await importCsv(orders(), "orders(UTC+5:30).csv");
		expect(again.rowsInserted).toBe(0);
		expect((await tx({ superseded: "true" })).map((t) => t.id)).toEqual([
			orderTx,
		]);
	});
	it("deleting the Trade History import restores the order", async () => {
		await del(fillImport);
		const order = (await tx()).find((t) => t.id === orderTx);
		expect(order?.supersededBy).toBeNull();
		expect(await tx({ superseded: "true" })).toEqual([]);
		const r = await compute("2026-27");
		expect(r.excluded.some((e) => e.txId === orderTx)).toBe(false);
		expect(r.balances.find((b) => b.asset === "BTC")?.computed).toBe("1");
	});
	it("trades first, then the order: the incoming order is the supplementary row (not double counted)", async () => {
		await del(orderImport);
		const all = await tx();
		for (const t of all) await call("DELETE", `/api/transactions/${t.id}`);
		const f = await importCsv(fills(), "trades.csv");
		const o = await importCsv(orders(), "orders(UTC+5:30).csv");
		const r = await compute("2026-27");
		expect(r.balances.find((b) => b.asset === "BTC")?.computed).toBe("1");
		expect(o.rowsInserted + o.rowsDuplicate).toBe(1);
		await del(o.id);
		await del(f.id);
	});
});

describe("ambiguous order vs fills", () => {
	beforeAll(wipeP2);
	it("fills summing to less than the order are inserted with possible_duplicate and nothing is superseded", async () => {
		const o = await importCsv(orders("1"), "orders(UTC+5:30).csv");
		const f = await importCsv(fills("0.5"), "trades.csv");
		const all = await tx();
		const orderRow = all.find((t) => t.importId === o.id);
		expect(orderRow?.supersededBy).toBeNull();
		const fillRows = all.filter((t) => t.importId === f.id);
		expect(fillRows).toHaveLength(2);
		const flagged = fillRows.filter((t) =>
			t.reviewFlags.some((x) => x.code === "possible_duplicate"),
		);
		expect(flagged.length).toBeGreaterThan(0);
		expect(
			flagged[0]?.reviewFlags.find((x) => x.code === "possible_duplicate")
				?.message,
		).toContain(orderRow?.id ?? "??");
	});
});

type Trade = (typeof BINANCE_TRADES)[number];
function tradeLine(t: Trade, shiftSeconds = 0) {
	const r = t.raw;
	const time = new Date(Number(r.time) + shiftSeconds * 1000)
		.toISOString()
		.replace("T", " ")
		.slice(0, 19);
	return `${time},${r.symbol},${r.isBuyer ? "BUY" : "SELL"},${r.price},${r.qty}${t.base},${r.quoteQty}${t.quote},${r.commission}${r.commissionAsset}`;
}
const tradeFile = (shiftFirst = 0) =>
	csv([
		FILL_HEADER,
		...BINANCE_TRADES.map((t, i) => tradeLine(t, i === 0 ? shiftFirst : 0)),
	]);

describe("file ↔ API fingerprint dedupe (Binance trades built from the mock's fixture)", () => {
	let bin = "";
	beforeAll(async () => {
		await wipeP2();
		bin = (await addBinance()).id;
	});

	describe("file first, then sync", () => {
		let summary: api.SyncSummary;
		beforeAll(async () => {
			const f = await importCsv(tradeFile(1), "Trade History.csv");
			expect(f.rowsInserted).toBe(5);
			summary = await syncOk(bin);
		}, SYNC_TIMEOUT);

		it("exact fingerprints are absorbed: 4 duplicates, no new ledger rows for them", () => {
			expect(
				summary.streams.find((s) => s.stream === "binance:myTrades:ETHUSDT"),
			).toMatchObject({ rowsFetched: 5, rowsDuplicate: 4, rowsInserted: 1 });
		});
		it("the near match (1 s apart) is inserted and flagged possible_duplicate naming the file row", async () => {
			const api1001 = (await tx({ source: "binance-api" })).find(
				(t) => t.sourceRef === "trade:ETHUSDT:1001",
			);
			expect(api1001).toBeDefined();
			const flag = api1001?.reviewFlags.find(
				(f) => f.code === "possible_duplicate",
			);
			expect(flag).toBeDefined();
			const fileIds = (await tx({ source: "binance" })).map((t) => t.id);
			expect(fileIds.some((id) => flag?.message.includes(id))).toBe(true);
		});
		it("only one ledger row per fill otherwise", async () => {
			const trades = (await tx()).filter(
				(t) =>
					t.type === "swap" &&
					(t.assetIn === "ETH" || t.assetOut === "ETH") &&
					(t.assetIn === "USDT" || t.assetOut === "USDT"),
			);
			expect(trades).toHaveLength(6);
		});
		it(
			"a second sync inserts nothing more",
			async () => {
				const s = await syncOk(bin);
				expect(s.streams.reduce((n, x) => n + x.rowsInserted, 0)).toBe(0);
			},
			SYNC_TIMEOUT,
		);
	});

	describe("API first, then file", () => {
		beforeAll(async () => {
			for (const i of ok(
				await call("GET", "/api/imports"),
				200,
				api.ListImportsResponseSchema,
			))
				await del(i.id);
			expect(await tx()).toEqual([]);
			const s = await syncOk(bin);
			expect(
				s.streams.find((x) => x.stream === "binance:myTrades:ETHUSDT")
					?.rowsInserted,
			).toBe(5);
		}, SYNC_TIMEOUT);

		it("deleting every import (sync included) reset the cursors: the sync re-inserted all trades", async () => {
			expect(
				(await tx({ source: "binance-api" })).filter((t) =>
					t.sourceRef.startsWith("trade:"),
				),
			).toHaveLength(5);
		});
		it("importing the exact Trade History file afterwards adds nothing: 5 duplicates", async () => {
			const f = await importCsv(tradeFile(0), "Trade History.csv");
			expect(f).toMatchObject({ rowsInserted: 0, rowsDuplicate: 5 });
			expect(await tx({ source: "binance" })).toEqual([]);
		});
		it("the file's raw rows are kept (linked to the API rows) and the import is accounted", async () => {
			const imports = ok(
				await call("GET", "/api/imports"),
				200,
				api.ListImportsResponseSchema,
			);
			const file = imports.find((i) => i.kind === "file");
			expect(file?.rowsRead).toBe(5);
		});
		it("the ledger holds each fill exactly once", async () => {
			const trades = (await tx()).filter((t) =>
				t.sourceRef.startsWith("trade:ETHUSDT:"),
			);
			expect(trades).toHaveLength(5);
		});
	});
});
