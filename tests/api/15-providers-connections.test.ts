import { beforeAll, describe, expect, it } from "vitest";
import {
	addBinance,
	addCoindcx,
	addEvm,
	allProviders,
	api,
	CHAIN_IDS,
	call,
	clearRequests,
	connections,
	createConnection,
	db,
	expectNoSecrets,
	fail,
	KEYS,
	ok,
	PASS,
	providers,
	putProvider,
	requests,
	scenario,
	startSync,
	sync,
	syncOk,
	WALLET_A,
	WALLET_B,
	waitJob,
	wipeP2,
} from "./p2";

const PROVIDERS = [
	"etherscan",
	"blockscout",
	"alchemy",
	"nodereal",
	"coingecko",
] as const;

describe("providers", () => {
	beforeAll(wipeP2);

	it("start with no keys and Etherscan tier free", async () => {
		expect(await providers()).toEqual({
			etherscan: { keySet: false, tier: "free" },
			blockscout: { keySet: false },
			alchemy: { keySet: false },
			nodereal: { keySet: false },
			coingecko: { keySet: false },
		});
	});

	it.each(PROVIDERS)(
		"PUT %s stores a key and never returns it",
		async (name) => {
			const secret = `secret-${name}-value-123`;
			const res = await call("PUT", `/api/providers/${name}`, {
				json: { apiKey: secret },
			});
			const body = ok(res, 200, api.ProvidersResponseSchema);
			expect(body[name].keySet).toBe(true);
			expect(res.text).not.toContain(secret);
			expect((await call("GET", "/api/providers")).text).not.toContain(secret);
		},
	);

	it("Etherscan tier paid is stored and reported; a later PUT without tier keeps it", async () => {
		expect((await putProvider("etherscan", "k1", "paid")).etherscan).toEqual({
			keySet: true,
			tier: "paid",
		});
		expect((await putProvider("etherscan", "k2")).etherscan.tier).toBe("paid");
		expect((await putProvider("etherscan", "k3", "free")).etherscan.tier).toBe(
			"free",
		);
	});

	it.each(["blockscout", "alchemy", "nodereal", "coingecko"])(
		"tier on %s → 400",
		async (name) => {
			fail(
				await call("PUT", `/api/providers/${name}`, {
					json: { apiKey: "k", tier: "paid" },
				}),
				400,
				"validation_error",
			);
		},
	);

	it.each([
		["an empty key", { apiKey: "" }],
		["a blank key", { apiKey: "   " }],
		["no key", {}],
		["a bad tier", { apiKey: "k", tier: "gold" }],
		["an extra field", { apiKey: "k", note: 1 }],
	])("PUT with %s → 400", async (_, body) => {
		fail(await call("PUT", "/api/providers/etherscan", { json: body }), 400);
	});

	it("an unknown provider name → 400 or 404", async () => {
		const res = await call("PUT", "/api/providers/infura", {
			json: { apiKey: "k" },
		});
		expect([400, 404]).toContain(res.status);
		fail(res, res.status);
	});

	it.each(PROVIDERS)("DELETE %s → keySet false", async (name) => {
		const body = ok(
			await call("DELETE", `/api/providers/${name}`),
			200,
			api.ProvidersResponseSchema,
		);
		expect(body[name].keySet).toBe(false);
	});

	it("DELETE etherscan resets the tier to free", async () => {
		await putProvider("etherscan", "k", "paid");
		const body = ok(
			await call("DELETE", "/api/providers/etherscan"),
			200,
			api.ProvidersResponseSchema,
		);
		expect(body.etherscan).toEqual({ keySet: false, tier: "free" });
	});

	it("DELETE of a provider with no key is harmless", async () => {
		ok(
			await call("DELETE", "/api/providers/alchemy"),
			200,
			api.ProvidersResponseSchema,
		);
	});

	it("locked vault: PUT and DELETE → 423, GET still works", async () => {
		await putProvider("nodereal", KEYS.nodereal);
		ok(await call("POST", "/api/vault/lock"), 200, api.VaultStatusSchema);
		for (const name of PROVIDERS) {
			fail(
				await call("PUT", `/api/providers/${name}`, { json: { apiKey: "k" } }),
				423,
				"vault_locked",
			);
			fail(await call("DELETE", `/api/providers/${name}`), 423, "vault_locked");
		}
		expect((await providers()).nodereal.keySet).toBe(true);
		ok(
			await call("POST", "/api/vault/unlock", { json: { passphrase: PASS } }),
			200,
			api.VaultStatusSchema,
		);
	});
});

