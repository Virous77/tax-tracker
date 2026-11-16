import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	addManual,
	allTx,
	api,
	call,
	fail,
	fixture,
	importOk,
	listTx,
	manual,
	ok,
	runId,
	wipe,
} from "./lib";

const FY25_START = "2025-03-31T18:30:00.000Z";
const FY26_START = "2026-03-31T18:30:00.000Z";
let coindcxImport = "";

beforeAll(async () => {
	await wipe();
	await importOk(fixture("binance-trade-history.csv"), "bth.csv", {
		source: "binance",
		timezone: "UTC",
	});
	coindcxImport = (
		await importOk(fixture("coindcx-report.xlsx"), "c.xlsx", {
			source: "coindcx",
			timezone: "IST",
		})
	).id;
	await addManual({
		timestamp: "2026-05-01T00:00:00.000Z",
		type: "gift",
		assetIn: "SOL",
		amountIn: "2",
		inrValue: "30000",
		userNote: "from uncle",
	});
});
afterAll(wipe);

const find = async (sourceRef: string) =>
	(await allTx()).find((t) => t.sourceRef === sourceRef);

describe("GET /api/transactions filters", () => {
	it("no filter returns everything with total", async () => {
		const r = await listTx();
		expect(r.total).toBe(16);
		expect(r.items).toHaveLength(16);
	});

	it("taxYear keeps only rows inside the IST year", async () => {
		const a = await allTx({ taxYear: "2025-26" });
		const b = await allTx({ taxYear: "2026-27" });
		for (const t of a)
			expect(t.timestamp >= FY25_START && t.timestamp < FY26_START).toBe(true);
		for (const t of b) expect(t.timestamp >= FY26_START).toBe(true);
		expect(a.length + b.length).toBe(16);
	});

	it("asset matches either side of the trade", async () => {
		const r = await allTx({ asset: "BTC" });
		expect(r.length).toBeGreaterThan(0);
		for (const t of r)
			expect([t.assetIn, t.assetOut, t.feeAsset]).toContain("BTC");
		expect(
			r.some((t) => t.assetIn === "BTC") && r.some((t) => t.assetOut === "BTC"),
		).toBe(true);
	});

	it("type, source, flagged", async () => {
		for (const t of await allTx({ type: "swap" })) expect(t.type).toBe("swap");
		const cdx = await allTx({ source: "coindcx" });
		expect(cdx).toHaveLength(7);
		const flagged = await allTx({ flagged: true });
		const clean = await allTx({ flagged: false });
		for (const t of flagged) expect(t.reviewFlags.length).toBeGreaterThan(0);
		for (const t of clean) expect(t.reviewFlags).toEqual([]);
		expect(flagged.length + clean.length).toBe(16);
	});

	it("q searches source refs and notes", async () => {
		const r = await allTx({ q: "IO-FIXT-0002" });
		expect(r.map((t) => t.sourceRef)).toEqual(["IO-FIXT-0002"]);
		expect((await allTx({ q: "uncle" })).map((t) => t.assetIn)).toEqual([
			"SOL",
		]);
		expect(await allTx({ q: "no-such-thing-xyz" })).toEqual([]);
	});

	it("q is a literal string, not a SQL LIKE pattern", async () => {
		expect(await allTx({ q: "%" })).toEqual([]);
		expect(await allTx({ q: "_" })).toEqual([]);
	});

	it("filters combine (AND)", async () => {
		const r = await allTx({
			source: "coindcx",
			type: "sell",
			taxYear: "2026-27",
		});
		expect(r.map((t) => t.sourceRef)).toEqual(["ST-FIXT-0005"]);
	});

	it.each([
		["type", "teleport"],
		["taxYear", "1999"],
		["flagged", "maybe"],
		["sort", "amount:asc"],
		["page", "0"],
		["page", "-1"],
		["pageSize", "0"],
		["pageSize", "201"],
		["pageSize", "abc"],
	])("invalid %s=%s → 400", async (k, v) => {
		fail(
			await call("GET", `/api/transactions?${k}=${v}`),
			400,
			"validation_error",
		);
	});
});

