import { D, type StreamBatch } from "@tax/core";
import { UpstreamError, UpstreamRateLimitError } from "@tax/sync";
import { describe, expect, it, vi } from "vitest";
import {
	AlchemyAdapter,
	chainConfig,
	chains,
	classifyTransactions,
	createExplorer,
	type EvmOptions,
	ExplorerAdapter,
	type ExplorerProvider,
	type ExplorerRow,
	ExplorerUnsupportedError,
	evmConnector,
	FallbackExplorer,
	knownTokensForChain,
	NodeRealAdapter,
	tokenAsset,
	walkBlocks,
} from "../src/index.js";

const wallet = "0x1111111111111111111111111111111111111111",
	other = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}`;
let instance = 0;
type RpcRequest = { method: string; params: unknown[] };
function options(
	chainId: number,
	handler: (request: RpcRequest, url: URL) => unknown,
): EvmOptions {
	const host = `https://provider-${++instance}.invalid`;
	return {
		chainId,
		address: wallet,
		ownAddresses: [wallet],
		providers: [{ kind: "alchemy", apiKey: "test-key" }],
		baseUrls: {
			alchemy: `${host}/alchemy/{network}/v2`,
			nodereal: `${host}/nodereal/v1`,
			etherscan: `${host}/etherscan`,
			blockscout: `${host}/blockscout`,
		},
		cursors: {},
		fetch: async (target, init) => {
			const url = new URL(String(target));
			const request = init?.body
				? (JSON.parse(String(init.body)) as RpcRequest)
				: { method: url.searchParams.get("action") ?? "", params: [] };
			const result = handler(request, url);
			if (result instanceof Response) return result;
			return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
		},
	};
}
const receipt = (patch: Record<string, unknown> = {}) => ({
	from: wallet,
	to: other,
	gasUsed: "0x5208",
	effectiveGasPrice: "0x3b9aca00",
	status: "0x1",
	...patch,
});
function transfer(patch: Record<string, unknown> = {}) {
	return {
		blockNum: "0xa",
		uniqueId: `${hash}:external`,
		hash,
		from: wallet,
		to: other,
		value: 987654321.1234567,
		asset: "ETH",
		category: "external",
		rawContract: { value: "0xde0b6b3a7640000", decimal: "0x12", address: null },
		metadata: { blockTimestamp: "2026-01-02T10:00:00.000Z" },
		...patch,
	};
}
function normal(patch: ExplorerRow = {}): ExplorerRow {
	return {
		hash,
		blockNumber: "10",
		timeStamp: "1767348000",
		from: wallet,
		to: other,
		value: "1000000000000000000",
		gasUsed: "21000",
		gasPrice: "1000000000",
		...patch,
	};
}
async function collect(opts: EvmOptions) {
	const batches: StreamBatch[] = [];
	for await (const batch of evmConnector.sync(opts)) batches.push(batch);
	return batches;
}
function classified(
	chainId: number,
	txlist: ExplorerRow[],
	tokentx: ExplorerRow[] = [],
) {
	return classifyTransactions({
		chainId,
		address: wallet,
		ownAddresses: [wallet],
		txlist,
		txlistinternal: [],
		tokentx,
	}).map((row) => row.tx);
}