describe("connections CRUD and validation", () => {
	beforeAll(wipeP2);

	it("creates a Binance connection with keySet and null job ids; keys are never returned", async () => {
		const res = await call("POST", "/api/connections", {
			json: {
				kind: "binance",
				label: "Main Binance",
				apiKey: KEYS.binanceKey,
				apiSecret: KEYS.binanceSecret,
			},
		});
		const c = ok(res, 201, api.ConnectionSchema);
		expect(c).toMatchObject({
			kind: "binance",
			label: "Main Binance",
			options: {},
			keySet: true,
			lastSyncAt: null,
			lastSyncStatus: null,
			lastSyncError: null,
			running: false,
			runningJobId: null,
			lastSyncJobId: null,
		});
		expectNoSecrets(res.text, "POST /api/connections");
		expectNoSecrets((await call("GET", "/api/connections")).text, "GET");
	});

	it("a second Binance connection with the same key → 409", async () => {
		fail(
			await call("POST", "/api/connections", {
				json: {
					kind: "binance",
					label: "Again",
					apiKey: KEYS.binanceKey,
					apiSecret: "other",
				},
			}),
			409,
		);
	});

	it("creates CoinDCX", async () => {
		expect((await addCoindcx()).keySet).toBe(true);
	});

	it.each(CHAIN_IDS)(
		"creates EVM wallets A and B on chain %i, lower-casing the address",
		async (chainId) => {
			const a = await addEvm(
				WALLET_A.toUpperCase().replace("0X", "0x"),
				chainId,
			);
			expect(a).toMatchObject({ kind: "evm", chainId, address: WALLET_A });
			const b = await addEvm(WALLET_B, chainId);
			expect(b.address).toBe(WALLET_B);
		},
	);

	it("EVM without chainId defaults to Ethereum (1) — and is then a duplicate", async () => {
		fail(
			await call("POST", "/api/connections", {
				json: { kind: "evm", label: "x", address: WALLET_A },
			}),
			409,
		);
	});

	it("the same address on the same chain in another case → 409", async () => {
		fail(
			await call("POST", "/api/connections", {
				json: {
					kind: "evm",
					label: "dup",
					address: WALLET_B.toUpperCase().replace("0X", "0x"),
					chainId: 137,
				},
			}),
			409,
		);
	});

	it.each([
		["a short address", { kind: "evm", label: "x", address: "0x1234" }],
		[
			"a non-hex address",
			{ kind: "evm", label: "x", address: `0x${"g".repeat(40)}` },
		],
		["an ENS name", { kind: "evm", label: "x", address: "vitalik.eth" }],
		[
			"chainId 10 (Optimism)",
			{ kind: "evm", label: "x", address: WALLET_A, chainId: 10 },
		],
		[
			"chainId as a string",
			{ kind: "evm", label: "x", address: WALLET_A, chainId: "1" },
		],
		["no address", { kind: "evm", label: "x", chainId: 1 }],
		["no secret", { kind: "binance", label: "x", apiKey: "k" }],
		["no key", { kind: "coindcx", label: "x", apiSecret: "s" }],
		[
			"an unknown kind",
			{ kind: "kraken", label: "x", apiKey: "k", apiSecret: "s" },
		],
		[
			"an empty label",
			{ kind: "evm", label: " ", address: WALLET_A, chainId: 1 },
		],
		[
			"an extra field",
			{ kind: "evm", label: "x", address: WALLET_A, chainId: 1, owner: "me" },
		],
		[
			"bad extraSymbols",
			{
				kind: "binance",
				label: "x",
				apiKey: "k9",
				apiSecret: "s",
				options: { extraSymbols: ["eth-usdt"] },
			},
		],
		[
			"an unknown provider",
			{
				kind: "evm",
				label: "x",
				address: WALLET_A,
				chainId: 1,
				options: { providers: ["infura"] },
			},
		],
		[
			"an empty providers list",
			{
				kind: "evm",
				label: "x",
				address: WALLET_A,
				chainId: 1,
				options: { providers: [] },
			},
		],
	])("%s → 400", async (_, body) => {
		fail(await call("POST", "/api/connections", { json: body }), 400);
	});

	it("lists 12 connections (Binance, CoinDCX, 2 × 5 chains)", async () => {
		expect(await connections()).toHaveLength(12);
	});

	it("PATCH label and Binance extraSymbols", async () => {
		const bin = (await connections()).find((c) => c.kind === "binance");
		const patched = ok(
			await call("PATCH", `/api/connections/${bin?.id}`, {
				json: { label: "Renamed", options: { extraSymbols: ["BTCUSDT"] } },
			}),
			200,
			api.ConnectionSchema,
		);
		expect(patched).toMatchObject({
			label: "Renamed",
			options: { extraSymbols: ["BTCUSDT"] },
			keySet: true,
		});
	});

	it("PATCH an EVM connection's provider list; an apiKey on EVM → 400", async () => {
		const evm = (await connections()).find((c) => c.kind === "evm");
		expect(
			ok(
				await call("PATCH", `/api/connections/${evm?.id}`, {
					json: { options: { providers: ["blockscout"] } },
				}),
				200,
				api.ConnectionSchema,
			).options,
		).toEqual({ providers: ["blockscout"] });
		fail(
			await call("PATCH", `/api/connections/${evm?.id}`, {
				json: { apiKey: "k" },
			}),
			400,
		);
	});

	it("PATCH with an unknown field → 400; unknown id → 404", async () => {
		const bin = (await connections()).find((c) => c.kind === "binance");
		fail(
			await call("PATCH", `/api/connections/${bin?.id}`, {
				json: { kind: "evm" },
			}),
			400,
		);
		fail(
			await call(
				"PATCH",
				"/api/connections/00000000-0000-4000-8000-000000000000",
				{
					json: { label: "x" },
				},
			),
			404,
		);
	});

	it("PATCH another connection to an existing exchange key → 409", async () => {
		const dcx = (await connections()).find((c) => c.kind === "coindcx");
		const second = await createConnection({
			kind: "coindcx",
			label: "second",
			apiKey: "another-dcx-key",
			apiSecret: "another-secret",
		});
		fail(
			await call("PATCH", `/api/connections/${second.id}`, {
				json: { apiKey: KEYS.dcxKey },
			}),
			409,
		);
		expect((await call("DELETE", `/api/connections/${second.id}`)).status).toBe(
			204,
		);
		expect(dcx).toBeDefined();
	});

	it("DELETE → 204, then 404; GET /balances of a deleted id → 404", async () => {
		const evm = (await connections()).find((c) => c.kind === "evm");
		expect((await call("DELETE", `/api/connections/${evm?.id}`)).status).toBe(
			204,
		);
		fail(await call("DELETE", `/api/connections/${evm?.id}`), 404);
		fail(await call("GET", `/api/connections/${evm?.id}/balances`), 404);
		fail(await call("POST", `/api/connections/${evm?.id}/sync`), 404);
	});
});