describe("pagination and sort", () => {
	it("pages are disjoint and cover the set; pageSize 200 is the maximum", async () => {
		const p1 = await listTx({ page: 1, pageSize: 5, sort: "timestamp:asc" });
		const p2 = await listTx({ page: 2, pageSize: 5, sort: "timestamp:asc" });
		const p4 = await listTx({ page: 4, pageSize: 5, sort: "timestamp:asc" });
		expect(p1).toMatchObject({ page: 1, pageSize: 5, total: 16 });
		expect(p1.items).toHaveLength(5);
		expect(p4.items).toHaveLength(1);
		const ids = new Set([...p1.items, ...p2.items].map((t) => t.id));
		expect(ids.size).toBe(10);
		expect((await listTx({ pageSize: 200 })).pageSize).toBe(200);
	});

	it("a page past the end is empty, not an error", async () => {
		const r = await listTx({ page: 99, pageSize: 50 });
		expect(r.items).toEqual([]);
		expect(r.total).toBe(16);
	});

	it("default is page 1, pageSize 50, newest first", async () => {
		const r = ok(
			await call("GET", "/api/transactions"),
			200,
			api.ListTransactionsResponseSchema,
		);
		expect(r).toMatchObject({ page: 1, pageSize: 50 });
		const ts = r.items.map((t) => t.timestamp);
		expect(ts).toEqual([...ts].sort().reverse());
	});

	it.each([
		"timestamp:asc",
		"timestamp:desc",
		"source:asc",
		"source:desc",
	] as const)("sort=%s orders rows", async (sort) => {
		const [key, dir] = sort.split(":") as ["timestamp" | "source", string];
		const vals = (await listTx({ sort })).items.map((t) => t[key]);
		const sorted = [...vals].sort();
		expect(vals).toEqual(dir === "asc" ? sorted : sorted.reverse());
	});

	it("sort=asset:asc orders by asset", async () => {
		const items = (await listTx({ sort: "asset:asc" })).items;
		expect(items.length).toBe(16);
	});
});

