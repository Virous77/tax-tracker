import type { EvmSyncOptions, StreamBatch } from "@tax/core";
import { expect, it } from "vitest";
import { evmConnector } from "../src/index.js";

const a = "0x5a17c9e3b4d28f6019ca7b3e5d8f2a4c6b1e9d70",
	b = "0x9c4e2a7d1f83b650e4d9a2c5f7b1e8d3a6c0b459";
async function mockServer() {
	const moduleUrl = new URL(
		"../../../tools/mock-sync/server.mjs",
		import.meta.url,
	).href;
	const module = (await import(moduleUrl)) as {
		startMockSync: (opts: {
			port: number;
		}) => Promise<{ url: string; close: () => Promise<void> }>;
	};
	return module.startMockSync({ port: 0 });
}
function options(url: string, address = a): EvmSyncOptions {
	return {
		chainId: 1,
		address,
		ownAddresses: [a, b],
		providers: [{ kind: "etherscan", apiKey: "mock-etherscan-key" }],
		baseUrls: {
			etherscan: `${url}/etherscan`,
			blockscout: `${url}/blockscout`,
		},
		cursors: {},
	};
}
async function collect(opts: EvmSyncOptions) {
	const batches: StreamBatch[] = [];
	for await (const batch of evmConnector.sync(opts)) batches.push(batch);
	return batches;
}
it("syncs Ethereum against the in-process shared mock, preserves own-address legs and spam", async () => {
	const mock = await mockServer();
	try {
		const opts = options(mock.url),
			batches = await collect(opts),
			rows = batches.flatMap((batch) => batch.rows.map((row) => row.tx));
		expect(
			batches.every((batch) => !batch.incomplete),
			JSON.stringify(batches.map((batch) => batch.incomplete)),
		).toBe(true);
		expect(rows.some((tx) => tx.type === "swap")).toBe(true);
		expect(rows.some((tx) => tx.type === "fee")).toBe(true);
		expect(
			rows.some((tx) =>
				tx.reviewFlags.some((flag) => flag.code === "suspected_spam"),
			),
			JSON.stringify(batches.map((batch) => batch.incomplete)),
		).toBe(true);
		const sender = rows.find(
			(tx) => tx.type === "withdrawal" && tx.assetOut === "USDC",
		);
		const other = (await collect(options(mock.url, b))).flatMap((batch) =>
			batch.rows.map((row) => row.tx),
		);
		const receiver = other.find(
			(tx) => tx.type === "deposit" && tx.txHash === sender?.txHash,
		);
		expect(receiver).toBeDefined();
		expect(receiver?.sourceRef).not.toBe(sender?.sourceRef);
		for (const batch of batches) opts.cursors[batch.stream] = batch.cursor;
		const resumed = (await collect(opts)).flatMap((batch) => batch.rows);
		expect(resumed).toHaveLength(0);
		expect(
			(await evmConnector.balances(opts)).some((row) => row.asset === "USDC"),
		).toBe(true);
		expect(await evmConnector.checkKey(opts)).toMatchObject({
			ok: true,
			readOnly: true,
		});
	} finally {
		await mock.close();
	}
}, 30_000);
it("walks shared mock big_history without exceeding the explorer cap", async () => {
	const mock = await mockServer();
	try {
		await fetch(`${mock.url}/__control`, {
			method: "POST",
			body: JSON.stringify({ scenario: "big_history" }),
		});
		const batches = await collect(options(mock.url));
		expect(
			batches.every((batch) => !batch.incomplete),
			JSON.stringify(batches.map((batch) => batch.incomplete)),
		).toBe(true);
		expect(batches.flatMap((batch) => batch.rows).length).toBeGreaterThan(3000);
		const log = (await (
			await fetch(`${mock.url}/__requests`)
		).json()) as Array<{ params: Record<string, string> }>;
		expect(
			log.filter((entry) => entry.params.action === "tokentx").length,
		).toBeGreaterThan(3);
		expect(
			log
				.filter((entry) => entry.params.action === "tokentx")
				.every(
					(entry) =>
						entry.params.page === "1" && entry.params.offset === "1000",
				),
		).toBe(true);
	} finally {
		await mock.close();
	}
}, 30_000);
