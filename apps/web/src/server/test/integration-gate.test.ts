import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { istDate, taxYearOf } from "@tax/core";
import { HttpClient, type HttpRequest, mapBinanceP2p } from "@tax/sync";
import { expect, it, vi } from "vitest";
import { settleBackgroundJobs } from "../background";
import { closeDatabases, database } from "../context";
import { type Endpoint, handle } from "../http";

it("reconciles signed sync and flags every difference against the shared mock", async () => {
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
	const started = performance.now();
	vi.spyOn(Date, "now").mockImplementation(() =>
		Math.floor(Date.parse(fixture.DATA_NOW) + performance.now() - started),
	);
	const mock = (await startMockSync({ port: 0, host: "127.0.0.1" })) as {
		url: string;
		close: () => Promise<void>;
	};
	// Connector tests cover minute budgets; keep host pacing while avoiding minute-long fixture pauses.
	const request = HttpClient.prototype.request;
	vi.spyOn(HttpClient.prototype, "request").mockImplementation(function (
		this: HttpClient,
		url: string | URL,
		init: HttpRequest = {},
	) {
		return request.call(this, url, { ...init, notBeforeMs: 0 });
	});
	const dir = await mkdtemp(join(tmpdir(), "tax-live-gate-"));
	vi.stubEnv("DATA_DIR", dir);
	vi.stubEnv("APP_PASSWORD", "");
	vi.stubEnv("SECRETS_PASSPHRASE", "");
	for (const [name, path] of Object.entries({
		BINANCE_API_BASE: "binance",
		BINANCE_DATA_BASE: "binance-data",
		COINDCX_API_BASE: "coindcx",
		ETHERSCAN_API_BASE: "etherscan",
		BLOCKSCOUT_API_BASE: "blockscout",
		COINGECKO_API_BASE: "coingecko",
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
					passphrase: "mock gate long passphrase",
				})
			).status,
		).toBe(200);
		for (const provider of ["etherscan", "blockscout", "coingecko"])
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
		const create = async (body: unknown) => {
			const response = await call("createConnection", "POST", body);
			expect(response.status).toBe(201);
			return (await response.json()) as { id: string };
		};
		const binance = await create({
			kind: "binance",
			label: "Binance",
			apiKey: fixture.CREDENTIALS.binance.apiKey,
			apiSecret: fixture.CREDENTIALS.binance.secret,
		});
		const dcx = await create({
			kind: "coindcx",
			label: "CoinDCX",
			apiKey: fixture.CREDENTIALS.coindcx.apiKey,
			apiSecret: fixture.CREDENTIALS.coindcx.secret,
		});
		const wallets = [];
		for (const address of fixture.OWN_ADDRESSES)
			wallets.push(
				await create({
					kind: "evm",
					label: address,
					address,
					chainId: 1,
					options: { providers: ["etherscan"] },
				}),
			);
		const db = await database();
		for (const stream of [
			"deposits",
			"withdrawals",
			"convert",
			"dividends",
			"fiat:0",
			"fiat:1",
			"fiatpay:0",
			"fiatpay:1",
			"p2p:BUY",
			"p2p:SELL",
			"earn:flexible",
			"earn:locked",
		])
			db.cursors.save(binance.id, `binance:${stream}`, {
				endTime: Date.parse("2025-04-01T00:00:00Z"),
			});
		for (const connection of [binance, dcx, ...wallets]) {
			const response = await call(
				"syncConnection",
				"POST",
				undefined,
				connection,
			);
			expect(response.status).toBe(202);
			const { jobId } = await response.json();
			await settleBackgroundJobs(db);
			const job = await (
				await call("getJob", "GET", undefined, { id: jobId })
			).json();
			expect(job, JSON.stringify(job)).toMatchObject({ status: "completed" });
		}
		const p2p = mapBinanceP2p(fixture.P2P_BUY);
		if (!p2p) throw new Error("Missing fixture purchase");
		if (!db.transactions.active().some((tx) => tx.sourceRef === p2p.sourceRef))
			expect(
				(
					await call("createTransaction", "POST", {
						...p2p,
						importId: null,
						venue: "binance",
					})
				).status,
			).toBe(201);
		for (const connection of [binance, dcx, ...wallets]) {
			const balances = await (
				await call("connectionBalances", "GET", undefined, connection)
			).json();
			const differences = balances.rows.filter(
				(row: { flagged: boolean }) => row.flagged,
			) as { asset: string; difference: string }[];
			expect(differences, JSON.stringify(balances)).toEqual([]);
			for (const row of differences) {
				expect(
					db.imports
						.list()
						.filter((item) => item.connectionId === connection.id)
						.some((item) =>
							item.warnings.some(
								(flag) =>
									flag.code === "balance_mismatch" &&
									flag.message.includes(row.asset),
							),
						),
				).toBe(true);
			}
		}
		expect(
			db.transactions
				.all()
				.some((tx) =>
					tx.reviewFlags.some((flag) => flag.code === "suspected_spam"),
				),
		).toBe(true);
		expect(
			(
				await call("putSettings", "PUT", {
					prices: { enabled: true, coingeckoFallback: false },
				})
			).status,
		).toBe(200);
		const dustDate = new Date(
			fixture.BINANCE_DUST[0].operateTime,
		).toISOString();
		const taxYear = taxYearOf(dustDate);
		const fill = await (await call("fillPrices", "POST", { taxYear })).json();
		await settleBackgroundJobs(db);
		expect(
			await (await call("getJob", "GET", undefined, { id: fill.jobId })).json(),
		).toMatchObject({
			status: "completed",
			result: {
				missing: expect.arrayContaining([
					{ asset: "XRP", date: istDate(dustDate) },
				]),
			},
		});
		expect(
			(await call("computeReport", "POST", undefined, { taxYear })).status,
		).toBe(200);
		// XRP has no fixture kline; a disabled fallback must leave the gap explicit.
		const report = await (
			await call("getReport", "GET", undefined, { taxYear })
		).json();
		expect(
			report.warnings.some(
				(flag: { code: string }) => flag.code === "missing_inr_value",
			),
		).toBe(true);
		expect(report.excluded.length).toBeGreaterThan(0);
	} finally {
		await settleBackgroundJobs(await database());
		await closeDatabases();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await mock.close();
		await rm(dir, { recursive: true, force: true });
	}
}, 120000);
