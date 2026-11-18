import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	allTx,
	api,
	call,
	compute,
	edge,
	fail,
	fingerprintOf,
	fixture,
	importOk,
	injectionRecipe,
	ok,
	upload,
	useMockAi,
	wipe,
} from "./lib";

beforeAll(async () => {
	await wipe();
	await useMockAi();
});
beforeEach(async () => {
	await wipe();
	await useMockAi();
});
afterAll(wipe);

describe("tests/data edge-case pack (tests/data/README.md)", () => {
	it("binance-large.csv: 5000 rows inserted, spanning 2025-26 and 2026-27", async () => {
		const s = await importOk(edge("binance-large.csv"), "binance-large.csv", {
			source: "binance",
			timezone: "UTC",
		});
		expect(s).toMatchObject({
			status: "imported",
			rowsRead: 5000,
			rowsInserted: 5000,
			rowsDuplicate: 0,
			rowsError: 0,
		});
		const a = ok(
			await call("GET", "/api/transactions?taxYear=2025-26&pageSize=1"),
			200,
			api.ListTransactionsResponseSchema,
		);
		const b = ok(
			await call("GET", "/api/transactions?taxYear=2026-27&pageSize=1"),
			200,
			api.ListTransactionsResponseSchema,
		);
		expect(a.total).toBeGreaterThan(0);
		expect(b.total).toBeGreaterThan(0);
		expect(a.total + b.total).toBe(5000);
	});

	it("duplicates.csv imported alone inserts 8", async () => {
		const s = await importOk(edge("duplicates.csv"), "duplicates.csv", {
			source: "binance",
			timezone: "UTC",
		});
		expect(s).toMatchObject({
			rowsRead: 8,
			rowsInserted: 8,
			rowsDuplicate: 0,
			rowsError: 0,
		});
	});

	it("duplicates.csv after the fixture inserts 4 and skips 4; again → 0 / 8", async () => {
		await importOk(
			fixture("binance-trade-history.csv"),
			"binance-trade-history.csv",
			{ source: "binance", timezone: "UTC" },
		);
		const s = await importOk(edge("duplicates.csv"), "duplicates.csv", {
			source: "binance",
			timezone: "UTC",
		});
		expect(s).toMatchObject({
			status: "imported",
			rowsRead: 8,
			rowsInserted: 4,
			rowsDuplicate: 4,
			rowsError: 0,
		});
		const again = await importOk(edge("duplicates.csv"), "duplicates.csv", {
			source: "binance",
			timezone: "UTC",
		});
		expect(again).toMatchObject({ rowsInserted: 0, rowsDuplicate: 8 });
		expect((await allTx()).length).toBe(12);
	});

	it("malformed.csv: 15 read, 4 inserted, 11 row errors with raw rows, no duplicate parse_warning", async () => {
		const s = await importOk(edge("malformed.csv"), "malformed.csv", {
			source: "binance",
			timezone: "UTC",
		});
		expect(s).toMatchObject({
			status: "imported",
			rowsRead: 15,
			rowsInserted: 4,
			rowsDuplicate: 0,
			rowsError: 11,
		});
		// Lead decision on P2-API-7: invalid rows are reported once (row errors → import_incomplete),
		// so the import no longer adds a parse_warning that repeats them.
		expect(s.warnings.filter((w) => w.code === "parse_warning")).toHaveLength(
			0,
		);
		const d = ok(
			await call("GET", `/api/imports/${s.id}`),
			200,
			api.GetImportResponseSchema,
		);
		expect(d.rowErrors).toHaveLength(11);
		for (const e of d.rowErrors)
			expect(e.raw, `row ${e.rowIndex} lost its raw row`).toBeDefined();
		const txs = await allTx();
		expect(txs).toHaveLength(4);
		expect(txs.every((t) => t.assetIn === "BTC")).toBe(true);
	});

	it.each([
		["empty.csv", "File contains no data rows."],
		["zero-bytes.csv", "File contains no data rows."],
		["not-a-csv.csv", "File is not a supported, safe CSV or XLSX workbook."],
	])("%s → 422 unprocessable_file, no import record", async (file, message) => {
		const err = fail(
			await upload(edge(file), file, { source: "auto", timezone: "UTC" }),
			422,
			"unprocessable_file",
		);
		expect(err?.message).toBe(message);
		expect(
			ok(await call("GET", "/api/imports"), 200, api.ListImportsResponseSchema),
		).toEqual([]);
	});

	it("fake.xlsx (CSV renamed) → 422 unprocessable_file, no partial import", async () => {
		fail(
			await upload(edge("fake.xlsx"), "fake.xlsx", {
				source: "auto",
				timezone: "UTC",
			}),
			422,
			"unprocessable_file",
		);
		expect(
			ok(await call("GET", "/api/imports"), 200, api.ListImportsResponseSchema),
		).toEqual([]);
		expect((await allTx()).length).toBe(0);
	});

	it("huge.csv → 413 file_too_large 'File exceeds 25 MB.'", async () => {
		const err = fail(
			await upload(edge("huge.csv"), "huge.csv", { source: "binance" }),
			413,
			"file_too_large",
		);
		expect(err?.message).toBe("File exceeds 25 MB.");
	});

	it("sell-without-buy.csv: 1 row; after compute review has unresolved history and negative holdings, and totals exclude it", async () => {
		const s = await importOk(
			edge("sell-without-buy.csv"),
			"sell-without-buy.csv",
			{ source: "binance", timezone: "UTC" },
		);
		expect(s).toMatchObject({ rowsRead: 1, rowsInserted: 1, rowsError: 0 });
		const r = await compute("2026-27");
		const ethRows = r.scheduleVdaRows.filter((x) => x.asset === "ETH");
		expect(ethRows.length).toBeGreaterThan(0);
		for (const row of ethRows)
			expect(row.costOfAcquisition, "never zero cost").toBeNull();
		expect(r.unresolved.map((u) => [u.asset, u.reason])).toContainEqual([
			"ETH",
			"missing_history",
		]);
		expect(r.totals.cost).toBe("0.00");
		const review = ok(
			await call("GET", "/api/review?taxYear=2026-27"),
			200,
			api.ReviewResponseSchema,
		);
		expect(
			review.groups.find((g) => g.code === "missing_history"),
		).toMatchObject({
			count: 2,
			items: [],
			reportItems: expect.arrayContaining([
				expect.objectContaining({ kind: "balance" }),
				expect.objectContaining({ kind: "unresolved" }),
			]),
		});
	});

	it("year-boundary.csv (UTC): 18:29:59Z in 2025-26, 18:30:00Z in 2026-27, no timezone flags", async () => {
		const s = await importOk(edge("year-boundary.csv"), "year-boundary.csv", {
			source: "binance",
			timezone: "UTC",
		});
		expect(s).toMatchObject({ rowsRead: 3, rowsInserted: 3, rowsError: 0 });
		const old = (await allTx({ taxYear: "2025-26" }))
			.map((t) => t.timestamp)
			.sort();
		const next = (await allTx({ taxYear: "2026-27" })).map((t) => t.timestamp);
		expect(old).toEqual([
			"2026-03-31T17:00:00.000Z",
			"2026-03-31T18:29:59.000Z",
		]);
		expect(next).toEqual(["2026-03-31T18:30:00.000Z"]);
		expect(
			(await allTx()).flatMap((t) => t.reviewFlags).map((f) => f.code),
		).not.toContain("ambiguous_timezone");
		const a = await compute("2025-26");
		const b = await compute("2026-27");
		expect(a.scheduleVdaRows.filter((r) => r.asset === "BTC")).toHaveLength(1);
		expect(b.scheduleVdaRows.filter((r) => r.asset === "BTC")).toHaveLength(1);
	});

	it("year-boundary.csv as IST: instants unchanged and the conflicting selection is warned", async () => {
		const s = await importOk(edge("year-boundary.csv"), "year-boundary.csv", {
			source: "binance",
			timezone: "IST",
		});
		const txs = await allTx();
		expect(txs.map((t) => t.timestamp).sort()).toEqual([
			"2026-03-31T17:00:00.000Z",
			"2026-03-31T18:29:59.000Z",
			"2026-03-31T18:30:00.000Z",
		]);
		// Phase 2 §9: the explicit UTC header wins and the IST selection is reported as a conflict.
		expect(s.timezoneSource).toBe("file");
		expect(
			s.warnings.some((w) => /UTC/.test(w.message) && /IST/.test(w.message)),
		).toBe(true);
	});

	it("tiny-amounts.csv keeps 1e-8 quantities and 0.00088 proceeds exactly", async () => {
		const s = await importOk(edge("tiny-amounts.csv"), "tiny-amounts.csv", {
			source: "binance",
			timezone: "UTC",
		});
		expect(s).toMatchObject({ rowsRead: 4, rowsInserted: 4, rowsError: 0 });
		const txs = await allTx();
		const btcBuy = txs.find((t) => t.assetIn === "BTC");
		expect(btcBuy).toMatchObject({
			amountIn: "0.00000001",
			amountOut: "0.00088",
		});
		const btcSell = txs.find((t) => t.assetOut === "BTC");
		expect(btcSell).toMatchObject({
			amountOut: "0.00000001",
			amountIn: "0.000882",
		});
		for (const t of txs) {
			if (t.amountIn) expect(Number(t.amountIn)).toBeGreaterThan(0);
			if (t.amountOut) expect(Number(t.amountOut)).toBeGreaterThan(0);
		}
	});

	it("csv-injection.csv: pending_recipe with cells returned verbatim; confirmed → sourceRefs kept literally", async () => {
		const s = await importOk(edge("csv-injection.csv"), "csv-injection.csv", {
			source: "auto",
			timezone: "IST",
		});
		expect(s.status).toBe("pending_recipe");
		const refs = s.sheets?.[0].sampleRows.map((r) => r.Reference);
		expect(refs).toEqual(["=1+1", "+2+3", "=cmd|calc!A0", "+cmd"]);
		expect(s.sheets?.[0].sampleRows[0].Note).toBe("@SUM(A1:A2)");
		const recipe = injectionRecipe(await fingerprintOf(s.id));
		const c = ok(
			await call("POST", `/api/imports/${s.id}/confirm`, {
				json: { recipe, saveRecipe: false },
			}),
			200,
			api.ConfirmImportResponseSchema,
		);
		expect(c).toMatchObject({ rowsInserted: 4, rowsError: 0 });
		expect((await allTx()).map((t) => t.sourceRef).sort()).toEqual(
			["+2+3", "+cmd", "=1+1", "=cmd|calc!A0"].sort(),
		);
	});
});
