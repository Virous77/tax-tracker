import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allTx, BASE_URL } from "./lib";
import {
	addBinance,
	addCoindcx,
	addEvm,
	allProviders,
	api,
	call,
	clearRequests,
	connections,
	dockerLogs,
	expectNoSecrets,
	fail,
	KEYS,
	ok,
	PASS,
	requests,
	SECRETS,
	scenario,
	sync,
	syncOk,
	WALLET_A,
	wipeP2,
} from "./p2";
import { restartStack } from "./stack";

const UUID = "00000000-0000-4000-8000-000000000000";

describe("no secret leaves the app", () => {
	beforeAll(async () => {
		await wipeP2();
		await clearRequests();
		await allProviders();
		const bin = await addBinance();
		const dcx = await addCoindcx();
		ok(
			await call("POST", `/api/connections/${bin.id}/check`),
			200,
			api.KeyCheckSchema,
		);
		for (const chain of [1, 8453, 56])
			await syncOk((await addEvm(WALLET_A, chain)).id);
		await syncOk(dcx.id);
		await scenario("bad_signature");
		await sync(bin.id);
		await scenario("ban_418");
		await sync(bin.id);
		await scenario("normal");
		ok(
			await call("PUT", "/api/settings", {
				json: { prices: { enabled: true } },
			}),
			200,
			api.PutSettingsResponseSchema,
		);
		ok(
			await call("POST", "/api/prices/fill", { json: { taxYear: "2025-26" } }),
			202,
			api.JobStartedSchema,
		);
		await new Promise((r) => setTimeout(r, 4000));
	}, 300_000);

	it.each([
		"/api/vault",
		"/api/providers",
		"/api/connections",
		"/api/imports",
		"/api/review",
		"/api/settings",
		"/api/balances/snapshots",
		"/api/prices/status?taxYear=2025-26",
	])("GET %s contains no key, secret or passphrase", async (path) => {
		expectNoSecrets((await call("GET", path)).text, path);
	});

	it("every job (results and errors) is clean", async () => {
		for (const c of await connections()) {
			const res = await call("GET", `/api/jobs/${c.lastSyncJobId}`);
			expect(res.status).toBe(200);
			expectNoSecrets(res.text, `job of ${c.label}`);
			expect(res.text).not.toMatch(
				/signature=[0-9a-f]{16}|X-MBX-APIKEY|apikey=/i,
			);
		}
	});

	it("every import detail and the whole ledger (raw rows included) are clean", async () => {
		const imports = ok(
			await call("GET", "/api/imports"),
			200,
			api.ListImportsResponseSchema,
		);
		for (const i of imports)
			expectNoSecrets(
				(await call("GET", `/api/imports/${i.id}`)).text,
				i.fileName,
			);
		expectNoSecrets(JSON.stringify(await allTx()), "transactions");
	});

	it("failed sync errors carry the vendor meaning without request details", async () => {
		const bin = (await connections()).find((c) => c.kind === "binance");
		expect(bin?.lastSyncError).toBeTruthy();
		expect(bin?.lastSyncError).not.toMatch(
			/timestamp=|signature|recvWindow|https?:\/\/|\?\w+=/,
		);
	});

	it("the mock's request log: keys appear only in redacted slots", async () => {
		const log = await requests();
		expect(log.length).toBeGreaterThan(10);
		const text = JSON.stringify(log);
		for (const s of SECRETS) expect(text.includes(s), s).toBe(false);
		for (const r of log) {
			for (const [k, v] of Object.entries(r.params))
				if (/key|secret|signature|token/i.test(k))
					expect(v, `${r.path} ${k}`).toBe("***");
			if (r.path.startsWith("/alchemy/"))
				expect(r.path).toMatch(/\/v2\/\*\*\*$/);
			if (r.path.startsWith("/nodereal/")) expect(r.path).toBe("/nodereal/***");
			if (r.path.startsWith("/coingecko"))
				expect(r.params.x_cg_demo_api_key).toBeUndefined();
		}
	});

	it("docker logs contain no key, secret, passphrase, signed query or provider key path", () => {
		const logs = dockerLogs();
		for (const s of SECRETS) expect(logs.includes(s), s).toBe(false);
		expect(logs).not.toMatch(
			/signature=|apikey=|x-mbx-apikey|X-AUTH-SIGNATURE/i,
		);
		expect(logs).not.toMatch(/\/v2\/mock-|\/nodereal\/mock-/);
	});
});

