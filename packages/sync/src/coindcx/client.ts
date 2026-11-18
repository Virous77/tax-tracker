import type { CoinDcxSyncOptions } from "@tax/core";
import { HttpClient, UpstreamError } from "../http.js";
import { signCoinDcx } from "./sign.js";

const READS = new Set([
	"/exchange/v1/orders/trade_history",
	"/exchange/v1/users/balances",
]);
export class CoinDcxClient {
	private http: HttpClient;
	constructor(private opts: CoinDcxSyncOptions) {
		this.http = new HttpClient({
			fetch: opts.fetch,
			now: opts.now,
			minIntervalMs: 350,
			vendor: "CoinDCX",
			redact: [opts.credentials.apiSecret],
		});
	}
	async request(
		path: string,
		params: Record<string, unknown> = {},
	): Promise<unknown> {
		const market = path === "/exchange/v1/markets_details";
		if (!market && !READS.has(path))
			throw new UpstreamError("CoinDCX path is not an allowed read");

		return this.http.request(
			`${this.opts.baseUrls.coindcx ?? "https://api.coindcx.com"}${path}`,
			{
				method: market ? "GET" : "POST",
				signal: this.opts.signal,
				prepare: market
					? undefined
					: (_target, request) => {
							const body = JSON.stringify({
								...params,
								timestamp: (this.opts.now ?? Date.now)(),
							});
							request.body = body;
							request.headers = {
								"Content-Type": "application/json",
								"X-AUTH-APIKEY": this.opts.credentials.apiKey,
								"X-AUTH-SIGNATURE": signCoinDcx(
									body,
									this.opts.credentials.apiSecret,
								),
							};
						},
			},
		);
	}
}
