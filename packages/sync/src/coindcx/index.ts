import { type CoinDcxSyncOptions, type Connector, D } from "@tax/core";
import { UpstreamError } from "../http.js";
import { amount, cursorObject, rows, text } from "../values.js";
import { CoinDcxClient } from "./client.js";
import { mapCoinDcxTrade } from "./map.js";
export const coindcxConnector: Connector<CoinDcxSyncOptions> = {
	async *sync(opts) {
		const client = new CoinDcxClient(opts);
		const markets = rows(await client.request("/exchange/v1/markets_details"));
		const stream = "coindcx:trades";
		let lastId = String(cursorObject(opts.cursors[stream]).lastId ?? "0");
		let fetched = 0;
		for (;;) {
			const page = rows(
				await client.request("/exchange/v1/orders/trade_history", {
					from_id: lastId,
					limit: 500,
					sort: "asc",
				}),
			);
			const fresh = page.filter(
				(row) => BigInt(text(row, "id")) > BigInt(lastId),
			);
			const unique = [
				...new Map(fresh.map((row) => [text(row, "id"), row])).values(),
			];
			if (unique.length)
				lastId = unique.reduce(
					(max, row) =>
						BigInt(text(row, "id")) > BigInt(max) ? text(row, "id") : max,
					lastId,
				);
			else if (page.length === 500)
				throw new UpstreamError("CoinDCX pagination did not advance");
			fetched += page.length;
			opts.onProgress?.({
				stream,
				streamsDone: 0,
				streamsTotal: 1,
				rowsFetched: fetched,
			});
			yield {
				stream,
				rows: unique.map((raw) => ({ tx: mapCoinDcxTrade(raw, markets) })),
				cursor: { lastId },
			};
			if (page.length < 500) break;
		}
	},
	async balances(opts) {
		return rows(
			await new CoinDcxClient(opts).request("/exchange/v1/users/balances"),
		).map((row) => ({
			asset: text(row, "currency"),
			amount: D(amount(row, "balance"))
				.plus(amount(row, "locked_balance"))
				.toFixed(),
			wallet: "spot",
		}));
	},
	async checkKey(opts) {
		await new CoinDcxClient(opts).request("/exchange/v1/users/balances");
		return {
			ok: true,
			readOnly: null,
			permissions: [],
			message:
				"CoinDCX keys cannot be restricted or verified as read-only; use IP binding. This client only allows read endpoints",
		};
	},
};
export { CoinDcxClient } from "./client.js";
export * from "./map.js";
export * from "./sign.js";
