import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	addCoindcx,
	api,
	call,
	connections,
	expectNoSecrets,
	fail,
	KEYS,
	ok,
	PASS,
	providers,
	putProvider,
	restartSameData,
	syncOk,
	vaultStatus,
	wipeP2,
} from "./p2";
import { restartStack } from "./stack";

const NEXT = "a different long passphrase";
const status = (res: Awaited<ReturnType<typeof call>>, code = 200) =>
	ok(res, code, api.VaultStatusSchema);

describe("vault state machine", () => {
	beforeAll(async () => {
		await wipeP2();
		status(
			await call("POST", "/api/vault/reset", { json: { confirm: "RESET" } }),
		);
	});

	it("starts not initialized, locked, no auto-unlock, 30 minute idle lock", async () => {
		expect(await vaultStatus()).toEqual({
			initialized: false,
			unlocked: false,
			autoUnlock: false,
			idleLockMinutes: 30,
		});
	});

	it("unlock before setup → 409 vault_not_initialized", async () => {
		fail(
			await call("POST", "/api/vault/unlock", { json: { passphrase: PASS } }),
			409,
			"vault_not_initialized",
		);
	});

	it("change-passphrase before setup → 409 vault_not_initialized", async () => {
		fail(
			await call("POST", "/api/vault/change-passphrase", {
				json: { current: PASS, next: NEXT },
			}),
			409,
			"vault_not_initialized",
		);
	});

	it("an exchange connection before setup → 409 vault_not_initialized", async () => {
		fail(
			await call("POST", "/api/connections", {
				json: {
					kind: "coindcx",
					label: "x",
					apiKey: KEYS.dcxKey,
					apiSecret: KEYS.dcxSecret,
				},
			}),
			409,
			"vault_not_initialized",
		);
	});

	it.each([
		["short", { passphrase: "eleven char" }],
		["missing", {}],
		["extra field", { passphrase: PASS, hint: "x" }],
		["not a string", { passphrase: 123456789012 }],
	])("setup with a %s passphrase → 400", async (_, body) => {
		fail(await call("POST", "/api/vault/setup", { json: body }), 400);
		expect((await vaultStatus()).initialized).toBe(false);
	});

	it("setup with 12+ characters → initialized and unlocked; the passphrase is not echoed", async () => {
		const res = await call("POST", "/api/vault/setup", {
			json: { passphrase: PASS },
		});
		expect(status(res)).toMatchObject({ initialized: true, unlocked: true });
		expect(res.text).not.toContain(PASS);
	});

	it("setup again → 409, and the passphrase is unchanged", async () => {
		fail(
			await call("POST", "/api/vault/setup", { json: { passphrase: NEXT } }),
			409,
		);
		status(await call("POST", "/api/vault/lock"));
		fail(
			await call("POST", "/api/vault/unlock", { json: { passphrase: NEXT } }),
			401,
			"wrong_passphrase",
		);
		status(
			await call("POST", "/api/vault/unlock", { json: { passphrase: PASS } }),
		);
	});

	it("unlock with a wrong passphrase → 401 wrong_passphrase and stays locked", async () => {
		status(await call("POST", "/api/vault/lock"));
		const res = await call("POST", "/api/vault/unlock", {
			json: { passphrase: "wrong wrong wrong" },
		});
		fail(res, 401, "wrong_passphrase");
		expect(res.text).not.toContain("wrong wrong wrong");
		expect((await vaultStatus()).unlocked).toBe(false);
	});

	it("unlock is idempotent while unlocked", async () => {
		status(
			await call("POST", "/api/vault/unlock", { json: { passphrase: PASS } }),
		);
		expect(
			status(
				await call("POST", "/api/vault/unlock", { json: { passphrase: PASS } }),
			).unlocked,
		).toBe(true);
	});

	describe("locked vault blocks every key-needing call with 423 vault_locked", () => {
		let dcx = "";
		beforeAll(async () => {
			dcx = (await addCoindcx()).id;
			await putProvider("etherscan", KEYS.etherscan);
			expect(status(await call("POST", "/api/vault/lock")).unlocked).toBe(
				false,
			);
		});
		afterAll(async () => {
			status(
				await call("POST", "/api/vault/unlock", { json: { passphrase: PASS } }),
			);
		});

		it("lock twice is fine", async () => {
			expect(status(await call("POST", "/api/vault/lock")).unlocked).toBe(
				false,
			);
		});
		it("PUT /api/providers/etherscan → 423", async () => {
			fail(
				await call("PUT", "/api/providers/etherscan", {
					json: { apiKey: "another" },
				}),
				423,
				"vault_locked",
			);
		});
		it("DELETE /api/providers/etherscan → 423 and the key stays", async () => {
			fail(
				await call("DELETE", "/api/providers/etherscan"),
				423,
				"vault_locked",
			);
			expect((await providers()).etherscan.keySet).toBe(true);
		});
		it("POST /api/connections (exchange) → 423", async () => {
			fail(
				await call("POST", "/api/connections", {
					json: {
						kind: "binance",
						label: "b",
						apiKey: KEYS.binanceKey,
						apiSecret: KEYS.binanceSecret,
					},
				}),
				423,
				"vault_locked",
			);
		});
		it("PATCH a connection's key → 423", async () => {
			fail(
				await call("PATCH", `/api/connections/${dcx}`, {
					json: { apiSecret: "x" },
				}),
				423,
				"vault_locked",
			);
		});
		it("POST /check → 423", async () => {
			fail(
				await call("POST", `/api/connections/${dcx}/check`),
				423,
				"vault_locked",
			);
		});
		it("POST /sync → 423 and no job is started", async () => {
			fail(
				await call("POST", `/api/connections/${dcx}/sync`),
				423,
				"vault_locked",
			);
			const [c] = await connections();
			expect(c).toMatchObject({ running: false, runningJobId: null });
		});
		it("reads still work: GET providers, connections; keySet is still true", async () => {
			expect((await providers()).etherscan.keySet).toBe(true);
			expect((await connections())[0]?.keySet).toBe(true);
		});
		it("EVM address connections need no vault", async () => {
			ok(
				await call("POST", "/api/connections", {
					json: {
						kind: "evm",
						label: "watch",
						address: "0x5a17c9e3b4d28f6019ca7b3e5d8f2a4c6b1e9d70",
						chainId: 1,
					},
				}),
				201,
				api.ConnectionSchema,
			);
		});
	});

	describe("change passphrase", () => {
		it.each([
			["a wrong current", { current: "nope nope nope", next: NEXT }, 401],
			["a short next", { current: PASS, next: "short" }, 400],
			["a missing field", { current: PASS }, 400],
		])("with %s → %i", async (_, body, code) => {
			fail(
				await call("POST", "/api/vault/change-passphrase", { json: body }),
				code,
			);
		});

		it("succeeds while locked? only with the right current passphrase", async () => {
			status(await call("POST", "/api/vault/lock"));
			const res = await call("POST", "/api/vault/change-passphrase", {
				json: { current: PASS, next: NEXT },
			});
			expect([200, 423]).toContain(res.status);
			if (res.status === 423) {
				status(
					await call("POST", "/api/vault/unlock", {
						json: { passphrase: PASS },
					}),
				);
				status(
					await call("POST", "/api/vault/change-passphrase", {
						json: { current: PASS, next: NEXT },
					}),
				);
			}
			expect(res.text).not.toContain(NEXT);
		});

		it("the old passphrase fails and the new one works", async () => {
			status(await call("POST", "/api/vault/lock"));
			fail(
				await call("POST", "/api/vault/unlock", { json: { passphrase: PASS } }),
				401,
				"wrong_passphrase",
			);
			status(
				await call("POST", "/api/vault/unlock", { json: { passphrase: NEXT } }),
			);
		});

		it("stored exchange keys still decrypt: a CoinDCX sync completes", async () => {
			const dcx = (await connections()).find((c) => c.kind === "coindcx");
			const summary = await syncOk(dcx?.id ?? "");
			expect(summary.streams[0]?.rowsInserted).toBe(4);
		});

		it("change back so later files can use PASS", async () => {
			status(
				await call("POST", "/api/vault/change-passphrase", {
					json: { current: NEXT, next: PASS },
				}),
			);
		});
	});

	describe("reset", () => {
		it.each([
			["an empty body", {}],
			["lower-case confirm", { confirm: "reset" }],
			["an extra field", { confirm: "RESET", really: true }],
			["a wrong word", { confirm: "YES" }],
		])("with %s → 400, nothing deleted", async (_, body) => {
			fail(await call("POST", "/api/vault/reset", { json: body }), 400);
			expect((await vaultStatus()).initialized).toBe(true);
			expect((await providers()).etherscan.keySet).toBe(true);
		});

		it('exactly {confirm:"RESET"} → not initialized; connections remain with keySet:false', async () => {
			const before = await connections();
			expect(
				status(
					await call("POST", "/api/vault/reset", {
						json: { confirm: "RESET" },
					}),
				),
			).toMatchObject({ initialized: false, unlocked: false });
			const after = await connections();
			expect(after.map((c) => c.id).sort()).toEqual(
				before.map((c) => c.id).sort(),
			);
			for (const c of after) expect(c.keySet, c.label).toBe(false);
			const p = await providers();
			for (const v of Object.values(p)) expect(v.keySet).toBe(false);
		});

		it("ledger history is kept after reset", async () => {
			const tx = ok(
				await call("GET", "/api/transactions?source=coindcx-api"),
				200,
				api.ListTransactionsResponseSchema,
			);
			expect(tx.total).toBe(4);
		});

		it("syncing an exchange after reset → 409 vault_not_initialized", async () => {
			const dcx = (await connections()).find((c) => c.kind === "coindcx");
			fail(
				await call("POST", `/api/connections/${dcx?.id}/sync`),
				409,
				"vault_not_initialized",
			);
		});

		it("set up again, re-enter the key with PATCH, sync works (0 new rows)", async () => {
			status(
				await call("POST", "/api/vault/setup", { json: { passphrase: PASS } }),
			);
			const dcx = (await connections()).find((c) => c.kind === "coindcx");
			const patched = ok(
				await call("PATCH", `/api/connections/${dcx?.id}`, {
					json: { apiKey: KEYS.dcxKey, apiSecret: KEYS.dcxSecret },
				}),
				200,
				api.ConnectionSchema,
			);
			expect(patched.keySet).toBe(true);
			const summary = await syncOk(dcx?.id ?? "");
			expect(summary.streams[0]?.rowsInserted).toBe(0);
		});
	});
});

