import { type CachedPrice, D, istDate } from "@tax/core";
import { HttpClient, type HttpOptions } from "@tax/sync/http";
export function createPriceRequest(options: HttpOptions = {}): PriceRequest {
	// 700 ms (~85 req/min) leaves safe jitter headroom below CoinGecko Demo's 100 req/min limit.
	const client = new HttpClient({ minIntervalMs: 700, ...options });
	return (url, init) => client.request(url, init);
}
export type PriceRequest = (
	url: string,
	init?: RequestInit,
) => Promise<unknown>;
export const priceDateFinal = (date: string, now: number): boolean =>
	now - Date.parse(`${date}T00:00:00+05:30`) >= 3 * 86400000;
export async function binanceKlines(input: {
	request: PriceRequest;
	baseUrl?: string;
	symbol: string;
	start: string;
	end: string;
	now: number;
}): Promise<CachedPrice[]> {
	const url = new URL(
		`${input.baseUrl || "https://data-api.binance.vision"}/api/v3/klines`,
	);
	const start = Date.parse(`${input.start}T00:00:00+05:30`);
	const end = Date.parse(`${input.end}T00:00:00+05:30`) + 86400000 - 1;
	if (end < start || end - start >= 1000 * 86400000)
		throw new Error("Kline range exceeds 1000 days");
	url.search = new URLSearchParams({
		symbol: input.symbol,
		interval: "1d",
		timeZone: "5:30",
		startTime: String(start),
		endTime: String(end),
		limit: "1000",
	}).toString();
	const data = await input.request(url.toString());
	if (!Array.isArray(data)) throw new Error("Invalid kline response");
	return data.flatMap((row: unknown) => {
		if (!Array.isArray(row) || row.length < 8)
			throw new Error("Invalid kline row");
		const timestamp = Number(row[0]);
		const date = istDate(new Date(timestamp).toISOString());
		if (timestamp < start || timestamp > end) return [];
		const close = String(row[4]);
		const volume = String(row[5]);
		const quoteVolume = String(row[7]);
		if (!D(close).isFinite() || !D(close).gt("0"))
			throw new Error("Invalid kline price");
		const base = {
			source: "binance_klines",
			sourceId: input.symbol,
			quote: "USDT",
			dayBasis: "IST" as const,
			date,
			final: priceDateFinal(date, input.now),
			fetchedAt: new Date(input.now).toISOString(),
		};
		return [
			{ ...base, kind: "close", price: D(close).toFixed() },
			...(D(volume).gt("0")
				? [
						{
							...base,
							kind: "vwap",
							price: D(quoteVolume).div(volume).toFixed(),
						},
					]
				: []),
		];
	});
}
export async function coingeckoHistory(input: {
	request: PriceRequest;
	baseUrl?: string;
	apiKey: string;
	coinId: string;
	date: string;
	now: number;
}): Promise<CachedPrice | null> {
	const instant = Date.parse(`${input.date}T00:00:00Z`);
	if (instant < input.now - 365 * 86400000 || instant > input.now) return null;
	const url = new URL(
		`${input.baseUrl || "https://api.coingecko.com/api/v3"}/coins/${encodeURIComponent(input.coinId)}/history`,
	);
	url.search = new URLSearchParams({
		date: input.date.split("-").reverse().join("-"),
		localization: "false",
	}).toString();
	const data = (await input.request(url.toString(), {
		headers: { "x-cg-demo-api-key": input.apiKey },
	})) as { market_data?: { current_price?: { inr?: unknown } } };
	// CoinGecko sends prices as JSON numbers; String() keeps the shortest exact decimal form.
	const raw = data?.market_data?.current_price?.inr;
	if (typeof raw !== "string" && typeof raw !== "number") return null;
	const price = String(raw);
	if (!D(price).isFinite() || !D(price).gt("0")) return null;
	return {
		source: "coingecko",
		sourceId: input.coinId,
		quote: "INR",
		dayBasis: "UTC",
		date: input.date,
		kind: "snapshot_00utc",
		price: D(price).toFixed(),
		final: priceDateFinal(input.date, input.now),
		fetchedAt: new Date(input.now).toISOString(),
	};
}

const coingeckoPlatforms = new Map([
	["1", "ethereum"],
	["8453", "base"],
	["42161", "arbitrum-one"],
	["137", "polygon-pos"],
	["56", "binance-smart-chain"],
]);

export async function coingeckoContractId(input: {
	request: PriceRequest;
	baseUrl?: string;
	apiKey: string;
	asset: string;
}): Promise<string | null> {
	const [, chainId, address] =
		/^ERC20:(\d+):0X([0-9A-F]{40})$/.exec(input.asset) ?? [];
	if (chainId === undefined || address === undefined) return null;
	const platform = coingeckoPlatforms.get(chainId);
	if (platform === undefined) return null;
	const url = `${input.baseUrl || "https://api.coingecko.com/api/v3"}/coins/${platform}/contract/0x${address.toLowerCase()}`;
	const data = (await input.request(url, {
		headers: { "x-cg-demo-api-key": input.apiKey },
	})) as { id?: unknown };
	return typeof data?.id === "string" && /^[a-z0-9_-]+$/.test(data.id)
		? data.id
		: null;
}
