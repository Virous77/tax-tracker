import type { BinanceSyncOptions, StreamBatch } from "@tax/core";
import { describe, expect, it, vi } from "vitest";
import { BinanceClient } from "../src/binance/client.js";
import { binanceConnector } from "../src/binance/index.js";
import {
	DAY,
	fetchHistory,
	type HistoryStream,
	historyStreams,
} from "../src/binance/streams.js";
import { CoinDcxClient } from "../src/coindcx/client.js";
import { UpstreamAuthError, UpstreamClockError } from "../src/http.js";
import { object } from "../src/values.js";
import { first, sample } from "./samples.js";

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));
const opts: BinanceSyncOptions = {
	credentials: { apiKey: "key", apiSecret: "secret" },
	baseUrls: { binance: "https://client.invalid" },
	knownAssets: [],
	extraSymbols: [],
	cursors: {},
	now: () => Date.parse("2026-01-01T00:00:00Z"),
};
function config(name: string): HistoryStream {
	const stream = historyStreams.find((s) => s.name === name);
	if (!stream) throw new Error("Missing config");
	return stream;
}
async function collect(
	client: BinanceClient,
	options: BinanceSyncOptions,
	stream: HistoryStream,
) {
	const batches: StreamBatch[] = [];
	for await (const batch of fetchHistory(client, options, stream))
		batches.push(batch);
	return batches;
}
describe("exchange clients", () => {
	it("rejects every mutating Binance and CoinDCX path before calling fetch", async () => {
		const fetcher = vi.fn();
		await expect(
			new BinanceClient({ ...opts, fetch: fetcher }).request("/api/v3/order"),
		).rejects.toThrow("allowed read");
		await expect(
			new CoinDcxClient({ ...opts, fetch: fetcher }).request(
				"/exchange/v1/orders/create",
			),
		).rejects.toThrow("allowed read");
		expect(fetcher).not.toHaveBeenCalled();
	});
	it.each([
		"enableWithdrawals",
		"enableSpotAndMarginTrading",
		"enableMargin",
		"enableFutures",
		"enableInternalTransfer",
		"permitsUniversalTransfer",
		"enableVanillaOptions",
		"enablePortfolioMarginTrading",
		"enableFixApiTrade",
	])("rejects unsafe Binance permission %s", async (permission) => {
		const client = new BinanceClient(opts);
		vi.spyOn(client, "request").mockResolvedValue({
			enableReading: true,
			[permission]: true,
		});
		expect(await client.checkKey()).toMatchObject({
			ok: true,
			readOnly: false,
		});
		await expect(client.requireReadOnly()).rejects.toBeInstanceOf(
			UpstreamAuthError,
		);
	});
	it("resynchronises clock once on -1021 and then succeeds", async () => {
		let requests = 0,
			times = 0;
		const fetcher: typeof fetch = async (url) => {
			if (String(url).includes("/time?")) {
				times++;
				return new Response(JSON.stringify({ serverTime: opts.now?.() }));
			}
			requests++;
			return requests === 1
				? new Response('{"code":-1021}', { status: 400 })
				: new Response('{"ok":true}');
		};
		const result = await new BinanceClient({ ...opts, fetch: fetcher }).request(
			"/api/v3/account",
		);
		expect(result).toEqual({ ok: true });
		expect(requests).toBe(2);
		expect(times).toBe(1);
	});
	it("fails after the single clock correction", async () => {
		let times = 0;
		const fetcher: typeof fetch = async (url) => {
			if (String(url).includes("/time?")) {
				times++;
				return new Response(JSON.stringify({ serverTime: opts.now?.() }));
			}
			return new Response('{"code":-1021}', { status: 400 });
		};
		await expect(
			new BinanceClient({ ...opts, fetch: fetcher }).request("/api/v3/account"),
		).rejects.toBeInstanceOf(UpstreamClockError);
		expect(times).toBe(1);
	});
	it("marks an initial 418 as incomplete and stops the whole sync", async () => {
		const fetcher = vi.fn(
			async () =>
				new Response("{}", { status: 418, headers: { "retry-after": "120" } }),
		);
		const batches: StreamBatch[] = [];
		for await (const batch of binanceConnector.sync({
			...opts,
			fetch: fetcher,
		}))
			batches.push(batch);
		expect(batches).toHaveLength(1);
		expect(batches[0]?.incomplete).toContain("ban");
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
describe("history windows and cursors", () => {
	it("offset-pages a full deposit window and retains its oldest pending row", async () => {
		const stream = config("deposits"),
			client = new BinanceClient(opts),
			pending = {
				...first(sample("binance-deposit-hisrec")),
				id: "pending",
				status: "0",
				insertTime: String((opts.now?.() ?? 0) - DAY),
			};
		const page = Array.from({ length: 1000 }, (_, index) => ({
			...first(sample("binance-deposit-hisrec")),
			id: String(index),
		}));
		const request = vi
			.spyOn(client, "request")
			.mockResolvedValueOnce(page)
			.mockResolvedValueOnce([pending]);
		const options = {
			...opts,
			cursors: { "binance:deposits": { endTime: opts.now?.() } },
		};
		const batches = await collect(client, options, stream);
		expect(batches[0]?.rows).toHaveLength(1000);
		expect(batches[0]?.cursor).toMatchObject({
			pendingSince: Number(pending.insertTime),
		});
		expect(request.mock.calls[1]?.[1]).toMatchObject({ offset: 1000 });
	});
	it("requeries seven days or the older pending timestamp, whichever is earlier", async () => {
		const client = new BinanceClient(opts),
			request = vi.spyOn(client, "request").mockResolvedValue([]),
			now = opts.now?.() ?? 0;
		await collect(
			client,
			{
				...opts,
				cursors: {
					"binance:deposits": { endTime: now, pendingSince: now - 10 * DAY },
				},
			},
			config("deposits"),
		);
		expect(request.mock.calls[0]?.[1]).toMatchObject({
			startTime: now - 10 * DAY,
		});
	});
	it("splits Convert ranges until moreData is false", async () => {
		const client = new BinanceClient(opts);
		vi.spyOn(client, "request").mockImplementation(async (_path, params) =>
			Number(params?.endTime) - Number(params?.startTime) > DAY
				? { list: [], moreData: true }
				: { list: [], moreData: false },
		);
		const batches = await collect(
			client,
			{ ...opts, cursors: { "binance:convert": { endTime: opts.now?.() } } },
			config("convert"),
		);
		expect(batches.every((batch) => !batch.incomplete)).toBe(true);
		expect(vi.mocked(client.request).mock.calls.length).toBeGreaterThan(3);
	});
	it("marks saturated dividend timestamps incomplete instead of skipping ties", async () => {
		const client = new BinanceClient(opts),
			raw = object(
				(sample("binance-assetDividend") as { rows: unknown[] }).rows[0],
			);
		vi.spyOn(client, "request").mockResolvedValue({
			rows: Array.from({ length: 500 }, (_, id) => ({
				...raw,
				id: String(id),
			})),
		});
		const batches = await collect(
			client,
			{ ...opts, cursors: { "binance:dividends": { endTime: opts.now?.() } } },
			config("dividends"),
		);
		expect(batches[0]?.incomplete).toContain("timestamp");
		expect(batches[0]?.cursor).toEqual({ endTime: opts.now?.() });
	});
	it("uses capped P2P history and the empty envelope without data", async () => {
		const client = new BinanceClient(opts),
			request = vi
				.spyOn(client, "request")
				.mockResolvedValue({ code: "000000", success: true, total: "0" });
		const batches = await collect(client, opts, config("p2p:BUY"));
		expect(batches[0]?.incomplete).toContain("six months");
		expect(batches.flatMap((batch) => batch.rows)).toEqual([]);
		for (const [, params] of request.mock.calls)
			expect(
				Number(params?.endTimestamp) - Number(params?.startTimestamp),
			).toBeLessThanOrEqual(30 * DAY);
	});
});