describe("origin checks on Phase 2 mutations", () => {
	let id = "";
	beforeAll(async () => {
		await wipeP2();
		id = (await addEvm(WALLET_A, 1)).id;
	});
	const routes = (): [string, string, unknown][] => [
		["POST", "/api/vault/setup", { passphrase: PASS }],
		["POST", "/api/vault/unlock", { passphrase: PASS }],
		["POST", "/api/vault/lock", {}],
		["POST", "/api/vault/change-passphrase", { current: PASS, next: PASS }],
		["POST", "/api/vault/reset", { confirm: "RESET" }],
		["PUT", "/api/providers/etherscan", { apiKey: "evil" }],
		["DELETE", "/api/providers/etherscan", undefined],
		[
			"POST",
			"/api/connections",
			{
				kind: "evm",
				label: "evil",
				address: `0x${"1".repeat(40)}`,
				chainId: 1,
			},
		],
		["PATCH", `/api/connections/${id}`, { label: "evil" }],
		["DELETE", `/api/connections/${id}`, undefined],
		["POST", `/api/connections/${id}/check`, {}],
		["POST", `/api/connections/${id}/sync`, {}],
		["POST", "/api/prices/fill", { taxYear: "2025-26" }],
		["POST", `/api/balances/snapshots/${UUID}/apply`, { taxYear: "2025-26" }],
	];
	it("a cross-origin request is refused (403 forbidden) on every route, and nothing changes", async () => {
		for (const [method, path, json] of routes()) {
			const res = await call(method, path, {
				...(json === undefined ? {} : { json }),
				headers: { origin: "http://evil.example" },
			});
			fail(res, 403, "forbidden");
		}
		expect((await call("GET", "/api/vault")).body).toMatchObject({
			initialized: true,
			unlocked: true,
		});
		expect((await connections()).map((c) => c.id)).toEqual([id]);
		expect((await connections())[0]?.label).not.toBe("evil");
	});
	it("the same requests from the app's own origin are not refused for origin reasons", async () => {
		const res = await call("POST", "/api/vault/lock", {
			headers: { origin: new URL(BASE_URL).origin },
		});
		expect(res.status).toBe(200);
		ok(
			await call("POST", "/api/vault/unlock", {
				json: { passphrase: PASS },
				headers: { origin: new URL(BASE_URL).origin },
			}),
			200,
			api.VaultStatusSchema,
		);
	});
});

describe("APP_PASSWORD covers the Phase 2 endpoints", () => {
	const PASSWORD = "app password for phase two";
	let cookie = "";
	beforeAll(async () => {
		await restartStack({ APP_PASSWORD: PASSWORD });
	}, 180_000);
	afterAll(async () => {
		await restartStack({});
	}, 180_000);

	it.each([
		["GET", "/api/vault"],
		["POST", "/api/vault/setup"],
		["POST", "/api/vault/unlock"],
		["POST", "/api/vault/lock"],
		["POST", "/api/vault/change-passphrase"],
		["POST", "/api/vault/reset"],
		["GET", "/api/providers"],
		["PUT", "/api/providers/etherscan"],
		["DELETE", "/api/providers/coingecko"],
		["GET", "/api/connections"],
		["POST", "/api/connections"],
		["PATCH", `/api/connections/${UUID}`],
		["DELETE", `/api/connections/${UUID}`],
		["POST", `/api/connections/${UUID}/check`],
		["POST", `/api/connections/${UUID}/sync`],
		["GET", `/api/connections/${UUID}/balances`],
		["GET", `/api/jobs/${UUID}`],
		["GET", "/api/prices/status?taxYear=2025-26"],
		["POST", "/api/prices/fill"],
		["GET", "/api/balances/snapshots"],
		["POST", `/api/balances/snapshots/${UUID}/apply`],
	])("%s %s → 401 without a session", async (method, path) => {
		fail(
			await call(
				method,
				path,
				method === "GET" || method === "DELETE" ? {} : { json: {} },
			),
			401,
			"unauthorized",
		);
	});

	it("with a session the vault works; logout locks it", async () => {
		const res = await call("POST", "/api/auth/login", {
			json: { password: PASSWORD },
		});
		expect(res.status).toBe(200);
		cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		const headers = { cookie };
		ok(
			await call("POST", "/api/vault/setup", {
				json: { passphrase: PASS },
				headers,
			}),
			200,
			api.VaultStatusSchema,
		);
		ok(
			await call("PUT", "/api/providers/etherscan", {
				json: { apiKey: KEYS.etherscan },
				headers,
			}),
			200,
			api.ProvidersResponseSchema,
		);
		expect(await call("POST", "/api/auth/logout", { headers })).toMatchObject({
			status: expect.any(Number),
		});
		const again = await call("POST", "/api/auth/login", {
			json: { password: PASSWORD },
		});
		const next = {
			cookie: (again.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
		};
		const status = ok(
			await call("GET", "/api/vault", { headers: next }),
			200,
			api.VaultStatusSchema,
		);
		expect(status).toMatchObject({ initialized: true, unlocked: false });
	});
});
