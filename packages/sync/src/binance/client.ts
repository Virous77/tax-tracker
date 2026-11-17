import type { BinanceSyncOptions, KeyCheck } from "@tax/core";
import {
	HttpClient,
	UpstreamAuthError,
	UpstreamClockError,
	UpstreamError,
} from "../http.js";
import { object, rows, text } from "../values.js";
import { signBinance } from "./sign.js";

const READ_PATHS = new Set([
	"/api/v3/time",
	"/api/v3/exchangeInfo",
	"/api/v3/myTrades",
	"/api/v3/account",
	"/sapi/v1/account/apiRestrictions",
	"/sapi/v1/capital/deposit/hisrec",
	"/sapi/v1/capital/withdraw/history",
	"/sapi/v1/convert/tradeFlow",
	"/sapi/v1/asset/dribblet",
	"/sapi/v1/asset/assetDividend",
	"/sapi/v1/fiat/orders",
	"/sapi/v1/fiat/payments",
	"/sapi/v1/c2c/orderMatch/listUserOrderHistory",
	"/sapi/v1/simple-earn/flexible/history/rewardsRecord",
	"/sapi/v1/simple-earn/locked/history/rewardsRecord",
	"/sapi/v1/simple-earn/flexible/position",
	"/sapi/v1/simple-earn/locked/position",
	"/sapi/v1/asset/get-funding-asset",
	"/sapi/v3/asset/getUserAsset",
]);
export type Params = Record<string, string | number | boolean>;
export class BinanceClient {
	private http: HttpClient;
	private offset = 0;
	private spotLimit = 6000;
	private used = new Map<string, { count: number; at: number }>();
	constructor(private opts: BinanceSyncOptions) {
		this.http = new HttpClient({
			fetch: opts.fetch,
			now: opts.now,
			minIntervalMs: 400,
		});
	}
	async time(): Promise<void> {
		const before = (this.opts.now ?? Date.now)();
		const result = object(await this.request("/api/v3/time", {}, false));
		this.offset =
			Number(text(result, "serverTime")) -
			Math.floor((before + (this.opts.now ?? Date.now)()) / 2);
	}
	async request(
		path: string,
		params: Params = {},
		signed = true,
	): Promise<unknown> {
		if (!READ_PATHS.has(path))
			throw new UpstreamError("Binance path is not an allowed read");
		const method = [
			"/sapi/v1/asset/get-funding-asset",
			"/sapi/v3/asset/getUserAsset",
		].includes(path)
			? "POST"
			: "GET";
		for (let attempt = 0; ; attempt++) {
			const query = new URLSearchParams(
				Object.entries(params).map(([key, value]) => [key, String(value)]),
			);

			const url = `${this.opts.baseUrls.binance ?? "https://api.binance.com"}${path}?${query}`;
			try {
				const value = await this.http.request(url, {
					method,
					headers: signed
						? { "X-MBX-APIKEY": this.opts.credentials.apiKey }
						: {},
					signal: this.opts.signal,
					notBeforeMs: this.notBefore(path),
					prepare: signed
						? (target) => {
								target.searchParams.delete("signature");
								target.searchParams.set("recvWindow", "5000");
								target.searchParams.set(
									"timestamp",
									String((this.opts.now ?? Date.now)() + this.offset),
								);
								target.searchParams.set(
									"signature",
									signBinance(
										target.searchParams.toString(),
										this.opts.credentials.apiSecret,
									),
								);
							}
						: undefined,
					onResponse: (response) => {
						const budget = this.budget(path),
							key = `${budget.scope}:${budget.header}`;
						const count = response.headers.get(budget.header),
							now = (this.opts.now ?? Date.now)(),
							old = this.used.get(key);
						this.used.set(key, {
							count:
								count !== null
									? Number(count)
									: (old && now - old.at < 60_000 ? old.count : 0) +
										budget.weight,
							at:
								count !== null || !old || now - old.at >= 60_000 ? now : old.at,
						});
					},
				});
				if (path === "/api/v3/exchangeInfo") {
					for (const limit of rows(object(value).rateLimits ?? []))
						if (
							limit.rateLimitType === "REQUEST_WEIGHT" &&
							limit.interval === "MINUTE" &&
							text(limit, "intervalNum") === "1"
						)
							this.spotLimit = Number(text(limit, "limit"));
				}
				return value;
			} catch (error) {
				if (!(error instanceof UpstreamClockError) || attempt !== 0 || !signed)
					throw error;
				await this.time();
			}
		}
	}
	private budget(path: string) {
		const spot = path.startsWith("/api/"),
			uid =
				path.includes("/fiat/orders") ||
				path.includes("/withdraw/") ||
				path.includes("/convert/");
		const weight = spot
			? path.endsWith("/time")
				? 1
				: 20
			: path.includes("/fiat/orders")
				? 90_000
				: path.includes("/withdraw/")
					? 18_000
					: path.includes("/convert/")
						? 3000
						: path.includes("simple-earn")
							? 150
							: 10;
		return {
			scope: spot ? "spot" : path,
			header: spot
				? "x-mbx-used-weight-1m"
				: uid
					? "x-sapi-used-uid-weight-1m"
					: "x-sapi-used-ip-weight-1m",
			limit: spot ? this.spotLimit : uid ? 180_000 : 12_000,
			weight,
		};
	}
	private notBefore(path: string): number {
		const budget = this.budget(path),
			used = this.used.get(`${budget.scope}:${budget.header}`);
		return used && used.count + budget.weight > budget.limit / 2
			? used.at + 60_000
			: 0;
	}
	async checkKey(): Promise<KeyCheck> {
		const row = object(await this.request("/sapi/v1/account/apiRestrictions"));
		const permissions = Object.entries(row)
			.filter(([, value]) => value === true)
			.map(([key]) => key);
		const unsafe = [
			"enableWithdrawals",
			"enableSpotAndMarginTrading",
			"enableMargin",
			"enableFutures",
			"enableInternalTransfer",
			"permitsUniversalTransfer",
			"enableVanillaOptions",
			"enablePortfolioMarginTrading",
			"enableFixApiTrade",
		].some((key) => row[key] === true);
		return {
			ok: row.enableReading === true,
			readOnly: !unsafe && row.enableReading === true,
			permissions,
			message: unsafe
				? "Key can trade, transfer or withdraw; create a reading-only key"
				: row.enableReading === true
					? "Read-only key verified"
					: "Reading permission is required",
		};
	}
	async requireReadOnly(): Promise<void> {
		const result = await this.checkKey();
		if (!result.ok || !result.readOnly)
			throw new UpstreamAuthError(
				"Binance sync requires a verified read-only key",
			);
	}
}
