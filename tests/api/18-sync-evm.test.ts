import { beforeAll, describe, expect, it } from "vitest";
import { allTx } from "./lib";
import {
	addEvm,
	allProviders,
	api,
	balances,
	call,
	clearRequests,
	connections,
	createConnection,
	expectNoSecrets,
	ok,
	requests,
	SYNC_TIMEOUT,
	scenario,
	streamTotals,
	syncOk,
	WALLET_A,
	WALLET_B,
	wipeP2,
} from "./p2";

type Wallet = "A" | "B";
const ADDRESS: Record<Wallet, string> = { A: WALLET_A, B: WALLET_B };
/** tools/mock-sync/README "Expected final balances"; spam is excluded on both sides. */
const EXPECTED: [number, Wallet, Record<string, string>][] = [
	[1, "A", { ETH: "0.2975746985", USDC: "180" }],
	[1, "B", { ETH: "0.0097306", USDC: "180" }],
	[8453, "A", { ETH: "0.0129985655095", USDC: "12.5" }],
	[8453, "B", {}],
	[42161, "A", { ETH: "0.0134975", USDC: "30", "USDC.E": "50" }],
	[42161, "B", {}],
	[137, "A", {}],
	[137, "B", { POL: "12.99874" }],
	[56, "A", { BNB: "0.049847", USDT: "225" }],
	[56, "B", {}],
];
const ids = new Map<string, string>();
const key = (chain: number, wallet: Wallet) => `${chain}:${wallet}`;
const summaries = new Map<string, api.SyncSummary>();

async function deleteConnectionAndImports(id: string) {
	const imports = ok(
		await call("GET", "/api/imports"),
		200,
		api.ListImportsResponseSchema,
	);
	expect((await call("DELETE", `/api/connections/${id}`)).status).toBe(204);
	for (const i of imports.filter((i) => i.connectionId === id))
		expect((await call("DELETE", `/api/imports/${i.id}`)).status).toBe(204);
}

