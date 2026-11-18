import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connector, ConnectorContext, LedgerTx } from "@tax/core";
import { IncompleteExplorerHistoryError } from "@tax/evm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { settleBackgroundJobs } from "../background";
import { closeDatabases, database } from "../context";
import { type Endpoint, handle } from "../http";
import { vaultSession } from "../vault";

const control = vi.hoisted(() => ({
	gate: undefined as Promise<void> | undefined,
	incomplete: false,
	fail: false,
	drift: false,
	waitingUntil: undefined as number | undefined,
	balanceError: undefined as Error | undefined,
}));
vi.mock("../connectors", () => {
	const connector: Connector<ConnectorContext> = {
		async *sync(opts) {
			if (control.waitingUntil !== undefined)
				opts.onProgress?.({
					stream: "trades",
					streamsDone: 0,
					streamsTotal: 1,
					rowsFetched: 0,
					waitingUntil: control.waitingUntil,
				});
			await control.gate;
			opts.signal?.throwIfAborted();
			if (control.fail)
				throw new Error("Do not expose signed-url?secret=hidden");
			const tx: Omit<LedgerTx, "id" | "importId"> = {
				source: "binance-api",
				sourceRef: "trade:ETHINR:1",
				timestamp: "2026-05-01T00:00:00Z",
				type: "buy",
				assetIn: "ETH",
				amountIn: "1",
				assetOut: "INR",
				amountOut: "1000",
				inrValue: "1000",
				raw: { original: "untouched" },
				reviewFlags: [],
			};
			opts.onProgress?.({
				stream: "trades",
				streamsDone: 0,
				streamsTotal: 1,
				rowsFetched: 1,
			});
			yield {
				stream: "trades",
				rows: [{ tx }],
				cursor: { lastId: "1" },
				...(control.incomplete ? { incomplete: "window truncated" } : {}),
			};
		},
		async balances() {
			if (control.balanceError) throw control.balanceError;
			return [
				{ asset: "ETH", amount: control.drift ? "1.5" : "1", wallet: "spot" },
			];
		},
		async checkKey() {
			return {
				ok: true,
				readOnly: false,
				permissions: ["trade"],
				message: "Trading enabled",
			};
		},
	};
	return { connectorFor: () => connector, baseUrls: () => ({}) };
});
let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "tax-phase2-api-"));
	vi.stubEnv("DATA_DIR", dir);
	vi.stubEnv("APP_PASSWORD", "");
	vi.stubEnv("SECRETS_PASSPHRASE", "");
	control.gate = undefined;
	control.fail = false;
	control.incomplete = false;
	control.drift = false;
	control.waitingUntil = undefined;
	control.balanceError = undefined;
});
afterEach(async () => {
	await settleBackgroundJobs(database());
	closeDatabases();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await rm(dir, { recursive: true, force: true });
});
function call(
	name: Endpoint,
	method = "GET",
	body?: unknown,
	params: Record<string, string> = {},
	query = "",
) {
	return handle(
		name,
		new Request(`http://localhost/api/test${query}`, {
			method,
			...(body === undefined
				? {}
				: {
						body: JSON.stringify(body),
						headers: { "Content-Type": "application/json" },
					}),
		}),
		params,
	);
}
const passphrase = "correct horse battery staple";
async function setup() {
	expect((await call("setupVault", "POST", { passphrase })).status).toBe(200);
	const response = await call("createConnection", "POST", {
		kind: "binance",
		label: "Test",
		apiKey: "test-key",
		apiSecret: "test-secret",
	});
	expect(response.status).toBe(201);
	return (await response.json()) as { id: string };
}
it("implements vault and provider flows without returning secret material", async () => {
	expect(await (await call("getVault")).json()).toMatchObject({
		initialized: false,
		unlocked: false,
		idleLockMinutes: 30,
	});
	expect(
		(
			await call(
				"putProvider",
				"PUT",
				{ apiKey: "hidden" },
				{ name: "etherscan" },
			)
		).status,
	).toBe(409);
	await setup();
	expect(
		(
			await call(
				"putProvider",
				"PUT",
				{ apiKey: "hidden" },
				{ name: "etherscan" },
			)
		).status,
	).toBe(200);
	expect(await (await call("getProviders")).json()).toMatchObject({
		etherscan: { keySet: true },
	});
	expect((await call("getProviders")).status).toBe(200);
	await call("lockVault", "POST");
	expect(
		(
			await call(
				"putProvider",
				"PUT",
				{ apiKey: "second" },
				{ name: "coingecko" },
			)
		).status,
	).toBe(423);
	expect(
		(await call("unlockVault", "POST", { passphrase: "wrong" })).status,
	).toBe(401);
	expect((await call("unlockVault", "POST", { passphrase })).status).toBe(200);
	expect(
		(
			await call("changePassphrase", "POST", {
				current: passphrase,
				next: "another long passphrase",
			})
		).status,
	).toBe(200);
	expect(
		(await call("deleteProvider", "DELETE", undefined, { name: "etherscan" }))
			.status,
	).toBe(200);
	expect(
		(await call("resetVault", "POST", { confirm: "RESET", extra: true }))
			.status,
	).toBe(400);
	expect((await call("resetVault", "POST", { confirm: "RESET" })).status).toBe(
		200,
	);
	expect(await (await call("listConnections")).json()).toMatchObject([
		{ keySet: false },
	]);
});
it("validates connections, lowercases addresses and returns only keySet", async () => {
	const connection = await setup();
	expect(
		(
			await call("createConnection", "POST", {
				kind: "binance",
				label: "Duplicate",
				apiKey: "test-key",
				apiSecret: "other",
			})
		).status,
	).toBe(409);
	const evm = await call("createConnection", "POST", {
		kind: "evm",
		label: "Wallet",
		address: `0x${"A".repeat(40)}`,
		chainId: 1,
	});
	expect(evm.status).toBe(201);
	expect(await evm.json()).toMatchObject({ address: `0x${"a".repeat(40)}` });
	expect(
		(
			await call("createConnection", "POST", {
				kind: "evm",
				label: "Bad",
				address: "bad",
			})
		).status,
	).toBe(400);
	expect(
		await (await call("checkConnection", "POST", undefined, connection)).json(),
	).toMatchObject({ ok: true, readOnly: false });
	expect(
		(
			await call(
				"patchConnection",
				"PATCH",
				{ label: "Changed", options: { extraSymbols: ["ETHUSDT"] } },
				connection,
			)
		).status,
	).toBe(200);
	const text = await (await call("listConnections")).text();
	expect(text).not.toContain("test-key");
	expect(text).not.toContain("test-secret");
	expect(
		(await call("deleteConnection", "DELETE", undefined, connection)).status,
	).toBe(204);
});
it("returns 202 before work finishes, rejects overlapping syncs, persists progress and resumes idempotently", async () => {
	const connection = await setup();
	control.waitingUntil = Date.parse("2026-11-17T05:30:00Z");
	let release: () => void = () => {};
	control.gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const response = await call("syncConnection", "POST", undefined, connection);
	expect(response.status).toBe(202);
	const { jobId } = await response.json();
	expect(await (await call("listConnections")).json()).toMatchObject([
		{ runningJobId: jobId, lastSyncJobId: null, running: true },
	]);
	expect(
		(await call("syncConnection", "POST", undefined, connection)).status,
	).toBe(409);
	try {
		await vi.waitFor(async () => {
			expect(
				await (await call("getJob", "GET", undefined, { id: jobId })).json(),
			).toMatchObject({
				status: "running",
				progress: { waitingUntil: "2026-11-17T05:30:00.000Z" },
			});
		});
	} finally {
		release();
	}
	await settleBackgroundJobs(database());
	expect(
		await (await call("getJob", "GET", undefined, { id: jobId })).json(),
	).toMatchObject({
		status: "completed",
		progress: { rowsFetched: 1, waitingUntil: null },
		result: {
			streams: [{ rowsInserted: 1 }],
			balanceCheck: [{ asset: "ETH", difference: "0" }],
		},
	});
	expect(
		await (
			await call("connectionBalances", "GET", undefined, connection)
		).json(),
	).toMatchObject({ rows: [{ flagged: false, computed: "1" }] });
	expect(await (await call("listConnections")).json()).toMatchObject([
		{ runningJobId: null, lastSyncJobId: jobId, running: false },
	]);
	const second = await (
		await call("syncConnection", "POST", undefined, connection)
	).json();
	await settleBackgroundJobs(database());
	expect(
		await (await call("getJob", "GET", undefined, { id: second.jobId })).json(),
	).toMatchObject({
		result: { streams: [{ rowsInserted: 0, rowsDuplicate: 1 }] },
	});
	closeDatabases();
	expect(await (await call("listConnections")).json()).toMatchObject([
		{ runningJobId: null, lastSyncJobId: second.jobId },
	]);
	expect((await call("getJob", "GET", undefined, { id: jobId })).status).toBe(
		200,
	);
	expect(database().transactions.all()).toHaveLength(1);
	expect(database().cursors.get(connection.id)).toEqual({
		trades: { lastId: "1" },
	});
});
it("assigns a manual buy to the venue's holdings and disposal lot pool", async () => {
	const connection = await setup();
	await call("putSettings", "PUT", { lotPool: "per_source" });
	const { jobId } = await (
		await call("syncConnection", "POST", undefined, connection)
	).json();
	await settleBackgroundJobs(database());
	expect(
		await (await call("getJob", "GET", undefined, { id: jobId })).json(),
	).toMatchObject({ status: "completed" });
	const manual = await call("createTransaction", "POST", {
		importId: null,
		venue: "binance",
		sourceRef: "manual-buy",
		timestamp: "2026-04-20T00:00:00Z",
		type: "buy",
		assetIn: "ETH",
		amountIn: "0.5",
		inrValue: "250",
		raw: { manual: true },
		reviewFlags: [],
	});
	expect(manual.status).toBe(201);
	const buy = await manual.json();
	expect(buy).toMatchObject({ source: "manual", venue: "binance" });
	const sale = {
		...database().transactions.active()[0],
		id: "00000000-0000-4000-8000-000000000001",
		importId: null,
		source: "binance-api",
		sourceRef: "sale",
		timestamp: "2026-05-02T00:00:00Z",
		type: "sell" as const,
		assetIn: "INR",
		amountIn: "500",
		assetOut: "ETH",
		amountOut: "0.5",
		inrValue: "500",
		raw: {},
		reviewFlags: [],
	};
	database().transactions.insert([{ tx: sale }]);
	closeDatabases();
	expect(
		await (
			await call("listTransactions", "GET", undefined, {}, "?source=manual")
		).json(),
	).toMatchObject({
		items: [{ id: buy.id, source: "manual", venue: "binance" }],
	});
	expect(
		await (
			await call("connectionBalances", "GET", undefined, connection)
		).json(),
	).toMatchObject({ rows: [{ asset: "ETH", difference: "0" }] });
	const report = await (
		await call("computeReport", "POST", undefined, { taxYear: "2026-27" })
	).json();
	expect(report.scheduleVdaRows).toMatchObject([
		{ costOfAcquisition: "250.00", trail: { lotTxIds: [buy.id] } },
	]);
	expect(
		(await call("deleteTransaction", "DELETE", undefined, { id: buy.id }))
			.status,
	).toBe(204);
});
it("retains incomplete warnings, reports balance drift, sanitizes failures and exposes failed connections in review", async () => {
	const connection = await setup();
	control.incomplete = true;
	control.drift = true;
	const { jobId } = await (
		await call("syncConnection", "POST", undefined, connection)
	).json();
	await settleBackgroundJobs(database());
	expect(
		await (await call("getJob", "GET", undefined, { id: jobId })).json(),
	).toMatchObject({
		result: {
			streams: [{ incomplete: "window truncated" }],
			balanceCheck: [{ difference: "0.5" }],
		},
	});
	expect(
		database()
			.imports.list()[0]
			?.warnings.map((row) => row.code),
	).toEqual(["import_incomplete", "balance_mismatch"]);
	control.fail = true;
	const failed = await (
		await call("syncConnection", "POST", undefined, connection)
	).json();
	await settleBackgroundJobs(database());
	const job = await (
		await call("getJob", "GET", undefined, { id: failed.jobId })
	).json();
	expect(job.status).toBe("failed");
	expect(JSON.stringify(job)).not.toContain("hidden");
	expect(await (await call("review")).json()).toMatchObject({
		connections: [{ lastSyncStatus: "failed" }],
	});
});
it("completes an EVM sync when the balance check discovers incomplete older history", async () => {
	await setup();
	await call(
		"putProvider",
		"PUT",
		{ apiKey: "test-explorer-key" },
		{ name: "alchemy" },
	);
	const connection = await (
		await call("createConnection", "POST", {
			kind: "evm",
			label: "Wallet",
			address: `0x${"a".repeat(40)}`,
			chainId: 42161,
			options: { providers: ["alchemy"] },
		})
	).json();
	const stream = `evm:42161:${connection.address}:txlistinternal`;
	control.balanceError = new IncompleteExplorerHistoryError([
		{ stream, message: "Older internal transfers are unavailable." },
	]);
	const { jobId } = await (
		await call("syncConnection", "POST", undefined, connection)
	).json();
	await settleBackgroundJobs(database());
	expect(
		await (await call("getJob", "GET", undefined, { id: jobId })).json(),
	).toMatchObject({
		status: "completed",
		result: {
			streams: expect.arrayContaining([
				expect.objectContaining({
					stream,
					incomplete: "Older internal transfers are unavailable.",
				}),
			]),
			balanceCheck: [],
			notices: [expect.stringMatching(/balance check skipped/i)],
		},
	});
	expect(database().connections.get(connection.id)?.lastSyncStatus).toBe(
		"incomplete",
	);
});
it("fills prices only when enabled and computes reports offline from the cache", async () => {
	const connection = await setup();
	expect(
		(await call("fillPrices", "POST", { taxYear: "2026-27" })).status,
	).toBe(409);
	expect(
		await (
			await call("pricesStatus", "GET", undefined, {}, "?taxYear=2026-27")
		).json(),
	).toMatchObject({ enabled: false, needed: 0 });
	await call("putSettings", "PUT", {
		prices: { enabled: true, coingeckoFallback: false },
		marketPriceBasis: "vwap",
	});
	await call("putSettings", "PUT", { prices: { enabled: false } });
	await call("putSettings", "PUT", { prices: { enabled: true } });
	expect(await (await call("getSettings")).json()).toMatchObject({
		prices: { enabled: true, coingeckoFallback: false },
		marketPriceBasis: "vwap",
	});
	expect(
		(
			await call("createTransaction", "POST", {
				importId: null,
				sourceRef: "income",
				timestamp: "2026-05-01T00:00:00Z",
				type: "income",
				assetIn: "ETH",
				amountIn: "1",
				raw: { manual: true },
				reviewFlags: [],
			})
		).status,
	).toBe(201);
	let requests = 0;
	vi.stubGlobal("fetch", async () => {
		requests++;
		return Response.json([
			[
				String(Date.parse("2026-04-30T18:30:00Z")),
				"2000",
				"2000",
				"2000",
				"2000",
				"10",
				"0",
				"20000",
			],
		]);
	});
	const fill = await call("fillPrices", "POST", { taxYear: "2026-27" });
	expect(fill.status).toBe(202);
	const { jobId } = await fill.json();
	await settleBackgroundJobs(database());
	expect(
		await (await call("getJob", "GET", undefined, { id: jobId })).json(),
	).toMatchObject({ result: { requested: 1, fetched: 1, missing: [] } });
	expect(requests).toBe(1);
	vi.stubGlobal("fetch", () => {
		throw new Error("Compute must stay offline");
	});
	expect(
		(await call("computeReport", "POST", undefined, { taxYear: "2026-27" }))
			.status,
	).toBe(200);
	const report = await (
		await call("getReport", "GET", undefined, { taxYear: "2026-27" })
	).json();
	expect(report.valuations[0]).toMatchObject({
		inrRateSource: "market_price_cache",
		marketPrice: { source: "binance_klines", kind: "vwap" },
	});
	await call("deleteConnection", "DELETE", undefined, connection);
});
it("auto-unlocks from the environment and clears the key on logout", async () => {
	vi.stubEnv("SECRETS_PASSPHRASE", passphrase);
	expect(await (await call("getVault")).json()).toMatchObject({
		initialized: true,
		unlocked: true,
		autoUnlock: true,
	});
	await call("logout", "POST");
	expect((await vaultSession(database())).status().unlocked).toBe(false);
});

