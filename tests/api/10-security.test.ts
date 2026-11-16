import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	addManual,
	allTx,
	api,
	BASE_URL,
	call,
	fail,
	fixture,
	listTx,
	manual,
	ok,
	runId,
	upload,
	wipe,
} from "./lib";

beforeEach(wipe);
afterAll(wipe);

describe("hostile file names", () => {
	it.each([
		["../../etc/passwd.csv", "passwd.csv"],
		["..\\..\\windows\\evil.csv", "evil.csv"],
		["/abs/path/x.csv", "x.csv"],
	])("%s is stored as a bare name", async (name, expected) => {
		const s = ok(
			await upload(fixture("binance-withdrawals.csv"), name),
			201,
			api.CreateImportResponseSchema,
		);
		expect(s.fileName).toBe(expected);
	});

	it("a <script> file name comes back as inert JSON text", async () => {
		const script = ok(
			await upload(
				fixture("binance-withdrawals.csv"),
				"<script>alert(1)</script>.csv",
			),
			201,
			api.CreateImportResponseSchema,
		);
		expect(script.fileName, "the '/' in </script> is a path separator").toBe(
			"script>.csv",
		);
		const name = "<img src=x onerror=alert(1)>.csv";
		const s = ok(
			await upload(fixture("binance-withdrawals.csv"), name),
			201,
			api.CreateImportResponseSchema,
		);
		expect(s.fileName).toBe(name);
		const list = await call("GET", "/api/imports");
		expect(list.headers.get("content-type")).toMatch(/^application\/json/);
		expect(list.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("unicode file names round-trip", async () => {
		const s = ok(
			await upload(fixture("binance-withdrawals.csv"), "लेनदेन-₹-😀.csv"),
			201,
			api.CreateImportResponseSchema,
		);
		expect(s.fileName).toBe("लेनदेन-₹-😀.csv");
	});
});

describe("methods and bodies", () => {
	it.each([
		["PATCH", "/api/health"],
		["DELETE", "/api/settings"],
		["PUT", "/api/imports"],
		["POST", "/api/tax-years"],
		["GET", "/api/recipes/suggest"],
		["PUT", "/api/transactions/00000000-0000-4000-8000-000000000000"],
		["POST", "/api/reports/2026-27"],
	])("%s %s → 405", async (method, path) => {
		const res = await call(method, path, method === "GET" ? {} : { json: {} });
		expect(res.status).toBe(405);
	});

	it.each([
		["PUT", "/api/settings"],
		["POST", "/api/transactions"],
		["POST", "/api/recipes/preview"],
		["POST", "/api/recipes/suggest"],
		["PUT", "/api/balances/actual?taxYear=2026-27"],
	])("malformed JSON on %s %s → 400", async (method, path) => {
		fail(
			await call(method, path, {
				body: '{"oops": ',
				headers: { "content-type": "application/json" },
			}),
			400,
			"validation_error",
		);
	});

	it("malformed JSON on PATCH transaction → 400", async () => {
		const tx = await addManual({
			timestamp: "2026-06-01T00:00:00.000Z",
			type: "gift",
			assetIn: "BTC",
			amountIn: "1",
		});
		fail(
			await call("PATCH", `/api/transactions/${tx.id}`, {
				body: "{]",
				headers: { "content-type": "application/json" },
			}),
			400,
		);
	});

	it("a JSON body over 1 MB → 413", async () => {
		const res = await call("POST", "/api/transactions", {
			json: manual({
				type: "gift",
				timestamp: "2026-06-01T00:00:00Z",
				assetIn: "BTC",
				amountIn: "1",
				userNote: "x".repeat(1_100_000),
			}),
		});
		fail(res, 413);
	});

	it("same-origin mutations use the public localhost port in Docker", async () => {
		ok(
			await call("PUT", "/api/settings", {
				json: { surchargeRate: "0" },
				headers: { origin: new URL(BASE_URL).origin },
			}),
			200,
			api.PutSettingsResponseSchema,
		);
	});

	it("cross-origin mutations are refused even without a password", async () => {
		fail(
			await call("PUT", "/api/settings", {
				json: { surchargeRate: "0" },
				headers: { origin: "http://evil.example" },
			}),
			403,
			"forbidden",
		);
	});

	it("errors never leak stack traces", async () => {
		const res = await call("POST", "/api/transactions", {
			body: "{",
			headers: { "content-type": "application/json" },
		});
		expect(res.text).not.toMatch(/\bat \S+:\d+:\d+|node_modules|\.next\//);
	});
});

describe("unicode and large values", () => {
	it("unicode note round-trips and is searchable", async () => {
		const note = `उपहार 🎁 от друга ${runId}`;
		await addManual({
			timestamp: "2026-06-01T00:00:00.000Z",
			type: "gift",
			assetIn: "BTC",
			amountIn: "1",
			userNote: note,
		});
		const found = await allTx({ q: "उपहार" });
		expect(found.map((t) => t.userNote)).toEqual([note]);
	});

	it.each(["1000000", "1e3", "999999999999999999999", "50.5"])(
		"pageSize=%s → 400",
		async (size) => {
			fail(
				await call("GET", `/api/transactions?pageSize=${size}`),
				400,
				"validation_error",
			);
		},
	);

	it("a huge page number is a clean 400 or an empty page", async () => {
		const res = await call(
			"GET",
			"/api/transactions?page=999999999999999999999",
		);
		if (res.status === 200)
			expect(ok(res, 200, api.ListTransactionsResponseSchema).items).toEqual(
				[],
			);
		else fail(res, 400);
	});

	it("80-digit decimals survive storage exactly", async () => {
		const amount = "12345678901234567890.123456789012345678901234567890";
		const tx = await addManual({
			timestamp: "2026-06-01T00:00:00.000Z",
			type: "gift",
			assetIn: "BTC",
			amountIn: amount,
			inrValue: "0.000000000000000001",
		});
		expect(tx.amountIn).toBe(amount);
		expect((await allTx()).find((t) => t.id === tx.id)?.amountIn).toBe(amount);
	});
});

describe("concurrency", () => {
	it("five concurrent uploads of the same file insert each ledger row once", async () => {
		const results = await Promise.all(
			Array.from({ length: 5 }, () =>
				upload(fixture("binance-trade-history.csv"), "same.csv", {
					source: "binance",
				}),
			),
		);
		const summaries = results.map((r) =>
			ok(r, 201, api.CreateImportResponseSchema),
		);
		expect(summaries.reduce((a, s) => a + s.rowsInserted, 0)).toBe(8);
		expect(summaries.reduce((a, s) => a + s.rowsDuplicate, 0)).toBe(32);
		expect((await listTx()).total).toBe(8);
	});

	it("concurrent manual creates with one sourceRef → exactly one row", async () => {
		const ref = `race-${runId}`;
		const body = manual({
			sourceRef: ref,
			timestamp: "2026-06-01T00:00:00.000Z",
			type: "gift",
			assetIn: "ETH",
			amountIn: "1",
		});
		const res = await Promise.all(
			Array.from({ length: 5 }, () =>
				call("POST", "/api/transactions", { json: body }),
			),
		);
		expect(res.filter((r) => r.status === 201)).toHaveLength(1);
		for (const r of res.filter((r) => r.status !== 201)) fail(r, 409);
		expect((await allTx({ q: ref })).length).toBe(1);
	});

	it("concurrent compute calls all return the same report", async () => {
		await addManual({
			timestamp: "2026-04-01T06:00:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "1",
			inrValue: "100",
		});
		await addManual({
			timestamp: "2026-04-02T06:00:00.000Z",
			type: "sell",
			assetOut: "ETH",
			amountOut: "1",
			inrValue: "200",
		});
		const res = await Promise.all(
			Array.from({ length: 4 }, () =>
				call("POST", "/api/reports/2026-27/compute"),
			),
		);
		const bodies = res.map((r) => ok(r, 200, api.ComputeReportResponseSchema));
		for (const b of bodies) expect(b).toEqual(bodies[0]);
	});
});