describe("check key", () => {
	let bin = "";
	let dcx = "";
	beforeAll(async () => {
		await wipeP2();
		bin = (await addBinance()).id;
		dcx = (await addCoindcx()).id;
	});

	it("Binance read-only key → ok, readOnly true", async () => {
		const check = ok(
			await call("POST", `/api/connections/${bin}/check`),
			200,
			api.KeyCheckSchema,
		);
		expect(check).toMatchObject({ ok: true, readOnly: true });
	});

	it("trading_key scenario → ok:true, readOnly:false, with a trade permission listed", async () => {
		await scenario("trading_key");
		const res = await call("POST", `/api/connections/${bin}/check`);
		const check = ok(res, 200, api.KeyCheckSchema);
		expect(check).toMatchObject({ ok: true, readOnly: false });
		expect(check.permissions.join(" ")).toMatch(/Trading/i);
		await scenario("normal");
	});

	it("CoinDCX → readOnly:null with an explanatory message", async () => {
		const check = ok(
			await call("POST", `/api/connections/${dcx}/check`),
			200,
			api.KeyCheckSchema,
		);
		expect(check.readOnly).toBeNull();
		expect(check.message).toMatch(/read-only|IP/i);
	});

	it("bad_signature → 502 upstream_auth, with no secret in the message", async () => {
		await scenario("bad_signature");
		const res = await call("POST", `/api/connections/${bin}/check`);
		fail(res, 502, "upstream_auth");
		expectNoSecrets(res.text, "check error");
		expect(res.text).not.toMatch(/signature=[0-9a-f]{16}/);
		await scenario("normal");
	});

	it("a wrong CoinDCX secret → 502 upstream_auth", async () => {
		ok(
			await call("PATCH", `/api/connections/${dcx}`, {
				json: { apiSecret: "wrong-secret-value" },
			}),
			200,
			api.ConnectionSchema,
		);
		const res = await call("POST", `/api/connections/${dcx}/sync`);
		const job = await waitJob(api.JobStartedSchema.parse(res.body).jobId);
		expect(job.status).toBe("failed");
		expect(job.error ?? "").not.toContain("wrong-secret-value");
		ok(
			await call("PATCH", `/api/connections/${dcx}`, {
				json: { apiSecret: KEYS.dcxSecret },
			}),
			200,
			api.ConnectionSchema,
		);
	});
});