for (const fileFirst of [true, false])
	it(`deduplicates a real file ${fileFirst ? "before" : "after"} the API import`, async () => {
		const connection = await setup();
		const upload = async () => {
			const form = new FormData();
			form.set(
				"file",
				new File(
					[
						"Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n2026-05-01 00:00:00,ETHINR,BUY,1000,1ETH,1000INR,0INR\n",
					],
					"synthetic.csv",
					{ type: "text/csv" },
				),
			);
			form.set("source", "binance");
			form.set("timezone", "UTC");
			return handle(
				"createImport",
				new Request("http://localhost/api/imports", {
					method: "POST",
					body: form,
				}),
			);
		};
		if (fileFirst) expect((await upload()).status).toBe(201);
		const sync = await (
			await call("syncConnection", "POST", undefined, connection)
		).json();
		await settleBackgroundJobs(database());
		if (!fileFirst)
			expect(await (await upload()).json()).toMatchObject({
				rowsInserted: 0,
				rowsDuplicate: 1,
			});
		else
			expect(
				await (
					await call("getJob", "GET", undefined, { id: sync.jobId })
				).json(),
			).toMatchObject({
				result: { streams: [{ rowsInserted: 0, rowsDuplicate: 1 }] },
			});
		expect(database().transactions.all()).toHaveLength(1);
	});

