import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	allTx,
	api,
	call,
	csv,
	edge,
	fail,
	fixture,
	importOk,
	ok,
	upload,
	wipe,
} from "./lib";

beforeEach(wipe);
afterAll(wipe);

const detail = async (id: string) =>
	ok(await call("GET", `/api/imports/${id}`), 200, api.GetImportResponseSchema);

describe("Binance fixtures", () => {
	it("spot trade history (current layout) imports 8 rows with source auto", async () => {
		const s = await importOk(
			fixture("binance-trade-history.csv"),
			"binance-trade-history.csv",
			{ source: "auto" },
		);
		expect(s).toMatchObject({
			source: "binance",
			status: "imported",
			rowsRead: 8,
			rowsInserted: 8,
			rowsDuplicate: 0,
			rowsError: 0,
			timezone: "UTC",
		});
		expect(s.fileSha256).toMatch(/^[0-9a-f]{64}$/);
		const txs = await allTx({ source: "binance" });
		expect(txs).toHaveLength(8);
		for (const tx of txs) {
			expect(tx.importId).toBe(s.id);
			expect(tx.raw).toBeTypeOf("object");
			expect(
				tx.reviewFlags.filter((f) => f.code === "ambiguous_timezone"),
			).toEqual([]);
		}
		const btcSells = txs.filter((t) => t.assetOut === "BTC");
		expect(btcSells.map((t) => t.timestamp).sort()).toEqual([
			"2026-03-31T18:29:58.000Z",
			"2026-03-31T18:30:02.000Z",
		]);
		const comma = txs.find(
			(t) =>
				t.timestamp === "2025-06-15T03:12:44.000Z" &&
				t.assetIn === "BTC" &&
				t.amountIn === "0.01",
		);
		expect(comma, 'the "1,050.00000000USDT" row').toBeDefined();
		expect(comma).toMatchObject({
			type: "swap",
			assetOut: "USDT",
			amountOut: "1050",
			feeAsset: "BTC",
		});
	});

	it("the two byte-identical 2026-05-10 fills both survive as separate ledger rows", async () => {
		await importOk(
			fixture("binance-trade-history.csv"),
			"binance-trade-history.csv",
			{ source: "binance" },
		);
		const same = (await allTx({ source: "binance" })).filter(
			(t) => t.timestamp === "2026-05-10T09:00:00.000Z",
		);
		expect(same).toHaveLength(2);
		expect(new Set(same.map((t) => t.sourceRef)).size).toBe(2);
	});

	it("older trade history layout with Fee Coin imports fees in a third coin", async () => {
		const s = await importOk(
			fixture("binance-trade-history-fee-coin-layout.csv"),
			"old.csv",
			{ source: "auto" },
		);
		expect(s).toMatchObject({
			source: "binance",
			rowsRead: 2,
			rowsInserted: 2,
			rowsError: 0,
		});
		const txs = await allTx();
		const eth = txs.find((t) => t.assetIn === "ETH");
		expect(eth).toMatchObject({
			amountIn: "0.05",
			assetOut: "USDT",
			amountOut: "180",
			feeAsset: "BNB",
			feeAmount: "0.00015882",
		});
	});

	it("transaction statement imports only income rows and reports the rest as row errors (no drop)", async () => {
		const s = await importOk(
			fixture("binance-transaction-statement.csv"),
			"statement.csv",
			{ source: "auto" },
		);
		expect(s).toMatchObject({ source: "binance", rowsRead: 32 });
		expect(s.rowsInserted + s.rowsError + s.rowsDuplicate).toBe(32);
		const d = await detail(s.id);
		expect(d.rowErrors).toHaveLength(s.rowsError);
		for (const e of d.rowErrors) expect(e.raw).toBeDefined();
		const txs = await allTx();
		expect(txs).toHaveLength(s.rowsInserted);
		const interest = txs.find((t) => t.incomeKind === "interest");
		expect(interest, "scientific-notation interest row").toMatchObject({
			type: "income",
			amountIn: "0.00001234",
		});
		const unknown = JSON.stringify(d.rowErrors) + JSON.stringify(txs);
		expect(
			unknown,
			"unknown operation must be visible, never dropped",
		).toContain("Some Future Operation");
	});

	it("deposits history imports two deposits in UTC without timezone flags", async () => {
		const s = await importOk(fixture("binance-deposits.csv"), "deposits.csv", {
			source: "auto",
			timezone: "UTC",
		});
		expect(s).toMatchObject({ rowsRead: 2, rowsInserted: 2, rowsError: 0 });
		const txs = await allTx();
		expect(txs.every((t) => t.type === "deposit")).toBe(true);
		const usdt = txs.find((t) => t.assetIn === "USDT");
		expect(usdt).toMatchObject({
			amountIn: "1799",
			timestamp: "2025-06-14T14:41:33.000Z",
		});
		expect(usdt?.txHash).toMatch(/^c417d6d3/);
		expect(txs.flatMap((t) => t.reviewFlags).map((f) => f.code)).not.toContain(
			"ambiguous_timezone",
		);
	});

	it("a UTC-headed file imported as IST keeps UTC instants and flags ambiguous_timezone", async () => {
		await importOk(fixture("binance-deposits.csv"), "deposits.csv", {
			source: "binance",
			timezone: "IST",
		});
		const txs = await allTx();
		expect(txs.find((t) => t.assetIn === "USDT")?.timestamp).toBe(
			"2025-06-14T14:41:33.000Z",
		);
		for (const t of txs)
			expect(t.reviewFlags.map((f) => f.code)).toContain("ambiguous_timezone");
	});

	it("2-digit-year deposit date 24-11-03 means 2024", async () => {
		const s = await importOk(
			fixture("binance-deposits-2digit-year.csv"),
			"dep2.csv",
			{ source: "auto" },
		);
		expect(s).toMatchObject({ rowsInserted: 1, rowsError: 0 });
		const [tx] = await allTx();
		expect(tx).toMatchObject({
			type: "deposit",
			assetIn: "ETH",
			amountIn: "0.25",
			timestamp: "2024-11-03T09:15:42.000Z",
		});
	});

	it("withdrawal history imports amount and network fee", async () => {
		const s = await importOk(fixture("binance-withdrawals.csv"), "wd.csv", {
			source: "auto",
		});
		expect(s).toMatchObject({ rowsInserted: 1 });
		const [tx] = await allTx();
		expect(tx).toMatchObject({
			type: "withdrawal",
			assetOut: "BTC",
			amountOut: "0.003",
			feeAsset: "BTC",
			feeAmount: "0.00002",
		});
	});
});

