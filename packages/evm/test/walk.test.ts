import {
	UpstreamAuthError,
	UpstreamError,
	UpstreamRateLimitError,
} from "@tax/sync";
import { describe, expect, it, vi } from "vitest";
import type { ExplorerRow } from "../src/api.js";
import {
	type ExplorerProvider,
	ExplorerRangeError,
	FallbackExplorer,
} from "../src/provider.js";
import { rawRowKeys, walkBlocks } from "../src/walk.js";

const wallet = "0x1111111111111111111111111111111111111111";
function row(
	index: number,
	blockNumber = Math.floor(index / 3) + 1,
): ExplorerRow {
	return {
		hash: `0x${index}`,
		blockNumber: String(blockNumber),
		timeStamp: "1600000000",
		from: wallet,
		to: wallet,
		value: "1",
		contractAddress: wallet,
		traceId: String(index),
	};
}
function provider(data: ExplorerRow[]): ExplorerProvider {
	return {
		history: vi.fn(async (_action, _address, start, end) =>
			data
				.filter(
					(row) =>
						Number(row.blockNumber) >= start && Number(row.blockNumber) <= end,
				)
				.slice(0, 1000),
		),
		blockNumber: async () => 10000,
		balance: async () => "0",
		tokenBalance: async () => "0",
	};
}
describe("block walking", () => {
	it("walks over 3000 rows, overlaps split blocks and never uses page 2", async () => {
		const data = Array.from({ length: 3507 }, (_, i) => row(i)),
			upstream = provider(data);
		const result = await walkBlocks(upstream, "tokentx", wallet, 0, 2000);
		expect(result.rows).toHaveLength(3507);
		expect(result.lastBlock).toBe(2000);
		expect(result.incomplete).toBeUndefined();
		expect(vi.mocked(upstream.history).mock.calls.length).toBeGreaterThan(3);
	});
	it("stops safely on a single saturated block", async () => {
		const result = await walkBlocks(
			provider(Array.from({ length: 1001 }, (_, i) => row(i, 10))),
			"tokentx",
			wallet,
			0,
			20,
		);
		expect(result.incomplete).toContain("1000");
		expect(result.lastBlock).toBe(9);
		expect(result.rows).toEqual([]);
	});
	it("halves a timeout range and continues the unqueried remainder", async () => {
		const upstream = provider(
			Array.from({ length: 90 }, (_, i) => row(i, i + 1)),
		);
		const original = upstream.history;
		upstream.history = async (action, address, start, end) => {
			if (end - start > 20) throw new ExplorerRangeError("timeout");
			return original(action, address, start, end);
		};
		expect(
			(await walkBlocks(upstream, "txlist", wallet, 0, 100)).rows,
		).toHaveLength(90);
	});
	it("marks single-block timeouts incomplete", async () => {
		const upstream = provider([]);
		upstream.history = async () => {
			throw new ExplorerRangeError("timeout");
		};
		expect(
			(await walkBlocks(upstream, "txlist", wallet, 10, 10)).lastBlock,
		).toBe(9);
	});
	it("keeps identical token events using ordinals", () => {
		const token = row(1);
		expect(rawRowKeys("tokentx", [token, token])).toEqual([
			`erc20:0x1:${wallet}:${wallet}:${wallet}:1#0`,
			`erc20:0x1:${wallet}:${wallet}:${wallet}:1#1`,
		]);
	});
	it("uses trace ids for internal identities", () =>
		expect(rawRowKeys("txlistinternal", [row(1)])[0]).toBe("int:0x1:1"));
});
describe("provider fallback", () => {
	it.each([
		new UpstreamRateLimitError("limited"),
		new UpstreamError("outage", 503),
	])("fails over on %s", async (error) => {
		const first = provider([]),
			second = provider([]);
		first.blockNumber = async () => {
			throw error;
		};
		second.blockNumber = vi.fn(async () => 42);
		const fallback = new FallbackExplorer([first, second]);
		expect(await fallback.blockNumber()).toBe(42);
		expect(await fallback.blockNumber()).toBe(42);
	});
	it("does not mask invalid credentials with another provider", async () => {
		const first = provider([]),
			second = provider([]);
		first.blockNumber = async () => {
			throw new UpstreamAuthError("bad key", 401);
		};
		second.blockNumber = vi.fn();
		await expect(
			new FallbackExplorer([first, second]).blockNumber(),
		).rejects.toBeInstanceOf(UpstreamAuthError);
		expect(second.blockNumber).not.toHaveBeenCalled();
	});
});