describe("Alchemy transfer adapter", () => {
	it("pages both directions, retains raw digits, caches streams, and charges Base receipt fees", async () => {
		const calls: RpcRequest[] = [];
		const opts = options(8453, (req, url) => {
			calls.push(req);
			expect(url.pathname).toBe("/alchemy/base-mainnet/v2/test-key");
			if (req.method === "eth_getTransactionReceipt")
				return receipt({ l1Fee: "0x64" });
			expect(req.method).toBe("alchemy_getAssetTransfers");
			const args = req.params[0] as Record<string, unknown>;
			expect(args).toMatchObject({
				fromBlock: "0x0",
				toBlock: "0x64",
				withMetadata: true,
				category: ["external", "internal", "erc20"],
				excludeZeroValue: false,
				maxCount: "0x3e8",
				order: "asc",
			});
			if (args.toAddress) return { transfers: [] };
			if (!args.pageKey) return { transfers: [transfer()], pageKey: "page-2" };
			return {
				transfers: [
					transfer({
						uniqueId: `${hash}:log:5`,
						category: "erc20",
						asset: "USDC",
						rawContract: {
							value: "0x16e360",
							decimal: "0x6",
							address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
						},
						from: other,
						to: wallet,
					}),
				],
			};
		});
		const adapter = new AlchemyAdapter(opts, {
			kind: "alchemy",
			apiKey: "test-key",
		});
		const main = await adapter.history("txlist", wallet, 0, 100),
			tokens = await adapter.history("tokentx", wallet, 0, 100);
		expect(
			calls.filter((c) => c.method === "alchemy_getAssetTransfers"),
		).toHaveLength(3);
		expect(
			calls.filter((c) => c.method === "eth_getTransactionReceipt"),
		).toHaveLength(1);
		expect(main[0]?.value).toBe("1000000000000000000");
		expect(tokens[0]?.value).toBe("1500000");
		expect(classified(8453, main, tokens)[0]).toMatchObject({
			type: "swap",
			amountOut: "1",
			amountIn: "1.5",
			feeAmount: "0.0000210000000001",
			reviewFlags: [],
		});
		expect(classified(8453, main, tokens)[0]?.raw).toMatchObject({
			providerRows: expect.arrayContaining([
				expect.objectContaining({
					value: "987654321.1234567",
					uniqueId: `${hash}:external`,
				}),
			]),
			receipts: [{ l1Fee: "0x64" }],
		});
	});
	it("fetches receipts for token-only sends so their gas is retained", async () => {
		const opts = options(1, (req) =>
			req.method === "eth_getTransactionReceipt"
				? receipt()
				: {
						transfers: (req.params[0] as Record<string, unknown>).fromAddress
							? [
									transfer({
										category: "erc20",
										asset: "USDC",
										rawContract: {
											value: "0x16e360",
											decimal: "0x6",
											address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
										},
									}),
								]
							: [],
					},
		);
		const adapter = new AlchemyAdapter(opts, {
			kind: "alchemy",
			apiKey: "test-key",
		});
		const main = await adapter.history("txlist", wallet, 0, 100),
			tokens = await adapter.history("tokentx", wallet, 0, 100);
		expect(main[0]?.value).toBe("0");
		expect(classified(1, main, tokens)[0]).toMatchObject({
			assetOut: "USDC",
			amountOut: "1.5",
			feeAmount: "0.000021",
		});
	});
	it("supports native and token balances while pinning historical balances with eth_call", async () => {
		const calls: RpcRequest[] = [];
		const contract = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
		const opts = options(8453, (req) => {
			calls.push(req);
			if (req.method === "alchemy_getTokenBalances")
				return {
					tokenBalances: [
						{ contractAddress: contract, tokenBalance: "0x16e360" },
					],
				};
			return "0x16e360";
		});
		const adapter = new AlchemyAdapter(opts, {
			kind: "alchemy",
			apiKey: "test-key",
		});
		expect(await adapter.balance(wallet, "0x64")).toBe("1500000");
		expect(await adapter.tokenBalance(wallet, contract)).toBe("1500000");
		expect(await adapter.tokenBalance(wallet, contract, "0x64")).toBe(
			"1500000",
		);
		expect(calls.at(-1)).toMatchObject({
			method: "eth_call",
			params: [
				{
					to: contract,
					data: `0x70a08231${wallet.slice(2).padStart(64, "0")}`,
				},
				"0x64",
			],
		});
	});
	it("reports missing Arbitrum internals and does not request an unsupported category", async () => {
		const opts = options(42161, (req) => {
			expect((req.params[0] as Record<string, unknown>).category).toEqual([
				"external",
				"erc20",
			]);
			return { transfers: [] };
		});
		const adapter = new AlchemyAdapter(opts, {
			kind: "alchemy",
			apiKey: "test-key",
		});
		expect(
			(await walkBlocks(adapter, "txlistinternal", wallet, 0, 100)).incomplete,
		).toContain("Internal transfers not available");
	});
	it.each([
		[{ code: 429, message: "rate limit exceeded" }, UpstreamRateLimitError],
		[{ code: -32601, message: "Method not found" }, ExplorerUnsupportedError],
		[{ code: -32000, message: "temporarily unavailable" }, UpstreamError],
	])("classifies nested RPC errors %j", async (error, type) => {
		const opts = options(
			1,
			() => new Response(JSON.stringify({ jsonrpc: "2.0", error })),
		);
		await expect(
			new AlchemyAdapter(opts, {
				kind: "alchemy",
				apiKey: "test-key",
			}).blockNumber(),
		).rejects.toBeInstanceOf(type);
	});
	it("refuses a repeated paging token without returning partial history", async () => {
		const opts = options(1, () => ({ transfers: [], pageKey: "same" }));
		await expect(
			new AlchemyAdapter(opts, { kind: "alchemy", apiKey: "test-key" }).history(
				"txlist",
				wallet,
				0,
				100,
			),
		).rejects.toThrow("repeated");
	});
	it("detects omitted approvals/failed transactions and retains the previous safe cursor", async () => {
		const opts = options(8453, (req) => {
			if (req.method === "eth_blockNumber") return "0xa4";
			if (req.method === "eth_getTransactionCount") return "0x2";
			if (req.method === "eth_getTransactionReceipt")
				return receipt({ l1Fee: "0x64" });
			return {
				transfers: (req.params[0] as Record<string, unknown>).fromAddress
					? [transfer()]
					: [],
			};
		});
		const batches = await collect(opts);
		expect(batches[0]?.incomplete).toContain(
			"1 sent transactions not found (their gas is missing)",
		);
		expect(batches[0]?.cursor).toEqual({ lastBlock: 0, provider: "alchemy" });
		expect(batches.flatMap((batch) => batch.rows)).toHaveLength(1);
	});
});