describe("CoinDCX workbook", () => {
	it("imports Instant + Spot sheets, reports unsupported sheets per row", async () => {
		const s = await importOk(
			fixture("coindcx-report.xlsx"),
			"coindcx-report.xlsx",
			{
				source: "auto",
				timezone: "IST",
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			},
		);
		expect(s).toMatchObject({
			source: "coindcx",
			status: "imported",
			rowsRead: 10,
			rowsInserted: 7,
			rowsError: 3,
		});
		expect(s.sheets?.map((x) => [x.name, x.rowsRead])).toEqual([
			["Instant Orders", 2],
			["Spot Orders", 5],
			["Futures Orders (USDT-M)", 1],
			["Crypto Dep&Wdl,Airdrop,Staking", 2],
		]);
		const d = await detail(s.id);
		expect(d.rowErrors.map((e) => e.sheet).sort()).toEqual([
			"Crypto Dep&Wdl,Airdrop,Staking",
			"Crypto Dep&Wdl,Airdrop,Staking",
			"Futures Orders (USDT-M)",
		]);
	});

	it("TDS columns land in tdsInr: 90.74 on the instant sell, none on the instant buy, 72.18 on the USDT-pair buy", async () => {
		await importOk(fixture("coindcx-report.xlsx"), "coindcx-report.xlsx", {
			source: "coindcx",
			timezone: "IST",
		});
		const txs = await allTx({ source: "coindcx" });
		const byRef = Object.fromEntries(txs.map((t) => [t.sourceRef, t]));
		expect(byRef["IO-FIXT-0002"]).toMatchObject({
			type: "sell",
			tdsInr: "90.74",
			assetOut: "USDT",
			amountOut: "100",
		});
		expect(byRef["IO-FIXT-0001"].tdsInr).toBeUndefined();
		expect(byRef["ST-FIXT-0003"]).toMatchObject({
			type: "swap",
			assetIn: "ETH",
			assetOut: "USDT",
			tdsInr: "72.18",
		});
		const tdsTotal =
			txs.reduce((a, t) => a + Number(t.tdsInr ?? 0) * 100, 0) / 100;
		expect(tdsTotal).toBeCloseTo(90.74 + 72.18 + 241.57 + 161.05, 2);
	});

	it("partial fills with one Order ID stay two rows keyed by Trade ID", async () => {
		await importOk(fixture("coindcx-report.xlsx"), "c.xlsx", {
			source: "coindcx",
			timezone: "IST",
		});
		const refs = (await allTx({ source: "coindcx" })).map((t) => t.sourceRef);
		expect(refs).toEqual(
			expect.arrayContaining(["ST-FIXT-0001", "ST-FIXT-0002"]),
		);
	});

	it("IST times convert to UTC: the straddling sells sit either side of 1 April IST", async () => {
		await importOk(fixture("coindcx-report.xlsx"), "c.xlsx", {
			source: "coindcx",
			timezone: "IST",
		});
		const txs = await allTx({ source: "coindcx" });
		const ts = (ref: string) => txs.find((t) => t.sourceRef === ref)?.timestamp;
		expect(ts("IO-FIXT-0001")).toBe("2025-06-10T05:45:22.000Z");
		expect(ts("ST-FIXT-0004")).toBe("2026-03-31T18:28:40.000Z");
		expect(ts("ST-FIXT-0005")).toBe("2026-03-31T18:30:35.000Z");
		expect(
			(await allTx({ taxYear: "2025-26", source: "coindcx" })).map(
				(t) => t.sourceRef,
			),
		).toContain("ST-FIXT-0004");
		expect(
			(await allTx({ taxYear: "2026-27", source: "coindcx" })).map(
				(t) => t.sourceRef,
			),
		).toContain("ST-FIXT-0005");
	});

	it("the same workbook read as UTC shifts every instant by +05:30", async () => {
		await importOk(fixture("coindcx-report.xlsx"), "c.xlsx", {
			source: "coindcx",
			timezone: "UTC",
		});
		const tx = (await allTx({ source: "coindcx" })).find(
			(t) => t.sourceRef === "IO-FIXT-0001",
		);
		expect(tx?.timestamp).toBe("2025-06-10T11:15:22.000Z");
	});
});