describe("EVM sync on all five chains", () => {
	beforeAll(async () => {
		await wipeP2();
		await allProviders();
		for (const [chain, wallet] of EXPECTED)
			ids.set(
				key(chain, wallet),
				(await addEvm(ADDRESS[wallet], chain, `${wallet}@${chain}`)).id,
			);
		await clearRequests();
		for (const [chain, wallet] of EXPECTED)
			summaries.set(
				key(chain, wallet),
				await syncOk(ids.get(key(chain, wallet)) ?? ""),
			);
	}, SYNC_TIMEOUT);

	it.each(EXPECTED)(
		"chain %i wallet %s: fetched balances match the README and every difference is zero",
		async (chain, wallet, expected) => {
			const res = await balances(ids.get(key(chain, wallet)) ?? "");
			expect(res.fetchedAt).not.toBeNull();
			const fetched = Object.fromEntries(
				res.rows
					.filter((r) => r.fetched !== "0")
					.map((r) => [r.asset, r.fetched]),
			);
			expect(fetched).toEqual(expected);
			for (const row of res.rows)
				expect(row, row.asset).toMatchObject({
					difference: "0",
					flagged: false,
				});
		},
	);

	it.each(EXPECTED)(
		"chain %i wallet %s: the sync summary's balance check agrees",
		(chain, wallet) => {
			const s = summaries.get(key(chain, wallet));
			for (const row of s?.balanceCheck ?? [])
				expect(row.difference, row.asset).toBe("0");
		},
	);

	it("each sync writes an api_sync import with source evm:<chainId>", async () => {
		const imports = ok(
			await call("GET", "/api/imports"),
			200,
			api.ListImportsResponseSchema,
		);
		for (const [chain, wallet] of EXPECTED) {
			const imp = imports.find(
				(i) => i.connectionId === ids.get(key(chain, wallet)),
			);
			expect(imp, key(chain, wallet)).toMatchObject({
				kind: "api_sync",
				source: `evm:${chain}`,
				status: "imported",
			});
		}
	});

	it("rows are stored once with unique sourceRefs and a lower-case txHash", async () => {
		const tx = (await allTx()).filter((t) => t.source.startsWith("evm:"));
		expect(tx.length).toBeGreaterThan(20);
		expect(new Set(tx.map((t) => `${t.source}|${t.sourceRef}`)).size).toBe(
			tx.length,
		);
		for (const t of tx)
			if (t.txHash) expect(t.txHash).toBe(t.txHash.toLowerCase());
	});

	it("the request log never carries a provider key in clear text; Blockscout keys are not in the query", async () => {
		const log = await requests();
		expectNoSecrets(JSON.stringify(log), "/__requests");
		for (const r of log.filter((r) => r.path.startsWith("/blockscout")))
			expect(r.params.apikey ?? "***").toBe("***");
	});

	it.each([
		[8453, "/alchemy/base-mainnet/v2/"],
		[56, "/nodereal/"],
	])("chain %i uses its preferred provider (%s)", async (chain, prefix) => {
		await clearRequests();
		await syncOk(ids.get(key(chain, "A")) ?? "");
		const log = await requests();
		expect(log.some((r) => r.path.startsWith(prefix))).toBe(true);
		expect(log.some((r) => r.path.startsWith("/etherscan"))).toBe(false);
	});

	it.each(EXPECTED)(
		"re-sync of chain %i wallet %s inserts nothing",
		async (chain, wallet) => {
			const s = await syncOk(ids.get(key(chain, wallet)) ?? "");
			expect(streamTotals(s).inserted).toBe(0);
		},
		SYNC_TIMEOUT,
	);

	describe("mock scenarios on a mainnet re-sync", () => {
		it.each([
			["etherscan_rate_limit_200", null],
			["rate_limit_once", 429],
			["upstream_500_once", 500],
		] as const)(
			"%s: recovers and completes",
			async (name, status) => {
				await scenario(name);
				await clearRequests();
				const s = await syncOk(ids.get(key(1, "A")) ?? "");
				expect(streamTotals(s).inserted).toBe(0);
				if (status)
					expect((await requests()).some((r) => r.status === status)).toBe(
						true,
					);
				const ctl = await (
					await fetch(
						`http://localhost:${process.env.MOCK_SYNC_PORT ?? 11601}/__control`,
					)
				).json();
				expect(ctl.scenario).toBe("normal");
				for (const row of s.balanceCheck) expect(row.difference).toBe("0");
			},
			SYNC_TIMEOUT,
		);
	});

	describe("drift", () => {
		it(
			"wallet B's extra 0.5 USDC → balance_mismatch with difference 0.5",
			async () => {
				await scenario("drift");
				const id = ids.get(key(1, "B")) ?? "";
				const s = await syncOk(id);
				await scenario("normal");
				expect(s.balanceCheck.find((r) => r.asset === "USDC")).toMatchObject({
					fetched: "180.5",
					computed: "180",
					difference: "0.5",
				});
				expect(s.notices.join("\n")).toMatch(/USDC.*difference 0\.5/);
				const row = (await balances(id)).rows.find((r) => r.asset === "USDC");
				expect(row).toMatchObject({ difference: "0.5", flagged: true });
				const detail = ok(
					await call("GET", `/api/imports/${s.importId}`),
					200,
					api.GetImportResponseSchema,
				);
				expect(detail.warnings).toContainEqual(
					expect.objectContaining({ code: "balance_mismatch" }),
				);
			},
			SYNC_TIMEOUT,
		);

		it(
			"only that asset drifts; a normal re-sync clears it",
			async () => {
				const id = ids.get(key(1, "B")) ?? "";
				const s = await syncOk(id);
				for (const row of s.balanceCheck)
					expect(row.difference, row.asset).toBe("0");
			},
			SYNC_TIMEOUT,
		);
	});

	describe("provider choice does not change identities", () => {
		it(
			"wallet B on mainnet re-added with Alchemy only: same rows (0 inserted), zero differences",
			async () => {
				await deleteConnectionAndImports(ids.get(key(1, "B")) ?? "");
				const before = (await allTx({ source: "evm:1" })).length;
				const legacy = (await allTx({ source: "evm:1" })).filter((t) =>
					t.sourceRef.includes(WALLET_B),
				).length;
				expect(legacy).toBe(0);
				const c = await createConnection({
					kind: "evm",
					label: "B@1 alchemy",
					address: WALLET_B,
					chainId: 1,
					options: { providers: ["alchemy"] },
				});
				ids.set(key(1, "B"), c.id);
				await clearRequests();
				const s = await syncOk(c.id);
				const log = await requests();
				expect(
					log.some((r) => r.path.startsWith("/alchemy/eth-mainnet/v2/")),
				).toBe(true);
				expect(log.some((r) => r.path.startsWith("/etherscan"))).toBe(false);
				expect(streamTotals(s).inserted).toBe(3);
				expect((await allTx({ source: "evm:1" })).length).toBe(before + 3);
				for (const row of s.balanceCheck)
					expect(row.difference, row.asset).toBe("0");
			},
			SYNC_TIMEOUT,
		);

		it(
			"Arbitrum through Alchemy alone is marked incomplete (internal transfers are not exposed)",
			async () => {
				await deleteConnectionAndImports(ids.get(key(42161, "A")) ?? "");
				const c = await createConnection({
					kind: "evm",
					label: "A@42161 alchemy",
					address: WALLET_A,
					chainId: 42161,
					options: { providers: ["alchemy"] },
				});
				const s = await syncOk(c.id);
				expect(s.balanceCheck).toEqual([]);
				expect(s.notices).toContainEqual(
					expect.stringMatching(/balance check skipped/i),
				);
				expect(
					s.streams.some((st) => /internal/i.test(st.incomplete ?? "")),
				).toBe(true);
				expect(
					(await connections()).find((x) => x.id === c.id)?.lastSyncStatus,
				).toBe("incomplete");
			},
			SYNC_TIMEOUT,
		);
	});

	describe("empty and big_history on a fresh mainnet wallet A", () => {
		it(
			"empty: zero rows, zero balances, no differences",
			async () => {
				await deleteConnectionAndImports(ids.get(key(1, "A")) ?? "");
				const c = await addEvm(WALLET_A, 1, "A@1 empty");
				ids.set(key(1, "A"), c.id);
				await scenario("empty");
				const s = await syncOk(c.id);
				await scenario("normal");
				expect(streamTotals(s).inserted).toBe(0);
				for (const row of s.balanceCheck)
					expect(row).toMatchObject({ fetched: "0", difference: "0" });
			},
			SYNC_TIMEOUT,
		);

		it(
			"big_history: >3000 transfers are walked by block, each stored once",
			async () => {
				await deleteConnectionAndImports(ids.get(key(1, "A")) ?? "");
				const c = await addEvm(WALLET_A, 1, "A@1 big");
				ids.set(key(1, "A"), c.id);
				await scenario("big_history");
				await clearRequests();
				const s = await syncOk(c.id);
				await scenario("normal");
				const tokentx = (await requests()).filter(
					(r) => r.path === "/etherscan" && r.params.action === "tokentx",
				);
				expect(tokentx.length).toBeGreaterThanOrEqual(4);
				expect(
					new Set(tokentx.map((r) => r.params.startblock)).size,
				).toBeGreaterThanOrEqual(4);
				for (const r of tokentx)
					expect(
						Number(r.params.page ?? 1) * Number(r.params.offset ?? 0),
					).toBeLessThanOrEqual(10000);
				const tx = (await allTx({ source: "evm:1" })).filter((t) =>
					t.sourceRef.includes(WALLET_A),
				);
				expect(tx.length).toBe(3050 + 6);
				expect(new Set(tx.map((t) => t.sourceRef)).size).toBe(tx.length);
				expect(new Set(tx.map((t) => t.txHash)).size).toBeGreaterThanOrEqual(
					3050,
				);
				expect(streamTotals(s).inserted).toBe(3056);
				for (const row of s.balanceCheck)
					expect(row.difference, row.asset).toBe("0");
			},
			SYNC_TIMEOUT,
		);

		it("big_history spam is flagged suspected_spam", async () => {
			const spam = (await allTx({ source: "evm:1" })).filter((t) =>
				t.reviewFlags.some((f) => f.code === "suspected_spam"),
			);
			expect(spam.length).toBeGreaterThanOrEqual(3050);
		});
	});
});
