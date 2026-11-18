import { readFileSync } from "node:fs";
import { parseJsonWithSource } from "@tax/sync";
import { describe, expect, it } from "vitest";
import type { ExplorerRow } from "../src/api.js";
import { type ClassifierInput, classifyTransactions } from "../src/classify.js";
import { knownTokensForChain, tokenAsset } from "../src/tokens.js";

const a = "0x1111111111111111111111111111111111111111",
	b = "0x2222222222222222222222222222222222222222",
	external = "0x3333333333333333333333333333333333333333";
const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
	dai = "0x6b175474e89094c44da98b954eedeac495271d0f";
function tx(patch: ExplorerRow = {}): ExplorerRow {
	return {
		hash: "0xabc",
		blockNumber: "100",
		timeStamp: "1600000000",
		from: a,
		to: external,
		value: "1000000000000000000",
		gasUsed: "21000",
		gasPrice: "1000000000",
		isError: "0",
		...patch,
	};
}
function token(patch: ExplorerRow = {}): ExplorerRow {
	return tx({
		value: "1000000",
		contractAddress: usdc,
		tokenDecimal: "6",
		tokenSymbol: "USDC",
		statusRep: "1",
		...patch,
	});
}
function classify(patch: Partial<ClassifierInput> = {}) {
	return classifyTransactions({
		chainId: 1,
		address: a,
		ownAddresses: [a, b],
		txlist: [],
		txlistinternal: [],
		tokentx: [],
		...patch,
	}).map((row) => row.tx);
}
function fixture(name: string): ExplorerRow {
	const data = parseJsonWithSource(
		readFileSync(
			new URL(
				`../../../docs/research/phase2-samples/${name}.json`,
				import.meta.url,
			),
			"utf8",
		),
	) as { result: ExplorerRow[] };
	const row = data.result[0];
	if (!row) throw new Error("Missing row");
	return row;
}
describe("EVM classifier", () => {
	it("classifies plain native outgoing with exact gas", () =>
		expect(classify({ txlist: [tx()] })[0]).toMatchObject({
			type: "withdrawal",
			amountOut: "1",
			assetOut: "ETH",
			feeAsset: "ETH",
			feeAmount: "0.000021",
			txHash: "0xabc",
		}));
	it("classifies incoming without charging someone else's gas", () => {
		const row = classify({ txlist: [tx({ from: external, to: a })] })[0];
		expect(row).toMatchObject({ type: "deposit", amountIn: "1" });
		expect(row?.feeAmount).toBeUndefined();
	});
	it("classifies internal transfers", () =>
		expect(
			classify({
				txlistinternal: [tx({ from: external, to: a, traceId: "0" })],
			})[0],
		).toMatchObject({ type: "deposit", amountIn: "1" }));
	it("classifies ERC20 with exact decimal conversion", () =>
		expect(
			classify({
				tokentx: [
					token({ from: external, to: a, value: "123456789012345678901" }),
				],
			})[0],
		).toMatchObject({
			type: "deposit",
			assetIn: "USDC",
			amountIn: "123456789012345.678901",
		}));
	it("emits own sender and receiver only from their respective connections", () => {
		const normal = tx({ to: b }),
			sent = classify({ txlist: [normal] });
		const received = classify({ address: b, txlist: [normal] });
		expect(sent).toHaveLength(1);
		expect(received).toHaveLength(1);
		expect(sent[0]?.type).toBe("withdrawal");
		expect(received[0]?.type).toBe("deposit");
		expect(sent[0]?.sourceRef).not.toBe(received[0]?.sourceRef);
		expect(sent[0]?.txHash).toBe(received[0]?.txHash);
		expect(received[0]?.feeAmount).toBeUndefined();
	});
	it("keeps own token transfers and does not mark unknown own assets unsolicited", () => {
		const unknown = token({
			to: b,
			contractAddress: external,
			tokenSymbol: "CUSTOM",
		});
		const received = classify({
			address: b,
			txlist: [],
			tokentx: [unknown],
		});
		expect(received[0]?.type).toBe("deposit");
		expect(received[0]?.reviewFlags).toEqual([]);
	});
	it("classifies a simple ETH/token swap", () =>
		expect(
			classify({
				txlist: [tx()],
				tokentx: [token({ from: external, to: a, value: "2000000000" })],
			})[0],
		).toMatchObject({
			type: "swap",
			assetOut: "ETH",
			amountOut: "1",
			assetIn: "USDC",
			amountIn: "2000",
			feeAmount: "0.000021",
		}));
	it("classifies a token/token swap", () =>
		expect(
			classify({
				txlist: [tx({ value: "0" })],
				tokentx: [
					token(),
					token({
						contractAddress: dai,
						tokenDecimal: "18",
						tokenSymbol: "DAI",
						from: external,
						to: a,
						value: "1000000000000000000",
					}),
				],
			})[0]?.type,
		).toBe("swap"));
	it.each(["1", "0"])("failed/approve tx is gas only (%s)", (failed) => {
		const rows = classify({
			txlist: [
				tx({
					isError: failed,
					value: failed === "1" ? "1000000000000000000" : "0",
				}),
			],
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ type: "fee", feeAmount: "0.000021" });
		expect(rows[0]?.amountOut).toBeUndefined();
	});
	it("keeps every complex multi-leg movement and charges gas once", () => {
		const rows = classify({
			txlist: [tx()],
			tokentx: [
				token({ from: external, to: a }),
				token({
					contractAddress: dai,
					tokenDecimal: "18",
					from: external,
					to: a,
				}),
			],
		});
		expect(rows).toHaveLength(3);
		expect(
			rows.every((row) =>
				row.reviewFlags.some((flag) => flag.code === "complex_onchain"),
			),
		).toBe(true);
		expect(rows.filter((row) => row.feeAmount)).toHaveLength(1);
	});
	it("does not guess a relayer/allowance movement is a swap", () => {
		const rows = classify({
			txlist: [tx({ from: external, to: a })],
			tokentx: [token()],
		});
		expect(rows.some((row) => row.type === "swap")).toBe(false);
		expect(
			rows.every((row) =>
				row.reviewFlags.some((flag) => flag.code === "complex_onchain"),
			),
		).toBe(true);
	});
	it("retains WETH wrapping as separate flagged legs", () => {
		const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
		const rows = classify({
			txlist: [tx({ to: weth })],
			tokentx: [
				token({
					contractAddress: weth,
					tokenDecimal: "18",
					from: weth,
					to: a,
					value: "1000000000000000000",
				}),
			],
		});
		expect(rows).toHaveLength(2);
		expect(
			rows.every((row) =>
				row.reviewFlags.some((flag) => flag.message.includes("wrap/unwrap")),
			),
		).toBe(true);
	});
	it.each([
		{ statusRep: "2" },
		{ contractAddress: external, tokenSymbol: "RANDOM" },
		{ contractAddress: external, tokenSymbol: "USDT" },
	] as ExplorerRow[])("flags inbound spam %j without dropping it", (patch) => {
		const rows = classify({
			tokentx: [token({ from: external, to: a, ...patch })],
		});
		expect(
			rows[0]?.reviewFlags.some((flag) => flag.code === "suspected_spam"),
		).toBe(true);
		expect(rows[0]?.amountIn).toBe("1");
	});
	it("preserves zero poisoning as an amount-free review marker", () => {
		const rows = classify({
			tokentx: [token({ from: external, to: a, value: "0" })],
		});
		expect(rows[0]).toMatchObject({
			type: "transfer",
			reviewFlags: [{ code: "suspected_spam" }],
		});
		expect(rows[0]?.amountIn).toBeUndefined();
		expect(rows[0]?.raw).toMatchObject({ tokentx: [{ value: "0" }] });
	});
	it("keeps one spam flag with all distinct reasons", () => {
		const [row] = classify({
			tokentx: [
				token({
					from: external,
					to: a,
					statusRep: "2",
					contractAddress: external,
					tokenSymbol: "USDT",
				}),
			],
		});
		expect(row?.reviewFlags).toEqual([
			{
				code: "suspected_spam",
				message:
					"Explorer marks this token unsafe.\nUnsolicited token from an unknown contract; verify before accepting.\nClaimed symbol imitates a known asset at a different contract.",
			},
		]);
	});
	it("does not exclude gas along with a spam receipt", () => {
		const rows = classify({
			txlist: [tx({ value: "0" })],
			tokentx: [token({ from: external, to: a, statusRep: "2" })],
		});
		expect(rows).toHaveLength(2);
		expect(rows.find((row) => row.type === "fee")?.reviewFlags).toEqual([]);
	});
	it("identifies unrecognised tokens by contract, never claimed ticker", () =>
		expect(tokenAsset(1, external)).toBe(`ERC20:1:${external.toUpperCase()}`));
	it("uses trusted registry decimals and flags a conflicting explorer claim", () => {
		const row = classify({
			tokentx: [token({ from: external, to: a, tokenDecimal: "18" })],
		})[0];
		expect(row?.amountIn).toBe("1");
		expect(row?.reviewFlags[0]?.code).toBe("parse_warning");
	});
	it("registry retains existing identities and includes researched additions", () => {
		expect(Object.keys(knownTokensForChain(1))).toHaveLength(31);
		expect(
			Object.keys(knownTokensForChain(1)).every((key) =>
				/^0x[0-9a-f]{40}$/.test(key),
			),
		).toBe(true);
	});
	it("official normal-tx sample is a gas-only delegate", () => {
		const row = fixture("etherscan-txlist");
		expect(
			classify({ address: row.from ?? a, txlist: [row] })[0],
		).toMatchObject({ type: "fee", feeAmount: "0.000011661947804494" });
	});
	it("official ERC20 sample maps Maker decimals exactly", () => {
		const row = fixture("etherscan-tokentx");
		expect(classify({ address: row.to ?? a, tokentx: [row] })[0]).toMatchObject(
			{ type: "deposit", assetIn: "MKR", amountIn: "5901.522149285533025181" },
		);
	});
	it("official zero internal create is preserved with a reason", () => {
		const row = fixture("etherscan-txlistinternal");
		expect(
			classify({ address: row.from ?? a, txlistinternal: [row] })[0],
		).toMatchObject({
			type: "transfer",
			reviewFlags: [{ code: "unknown_type" }],
			raw: { txlistinternal: [row] },
		});
	});
	it("stable refs survive explorer row reordering", () => {
		const one = token({ from: external, to: a }),
			two = token({
				contractAddress: dai,
				tokenDecimal: "18",
				from: external,
				to: a,
			});
		expect(
			classify({ tokentx: [one, two] }).map((row) => row.sourceRef),
		).toEqual(classify({ tokentx: [two, one] }).map((row) => row.sourceRef));
	});
});
it.each([
	[1, "ETH"],
	[8453, "ETH"],
	[42161, "ETH"],
	[137, "POL"],
	[56, "BNB"],
])("uses chain %s native asset %s for movements and gas", (chainId, native) => {
	const row = classify({ chainId, txlist: [tx()] })[0];
	expect(row?.assetOut).toBe(native);
	expect(row?.feeAsset).toBe(native);
	expect(row?.amountOut).toBe("1");
});
it("nets ETH refunds before classifying a swap", () => {
	const rows = classify({
		txlist: [tx()],
		txlistinternal: [
			tx({ from: external, to: a, value: "200000000000000000", traceId: "0" }),
		],
		tokentx: [token({ from: external, to: a })],
	});
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		type: "swap",
		assetOut: "ETH",
		amountOut: "0.8",
		assetIn: "USDC",
		amountIn: "1",
	});
});
it("keeps non-mainnet lookalike symbols flagged until that chain's registry is curated", () => {
	const rows = classify({
		chainId: 137,
		txlist: [tx({ value: "0" })],
		tokentx: [token({ from: external, to: a, tokenSymbol: "USDT" })],
	});
	expect(
		rows.some((row) =>
			row.reviewFlags.some((flag) => flag.code === "suspected_spam"),
		),
	).toBe(true);
});