describe("source selection", () => {
	it("explicit correct source behaves like auto", async () => {
		const s = await importOk(fixture("binance-withdrawals.csv"), "wd.csv", {
			source: "binance",
		});
		expect(s).toMatchObject({ source: "binance", rowsInserted: 1 });
	});

	it("explicit generic on a known layout asks for a recipe", async () => {
		const s = await importOk(fixture("binance-withdrawals.csv"), "wd.csv", {
			source: "generic",
		});
		expect(s).toMatchObject({ status: "pending_recipe", rowsInserted: 0 });
		expect(s.sheets?.[0].headers).toContain("TXID");
		expect((await allTx()).length).toBe(0);
	});

	it("wrong explicit source returns 422 naming the expected headers", async () => {
		for (const [file, source, header] of [
			["binance-withdrawals.csv", "coindcx", "Side (Buy/Sell)"],
			["coindcx-report.xlsx", "binance", "Date(UTC)"],
		]) {
			const error = fail(
				await upload(fixture(file), file, { source }),
				422,
				"unprocessable_file",
			);
			expect(error?.message).toContain(header);
		}
		expect((await allTx()).length).toBe(0);
	});

	it("unknown layout with source auto asks for a recipe with headers and ≤20 sample rows", async () => {
		const s = await importOk(fixture("generic-unknown-exchange.csv"), "g.csv", {
			source: "auto",
			timezone: "IST",
		});
		expect(s).toMatchObject({
			source: "generic",
			status: "pending_recipe",
			rowsRead: 6,
			rowsInserted: 0,
		});
		expect(s.sheets?.[0].sampleRows.length).toBe(6);
	});

	it.each([
		["unknown source", { source: "kraken", timezone: "UTC" }],
		["bad timezone", { source: "auto", timezone: "PST" }],
	])("rejects %s with 400", async (_n, fields) => {
		fail(
			await upload(fixture("binance-withdrawals.csv"), "wd.csv", fields),
			400,
			"validation_error",
		);
	});

	it("missing timezone is 400", async () => {
		const form = new FormData();
		form.set("file", new Blob([fixture("binance-withdrawals.csv")]), "wd.csv");
		fail(
			await call("POST", "/api/imports", { body: form }),
			400,
			"validation_error",
		);
	});

	it("missing file is 400", async () => {
		const form = new FormData();
		form.set("source", "auto");
		form.set("timezone", "UTC");
		fail(
			await call("POST", "/api/imports", { body: form }),
			400,
			"validation_error",
		);
	});

	it("a JSON body instead of multipart is 400", async () => {
		fail(
			await call("POST", "/api/imports", { json: { file: "x" } }),
			400,
			"validation_error",
		);
	});

	it("a .txt file name is rejected with 422", async () => {
		fail(await upload(fixture("binance-withdrawals.csv"), "wd.txt"), 422);
	});

	it("an image MIME type is rejected with 422", async () => {
		fail(
			await upload(fixture("binance-withdrawals.csv"), "wd.csv", {
				type: "image/png",
			}),
			422,
		);
	});
});

