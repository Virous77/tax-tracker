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
import {
	DAY,
	discoveryStreams,
	FIRST_SYNC,
	fetchHistory,
	type HistoryStream,
	historyStreams,
} from "./streams.js";

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
	const now = (opts.now ?? Date.now)();
	const cursors = { ...opts.cursors };
	let earliest = now;
	const observe = (time: unknown) => {
		if (typeof time === "number" && Number.isFinite(time) && time >= FIRST_SYNC)
			earliest = Math.min(earliest, time);
	};
	for (const cursor of Object.values(cursors))
		observe(cursorObject(cursor).earliestActivity);
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
	let done = 0;
	let fetched = 0;
	let streamsTotal: number | null = null;
	let stream = "binance:key-check";
	const progress = (waitingUntil?: number) =>
		opts.onProgress?.({
			stream,
			streamsDone: done,
			streamsTotal,
			rowsFetched: fetched,
			waitingUntil,
		});
	const client = new BinanceClient(opts, progress);
	async function* walkHistory(config: HistoryStream, start?: number) {
		stream = `binance:${config.name}`;
		for await (const batch of fetchHistory(client, opts, config, start)) {
			for (const row of batch.rows) collect(row.tx);
			observe(cursorObject(batch.cursor).earliestActivity);
			cursors[stream] = batch.cursor;
			fetched += batch.rows.length;
			progress();
			yield batch;
		}
		done++;
	}
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
		// These low-weight streams expose older history in the widest available windows.
		for (const config of historyStreams)
			if (discoveryStreams.has(config.name)) yield* walkHistory(config);
		stream = "binance:dust";
		const dust = object(
			await client.request("/sapi/v1/asset/dribblet", { accountType: "SPOT" }),
		);
		const dustRows = rows(dust.userAssetDribblets ?? []).flatMap((parent) =>
			rows(parent.userAssetDribbletDetails).map((raw) =>
				mapBinanceDust(raw, parent),
			),
		);
		for (const tx of dustRows) {
			collect(tx);
			observe(Date.parse(tx.timestamp));
		}
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
		const extraMarkets: SymbolInfo[] = [];
		for (const extra of new Set(
			opts.extraSymbols.map((symbol) => symbol.toUpperCase()),
		)) {
			if (info.some((market) => market.symbol === extra)) continue;
			const parts = splitPair(extra);
			if (parts)
				extraMarkets.push({
					symbol: extra,
					baseAsset: parts[0],
					quoteAsset: parts[1],
				});
			else
				yield {
					stream: `binance:myTrades:${extra}`,
					rows: [],
					cursor: cursors[`binance:myTrades:${extra}`] ?? null,
					incomplete:
						"Extra symbol is absent from exchangeInfo and cannot be split safely",
				};
		}
		const completedMarkets = new Set<string>();
		const markets = () =>
			[
				...discoverSymbols(info, assets, opts.extraSymbols),
				...extraMarkets,
			].filter((market) => !completedMarkets.has(market.symbol));
		async function* walkTrades(symbols: SymbolInfo[]) {
			for (const market of symbols) {
				stream = `binance:myTrades:${market.symbol}`;
				const old = cursorObject(cursors[stream]);
				let lastId = String(old.lastId ?? "-1");
				let earliestActivity =
					typeof old.earliestActivity === "number"
						? old.earliestActivity
						: undefined;
				completedMarkets.add(market.symbol);
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
								cursor: cursors[stream] ?? { lastId },
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
							throw new UpstreamError(
								"Binance trade pagination did not advance",
							);
						lastId = next;
					}
					for (const { tx } of mapped) {
						collect(tx);
						observe(Date.parse(tx.timestamp));
						earliestActivity = Math.min(
							earliestActivity ?? now,
							Date.parse(tx.timestamp),
						);
					}
					const cursor = {
						lastId,
						...(earliestActivity === undefined ? {} : { earliestActivity }),
					};
					cursors[stream] = cursor;
					fetched += page.length;
					progress();
					yield { stream, rows: mapped, cursor };
					if (page.length < 1000) break;
				}
				done++;
			}
		}
		const remainingHistory = historyStreams.filter(
			(config) => !discoveryStreams.has(config.name),
		);
		const historyStartStream = "binance:history-start";
		const previousStart = cursorObject(cursors[historyStartStream]).firstStart;
		const discovering = remainingHistory.some(
			(config) =>
				!config.capMonths &&
				typeof cursorObject(cursors[`binance:${config.name}`]).endTime !==
					"number",
		);
		if (discovering) yield* walkTrades(markets());
		// Observed activity is a hint, not proof there were no earlier fiat or Convert transactions.
		const firstStart =
			typeof previousStart === "number"
				? previousStart
				: Math.max(FIRST_SYNC, Math.min(earliest - 89 * DAY, now - 365 * DAY));
		if (
			firstStart > FIRST_SYNC &&
			(discovering || previousStart !== undefined)
		) {
			yield {
				stream: historyStartStream,
				rows: [],
				cursor: { firstStart },
				incomplete: `Some Binance API histories were scanned from ${new Date(firstStart).toISOString().slice(0, 10)} onward. Import earlier exports to cover any older activity.`,
			};
		}
		for (const config of remainingHistory)
			yield* walkHistory(config, config.capMonths ? FIRST_SYNC : firstStart);
		const finalMarkets = markets();
		streamsTotal = done + finalMarkets.length;
		yield* walkTrades(finalMarkets);
	} catch (error) {
		if (error instanceof UpstreamAuthError) throw error;
		if (!(error instanceof UpstreamError)) throw error;
		yield {
			stream,
			rows: [],
			cursor: cursors[stream] ?? null,
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
		const client = new BinanceClient(opts, (waitingUntil) =>
			opts.onProgress?.({
				stream: "binance:balances",
				streamsDone: 0,
				streamsTotal: null,
				rowsFetched: 0,
				waitingUntil,
			}),
		);
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
