import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { BinanceSyncOptions, StreamBatch } from "@tax/core";
import { afterEach, expect, it, vi } from "vitest";
import { binanceConnector } from "../src/binance/index.js";
import { historyStreams } from "../src/binance/streams.js";
import { envelope, first, sample } from "./samples.js";

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of closers.splice(0)) await close();
});
async function collect(opts: BinanceSyncOptions) {
	const result: StreamBatch[] = [];
	for await (const batch of binanceConnector.sync(opts)) result.push(batch);
	return result;
}
async function stub() {
	const requests: URL[] = [];
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://stub");
		requests.push(url);
		res.setHeader("content-type", "application/json");
		const send = (data: unknown, status = 200) => {
			res.statusCode = status;
			res.end(JSON.stringify(data));
		};
		if (url.pathname === "/api/v3/time")
			return send({ serverTime: Date.now() });
		if (url.pathname === "/api/v3/exchangeInfo")
			return send({
				symbols: [{ symbol: "BNBBTC", baseAsset: "BNB", quoteAsset: "BTC" }],
				rateLimits: [],
			});
		const query = url.search.slice(1).split("&signature=")[0] ?? "";
		if (
			req.headers["x-mbx-apikey"] !== "key" ||
			url.searchParams.get("signature") !==
				createHmac("sha256", "secret").update(query).digest("hex")
		)
			return send({ code: -1022 }, 400);
		if (url.pathname.endsWith("apiRestrictions"))
			return send({ enableReading: true, enableSpotAndMarginTrading: false });
		if (url.pathname === "/api/v3/account")
			return send({
				balances: [
					{ asset: "BNB", free: "1", locked: "0" },
					{ asset: "BTC", free: "1", locked: "0" },
				],
			});
		if (url.pathname.endsWith("get-funding-asset")) return send([]);
		if (url.pathname.endsWith("/position")) return send({ rows: [], total: 0 });
		if (url.pathname === "/api/v3/myTrades")
			return send(sample("binance-myTrades"));
		if (url.pathname.endsWith("/dribblet"))
			return send(sample("binance-dribblet"));
		const config = historyStreams.find((c) => c.path === url.pathname);
		if (!config) return send({}, 404);
		const start = Number(
				url.searchParams.get(config.timeKeys?.[0] ?? "startTime"),
			),
			end = Number(url.searchParams.get(config.timeKeys?.[1] ?? "endTime"));
		let data: unknown[] = [];
		if (config.name === "deposits")
			data = [first(sample("binance-deposit-hisrec"))].filter(
				(row) =>
					Number(row.insertTime) >= start && Number(row.insertTime) <= end,
			);
		if (config.name === "withdrawals")
			data = [first(sample("binance-withdraw-history"))].filter(
				(row) =>
					Date.parse(`${String(row.applyTime).replace(" ", "T")}Z`) >= start &&
					Date.parse(`${String(row.applyTime).replace(" ", "T")}Z`) <= end,
			);
		if (config.name === "dividends")
			data = [envelope("binance-assetDividend")].filter(
				(row) => Number(row.divTime) >= start && Number(row.divTime) <= end,
			);
		if (config.shape === "array") return send(data);
		return send(
			config.shape === "convert"
				? { list: data, moreData: false }
				: config.shape === "data"
					? {
							code: "000000",
							success: true,
							total: data.length,
							...(data.length ? { data } : {}),
						}
					: { rows: data, total: data.length },
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	closers.push(
		() =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	);
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		requests,
		opts: {
			baseUrls: { binance: base },
			cursors: {},
			credentials: { apiKey: "key", apiSecret: "secret" },
			knownAssets: ["BNB", "BTC"],
			extraSymbols: [],
		} satisfies BinanceSyncOptions,
	};
}
it("full Binance sync verifies HMAC, walks every history stream and discovers knownAssets pairs", async () => {
	const { opts, requests } = await stub(),
		batches = await collect(opts),
		txs = batches.flatMap((batch) => batch.rows.map((row) => row.tx));
	expect(txs.some((tx) => tx.sourceRef === "trade:BNBBTC:28457")).toBe(true);
	expect(txs.some((tx) => tx.sourceRef.startsWith("deposit:"))).toBe(true);
	expect(txs.some((tx) => tx.sourceRef.startsWith("withdraw:"))).toBe(true);
	expect(
		batches.some(
			(batch) => batch.stream === "binance:dust" && batch.incomplete,
		),
	).toBe(true);
	expect(
		batches.some(
			(batch) => batch.stream === "binance:p2p:BUY" && batch.incomplete,
		),
	).toBe(true);
	for (const config of historyStreams)
		expect(requests.some((url) => url.pathname === config.path)).toBe(true);
	for (const url of requests.filter((url) => url.searchParams.has("startTime")))
		expect(
			Number(url.searchParams.get("endTime")) -
				Number(url.searchParams.get("startTime")),
		).toBeLessThanOrEqual(180 * 86400000);
});
it("resumes trade ids without mixing fromId with time windows", async () => {
	const { opts, requests } = await stub();
	opts.cursors = { "binance:myTrades:BNBBTC": { lastId: "28456" } };
	await collect(opts);
	const request = requests.find((url) => url.pathname === "/api/v3/myTrades");
	expect(request?.searchParams.get("fromId")).toBe("28457");
	expect(request?.searchParams.has("startTime")).toBe(false);
});
it("syncs Binance against the shared mock and records unsupported Earn balances", async () => {
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
	closers.push(mock.close);
	const opts: BinanceSyncOptions = {
		baseUrls: { binance: `${mock.url}/binance` },
		cursors: {},
		credentials: {
			apiKey: "mock-binance-key",
			apiSecret: "mock-binance-secret",
		},
		knownAssets: [],
		extraSymbols: [],
	};
	const batches = await collect(opts);
	expect(
		batches
			.flatMap((batch) => batch.rows)
			.some((row) => row.tx.sourceRef.startsWith("trade:ETHUSDT:")),
	).toBe(true);
	expect(batches.some((batch) => batch.stream === "binance:dust")).toBe(true);
});