describe("idempotency and dedupe", () => {
	it("importing the same file twice inserts nothing the second time", async () => {
		const a = await importOk(fixture("binance-trade-history.csv"), "t.csv", {
			source: "binance",
		});
		const b = await importOk(fixture("binance-trade-history.csv"), "t.csv", {
			source: "binance",
		});
		expect(a.rowsInserted).toBe(8);
		expect(b).toMatchObject({ rowsRead: 8, rowsInserted: 0, rowsDuplicate: 8 });
		expect((await allTx()).length).toBe(8);
	});

	it("CoinDCX workbook twice inserts nothing the second time", async () => {
		await importOk(fixture("coindcx-report.xlsx"), "c.xlsx", {
			source: "coindcx",
			timezone: "IST",
		});
		const b = await importOk(fixture("coindcx-report.xlsx"), "c.xlsx", {
			source: "coindcx",
			timezone: "IST",
		});
		expect(b).toMatchObject({ rowsInserted: 0, rowsDuplicate: 7 });
		expect((await allTx()).length).toBe(7);
	});

	const header = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
	const fill =
		"2026-07-01 10:00:00,ETHUSDT,BUY,3000.00,0.0100000000ETH,30.00000000USDT,0.0000100000ETH";

	it("a crafted file with two identical legitimate fills inserts two rows", async () => {
		const s = await importOk(csv([header, fill, fill]), "identical.csv", {
			source: "binance",
		});
		expect(s).toMatchObject({ rowsRead: 2, rowsInserted: 2, rowsDuplicate: 0 });
		expect((await allTx()).length).toBe(2);
	});

	it("re-importing the identical-fill file stays at two rows", async () => {
		await importOk(csv([header, fill, fill]), "identical.csv", {
			source: "binance",
		});
		const again = await importOk(csv([header, fill, fill]), "identical.csv", {
			source: "binance",
		});
		expect(again).toMatchObject({ rowsInserted: 0, rowsDuplicate: 2 });
	});

	it("a later export with a third identical fill adds exactly one row", async () => {
		await importOk(csv([header, fill, fill]), "a.csv", { source: "binance" });
		const later = await importOk(csv([header, fill, fill, fill]), "b.csv", {
			source: "binance",
		});
		expect(later).toMatchObject({ rowsInserted: 1, rowsDuplicate: 2 });
		expect((await allTx()).length).toBe(3);
	});
});

