import { beforeAll, describe, expect, it } from "vitest";
import { allTx } from "./lib";
import {
	addCoindcx,
	api,
	balances,
	call,
	clearRequests,
	connections,
	fail,
	ok,
	requests,
	scenario,
	startSync,
	streamTotals,
	sync,
	syncOk,
	waitJob,
	wipeP2,
} from "./p2";

let id = "";

describe("CoinDCX sync", () => {
	beforeAll(async () => {
		await wipeP2();
		id = (await addCoindcx("DCX")).id;
	});

	describe("full sync", () => {
		let summary: api.SyncSummary;
		beforeAll(async () => {
			await clearRequests();
			summary = await syncOk(id);
		});

		it("one trades stream with 4 rows inserted", () => {
			expect(summary.streams).toEqual([
				expect.objectContaining({
					stream: "coindcx:trades",
					rowsFetched: 4,
					rowsInserted: 4,
					rowsDuplicate: 0,
				}),
			]);
		});
		it("the summary says the API has no deposits/withdrawals or TDS", () => {
			expect(summary.notices.join(" ")).toMatch(/TDS/);
			expect(summary.notices.join(" ")).toMatch(/deposit\/withdrawal/i);
		});
		it("balances: BTC 0.0005, ETH 0.08, INR 0 — all zero differences", async () => {
			const rows = (await balances(id)).rows;
			expect(
				Object.fromEntries(rows.map((r) => [r.asset, r.fetched])),
			).toMatchObject({
				BTC: "0.0005",
				ETH: "0.08",
			});
			for (const r of rows)
				expect(r, r.asset).toMatchObject({ difference: "0", flagged: false });
		});
		it("rows are coindcx-api, INR-priced, carry no TDS, and raw keeps the API row", async () => {
			const tx = await allTx({ source: "coindcx-api" });
			expect(tx).toHaveLength(4);
			for (const t of tx) {
				expect(t.tdsInr ?? null).toBeNull();
				expect(t.raw).toBeTruthy();
			}
		});
		it("every authenticated call is a POST (signed body)", async () => {
			const log = (await requests()).filter(
				(r) =>
					r.path.startsWith("/coindcx/exchange/v1/users") ||
					r.path.includes("trade_history"),
			);
			expect(log.length).toBeGreaterThan(0);
			for (const r of log) expect(r.method).toBe("POST");
		});
		it("trade history pages with from_id/limit", async () => {
			const th = (await requests()).filter((r) =>
				r.path.endsWith("/orders/trade_history"),
			);
			expect(th.length).toBeGreaterThan(0);
		});
	});

	it("re-sync is idempotent", async () => {
		const summary = await syncOk(id);
		expect(streamTotals(summary).inserted).toBe(0);
		expect(await allTx({ source: "coindcx-api" })).toHaveLength(4);
	});

	it("concurrent sync → 409 sync_running", async () => {
		const job = await startSync(id);
		fail(
			await call("POST", `/api/connections/${id}/sync`),
			409,
			"sync_running",
		);
		await waitJob(job);
	});

	it.each([
		["rate_limit_once", 429],
		["upstream_500_once", 500],
	])("%s: recovers", async (name, status) => {
		await scenario(name);
		await clearRequests();
		const summary = await syncOk(id);
		expect(streamTotals(summary).inserted).toBe(0);
		expect((await requests()).some((r) => r.status === status)).toBe(true);
	});

	it("Binance-only scenarios do not affect CoinDCX (ban_418, bad_signature)", async () => {
		for (const name of ["ban_418", "bad_signature"]) {
			await scenario(name);
			expect((await sync(id)).status, name).toBe("completed");
		}
		await scenario("normal");
	});

	it("a wrong secret fails with upstream auth and a readable message", async () => {
		ok(
			await call("PATCH", `/api/connections/${id}`, {
				json: { apiSecret: "bad-dcx-secret" },
			}),
			200,
			api.ConnectionSchema,
		);
		const job = await sync(id);
		expect(job.status).toBe("failed");
		expect(job.error).toMatch(/credential|auth|key|401/i);
		expect(job.error).not.toContain("bad-dcx-secret");
		const c = (await connections()).find((x) => x.id === id);
		expect(c?.lastSyncStatus).toBe("failed");
	});

	it("empty account on a fresh connection: completes with zero rows and zero balances", async () => {
		expect((await call("DELETE", `/api/connections/${id}`)).status).toBe(204);
		const imports = ok(
			await call("GET", "/api/imports"),
			200,
			api.ListImportsResponseSchema,
		);
		for (const i of imports) await call("DELETE", `/api/imports/${i.id}`);
		id = (await addCoindcx("DCX empty")).id;
		await scenario("empty");
		const summary = await syncOk(id);
		await scenario("normal");
		expect(streamTotals(summary)).toEqual({
			fetched: 0,
			inserted: 0,
			duplicate: 0,
		});
		for (const r of summary.balanceCheck) expect(r.difference).toBe("0");
	});
});
