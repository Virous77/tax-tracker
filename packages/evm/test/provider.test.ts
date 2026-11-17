import type { EvmSyncOptions } from "@tax/core";
import { UpstreamAuthError, UpstreamError } from "@tax/sync";
import { expect, it, vi } from "vitest";
import { ExplorerAdapter } from "../src/provider.js";

const wallet = "0x1111111111111111111111111111111111111111";
function options(fetcher: typeof fetch): EvmSyncOptions {
	return {
		chainId: 137,
		address: wallet,
		ownAddresses: [wallet],
		providers: [],
		baseUrls: {
			etherscan: "https://ether-test.invalid/api",
			blockscout: "https://block-test.invalid/api",
		},
		cursors: {},
		fetch: fetcher,
	};
}
it("Etherscan sends chainid and a key while requesting page one with offset 1000", async () => {
	const fetcher = vi.fn(
		async (_url: Parameters<typeof fetch>[0]) =>
			new Response(
				'{"status":"0","message":"No transactions found","result":[]}',
			),
	);
	const adapter = new ExplorerAdapter(options(fetcher), {
		kind: "etherscan",
		apiKey: "key",
	});
	expect(await adapter.history("txlist", wallet, 1, 100)).toEqual([]);
	const url = new URL(String(fetcher.mock.calls[0]?.[0]));
	expect(url.searchParams.get("chainid")).toBe("137");
	expect(url.searchParams.get("apikey")).toBe("key");
	expect(url.searchParams.get("page")).toBe("1");
	expect(url.searchParams.get("offset")).toBe("1000");
});
it("Blockscout sends chain_id and authorization without putting the key in the URL", async () => {
	let url = "",
		headers: RequestInit["headers"];
	const fetcher: typeof fetch = async (target, init) => {
		url = String(target);
		headers = init?.headers;
		return new Response('{"status":"1","result":"123456789012345678901234"}');
	};
	const adapter = new ExplorerAdapter(options(fetcher), {
		kind: "blockscout",
		apiKey: "proapi_key",
	});
	expect(await adapter.balance(wallet)).toBe("123456789012345678901234");
	expect(new URL(url).searchParams.get("chain_id")).toBe("137");
	expect(new URL(url).searchParams.has("apikey")).toBe(false);
	expect(headers).toMatchObject({ authorization: "proapi_key" });
});
it("parses a proxy block number", async () => {
	const adapter = new ExplorerAdapter(
		options(async () => new Response('{"jsonrpc":"2.0","result":"0x100"}')),
		{ kind: "etherscan", apiKey: "key" },
	);
	expect(await adapter.blockNumber()).toBe(256);
});
it.each([
	["Invalid API Key", UpstreamAuthError],
	["Missing or unsupported chainid", UpstreamError],
])("surfaces explorer error %s", async (message, error) => {
	const opts = options(
		async () => new Response(JSON.stringify({ status: "0", result: message })),
	);
	opts.baseUrls.etherscan = `https://${message.startsWith("Invalid") ? "auth" : "chain"}-test.invalid`;
	await expect(
		new ExplorerAdapter(opts, { kind: "etherscan", apiKey: "key" }).history(
			"txlist",
			wallet,
			0,
			100,
		),
	).rejects.toBeInstanceOf(error);
});