describe("list, detail and delete", () => {
	it("GET /api/imports lists every import, newest first", async () => {
		const a = await importOk(fixture("binance-withdrawals.csv"), "a.csv");
		const b = await importOk(fixture("binance-deposits.csv"), "b.csv");
		const list = ok(
			await call("GET", "/api/imports"),
			200,
			api.ListImportsResponseSchema,
		);
		expect(list.map((i) => i.id)).toEqual([b.id, a.id]);
	});

	it("GET /api/imports/:id returns summary + rowErrors", async () => {
		const s = await importOk(fixture("binance-withdrawals.csv"), "a.csv");
		const d = await detail(s.id);
		expect(d).toMatchObject({ id: s.id, rowsInserted: 1, rowErrors: [] });
	});

	it("unknown import id: GET, DELETE, confirm → 404", async () => {
		const id = "00000000-0000-4000-8000-00000000dead";
		fail(await call("GET", `/api/imports/${id}`), 404, "not_found");
		fail(await call("DELETE", `/api/imports/${id}`), 404, "not_found");
		fail(
			await call("POST", `/api/imports/${id}/confirm`, {
				json: {
					recipe: {
						id: "r",
						name: "r",
						version: 1,
						fingerprint: "f",
						columns: { timestamp: "a", amount: "b" },
						dateFormat: "yyyy",
						signStyle: "side_column",
					},
					saveRecipe: false,
				},
			}),
			404,
		);
	});

	it("DELETE removes the import, its transactions and its raw rows", async () => {
		const keep = await importOk(fixture("binance-deposits.csv"), "keep.csv");
		const s = await importOk(fixture("binance-trade-history.csv"), "t.csv");
		expect((await allTx()).length).toBe(10);
		const del = await call("DELETE", `/api/imports/${s.id}`);
		expect(del.status).toBe(204);
		expect(del.text).toBe("");
		fail(await call("GET", `/api/imports/${s.id}`), 404);
		const left = await allTx();
		expect(left.length).toBe(2);
		expect(left.every((t) => t.importId === keep.id)).toBe(true);
		const again = await importOk(fixture("binance-trade-history.csv"), "t.csv");
		expect(
			again.rowsInserted,
			"deleted rows must not linger as duplicates",
		).toBe(8);
	});

	it("DELETE twice → second is 404", async () => {
		const s = await importOk(fixture("binance-withdrawals.csv"), "a.csv");
		expect((await call("DELETE", `/api/imports/${s.id}`)).status).toBe(204);
		fail(await call("DELETE", `/api/imports/${s.id}`), 404);
	});
});

describe("size and garbage", () => {
	it("a file over 25 MB is 413 file_too_large", async () => {
		fail(
			await upload(edge("huge.csv"), "huge.csv", { source: "binance" }),
			413,
			"file_too_large",
		);
		expect(
			ok(await call("GET", "/api/imports"), 200, api.ListImportsResponseSchema),
		).toEqual([]);
	});

	it("binary noise is 422 and creates no import", async () => {
		fail(
			await upload(edge("not-a-csv.csv"), "not-a-csv.csv"),
			422,
			"unprocessable_file",
		);
		expect(
			ok(await call("GET", "/api/imports"), 200, api.ListImportsResponseSchema),
		).toEqual([]);
	});
});
