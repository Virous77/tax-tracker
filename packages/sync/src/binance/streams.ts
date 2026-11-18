import type { BinanceSyncOptions, StreamBatch } from "@tax/core";
import { UpstreamError } from "../http.js";
import {
	type ApiRow,
	cursorObject,
	iso,
	object,
	rows,
	type SyncTx,
	text,
} from "../values.js";
import type { BinanceClient, Params } from "./client.js";
import {
	mapBinanceConvert,
	mapBinanceDeposit,
	mapBinanceDividend,
	mapBinanceEarnAudit,
	mapBinanceFiatOrder,
	mapBinanceFiatPayment,
	mapBinanceP2p,
	mapBinanceWithdrawal,
} from "./map.js";
export const DAY = 86_400_000;
export const FIRST_SYNC = Date.parse("2017-07-01T00:00:00Z");
export const discoveryStreams = new Set(["deposits", "dividends"]);
export interface HistoryStream {
	name: string;
	path: string;
	days: number;
	limit: number;
	shape: "array" | "data" | "rows" | "convert";
	paging: "offset" | "page" | "current" | "dividend" | "split";
	params?: Params;
	timeKeys?: [string, string];
	overlapDays?: number;
	map: (raw: ApiRow) => SyncTx | null;
	capMonths?: number;
}
export const historyStreams: HistoryStream[] = [
	{
		name: "deposits",
		path: "/sapi/v1/capital/deposit/hisrec",
		days: 89,
		limit: 1000,
		shape: "array",
		paging: "offset",
		overlapDays: 7,
		map: mapBinanceDeposit,
	},
	{
		name: "withdrawals",
		path: "/sapi/v1/capital/withdraw/history",
		days: 89,
		limit: 1000,
		shape: "array",
		paging: "offset",
		overlapDays: 7,
		map: mapBinanceWithdrawal,
	},
	{
		name: "convert",
		path: "/sapi/v1/convert/tradeFlow",
		days: 30,
		limit: 1000,
		shape: "convert",
		paging: "split",
		map: mapBinanceConvert,
	},
	{
		name: "dividends",
		path: "/sapi/v1/asset/assetDividend",
		days: 180,
		limit: 500,
		shape: "rows",
		paging: "dividend",
		map: mapBinanceDividend,
	},
	...["0", "1"].flatMap((direction) => [
		{
			name: `fiat:${direction}`,
			path: "/sapi/v1/fiat/orders",
			days: 89,
			limit: 500,
			shape: "data" as const,
			paging: "page" as const,
			timeKeys: ["beginTime", "endTime"] as [string, string],
			params: { transactionType: direction },
			map: (row: ApiRow) => mapBinanceFiatOrder(row, direction as "0" | "1"),
		},
		{
			name: `fiatpay:${direction}`,
			path: "/sapi/v1/fiat/payments",
			days: 89,
			limit: 500,
			shape: "data" as const,
			paging: "page" as const,
			timeKeys: ["beginTime", "endTime"] as [string, string],
			params: { transactionType: direction },
			map: (row: ApiRow) => mapBinanceFiatPayment(row, direction as "0" | "1"),
		},
	]),
	...["BUY", "SELL"].map((direction) => ({
		name: `p2p:${direction}`,
		path: "/sapi/v1/c2c/orderMatch/listUserOrderHistory",
		days: 30,
		limit: 100,
		shape: "data" as const,
		paging: "page" as const,
		params: { tradeType: direction },
		timeKeys: ["startTimestamp", "endTimestamp"] as [string, string],
		capMonths: 6,
		map: mapBinanceP2p,
	})),
	...["flexible", "locked"].map((kind) => ({
		name: `earn:${kind}`,
		path: `/sapi/v1/simple-earn/${kind}/history/rewardsRecord`,
		days: 30,
		limit: 100,
		shape: "rows" as const,
		paging: "current" as const,
		params: kind === "flexible" ? { type: "ALL" } : undefined,
		map: (row: ApiRow) => mapBinanceEarnAudit(row, kind),
	})),
];
function extract(data: unknown, stream: HistoryStream): ApiRow[] {
	if (stream.shape === "array") return rows(data);
	const envelope = object(data);
	if (
		envelope.success === false ||
		(envelope.code !== undefined && envelope.code !== "000000")
	)
		throw new UpstreamError("Upstream history envelope reports failure");
	return rows(
		envelope[stream.shape === "convert" ? "list" : stream.shape] ?? [],
	);
}
function stamp(row: ApiRow, name: string): number {
	const key = name === "withdrawals" ? "applyTime" : "insertTime";
	return Date.parse(iso(text(row, key)));
}
export async function* fetchHistory(
	client: BinanceClient,
	opts: BinanceSyncOptions,
	config: HistoryStream,
	firstStart = FIRST_SYNC,
): AsyncGenerator<StreamBatch> {
	const stream = `binance:${config.name}`;
	const old = cursorObject(opts.cursors[stream]);
	const now = (opts.now ?? Date.now)();
	let start = Math.max(
		FIRST_SYNC,
		typeof old.endTime === "number"
			? old.endTime - (config.overlapDays ?? 3) * DAY
			: firstStart,
	);
	if (typeof old.pendingSince === "number")
		start = Math.min(start, old.pendingSince);
	let incomplete: string | undefined;
	if (config.capMonths) {
		const cap = new Date(now);
		cap.setUTCMonth(cap.getUTCMonth() - config.capMonths);
		start = Math.max(start, cap.getTime());
		incomplete =
			"P2P API only returns the past six months; import older orders from a file";
	}
	let pendingSince: number | undefined;
	let earliestActivity =
		typeof old.earliestActivity === "number" ? old.earliestActivity : undefined;
	for (; start <= now; ) {
		const end = Math.min(now, start + config.days * DAY - 1);
		const collected: ApiRow[] = [];
		let windowIncomplete: string | undefined;
		const [startKey, endKey] = config.timeKeys ?? ["startTime", "endTime"];
		if (config.paging === "split") {
			const fetchRange = async (a: number, b: number): Promise<void> => {
				const data = object(
					await client.request(config.path, {
						...config.params,
						[startKey]: a,
						[endKey]: b,
						limit: config.limit,
					}),
				);
				if (data.moreData === true) {
					if (a === b) {
						collected.push(...extract(data, config));
						windowIncomplete =
							"Convert has more than 1000 records at one timestamp";
						return;
					}
					const middle = Math.floor((a + b) / 2);
					await fetchRange(a, middle);
					await fetchRange(middle + 1, b);
				} else collected.push(...extract(data, config));
			};
			await fetchRange(start, end);
		} else {
			let page = 1,
				boundary = end;
			for (;;) {
				const paging: Params =
					config.paging === "offset"
						? { offset: (page - 1) * config.limit, limit: config.limit }
						: config.paging === "page"
							? { page, rows: config.limit }
							: config.paging === "current"
								? { current: page, size: config.limit }
								: { limit: config.limit };
				const data = await client.request(config.path, {
					...config.params,
					[startKey]: start,
					[endKey]: boundary,
					...paging,
				});
				const batch = extract(data, config);
				collected.push(...batch);
				if (batch.length < config.limit) break;
				if (config.paging === "dividend") {
					const oldest = Math.min(
						...batch.map((row) => Number(text(row, "divTime"))),
					);
					if (batch.every((row) => Number(text(row, "divTime")) === oldest)) {
						windowIncomplete =
							"Dividend history fills a page at one timestamp; older records may be missing";
						break;
					}
					boundary = oldest;
				} else page++;
			}
		}
		if (config.name === "deposits" || config.name === "withdrawals") {
			for (const row of collected)
				if (["0", "4"].includes(text(row, "status"))) {
					const time = stamp(row, config.name);
					pendingSince = Math.min(pendingSince ?? time, time);
				}
		}
		const mapped = new Map<string, SyncTx>();
		const auditCounts = new Map<string, number>();
		for (const row of collected) {
			const tx = config.map(row);
			if (tx) {
				if (discoveryStreams.has(config.name))
					earliestActivity = Math.min(
						earliestActivity ?? now,
						Date.parse(tx.timestamp),
					);
				if (config.name.startsWith("earn:")) {
					const ref = tx.sourceRef,
						ordinal = auditCounts.get(ref) ?? 0;
					auditCounts.set(ref, ordinal + 1);
					tx.sourceRef = `${ref}#${ordinal}`;
				}
				mapped.set(tx.sourceRef, tx);
			}
		}
		yield {
			stream,
			rows: [...mapped.values()].map((tx) => ({ tx })),
			cursor: windowIncomplete
				? (opts.cursors[stream] ?? null)
				: {
						endTime: end,
						...(pendingSince === undefined ? {} : { pendingSince }),
						...(earliestActivity === undefined ? {} : { earliestActivity }),
					},
			...(incomplete || windowIncomplete
				? { incomplete: windowIncomplete ?? incomplete }
				: {}),
		};
		if (windowIncomplete) return;
		start = end + 1;
	}
}