it("creates every supported chain and fails fast with chain-specific provider requirements", async () => {
	const { SUPPORTED_EVM_CHAIN_IDS } = await import("@tax/core");
	const { connectionOptions } = await import("../connections");
	await setup();
	const connections = new Map<number, { id: string }>();
	for (const chainId of SUPPORTED_EVM_CHAIN_IDS) {
		const response = await call("createConnection", "POST", {
			kind: "evm",
			label: `Chain ${chainId}`,
			address: `0x${"a".repeat(40)}`,
			chainId,
		});
		expect(response.status).toBe(201);
		const connection = await response.json();
		connections.set(chainId, connection);
		expect(connection).toMatchObject({
			chainId,
			keySet: false,
			runningJobId: null,
			lastSyncJobId: null,
		});
		const sync = await call("syncConnection", "POST", undefined, connection);
		expect(sync.status).toBe(409);
		const error = await sync.json();
		expect(error).toMatchObject({
			error: { code: "provider_key_required", details: { chainId } },
		});
		expect(error.error.details.needs.length).toBeGreaterThan(0);
	}
	const base = connections.get(8453);
	if (!base) throw new Error("Missing Base connection");
	await call(
		"putProvider",
		"PUT",
		{ apiKey: "hidden-free", tier: "free" },
		{ name: "etherscan" },
	);
	expect((await call("syncConnection", "POST", undefined, base)).status).toBe(
		409,
	);
	await call(
		"putProvider",
		"PUT",
		{ apiKey: "hidden-paid", tier: "paid" },
		{ name: "etherscan" },
	);
	expect(await connectionOptions(database(), base.id)).toMatchObject({
		providers: [{ kind: "etherscan", tier: "paid" }],
	});
	for (const name of ["alchemy", "nodereal"])
		expect(
			(await call("putProvider", "PUT", { apiKey: `hidden-${name}` }, { name }))
				.status,
		).toBe(200);
	expect(await (await call("getProviders")).json()).toMatchObject({
		alchemy: { keySet: true },
		nodereal: { keySet: true },
		etherscan: { keySet: true, tier: "paid" },
	});
	const sibling = await (
		await call("createConnection", "POST", {
			kind: "evm",
			label: "Other Base wallet",
			chainId: 8453,
			address: `0x${"b".repeat(40)}`,
		})
	).json();
	const options = await connectionOptions(database(), base.id);
	expect(options).toMatchObject({
		ownAddresses: [`0x${"a".repeat(40)}`, sibling.address],
		providers: [{ kind: "alchemy" }, { kind: "etherscan", tier: "paid" }],
	});
	expect(
		(
			await call("createConnection", "POST", {
				kind: "evm",
				label: "Unsupported",
				address: `0x${"a".repeat(40)}`,
				chainId: 10,
			})
		).status,
	).toBe(400);
});