describe("POST /api/transactions (manual)", () => {
	it("gift with FMV is created with source manual and a fresh uuid", async () => {
		const tx = await addManual({
			timestamp: "2026-06-01T10:00:00.000Z",
			type: "gift",
			assetIn: "ETH",
			amountIn: "0.5",
			inrValue: "120000",
		});
		expect(tx).toMatchObject({
			source: "manual",
			type: "gift",
			assetIn: "ETH",
			amountIn: "0.5",
			inrValue: "120000",
			importId: null,
		});
		expect(tx.id).toMatch(/^[0-9a-f-]{36}$/);
		expect((await allTx({ source: "manual" })).map((t) => t.id)).toContain(
			tx.id,
		);
	});

	it("staking income with incomeKind", async () => {
		const tx = await addManual({
			timestamp: "2026-06-02T10:00:00.000Z",
			type: "income",
			incomeKind: "staking",
			assetIn: "DOT",
			amountIn: "3.25",
			inrValue: "1500",
		});
		expect(tx).toMatchObject({ type: "income", incomeKind: "staking" });
	});

	it("a missing buy with only an INR value (no quote side)", async () => {
		const tx = await addManual({
			timestamp: "2025-01-01T10:00:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "0.01",
			inrValue: "2500",
		});
		expect(tx).toMatchObject({ type: "buy", inrValue: "2500" });
		expect(tx.assetOut).toBeUndefined();
	});

	it("cannot spoof another source", async () => {
		const res = await call("POST", "/api/transactions", {
			json: manual({
				source: "binance",
				timestamp: "2026-06-03T10:00:00.000Z",
				type: "gift",
				assetIn: "ADA",
				amountIn: "5",
			}),
		});
		if (res.status === 201)
			expect(ok(res, 201, api.CreateTransactionResponseSchema).source).toBe(
				"manual",
			);
		else fail(res, 400);
	});

	it.each([
		[
			"sell without assetOut",
			{ type: "sell", timestamp: "2026-06-01T00:00:00Z", inrValue: "1" },
		],
		[
			"buy with neither quote nor INR value",
			{
				type: "buy",
				timestamp: "2026-06-01T00:00:00Z",
				assetIn: "BTC",
				amountIn: "1",
			},
		],
		[
			"negative amount",
			{
				type: "gift",
				timestamp: "2026-06-01T00:00:00Z",
				assetIn: "BTC",
				amountIn: "-1",
			},
		],
		[
			"zero amount",
			{
				type: "gift",
				timestamp: "2026-06-01T00:00:00Z",
				assetIn: "BTC",
				amountIn: "0",
			},
		],
		[
			"amount as a JS number",
			{
				type: "gift",
				timestamp: "2026-06-01T00:00:00Z",
				assetIn: "BTC",
				amountIn: 1,
			},
		],
		[
			"incomeKind on a buy",
			{
				type: "buy",
				incomeKind: "staking",
				timestamp: "2026-06-01T00:00:00Z",
				assetIn: "BTC",
				amountIn: "1",
				inrValue: "1",
			},
		],
		[
			"bad timestamp",
			{ type: "gift", timestamp: "yesterday", assetIn: "BTC", amountIn: "1" },
		],
		[
			"lower-case asset",
			{
				type: "gift",
				timestamp: "2026-06-01T00:00:00Z",
				assetIn: "btc",
				amountIn: "1",
			},
		],
		[
			"unknown type",
			{
				type: "teleport",
				timestamp: "2026-06-01T00:00:00Z",
				assetIn: "BTC",
				amountIn: "1",
			},
		],
		[
			"NaN amount",
			{
				type: "gift",
				timestamp: "2026-06-01T00:00:00Z",
				assetIn: "BTC",
				amountIn: "NaN",
			},
		],
		[
			"Infinity INR",
			{
				type: "gift",
				timestamp: "2026-06-01T00:00:00Z",
				assetIn: "BTC",
				amountIn: "1",
				inrValue: "Infinity",
			},
		],
	])("invalid: %s → 400", async (_n, tx) => {
		const before = (await listTx()).total;
		fail(
			await call("POST", "/api/transactions", { json: manual(tx) }),
			400,
			"validation_error",
		);
		expect((await listTx()).total).toBe(before);
	});

	it("reusing a manual sourceRef → 409", async () => {
		const ref = `dup-${runId}`;
		await addManual({
			sourceRef: ref,
			timestamp: "2026-06-05T00:00:00.000Z",
			type: "gift",
			assetIn: "XRP",
			amountIn: "1",
		});
		fail(
			await call("POST", "/api/transactions", {
				json: manual({
					sourceRef: ref,
					timestamp: "2026-06-05T00:00:00.000Z",
					type: "gift",
					assetIn: "XRP",
					amountIn: "1",
				}),
			}),
			409,
		);
	});
});

