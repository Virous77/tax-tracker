import { beforeAll, describe, expect, it } from "vitest";
import { addManual, allTx } from "./lib";
import {
	addBinance,
	api,
	balances,
	call,
	clearRequests,
	connections,
	db,
	expectNoSecrets,
	fail,
	mockDay,
	ok,
	readyVault,
	requests,
	restartSameData,
	SYNC_TIMEOUT,
	scenario,
	startSync,
	streamTotals,
	sync,
	syncOk,
	waitJob,
	wipeP2,
} from "./p2";

const EXPECTED_STREAMS: Record<string, number> = {
	"binance:deposits": 2,
	"binance:withdrawals": 4,
	"binance:convert": 1,
	"binance:dividends": 2,
	"binance:fiat:0": 1,
	"binance:fiat:1": 1,
	"binance:p2p:BUY": 1,
	"binance:earn:flexible": 1,
	"binance:dust": 1,
	"binance:myTrades:ETHUSDT": 5,
};
const EXPECTED_TOTAL = Object.values(EXPECTED_STREAMS).reduce((a, b) => a + b);
const ZERO_DIFF = ["BNB", "ETH", "USDC", "XRP"];

let id = "";
const cursorCount = () =>
	Number(db(`select count(*) from sync_cursors where connection_id='${id}'`));
async function importsOf() {
	return ok(
		await call("GET", "/api/imports"),
		200,
		api.ListImportsResponseSchema,
	).filter((i) => i.connectionId === id);
}