describe("provider_key_required and paid Etherscan", () => {
	beforeAll(wipeP2);

	it("no provider keys: an Ethereum sync → 409 provider_key_required with details", async () => {
		const c = await addEvm(WALLET_A, 1);
		const err = fail(
			await call("POST", `/api/connections/${c.id}/sync`),
			409,
			"provider_key_required",
		);
		expect(err?.details).toMatchObject({ chainId: 1 });
		expect((err?.details as { needs: string[] } | undefined)?.needs).toEqual(
			expect.arrayContaining(["etherscan"]),
		);
		expect(c.keySet).toBe(false);
	});

	it("Base with only a free Etherscan key → 409; needs names Alchemy, not free Etherscan", async () => {
		await putProvider("etherscan", KEYS.etherscan, "free");
		const c = await addEvm(WALLET_A, 8453);
		expect(c.keySet).toBe(false);
		const err = fail(
			await call("POST", `/api/connections/${c.id}/sync`),
			409,
			"provider_key_required",
		);
		const details = err?.details as { chainId: number; needs: string[] };
		expect(details.chainId).toBe(8453);
		expect(details.needs).toContain("alchemy");
		expect(details.needs).not.toContain("etherscan");
	});

	it("BSC with only a free Etherscan key → 409; needs names NodeReal", async () => {
		const c = await addEvm(WALLET_A, 56);
		const err = fail(
			await call("POST", `/api/connections/${c.id}/sync`),
			409,
			"provider_key_required",
		);
		const details = err?.details as { chainId: number; needs: string[] };
		expect(details.chainId).toBe(56);
		expect(details.needs).toContain("nodereal");
		expect(details.needs).not.toContain("etherscan");
	});

	it("a connection narrowed to a provider with no key → 409 even though Etherscan is set", async () => {
		const c = await addEvm(WALLET_B, 1);
		ok(
			await call("PATCH", `/api/connections/${c.id}`, {
				json: { options: { providers: ["blockscout"] } },
			}),
			200,
			api.ConnectionSchema,
		);
		fail(
			await call("POST", `/api/connections/${c.id}/sync`),
			409,
			"provider_key_required",
		);
	});

	it.each([8453, 56])(
		"paid Etherscan key + tier paid: chain %i syncs through Etherscan with zero balance differences",
		async (chainId) => {
			await putProvider("etherscan", KEYS.etherscanPaid, "paid");
			const c = (await connections()).find(
				(x) => x.chainId === chainId && x.address === WALLET_A,
			);
			expect(c?.keySet).toBe(true);
			await clearRequests();
			const summary = await syncOk(c?.id ?? "");
			const log = await requests();
			expect(
				log.some(
					(r) =>
						r.path === "/etherscan" && r.params.chainid === String(chainId),
				),
			).toBe(true);
			expect(log.some((r) => /alchemy|nodereal/.test(r.path))).toBe(false);
			expect(summary.balanceCheck.length).toBeGreaterThan(0);
			for (const row of summary.balanceCheck)
				expect(row.difference, row.asset).toBe("0");
		},
	);
});