describe("PATCH /api/transactions/:id", () => {
	it("edits type, inrValue, note and resolves flags", async () => {
		const tx = await find("IO-FIXT-0001");
		expect(tx?.reviewFlags.map((f) => f.code)).toContain("parse_warning");
		const res = await call("PATCH", `/api/transactions/${tx?.id}`, {
			json: {
				inrValue: "180000",
				userNote: "checked against bank",
				resolveFlags: ["parse_warning"],
			},
		});
		const up = ok(res, 200, api.PatchTransactionResponseSchema);
		expect(up).toMatchObject({
			id: tx?.id,
			inrValue: "180000",
			inrRateSource: "manual",
			userNote: "checked against bank",
		});
		expect(up.reviewFlags.map((f) => f.code)).not.toContain("parse_warning");
		expect(up.raw).toEqual(tx?.raw);
	});

	it("changing a deposit to income with incomeKind", async () => {
		const tx = await addManual({
			timestamp: "2026-07-01T00:00:00.000Z",
			type: "deposit",
			assetIn: "MATIC",
			amountIn: "10",
		});
		const up = ok(
			await call("PATCH", `/api/transactions/${tx.id}`, {
				json: { type: "income", incomeKind: "airdrop" },
			}),
			200,
			api.PatchTransactionResponseSchema,
		);
		expect(up).toMatchObject({ type: "income", incomeKind: "airdrop" });
	});

	it("re-importing the source file does not overwrite a user edit", async () => {
		const tx = await find("ST-FIXT-0004");
		ok(
			await call("PATCH", `/api/transactions/${tx?.id}`, {
				json: { inrValue: "99999", userNote: "user fixed", type: "sell" },
			}),
			200,
			api.PatchTransactionResponseSchema,
		);
		const again = await importOk(fixture("coindcx-report.xlsx"), "c.xlsx", {
			source: "coindcx",
			timezone: "IST",
		});
		expect(again.rowsInserted).toBe(0);
		const after = await find("ST-FIXT-0004");
		expect(after).toMatchObject({
			id: tx?.id,
			inrValue: "99999",
			userNote: "user fixed",
		});
	});

	it("editing a type into an invalid shape is rejected, not stored", async () => {
		const tx = await addManual({
			timestamp: "2026-07-02T00:00:00.000Z",
			type: "deposit",
			assetIn: "LINK",
			amountIn: "1",
		});
		const res = await call("PATCH", `/api/transactions/${tx.id}`, {
			json: { type: "sell" },
		});
		expect([400, 422]).toContain(res.status);
		fail(res, res.status);
		expect(
			(await allTx({ source: "manual" })).find((t) => t.id === tx.id)?.type,
		).toBe("deposit");
	});

	it("incomeKind on a non-income row is rejected", async () => {
		const tx = await addManual({
			timestamp: "2026-07-03T00:00:00.000Z",
			type: "deposit",
			assetIn: "LINK",
			amountIn: "2",
		});
		const res = await call("PATCH", `/api/transactions/${tx.id}`, {
			json: { incomeKind: "staking" },
		});
		expect([400, 422]).toContain(res.status);
	});

	it.each([
		["unknown field", { amountIn: "5" }],
		["negative inrValue", { inrValue: "-1" }],
		["unknown flag code", { resolveFlags: ["everything"] }],
		["bad type", { type: "teleport" }],
	])("%s → 400", async (_n, body) => {
		const tx = await find("IO-FIXT-0002");
		fail(
			await call("PATCH", `/api/transactions/${tx?.id}`, { json: body }),
			400,
			"validation_error",
		);
	});

	it("unknown id → 404", async () => {
		fail(
			await call(
				"PATCH",
				"/api/transactions/00000000-0000-4000-8000-000000000000",
				{ json: { userNote: "x" } },
			),
			404,
			"not_found",
		);
	});
});

describe("DELETE /api/transactions/:id", () => {
	it("deletes a manual row → 204", async () => {
		const tx = await addManual({
			timestamp: "2026-07-04T00:00:00.000Z",
			type: "gift",
			assetIn: "UNI",
			amountIn: "1",
		});
		const res = await call("DELETE", `/api/transactions/${tx.id}`);
		expect(res.status).toBe(204);
		expect((await allTx({ source: "manual" })).map((t) => t.id)).not.toContain(
			tx.id,
		);
	});

	it("refuses to delete an imported row (4xx) and keeps it", async () => {
		const tx = await find("IO-FIXT-0002");
		const res = await call("DELETE", `/api/transactions/${tx?.id}`);
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
		fail(res, res.status);
		expect(await find("IO-FIXT-0002")).toBeDefined();
	});

	it("unknown id → 404", async () => {
		fail(
			await call(
				"DELETE",
				"/api/transactions/00000000-0000-4000-8000-000000000000",
			),
			404,
		);
	});

	it("deleting the import removes the user-edited rows of that import too", async () => {
		expect((await call("DELETE", `/api/imports/${coindcxImport}`)).status).toBe(
			204,
		);
		expect(await allTx({ source: "coindcx" })).toEqual([]);
	});
});
