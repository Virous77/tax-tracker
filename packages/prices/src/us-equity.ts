import { D, type EquityCyPrice, PositiveDecimalSchema } from "@tax/core";
import type { PriceRequest } from "./clients.js";
import type { EquityHoldingEvent } from "./equity-planner.js";

export {
	type EquityHoldingEvent,
	planEquityPriceFill,
} from "./equity-planner.js";

export interface DailyEquityBar {
	date: string;
	high: string;
	close: string;
}

interface BarsRequest {
	request: PriceRequest;
	baseUrl?: string;
	apiKey: string;
	symbol: string;
	from: string;
	to: string;
}

function dailyBar(
	{ from, to }: BarsRequest,
	timestamp: unknown,
	scale: number,
	high: unknown,
	close: unknown,
): DailyEquityBar[] {
	if (typeof timestamp !== "number" && typeof timestamp !== "string") return [];
	if (typeof high !== "number" && typeof high !== "string") return [];
	if (typeof close !== "number" && typeof close !== "string") return [];
	const instant = new Date(Number(timestamp) * scale);
	if (!Number.isFinite(instant.getTime())) return [];
	const date = instant.toISOString().slice(0, 10);
	if (date < from || date > to) return [];
	const h = PositiveDecimalSchema.safeParse(String(high));
	const c = PositiveDecimalSchema.safeParse(String(close));
	return h.success && c.success
		? [{ date, high: D(h.data).toFixed(), close: D(c.data).toFixed() }]
		: [];
}

export async function polygonDailyBars(
	input: BarsRequest,
): Promise<DailyEquityBar[]> {
	const { request, apiKey, symbol, from, to } = input;
	const base = (input.baseUrl || "https://api.polygon.io").replace(/\/$/, "");
	// Schedule FA peak and closing values pair actual historical share counts with unadjusted historical prices.
	const data = (await request(
		`${base}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}?adjusted=false&sort=asc&limit=50000`,
		{ headers: { Authorization: `Bearer ${apiKey}` } },
	)) as { results?: unknown } | null;
	if (data?.results === undefined) return [];
	if (!Array.isArray(data.results))
		throw new Error("Invalid Polygon bars response");
	return data.results.flatMap((bar: unknown) => {
		if (!bar || typeof bar !== "object") return [];
		const { t, h, c } = bar as { t?: unknown; h?: unknown; c?: unknown };
		return dailyBar(input, t, 1, h, c);
	});
}

export async function finnhubDailyBars(
	input: BarsRequest,
): Promise<DailyEquityBar[]> {
	const { request, apiKey, symbol, from, to } = input;
	const base = (input.baseUrl || "https://finnhub.io/api/v1").replace(
		/\/$/,
		"",
	);
	const fromUnix = Date.parse(`${from}T00:00:00Z`) / 1000;
	const toUnix = Date.parse(`${to}T23:59:59Z`) / 1000;
	const data = (await request(
		`${base}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${fromUnix}&to=${toUnix}`,
		{ headers: { "X-Finnhub-Token": apiKey } },
	)) as { s?: unknown; t?: unknown; h?: unknown; c?: unknown } | null;
	if (data?.s === "no_data") return [];
	if (
		data?.s !== "ok" ||
		!Array.isArray(data.t) ||
		!Array.isArray(data.h) ||
		!Array.isArray(data.c) ||
		data.t.length !== data.h.length ||
		data.t.length !== data.c.length
	)
		throw new Error("Invalid Finnhub candles response");
	const { t, h, c } = data;
	return t.flatMap((timestamp, i) =>
		dailyBar(input, timestamp, 1000, h[i], c[i]),
	);
}

export function deriveScheduleFaPrices({
	symbol,
	calendarYear,
	bars,
	events,
	closingQty,
	source,
}: {
	symbol: string;
	calendarYear: number;
	bars: readonly DailyEquityBar[];
	events: readonly EquityHoldingEvent[];
	closingQty: string;
	source: string;
}): EquityCyPrice {
	const start = `${calendarYear}-01-01`;
	const end = `${calendarYear}-12-31`;
	const price: EquityCyPrice = { calendarYear, symbol, source };
	const needsClose = D(closingQty).gt("0");
	let quantity = D("0");
	let peakValue = D("0");
	let next = 0;
	for (const bar of [...bars].sort((a, b) => a.date.localeCompare(b.date))) {
		if (bar.date > end) break;
		if (needsClose) price.closingPriceUsd = bar.close;
		if (bar.date < start) continue;
		for (
			let event = events[next];
			event && event.date <= bar.date;
			event = events[++next]
		)
			quantity = D(event.quantity);
		if (!quantity.gt("0")) continue;
		const value = quantity.mul(bar.close);
		if (value.gt(peakValue)) {
			peakValue = value;
			price.peakPriceUsd = bar.close;
			price.peakDate = bar.date;
		}
	}
	return price;
}