describe("delete semantics and job ids", () => {
	let dcx = "";
	let firstJob = "";
	beforeAll(async () => {
		await wipeP2();
		await allProviders();
		dcx = (await addCoindcx()).id;
	});

	it("runningJobId is set while a sync runs; lastSyncJobId after it ends", async () => {
		firstJob = await startSync(dcx);
		const during = (await connections()).find((c) => c.id === dcx);
		expect(during).toMatchObject({ running: true, runningJobId: firstJob });
		const job = await waitJob(firstJob);
		expect(job.status).toBe("completed");
		const after = (await connections()).find((c) => c.id === dcx);
		expect(after).toMatchObject({
			running: false,
			runningJobId: null,
			lastSyncJobId: firstJob,
			lastSyncStatus: "completed",
			lastSyncError: null,
		});
		expect(after?.lastSyncAt).not.toBeNull();
	});

	it("while running: second sync → 409 sync_running; PATCH and DELETE → 409", async () => {
		const job = await startSync(dcx);
		fail(
			await call("POST", `/api/connections/${dcx}/sync`),
			409,
			"sync_running",
		);
		fail(
			await call("PATCH", `/api/connections/${dcx}`, { json: { label: "x" } }),
			409,
			"sync_running",
		);
		fail(await call("DELETE", `/api/connections/${dcx}`), 409, "sync_running");
		await waitJob(job);
		expect((await connections()).find((c) => c.id === dcx)?.lastSyncJobId).toBe(
			job,
		);
	});

	it("GET /api/jobs of an unknown id → 404", async () => {
		fail(
			await call("GET", "/api/jobs/00000000-0000-4000-8000-000000000000"),
			404,
		);
	});

	it("delete removes secrets, cursors and fetched balances but keeps sync imports and ledger rows", async () => {
		expect(
			Number(db(`select count(*) from secrets where id like 'conn:${dcx}:%'`)),
		).toBe(2);
		expect(
			Number(
				db(`select count(*) from sync_cursors where connection_id='${dcx}'`),
			),
		).toBeGreaterThan(0);
		expect(
			Number(
				db(
					`select count(*) from fetched_balances where connection_id='${dcx}'`,
				),
			),
		).toBeGreaterThan(0);
		expect((await call("DELETE", `/api/connections/${dcx}`)).status).toBe(204);
		expect(
			Number(db(`select count(*) from secrets where id like 'conn:${dcx}:%'`)),
		).toBe(0);
		expect(
			Number(
				db(`select count(*) from sync_cursors where connection_id='${dcx}'`),
			),
		).toBe(0);
		expect(
			Number(
				db(
					`select count(*) from fetched_balances where connection_id='${dcx}'`,
				),
			),
		).toBe(0);
		const imports = ok(
			await call("GET", "/api/imports"),
			200,
			api.ListImportsResponseSchema,
		);
		expect(imports.filter((i) => i.kind === "api_sync")).toHaveLength(2);
		const tx = ok(
			await call("GET", "/api/transactions?source=coindcx-api"),
			200,
			api.ListTransactionsResponseSchema,
		);
		expect(tx.total).toBe(4);
		expect(
			Number(db("select count(*) from secrets where id like 'provider:%'")),
		).toBe(5);
	});

	it("the finished job is still readable after its connection is deleted", async () => {
		const job = ok(
			await call("GET", `/api/jobs/${firstJob}`),
			200,
			api.JobSchema,
		);
		expect(job.status).toBe("completed");
	});

	it("re-adding the same CoinDCX key syncs again without duplicating the ledger", async () => {
		const again = await addCoindcx();
		const summary = await syncOk(again.id);
		expect(summary.streams[0]).toMatchObject({
			rowsFetched: 4,
			rowsInserted: 0,
		});
		const tx = ok(
			await call("GET", "/api/transactions?source=coindcx-api"),
			200,
			api.ListTransactionsResponseSchema,
		);
		expect(tx.total).toBe(4);
	});
});

describe("sync job rejects", () => {
	beforeAll(wipeP2);
	it("an unknown connection id → 404", async () => {
		fail(await call("POST", "/api/connections/nope/sync"), 404);
		fail(await call("POST", "/api/connections/nope/check"), 404);
	});
	it("a failed sync records lastSyncStatus failed and an error string", async () => {
		const bin = await addBinance();
		await scenario("bad_signature");
		const job = await sync(bin.id);
		await scenario("normal");
		expect(job.status).toBe("failed");
		const c = (await connections()).find((x) => x.id === bin.id);
		expect(c).toMatchObject({
			lastSyncStatus: "failed",
			lastSyncJobId: job.id,
		});
		expect(c?.lastSyncError).toBeTruthy();
	});
});