describe("Binance sync", () => {
	beforeAll(async () => {
		await wipeP2();
		id = (await addBinance("Binance main")).id;
	});

	describe("empty account", () => {
		let summary: api.SyncSummary;
		beforeAll(async () => {
			await scenario("empty");
			summary = await syncOk(id);
			await scenario("normal");
		}, SYNC_TIMEOUT);

		it("completes with zero rows on every stream", () => {
			expect(summary.streams.length).toBeGreaterThan(5);
			expect(streamTotals(summary)).toEqual({
				fetched: 0,
				inserted: 0,
				duplicate: 0,
			});
		});
		it("balance check is all zeros with no differences", () => {
			for (const row of summary.balanceCheck)
				expect(row, row.asset).toMatchObject({ fetched: "0", difference: "0" });
		});
		it("writes an api_sync import with the connection label and a readable name", async () => {
			const [imp] = await importsOf();
			expect(imp).toMatchObject({
				kind: "api_sync",
				connectionLabel: "Binance main",
				source: "binance-api",
				status: "imported",
				rowsRead: 0,
				reportKind: null,
			});
			expect(imp?.fileName).toMatch(
				/^Binance main API sync \d{4}-\d{2}-\d{2} \d{2}:\d{2} IST$/,
			);
		});
		it("deleting the sync import resets the connection's cursors", async () => {
			expect(cursorCount()).toBeGreaterThan(5);
			const [imp] = await importsOf();
			expect((await call("DELETE", `/api/imports/${imp?.id}`)).status).toBe(
				204,
			);
			expect(cursorCount()).toBe(0);
		});
	});

	describe("full sync (normal)", () => {
		let job: Awaited<ReturnType<typeof sync>>;
		let summary: api.SyncSummary;
		let elapsedMs = 0;
		const waits: { seenAt: number; until: string }[] = [];
		beforeAll(async () => {
			await clearRequests();
			const started = Date.now();
			const jobId = await startSync(id);
			for (;;) {
				const current = ok(
					await call("GET", `/api/jobs/${jobId}`),
					200,
					api.JobSchema,
				);
				if (current.progress?.waitingUntil)
					waits.push({
						seenAt: Date.now(),
						until: current.progress.waitingUntil,
					});
				if (current.status === "completed" || current.status === "failed") {
					job = current;
					break;
				}
				await new Promise((r) => setTimeout(r, 300));
			}
			elapsedMs = Date.now() - started;
			summary = api.SyncSummarySchema.parse(job.result);
		}, SYNC_TIMEOUT);

		it("a first full sync of the fixture account finishes in under 6 minutes (P2-API-1)", () => {
			expect(elapsedMs).toBeLessThan(360_000);
		});
		it("while paced for the SAPI weight limit the job exposes progress.waitingUntil, about a minute ahead", () => {
			expect(waits.length).toBeGreaterThan(0);
			for (const w of waits) {
				const ahead = Date.parse(w.until) - w.seenAt;
				expect(ahead, w.until).toBeGreaterThan(-5_000);
				expect(ahead, w.until).toBeLessThanOrEqual(65_000);
			}
		});
		it("waitingUntil is cleared once the job ends", () => {
			expect(job.progress?.waitingUntil ?? null).toBeNull();
		});

		it("completes; the job records progress and the summary", () => {
			expect(job).toMatchObject({
				kind: "sync",
				status: "completed",
				error: null,
			});
			expect(job.progress?.streamsDone).toBeGreaterThan(0);
		});
		it.each(Object.entries(EXPECTED_STREAMS))(
			"stream %s inserted %i rows (after the cursor reset)",
			(stream, count) => {
				const row = summary.streams.find((s) => s.stream === stream);
				expect(row, stream).toMatchObject({
					rowsFetched: count,
					rowsInserted: count,
					rowsDuplicate: 0,
				});
			},
		);
		it("ledger holds exactly the inserted rows, all binance-api with unique sourceRefs and raw rows", async () => {
			const tx = await allTx({ source: "binance-api" });
			expect(tx).toHaveLength(EXPECTED_TOTAL);
			expect(new Set(tx.map((t) => t.sourceRef)).size).toBe(EXPECTED_TOTAL);
			for (const t of tx) expect(t.raw, t.sourceRef).toBeTruthy();
			expect(tx.find((t) => t.sourceRef === "trade:ETHUSDT:1001")).toBeTruthy();
		});
		it("API raw rows keep number text exactly (no float rounding)", async () => {
			const trade = (await allTx({ source: "binance-api" })).find(
				(t) => t.sourceRef === "trade:ETHUSDT:1001",
			);
			expect(JSON.stringify(trade?.raw)).toContain('"2512.40000000"');
		});
		it("the import detail matches the summary", async () => {
			const detail = ok(
				await call("GET", `/api/imports/${summary.importId}`),
				200,
				api.GetImportResponseSchema,
			);
			expect(detail).toMatchObject({
				kind: "api_sync",
				connectionId: id,
				status: "imported",
				rowsRead: EXPECTED_TOTAL,
				rowsInserted: EXPECTED_TOTAL,
			});
		});
		it("incomplete windows are reported: P2P six months and the dust limit", () => {
			expect(
				summary.streams.find((s) => s.stream === "binance:p2p:BUY")?.incomplete,
			).toMatch(/six months/);
			expect(
				summary.streams.find((s) => s.stream === "binance:dust")?.incomplete,
			).toMatch(/100/);
		});
		it.each(ZERO_DIFF)(
			"balance check: %s has zero difference",
			async (asset) => {
				const row = (await balances(id)).rows.find((r) => r.asset === asset);
				expect(row, asset).toMatchObject({ difference: "0", flagged: false });
			},
		);
		it("ETH fetched = spot 0.6569 + locked Earn 0.02; USDC 144.98; BNB 0.009554", async () => {
			const rows = Object.fromEntries(
				(await balances(id)).rows.map((r) => [r.asset, r.fetched]),
			);
			expect(rows).toMatchObject({
				ETH: "0.6769",
				USDC: "144.98",
				BNB: "0.009554",
			});
		});
		it("USDT includes the recent P2P purchase and reconciles across spot, funding and Earn", async () => {
			const row = (await balances(id)).rows.find((r) => r.asset === "USDT");
			expect(row).toMatchObject({
				fetched: "1977.433845",
				difference: "0",
				flagged: false,
			});
		});
		it("connection is 'incomplete' because P2P/dust are incomplete", async () => {
			const c = (await connections()).find((x) => x.id === id);
			expect(c).toMatchObject({
				lastSyncStatus: "incomplete",
				lastSyncJobId: job.id,
			});
		});
		it("signed calls carry a redacted signature and the key never shows up in the request log", async () => {
			const log = await requests();
			expect(log.length).toBeGreaterThan(20);
			for (const r of log.filter(
				(r) =>
					r.path.startsWith("/binance/sapi") || r.path.includes("myTrades"),
			))
				expect(r.params.signature, r.path).toBe("***");
			expectNoSecrets(JSON.stringify(log), "/__requests");
		});
		it("myTrades pages with fromId per symbol", async () => {
			const trades = (await requests()).filter(
				(r) => r.path === "/binance/api/v3/myTrades",
			);
			expect(trades.some((r) => r.params.symbol === "ETHUSDT")).toBe(true);
		});
	});

	describe("manual rows assigned to the binance venue", () => {
		const usdt = async () =>
			(await balances(id)).rows.find((r) => r.asset === "USDT");
		const added: string[] = [];
		const add = async (tx: Record<string, unknown>) => {
			const row = await addManual(tx);
			added.push(row.id);
			return row;
		};
		it("a manual row keeps source manual and reports its venue", async () => {
			const row = await add({
				timestamp: await mockDay(1, "10:00:00"),
				type: "withdrawal",
				venue: "binance",
				assetOut: "USDT",
				amountOut: "7",
			});
			expect(row).toMatchObject({ source: "manual", venue: "binance" });
			const listed = (await allTx()).find((t) => t.id === row.id);
			expect(listed).toMatchObject({ source: "manual", venue: "binance" });
		});
		it("it counts toward the Binance balance check: a 7 USDT withdrawal opens a 7 gap", async () => {
			expect(await usdt()).toMatchObject({
				fetched: "1977.433845",
				difference: "7",
				flagged: true,
			});
		});
		it("a venue-manual row does not touch the Binance check", async () => {
			const row = await add({
				timestamp: await mockDay(1, "11:00:00"),
				type: "deposit",
				assetIn: "USDT",
				amountIn: "7",
			});
			expect(row.venue).toBe("manual");
			expect(await usdt()).toMatchObject({ difference: "7", flagged: true });
		});
		it("a binance-venue deposit closes the gap", async () => {
			await add({
				timestamp: await mockDay(1, "12:00:00"),
				type: "deposit",
				venue: "binance",
				assetIn: "USDT",
				amountIn: "7",
			});
			expect(await usdt()).toMatchObject({ difference: "0", flagged: false });
		});
		it("deleting the manual rows restores the synced state", async () => {
			for (const txId of added)
				expect((await call("DELETE", `/api/transactions/${txId}`)).status).toBe(
					204,
				);
			expect(await usdt()).toMatchObject({ difference: "0", flagged: false });
		});
	});

	describe("re-sync is idempotent and resumes from cursors", () => {
		let summary: api.SyncSummary;
		beforeAll(async () => {
			await clearRequests();
			summary = await syncOk(id);
		}, SYNC_TIMEOUT);
		it("inserts nothing", () => {
			expect(streamTotals(summary).inserted).toBe(0);
		});
		it("the ledger is unchanged", async () => {
			expect(await allTx({ source: "binance-api" })).toHaveLength(
				EXPECTED_TOTAL,
			);
		});
		it("does not re-walk deposit history from 2017 (few deposit windows)", async () => {
			const n = (await requests()).filter((r) =>
				r.path.endsWith("/capital/deposit/hisrec"),
			).length;
			expect(n).toBeLessThan(10);
		});
	});

	describe("mock scenarios on a re-sync", () => {
		it.each([
			["rate_limit_once", 429],
			["upstream_500_once", 500],
		])(
			"%s: the job recovers and completes",
			async (name, status) => {
				await scenario(name);
				await clearRequests();
				const summary = await syncOk(id);
				expect(streamTotals(summary).inserted).toBe(0);
				const log = await requests();
				expect(log.some((r) => r.status === status)).toBe(true);
				expect(log.filter((r) => r.status === status)).toHaveLength(1);
			},
			SYNC_TIMEOUT,
		);

		it(
			"clock_skew: recovers via /api/v3/time",
			async () => {
				await scenario("clock_skew");
				await clearRequests();
				const summary = await syncOk(id);
				expect(streamTotals(summary).inserted).toBe(0);
				expect(
					(await requests()).some((r) => r.path === "/binance/api/v3/time"),
				).toBe(true);
				await scenario("normal");
			},
			SYNC_TIMEOUT,
		);

		it(
			"ban_418: fails fast with a clear error and no retry storm",
			async () => {
				await scenario("ban_418");
				await clearRequests();
				const job = await sync(id);
				await scenario("normal");
				expect(job.status).toBe("failed");
				expect(job.error).toMatch(/418|ban|rate|too many/i);
				const banned = (await requests()).filter((r) => r.status === 418);
				expect(banned.length).toBeGreaterThan(0);
				expect(banned.length).toBeLessThanOrEqual(2);
				const c = (await connections()).find((x) => x.id === id);
				expect(c).toMatchObject({
					lastSyncStatus: "failed",
					lastSyncError: job.error,
				});
			},
			SYNC_TIMEOUT,
		);

		it(
			"bad_signature: fails with an auth error that names the problem and leaks nothing",
			async () => {
				await scenario("bad_signature");
				const job = await sync(id);
				await scenario("normal");
				expect(job.status).toBe("failed");
				expect(job.error).toMatch(/Binance -1022:.*signature/i);
				expect(job.error).not.toMatch(
					/signature=|timestamp=|recvWindow=|\?\w+=|https?:\/\/|mock-binance/i,
				);
				const c = (await connections()).find((x) => x.id === id);
				expect(c?.lastSyncError).toBe(job.error);
				expectNoSecrets(JSON.stringify(job), "job");
			},
			SYNC_TIMEOUT,
		);

		it("a failed sync's import is marked failed and Review lists the connection", async () => {
			const failed = (await importsOf()).filter((i) => i.status === "failed");
			expect(failed.length).toBeGreaterThanOrEqual(2);
			const review = ok(
				await call("GET", "/api/review"),
				200,
				api.ReviewResponseSchema,
			);
			expect(review.connections.map((c) => c.id)).toContain(id);
		});

		it(
			"after the failures a normal re-sync completes and inserts nothing",
			async () => {
				expect(streamTotals(await syncOk(id)).inserted).toBe(0);
				expect(await allTx({ source: "binance-api" })).toHaveLength(
					EXPECTED_TOTAL,
				);
			},
			SYNC_TIMEOUT,
		);
	});

	describe("interrupted by a restart, then resumed", () => {
		let interrupted = "";
		let importId = "";
		beforeAll(async () => {
			for (const imp of await importsOf())
				expect((await call("DELETE", `/api/imports/${imp.id}`)).status).toBe(
					204,
				);
			expect(cursorCount()).toBe(0);
			expect(await allTx({ source: "binance-api" })).toHaveLength(0);
			interrupted = await startSync(id);
			const deadline = Date.now() + 120_000;
			for (;;) {
				const job = ok(
					await call("GET", `/api/jobs/${interrupted}`),
					200,
					api.JobSchema,
				);
				if ((job.progress?.streamsDone ?? 0) >= 2) {
					importId = api.SyncSummarySchema.parse(job.result).importId;
					break;
				}
				if (Date.now() > deadline || job.status !== "running")
					throw new Error(`job ${job.status}`);
				await new Promise((r) => setTimeout(r, 300));
			}
			await restartSameData();
		}, SYNC_TIMEOUT);

		it("the interrupted job is failed after boot and the connection says so", async () => {
			const job = ok(
				await call("GET", `/api/jobs/${interrupted}`),
				200,
				api.JobSchema,
			);
			expect(job.status).toBe("failed");
			expect(job.error).toMatch(/restart/i);
			const c = (await connections()).find((x) => x.id === id);
			expect(c).toMatchObject({
				running: false,
				runningJobId: null,
				lastSyncJobId: interrupted,
				lastSyncStatus: "failed",
			});
		});

		it("per-stream counts were checkpointed before the restart", async () => {
			const job = ok(
				await call("GET", `/api/jobs/${interrupted}`),
				200,
				api.JobSchema,
			);
			const summary = api.SyncSummarySchema.parse(job.result);
			expect(
				summary.streams.find((s) => s.stream === "binance:deposits")
					?.rowsInserted,
			).toBe(2);
		});

		it("the interrupted sync's import is marked failed (not left pending)", async () => {
			const imp = (await importsOf()).find((i) => i.id === importId);
			expect(imp?.status).toBe("failed");
		});

		it(
			"after unlock, a retry resumes and the ledger ends up complete with no duplicates",
			async () => {
				await readyVault();
				const summary = await syncOk(id);
				expect(
					summary.streams.find((s) => s.stream === "binance:deposits")
						?.rowsInserted ?? 0,
				).toBe(0);
				const tx = await allTx({ source: "binance-api" });
				expect(tx).toHaveLength(EXPECTED_TOTAL);
				expect(new Set(tx.map((t) => t.sourceRef)).size).toBe(EXPECTED_TOTAL);
			},
			SYNC_TIMEOUT,
		);

		it(
			"concurrent sync on the same connection → 409 sync_running",
			async () => {
				const job = await startSync(id);
				fail(
					await call("POST", `/api/connections/${id}/sync`),
					409,
					"sync_running",
				);
				await waitJob(job);
			},
			SYNC_TIMEOUT,
		);
	});
});