describe("NodeReal BSC adapter", () => {
	it("bounds every window at 100000 blocks, pages both directions, accepts both timestamps, and keeps supplied gas", async () => {
		const calls: RpcRequest[] = [];
		const opts = options(56, (req) => {
			calls.push(req);
			expect(req.method).toBe("nr_getAssetTransfers");
			const args = req.params[0] as Record<string, string>;
			expect(
				Number(BigInt(args.toBlock ?? "0")) -
					Number(BigInt(args.fromBlock ?? "0")) +
					1,
			).toBeLessThanOrEqual(100000);
			expect(args.category).toEqual(["external", "internal", "20"]);
			if (args.fromBlock !== "0x0" || args.toAddress) return { transfers: [] };
			if (!args.pageKey)
				return {
					transfers: [
						{
							category: "external",
							hash,
							blockNum: "0xa",
							from: wallet,
							to: other,
							value: "0xde0b6b3a7640000",
							asset: "BNB",
							blockTimeStamp: "0x69579fa0",
							gasPrice: "0x3b9aca00",
							gasUsed: "0x5208",
							receiptsStatus: "0x1",
						},
					],
					pageKey: "next",
				};
			return {
				transfers: [
					{
						category: "20",
						hash,
						blockNum: "0xa",
						from: other,
						to: wallet,
						value: "0xde0b6b3a7640000",
						asset: "USDT",
						contractAddress: "0x55d398326f99059ff775485246999027b3197955",
						decimal: null,
						blockTimestamp: "0x69579fa0",
					},
				],
			};
		});
		const adapter = new NodeRealAdapter(opts, {
			kind: "nodereal",
			apiKey: "test-key",
		});
		const main = await adapter.history("txlist", wallet, 0, 200001),
			tokens = await adapter.history("tokentx", wallet, 0, 200001);
		expect(calls).toHaveLength(7);
		expect(tokens[0]?.tokenDecimal).toBe("18");
		expect(classified(56, main, tokens)[0]).toMatchObject({
			assetOut: "BNB",
			amountOut: "1",
			assetIn: "USDT",
			amountIn: "1",
			feeAmount: "0.000021",
		});
	});
	it("preserves more than 1000 same-block rows when pageKey proves completeness", async () => {
		const opts = options(56, (req) => {
			const args = req.params[0] as Record<string, string>;
			return {
				transfers: args.fromAddress
					? Array.from({ length: args.pageKey ? 1 : 1000 }, (_, i) => ({
							category: "external",
							hash: `0x${i + (args.pageKey ? 1000 : 0)}`,
							blockNum: "0xa",
							from: wallet,
							to: other,
							value: "0x1",
							asset: "BNB",
							blockTimeStamp: "0x69579fa0",
							gasPrice: "0x1",
							gasUsed: "0x1",
							receiptsStatus: "0x1",
						}))
					: [],
				...(args.fromAddress && !args.pageKey ? { pageKey: "next" } : {}),
			};
		});
		const adapter = new NodeRealAdapter(opts, {
			kind: "nodereal",
			apiKey: "test-key",
		});
		const result = await walkBlocks(adapter, "txlist", wallet, 0, 100);
		expect(result.incomplete).toBeUndefined();
		expect(result.rows).toHaveLength(1001);
	});
	it("keeps an unknown token with omitted decimals as raw review data without inventing its scale", async () => {
		const opts = options(56, (req) =>
			req.method === "eth_getTransactionReceipt"
				? receipt()
				: {
						transfers: (req.params[0] as Record<string, unknown>).fromAddress
							? [
									{
										category: "20",
										hash,
										blockNum: "0xa",
										from: wallet,
										to: other,
										value: "0xde0b6b3a7640000",
										asset: "UNKNOWN",
										contractAddress: other,
										decimal: null,
										blockTimeStamp: "0x69579fa0",
									},
								]
							: [],
					},
		);
		const adapter = new NodeRealAdapter(opts, {
			kind: "nodereal",
			apiKey: "test-key",
		});
		const tokens = await walkBlocks(adapter, "tokentx", wallet, 0, 100);
		expect(tokens.incomplete).toContain("omitted decimals");
		const rows = classified(
			56,
			await adapter.history("txlist", wallet, 0, 100),
			tokens.rows,
		);
		expect(rows.some((tx) => tx.amountIn || tx.amountOut)).toBe(false);
		expect(
			rows
				.flatMap((tx) => tx.reviewFlags)
				.some(
					(flag) =>
						flag.code === "parse_warning" && flag.message.includes("decimals"),
				),
		).toBe(true);
		expect(rows[0]?.raw).toMatchObject({
			providerRows: [
				expect.objectContaining({ decimal: null, value: "0xde0b6b3a7640000" }),
			],
		});
	});

	it("reads BSC balances with block-pinned RPC", async () => {
		const opts = options(56, () => "0xde0b6b3a7640000");
		const adapter = new NodeRealAdapter(opts, {
			kind: "nodereal",
			apiKey: "test-key",
		});
		expect(await adapter.balance(wallet, "0x64")).toBe("1000000000000000000");
		expect(await adapter.tokenBalance(wallet, other, "0x64")).toBe(
			"1000000000000000000",
		);
	});
});