describe("restart and SECRETS_PASSPHRASE", () => {
	let dcx = "";
	beforeAll(async () => {
		await wipeP2();
		dcx = (await addCoindcx()).id;
		await putProvider("etherscan", KEYS.etherscan);
	});
	afterAll(async () => {
		await restartStack({});
	}, 180_000);

	it("after a restart the vault is locked and keys survive", async () => {
		await restartSameData();
		expect(await vaultStatus()).toMatchObject({
			initialized: true,
			unlocked: false,
			autoUnlock: false,
		});
		expect((await connections()).find((c) => c.id === dcx)?.keySet).toBe(true);
		expect((await providers()).etherscan.keySet).toBe(true);
		fail(
			await call("POST", `/api/connections/${dcx}/sync`),
			423,
			"vault_locked",
		);
		status(
			await call("POST", "/api/vault/unlock", { json: { passphrase: PASS } }),
		);
		expect((await syncOk(dcx)).streams[0]?.rowsInserted).toBe(4);
	}, 180_000);

	it("SECRETS_PASSPHRASE auto-unlocks an existing vault at boot", async () => {
		await restartSameData({ SECRETS_PASSPHRASE: PASS });
		expect(await vaultStatus()).toMatchObject({
			initialized: true,
			unlocked: true,
			autoUnlock: true,
		});
		expect((await syncOk(dcx)).streams[0]?.rowsInserted).toBe(0);
	}, 180_000);

	it("a wrong SECRETS_PASSPHRASE leaves the vault locked (and says autoUnlock)", async () => {
		await restartSameData({ SECRETS_PASSPHRASE: "not the passphrase" });
		expect(await vaultStatus()).toMatchObject({
			initialized: true,
			unlocked: false,
			autoUnlock: true,
		});
		status(
			await call("POST", "/api/vault/unlock", { json: { passphrase: PASS } }),
		);
	}, 180_000);

	it("SECRETS_PASSPHRASE sets up the vault on first boot", async () => {
		await restartStack({ SECRETS_PASSPHRASE: PASS });
		expect(await vaultStatus()).toMatchObject({
			initialized: true,
			unlocked: true,
			autoUnlock: true,
		});
		const c = await addCoindcx();
		expect(c.keySet).toBe(true);
	}, 180_000);

	it("the env passphrase never appears in any vault response", async () => {
		const res = await call("GET", "/api/vault");
		expectNoSecrets(res.text, "GET /api/vault");
	});
});
