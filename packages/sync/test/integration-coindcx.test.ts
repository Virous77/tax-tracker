import type { CoinDcxSyncOptions, StreamBatch } from "@tax/core";
import { expect, it } from "vitest";
import { coindcxConnector } from "../src/coindcx/index.js";

it("syncs and resumes CoinDCX against the in-process shared mock with real HMAC", async () => {
	const moduleUrl = new URL(
		"../../../tools/mock-sync/server.mjs",
		import.meta.url,
	).href;
	const module = (await import(moduleUrl)) as {
		startMockSync: (opts: {
			port: number;
		}) => Promise<{ url: string; close: () => Promise<void> }>;
	};
	const mock = await module.startMockSync({ port: 0 });
	try {
		const opts: CoinDcxSyncOptions = {
			baseUrls: { coindcx: `${mock.url}/coindcx` },
			cursors: {},
			credentials: { apiKey: "mock-dcx-key", apiSecret: "mock-dcx-secret" },
		};
		const batches: StreamBatch[] = [];
		for await (const batch of coindcxConnector.sync(opts)) batches.push(batch);
		expect(batches.flatMap((batch) => batch.rows)).toHaveLength(4);
		expect(
			batches
				.flatMap((batch) => batch.rows)
				.every((row) => row.tx.tdsInr === undefined),
		).toBe(true);
		for (const batch of batches) opts.cursors[batch.stream] = batch.cursor;
		const resumed: StreamBatch[] = [];
		for await (const batch of coindcxConnector.sync(opts)) resumed.push(batch);
		expect(resumed.flatMap((batch) => batch.rows)).toHaveLength(0);
		expect(
			(await coindcxConnector.balances(opts)).some(
				(row) => row.asset === "ETH",
			),
		).toBe(true);
		expect(await coindcxConnector.checkKey(opts)).toMatchObject({
			ok: true,
			readOnly: null,
		});
	} finally {
		await mock.close();
	}
});