describe("chain identity and classification", () => {
	it.each(chains)(
		"has curated data and a provider order for $name",
		(chain) => {
			const tokens = knownTokensForChain(chain.chainId);
			expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(17);
			for (const [contract, token] of Object.entries(tokens)) {
				expect(contract).toMatch(/^0x[0-9a-f]{40}$/);
				expect(Number.isInteger(token.decimals)).toBe(true);
			}
			expect(chain.defaultProviders.length).toBeGreaterThanOrEqual(2);
		},
	);
	it.each([
		[42161, "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "USDC"],
		[42161, "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8", "USDC.E"],
		[137, "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", "USDC.E"],
		[8453, "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", "USDBC"],
		[56, "0x2170ed0880ac9a755fd29b2688956bd959f933f8", "ETH"],
		[56, "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", "BTC"],
	])("maps verified identity %s %s to %s", (chain, contract, asset) =>
		expect(tokenAsset(chain as number, contract as string)).toBe(asset),
	);
	it("adds Base l1Fee exactly and never adds Arbitrum gasUsedForL1 twice", () => {
		expect(
			classified(8453, [
				normal({ l1Fee: "100", effectiveGasPrice: "2000000000" }),
			])[0],
		).toMatchObject({ feeAmount: "0.0000420000000001", reviewFlags: [] });
		expect(
			classified(42161, [
				normal({ gasUsedForL1: "210", effectiveGasPrice: "2000000000" }),
			])[0],
		).toMatchObject({ feeAmount: "0.000042", reviewFlags: [] });
	});
	it("flags a missing Base l1Fee or an unverified operator fee", () => {
		expect(classified(8453, [normal()])[0]?.reviewFlags[0]?.code).toBe(
			"fee_review_required",
		);
		expect(
			classified(8453, [normal({ l1Fee: "100", operatorFeeScalar: "1" })])[0]
				?.reviewFlags[0]?.message,
		).toContain("operator-fee");
	});
	it("maps MATIC native history to POL, retains its raw symbol, warns once, and drops native aliases", () => {
		const main = normal({ timeStamp: "1600000000", nativeSymbol: "MATIC" });
		const rows = classified(
			137,
			[
				main,
				normal({
					hash: "0xother",
					timeStamp: "1600000100",
					nativeSymbol: "MATIC",
				}),
			],
			[
				normal({
					contractAddress: "0x0000000000000000000000000000000000001010",
					tokenDecimal: "18",
					tokenSymbol: "MATIC",
				}),
			],
		);
		expect(rows).toHaveLength(2);
		expect(rows.every((tx) => tx.assetOut === "POL")).toBe(true);
		expect(
			rows
				.flatMap((tx) => tx.reviewFlags)
				.filter((flag) => flag.message.includes("renamed")),
		).toHaveLength(1);
		expect(rows[0]?.raw).toMatchObject({
			txlist: [{ nativeSymbol: "MATIC" }],
			tokentx: [{ tokenSymbol: "MATIC" }],
		});
	});
	it.each([1, 8453, 42161, 137])(
		"flags official bridge on %s and keeps separate legs",
		(chain) => {
			const target = chainConfig(chain).bridgeContracts[0];
			if (!target) throw new Error("Missing bridge");
			const rows = classified(chain, [normal({ to: target, l1Fee: "0" })]);
			expect(rows[0]?.type).toBe("withdrawal");
			expect(rows[0]?.reviewFlags).toContainEqual({
				code: "complex_onchain",
				message: "Possible bridge between chains",
			});
		},
	);
	it("flags labelled CEX withdrawals on destination chains without guessing their counterpart", () => {
		const rows = classified(56, [
			normal({ from: other, to: wallet, fromLabel: "Binance Hot Wallet" }),
		]);
		expect(rows[0]).toMatchObject({
			type: "deposit",
			amountIn: "1",
			reviewFlags: [{ message: "Possible bridge between chains" }],
		});
	});
});

describe("provider continuity", () => {
	function provider(
		kind: string,
		history: ExplorerProvider["history"],
	): ExplorerProvider {
		return {
			kind,
			history,
			blockNumber: async () => 100,
			balance: async () => "0",
			tokenBalance: async () => "0",
		};
	}
	it("discards pages from the old provider and restarts at the persisted safe block", async () => {
		const first = provider(
			"etherscan",
			vi.fn(async (_action, _wallet, start) => {
				if (start > 5) throw new UpstreamRateLimitError("rate limit");
				return Array.from({ length: 1000 }, (_, i) =>
					normal({ hash: `old-${i}`, blockNumber: i < 500 ? "6" : "7" }),
				);
			}),
		);
		const second = provider(
			"blockscout",
			vi.fn(async () => [normal({ hash: "replacement", blockNumber: "6" })]),
		);
		const fallback = new FallbackExplorer([first, second]);
		const result = await walkBlocks(fallback, "txlist", wallet, 5, 100);
		expect(result.rows.map((row) => row.hash)).toEqual(["replacement"]);
		expect(result.provider).toBe("blockscout");
		expect(vi.mocked(second.history).mock.calls.at(-1)?.[2]).toBe(5);
		expect(fallback.providerFor("tokentx")).toBe("etherscan");
	});
	it("resumes each stream on its recorded provider", async () => {
		const first = provider(
				"etherscan",
				vi.fn(async () => []),
			),
			second = provider(
				"blockscout",
				vi.fn(async () => []),
			);
		const fallback = new FallbackExplorer([first, second], {
			[`evm:1:${wallet}:txlist`]: { lastBlock: 5, provider: "blockscout" },
		});
		await fallback.history("txlist", wallet, 5, 100);
		expect(first.history).not.toHaveBeenCalled();
		expect(second.history).toHaveBeenCalledOnce();
	});
	it("fails over a free Etherscan key rejected on a paid-only chain with a clear notice", async () => {
		const opts = options(8453, (req) => {
			if (req.method === "txlist")
				return new Response(
					JSON.stringify({
						status: "0",
						result:
							"Free API access is not supported for this chain. Please upgrade to a paid plan",
					}),
				);
			return { transfers: [] };
		});
		const adapter = new ExplorerAdapter(opts, {
			kind: "etherscan",
			apiKey: "free",
		});
		const fallback = new FallbackExplorer([
			adapter,
			new AlchemyAdapter(opts, { kind: "alchemy", apiKey: "test-key" }),
		]);
		expect(await fallback.history("txlist", wallet, 0, 100)).toEqual([]);
		expect(fallback.notices[0]).toContain("paid plan");
	});
	it("fetches paid Etherscan Base receipts", async () => {
		const opts = options(8453, (req) =>
			req.method === "txlist"
				? new Response(JSON.stringify({ status: "1", result: [normal()] }))
				: receipt({ l1Fee: "0x64" }),
		);
		const rows = await new ExplorerAdapter(opts, {
			kind: "etherscan",
			apiKey: "paid",
			tier: "paid",
		}).history("txlist", wallet, 0, 100);
		expect(classified(8453, rows)[0]?.feeAmount).toBe("0.0000210000000001");
	});
	it("uses the configured per-chain order even if supplied keys are reversed", () => {
		const opts = options(8453, () => ({ transfers: [] }));
		opts.providers = [
			{ kind: "etherscan", apiKey: "paid" },
			{ kind: "alchemy", apiKey: "test-key" },
			{ kind: "nodereal", apiKey: "test-key" },
		];
		expect(createExplorer(opts).providerFor("txlist")).toBe("alchemy");
	});
	it("keeps amounts as exact decimals", () =>
		expect(D("0.0000210000000001").minus("0.000021").toFixed()).toBe(
			"0.0000000000000001",
		));
});
