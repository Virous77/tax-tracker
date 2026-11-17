import { type ConnectorRow, D, type StreamBatch } from "@tax/core";
import { describe, expect, it } from "vitest";
import { chainConfig, type EvmOptions, evmConnector } from "../src/index.js";

const wallet = "0x5a17c9e3b4d28f6019ca7b3e5d8f2a4c6b1e9d70";
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
function options(url: string, chainId: number, kind: string): EvmOptions {
	return {
		chainId,
		address:
			chainId === 137 ? "0x9c4e2a7d1f83b650e4d9a2c5f7b1e8d3a6c0b459" : wallet,
		ownAddresses: [wallet, "0x9c4e2a7d1f83b650e4d9a2c5f7b1e8d3a6c0b459"],
		providers: [
			{
				kind,
				apiKey: `mock-${kind}${kind === "etherscan" && (chainId === 56 || chainId === 8453) ? "-paid" : ""}-key`,
			},
		],
		cursors: {},
		baseUrls: {
			etherscan: `${url}/etherscan`,
			blockscout: `${url}/blockscout`,
			alchemy: `${url}/alchemy/{network}/v2`,
			nodereal: `${url}/nodereal`,
		},
	};
}
async function collect(opts: EvmOptions) {
	const batches: StreamBatch[] = [];
	for await (const batch of evmConnector.sync(opts)) batches.push(batch);
	return batches;
}
function holdings(rows: ConnectorRow[]) {
	const balances = new Map<string, string>();
	const add = (
		asset: string | undefined,
		amount: string | undefined,
		sign = "1",
	) => {
		if (asset && amount)
			balances.set(
				asset,
				D(balances.get(asset) ?? "0")
					.plus(D(amount).mul(sign))
					.toFixed(),
			);
	};
	for (const { tx } of rows) {
		if (tx.reviewFlags.some((f) => f.code === "suspected_spam")) continue;
		add(tx.assetIn, tx.amountIn);
		add(tx.assetOut, tx.amountOut, "-1");
		add(tx.feeAsset, tx.feeAmount, "-1");
	}
	return balances;
}

describe("in-process multichain shared mock", () => {
	it.each([
		[1, "etherscan"],
		[1, "blockscout"],
		[8453, "alchemy"],
		[8453, "etherscan"],
		[42161, "etherscan"],
		[42161, "blockscout"],
		[137, "etherscan"],
		[137, "alchemy"],
		[56, "nodereal"],
		[56, "etherscan"],
	] as const)(
		"imports chain %s using %s and reconciles every complete snapshot",
		async (chainId, kind) => {
			const mock = await mockServer();
			try {
				const opts = options(mock.url, chainId, kind),
					batches = await collect(opts),
					rows = batches.flatMap((batch) => batch.rows);
				expect(
					rows.length,
					JSON.stringify(batches.map((batch) => batch.incomplete)),
				).toBeGreaterThan(0);
				for (const batch of batches)
					expect(batch.cursor).toMatchObject({ provider: kind });
				expect(
					batches.every((batch) => !batch.incomplete),
					JSON.stringify(batches.map((batch) => batch.incomplete)),
				).toBe(true);
				const computed = holdings(rows),
					actual = await evmConnector.balances(opts);
				for (const balance of actual)
					expect(
						computed.get(balance.asset) ?? "0",
						`${chainId} ${kind} ${balance.asset}`,
					).toBe(balance.amount);
				if (chainId === 8453) {
					const sent = rows.filter((row) => row.tx.feeAmount);
					expect(sent.length).toBeGreaterThan(0);
					expect(
						sent.every(
							(row) =>
								!row.tx.reviewFlags.some(
									(flag) => flag.code === "fee_review_required",
								),
						),
					).toBe(true);
					expect(
						rows.some((row) =>
							row.tx.reviewFlags.some(
								(flag) => flag.message === "Possible bridge between chains",
							),
						),
					).toBe(true);
				}
				if (chainId === 42161) {
					expect(rows.some((row) => row.tx.assetIn === "USDC.E")).toBe(true);
					expect(rows.some((row) => row.tx.assetIn === "USDC")).toBe(true);
					expect(
						rows.some(
							(row) => row.tx.type === "swap" && row.tx.assetIn === "ETH",
						),
					).toBe(true);
					expect(
						rows.every(
							(row) =>
								!row.tx.reviewFlags.some(
									(flag) => flag.code === "fee_review_required",
								),
						),
					).toBe(true);
				}
				if (chainId === 137) {
					expect(rows.some((row) => row.tx.assetIn === "POL")).toBe(true);
					expect(
						rows.some(
							(row) =>
								row.tx.assetIn === "MATIC" || row.tx.assetOut === "MATIC",
						),
					).toBe(false);
					expect(
						rows.some((row) =>
							row.tx.reviewFlags.some((flag) =>
								flag.message.includes("renamed"),
							),
						),
					).toBe(true);
				}
				if (chainId === 56) {
					expect(rows.some((row) => row.tx.assetIn === "USDT")).toBe(true);
					expect(rows.some((row) => row.tx.assetIn === "BNB")).toBe(true);
				}
				expect(holdings(rows).has(chainConfig(chainId).nativeAsset)).toBe(true);
			} finally {
				await mock.close();
			}
		},
		30_000,
	);
	it("preserves Arbitrum transfer legs and explicitly flags Alchemy's missing internals", async () => {
		const mock = await mockServer();
		try {
			const batches = await collect(options(mock.url, 42161, "alchemy"));
			expect(
				batches.some((batch) =>
					batch.incomplete?.includes("Internal transfers not available"),
				),
			).toBe(true);
			expect(
				batches
					.flatMap((batch) => batch.rows)
					.some((row) => row.tx.assetOut === "USDC.E"),
			).toBe(true);
			const stream = batches.find((batch) =>
				batch.stream.endsWith(":txlistinternal"),
			);
			expect(stream?.cursor).toMatchObject({
				provider: "alchemy",
				lastBlock: 0,
			});
		} finally {
			await mock.close();
		}
	});
});
