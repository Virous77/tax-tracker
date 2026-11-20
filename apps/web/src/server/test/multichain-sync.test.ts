import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { settleBackgroundJobs } from "../background";
import { closeDatabases, database } from "../context";
import { type Endpoint, handle } from "../http";

it.each([
	[1, "etherscan", true],
	[1, "blockscout", true],
	[8453, "alchemy", true],
	[56, "nodereal", true],
	[42161, "alchemy", false],
] as const)(
	"syncs chain %s through %s (complete history: %s)",
	async (chainId, provider, complete) => {
		const modulePath = new URL(
			"../../../../../tools/mock-sync/server.mjs",
			import.meta.url,
		).href;
		const fixturePath = new URL(
			"../../../../../tools/mock-sync/fixtures.mjs",
			import.meta.url,
		).href;
		const { startMockSync } = await import(/* @vite-ignore */ modulePath);
		const fixture = await import(/* @vite-ignore */ fixturePath);
		const mock = (await startMockSync({ port: 0, host: "127.0.0.1" })) as {
			url: string;
			close: () => Promise<void>;
		};
		const dir = await mkdtemp(join(tmpdir(), "tax-provider-gate-"));
		vi.stubEnv("DATA_DIR", dir);
		vi.stubEnv("APP_PASSWORD", "");
		vi.stubEnv("SECRETS_PASSPHRASE", "");
		for (const [name, path] of Object.entries({
			ETHERSCAN_API_BASE: "etherscan",
			BLOCKSCOUT_API_BASE: "blockscout",
			ALCHEMY_API_BASE: "alchemy/{network}/v2",
			NODEREAL_API_BASE: "nodereal",
		}))
			vi.stubEnv(name, `${mock.url}/${path}`);
		const call = (
			name: Endpoint,
			method = "GET",
			body?: unknown,
			params: Record<string, string> = {},
		) =>
			handle(
				name,
				new Request("http://localhost/api/test", {
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
		try {
			expect(
				(
					await call("setupVault", "POST", {
						passphrase: "mock provider gate passphrase",
					})
				).status,
			).toBe(200);
			expect(
				(
					await call(
						"putProvider",
						"PUT",
						{ apiKey: fixture.CREDENTIALS[provider].apiKey },
						{ name: provider },
					)
				).status,
			).toBe(200);
			const connections: { id: string }[] = [];
			for (const address of fixture.OWN_ADDRESSES) {
				const response = await call("createConnection", "POST", {
					kind: "evm",
					chainId,
					address,
					label: address,
					options: { providers: [provider] },
				});
				expect(response.status).toBe(201);
				connections.push(await response.json());
			}
			for (const connection of connections) {
				const response = await call(
					"syncConnection",
					"POST",
					undefined,
					connection,
				);
				expect(response.status).toBe(202);
				const { jobId } = await response.json();
				await settleBackgroundJobs(await database());
				const job = await (
					await call("getJob", "GET", undefined, { id: jobId })
				).json();
				expect(job, JSON.stringify(job)).toMatchObject({ status: "completed" });
				if (!complete) {
					expect(job.result).toMatchObject({
						streams: expect.arrayContaining([
							expect.objectContaining({
								stream: expect.stringMatching(/:txlistinternal$/),
								incomplete: expect.stringMatching(/internal transfers/i),
							}),
						]),
						balanceCheck: [],
						notices: [expect.stringMatching(/balance check skipped/i)],
					});
					expect(
						(await database()).connections.get(connection.id)?.lastSyncStatus,
					).toBe("incomplete");
					expect(
						await (
							await call("connectionBalances", "GET", undefined, connection)
						).json(),
					).toEqual({ fetchedAt: null, rows: [] });
					continue;
				}
				expect(
					job.result.streams.every(
						(stream: { incomplete?: string }) => !stream.incomplete,
					),
				).toBe(true);
				expect(job.result.balanceCheck.length).toBeGreaterThan(0);
				expect(
					job.result.balanceCheck.every(
						(row: { difference: string }) => row.difference === "0",
					),
					JSON.stringify(job.result.balanceCheck),
				).toBe(true);
				expect(
					(
						await (
							await call("connectionBalances", "GET", undefined, connection)
						).json()
					).rows.every((row: { flagged: boolean }) => !row.flagged),
				).toBe(true);
			}
			if (chainId === 1) {
				await fetch(`${mock.url}/__control`, {
					method: "POST",
					body: JSON.stringify({ scenario: "drift" }),
				});
				const connection = connections[1];
				if (!connection) throw new Error("Missing fixture wallet");
				const { jobId } = await (
					await call("syncConnection", "POST", undefined, connection)
				).json();
				await settleBackgroundJobs(await database());
				const job = await (
					await call("getJob", "GET", undefined, { id: jobId })
				).json();
				expect(job.status).toBe("completed");
				expect(job.result.balanceCheck).toContainEqual(
					expect.objectContaining({ asset: "USDC", difference: "0.5" }),
				);
				expect(
					(await database()).imports.get(job.result.importId)?.warnings,
				).toContainEqual(expect.objectContaining({ code: "balance_mismatch" }));
			}
		} finally {
			await settleBackgroundJobs(await database());
			await closeDatabases();
			vi.unstubAllEnvs();
			await mock.close();
			await rm(dir, { recursive: true, force: true });
		}
	},
	120_000,
);
