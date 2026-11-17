import {
	type BinanceSyncOptions,
	type Connector,
	D,
	type FetchedBalance,
	type StreamBatch,
} from "@tax/core";
import {
	UpstreamAuthError,
	UpstreamError,
	UpstreamRateLimitError,
} from "../http.js";
import {
	amount,
	cursorObject,
	object,
	rows,
	type SyncTx,
	splitPair,
	text,
} from "../values.js";
import { BinanceClient } from "./client.js";
import {
	discoverSymbols,
	mapBinanceDust,
	mapBinanceTrade,
	type SymbolInfo,
} from "./map.js";
import { fetchHistory, historyStreams } from "./streams.js";

async function balances(
	client: BinanceClient,
	onIncomplete?: (message: string) => void,
): Promise<FetchedBalance[]> {
	const result: FetchedBalance[] = [];
	const spot = rows(object(await client.request("/api/v3/account")).balances);
	for (const row of spot)
		result.push({
			asset: text(row, "asset"),
			amount: D(amount(row, "free")).plus(amount(row, "locked")).toFixed(),
			wallet: "spot",
		});
	for (const row of rows(
		await client.request("/sapi/v1/asset/get-funding-asset"),
	)) {
		const total = ["free", "locked", "freeze", "withdrawing"].reduce(
			(sum, key) => sum.plus(row[key] === undefined ? "0" : amount(row, key)),
			D("0"),
		);
		result.push({
			asset: text(row, "asset"),
			amount: total.toFixed(),
			wallet: "funding",
		});
	}
	// Position APIs are required for total-wallet reconciliation (research §7.3).
	for (const kind of ["flexible", "locked"]) {
		try {
			for (let current = 1; ; current++) {
				const page = rows(
					object(
						await client.request(`/sapi/v1/simple-earn/${kind}/position`, {
							current,
							size: 100,
						}),
					).rows ?? [],
				);
				for (const row of page)
					result.push({
						asset: text(row, "asset"),
						amount: amount(row, kind === "flexible" ? "totalAmount" : "amount"),
						wallet: "earn",
					});
				if (page.length < 100) break;
			}
		} catch (error) {
			if (
				!onIncomplete ||
				!(error instanceof UpstreamError) ||
				error.status !== 404
			)
				throw error;
			onIncomplete(
				`Simple Earn ${kind} position endpoint is unavailable; balance discovery is incomplete`,
			);
		}
	}
	const totals = new Map<string, FetchedBalance>();
	for (const balance of result) {
		const key = `${balance.wallet}:${balance.asset}`,
			old = totals.get(key);
		totals.set(key, {
			...balance,
			amount: D(old?.amount ?? "0")
				.plus(balance.amount)
				.toFixed(),
		});
	}
	return [...totals.values()];
}
async function* sync(opts: BinanceSyncOptions): AsyncGenerator<StreamBatch> {
	const client = new BinanceClient(opts);
	const assets = new Set(opts.knownAssets.map((asset) => asset.toUpperCase()));
	const collect = (tx: SyncTx) => {
		for (const asset of [tx.assetIn, tx.assetOut, tx.feeAsset])
			if (asset) assets.add(asset);
		if (tx.raw && typeof tx.raw === "object" && !Array.isArray(tx.raw)) {
			for (const key of [
				"asset",
				"coin",
				"fromAsset",
				"toAsset",
				"fiatCurrency",
				"cryptoCurrency",
				"fiat",
			]) {
				const value = (tx.raw as Record<string, unknown>)[key];
				if (typeof value === "string") assets.add(value.toUpperCase());
			}
		}
	};
	let done = 0,
		fetched = 0;
	let stream = "binance:key-check";
	try {
		await client.time();
		await client.requireReadOnly();
		stream = "binance:balances";
		const balanceNotices: string[] = [];
		for (const balance of await balances(client, (message) =>
			balanceNotices.push(message),
		))
			if (D(balance.amount).gt("0")) assets.add(balance.asset);
		if (balanceNotices.length)
			yield {
				stream,
				rows: [],
				cursor: null,
				incomplete: balanceNotices.join("; "),
			};
		for (const config of historyStreams) {
			stream = `binance:${config.name}`;
			for await (const batch of fetchHistory(client, opts, config)) {
				for (const row of batch.rows) collect(row.tx);
				fetched += batch.rows.length;
				opts.onProgress?.({
					stream,
					streamsDone: done,
					streamsTotal: null,
					rowsFetched: fetched,
				});
				yield batch;
			}
			done++;
		}
		stream = "binance:dust";
		const dust = object(
			await client.request("/sapi/v1/asset/dribblet", { accountType: "SPOT" }),
		);
		const dustRows = rows(dust.userAssetDribblets ?? []).flatMap((parent) =>
			rows(parent.userAssetDribbletDetails).map((raw) =>
				mapBinanceDust(raw, parent),
			),
		);
		dustRows.forEach(collect);
		yield {
			stream,
			rows: dustRows.map((tx) => ({ tx })),
			cursor: null,
			incomplete:
				"Dust API exposes only the latest 100 records after 2020-12-01; import older history from a file",
		};
		done++;
		stream = "binance:symbols";
		const info: SymbolInfo[] = rows(
			object(await client.request("/api/v3/exchangeInfo", {}, false)).symbols,
		).map((row) => ({
			symbol: text(row, "symbol"),
			baseAsset: text(row, "baseAsset"),
			quoteAsset: text(row, "quoteAsset"),
		}));
		const symbols = discoverSymbols(info, assets, opts.extraSymbols);
		for (const extra of opts.extraSymbols.map((v) => v.toUpperCase()))
			if (!symbols.some((row) => row.symbol === extra)) {
				const parts = splitPair(extra);
				if (parts)
					symbols.push({
						symbol: extra,
						baseAsset: parts[0],
						quoteAsset: parts[1],
					});
				else
					yield {
						stream: `binance:myTrades:${extra}`,
						rows: [],
						cursor: opts.cursors[`binance:myTrades:${extra}`] ?? null,
						incomplete:
							"Extra symbol is absent from exchangeInfo and cannot be split safely",
					};
			}
		for (const market of symbols) {
			stream = `binance:myTrades:${market.symbol}`;
			let lastId = String(cursorObject(opts.cursors[stream]).lastId ?? "-1");
			for (;;) {
				let page: ReturnType<typeof rows>;
				try {
					page = rows(
						await client.request("/api/v3/myTrades", {
							symbol: market.symbol,
							fromId: (BigInt(lastId) + 1n).toString(),
							limit: 1000,
						}),
					);
				} catch (error) {
					if (error instanceof UpstreamError && error.code === "-1121") {
						yield {
							stream,
							rows: [],
							cursor: { lastId },
							incomplete:
								"Symbol is delisted or unavailable; verify trades against a file export",
						};
						break;
					}
					throw error;
				}
				const mapped = page.map((raw) => ({
					tx: mapBinanceTrade(raw, market),
				}));
				if (page.length) {
					const next = page.reduce(
						(max, row) =>
							BigInt(text(row, "id")) > BigInt(max) ? text(row, "id") : max,
						lastId,
					);
					if (BigInt(next) <= BigInt(lastId))
						throw new UpstreamError("Binance trade pagination did not advance");
					lastId = next;
				}
				fetched += page.length;
				opts.onProgress?.({
					stream,
					streamsDone: done,
					streamsTotal: historyStreams.length + 1 + symbols.length,
					rowsFetched: fetched,
				});
				yield { stream, rows: mapped, cursor: { lastId } };
				if (page.length < 1000) break;
			}
			done++;
		}
	} catch (error) {
		if (error instanceof UpstreamAuthError) throw error;
		if (!(error instanceof UpstreamError)) throw error;
		yield {
			stream,
			rows: [],
			cursor: opts.cursors[stream] ?? null,
			incomplete:
				error instanceof UpstreamRateLimitError && error.hardStop
					? `Binance IP ban; retry after ${error.retryAfterMs} ms`
					: error.message,
		};
	}
}
export const binanceConnector: Connector<BinanceSyncOptions> = {
	sync,
	async balances(opts) {
		const client = new BinanceClient(opts);
		await client.time();
		await client.requireReadOnly();
		return balances(client);
	},
	async checkKey(opts) {
		const client = new BinanceClient(opts);
		await client.time();
		return client.checkKey();
	},
};
export { BinanceClient } from "./client.js";
export * from "./map.js";
export * from "./sign.js";
