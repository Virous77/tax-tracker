import {
	type AssetPriceId,
	type CachedPrice,
	type EngineSettings,
	istDate,
	type LedgerTx,
	taxYearBounds,
} from "@tax/core";
import { priceLookupFromCache } from "./cache.js";
import { priceIdsForAsset } from "./mapping.js";
export interface PriceNeed {
	asset: string;
	date: string;
}
export interface PriceRange {
	asset: string;
	sourceId: string;
	start: string;
	end: string;
	dates: string[];
}
const fiat = new Set(["INR", "USD", "EUR", "GBP"]);
export function neededPrices(
	transactions: readonly LedgerTx[],
	taxYear: string,
	settings: EngineSettings,
): PriceNeed[] {
	const end = taxYearBounds(taxYear).endExclusiveUtc;
	const needs = new Map<string, PriceNeed>();
	const add = (asset: string | undefined, date: string) => {
		if (asset && !fiat.has(asset) && asset !== "USDT")
			needs.set(`${asset}|${date}`, { asset, date });
	};
	for (const tx of transactions) {
		if (
			tx.timestamp >= end ||
			tx.reviewFlags.some((f) => f.code === "suspected_spam")
		)
			continue;
		if (!["buy", "sell", "swap", "income", "gift"].includes(tx.type)) continue;
		const date = istDate(tx.timestamp);
		const own =
			tx.inrValue !== undefined ||
			tx.assetIn === "INR" ||
			tx.assetOut === "INR" ||
			tx.priceQuote?.asset === "INR" ||
			tx.priceQuote?.asset === "USD" ||
			tx.priceQuote?.asset === "USDT" ||
			tx.assetIn === "USDT" ||
			tx.assetOut === "USDT";
		if (!own)
			add(
				["buy", "income", "gift"].includes(tx.type) ? tx.assetIn : tx.assetOut,
				date,
			);
		if (
			settings.feeTreatment === "include" &&
			tx.feeAmount &&
			tx.feeAsset &&
			tx.feeAsset !== tx.assetIn &&
			tx.feeAsset !== tx.assetOut
		)
			add(tx.feeAsset, date);
	}
	return [...needs.values()].sort(
		(a, b) => a.asset.localeCompare(b.asset) || a.date.localeCompare(b.date),
	);
}
export function planPriceFill(input: {
	transactions: readonly LedgerTx[];
	taxYear: string;
	settings: EngineSettings;
	cache: readonly CachedPrice[];
	mappings?: readonly AssetPriceId[];
}) {
	const needed = neededPrices(
		input.transactions,
		input.taxYear,
		input.settings,
	);
	const lookup = priceLookupFromCache(
		input.cache.filter((row) => row.final),
		input.mappings,
	);
	const missing = needed.filter(
		(n) => !lookup(n.asset, n.date, input.settings.marketPriceBasis),
	);
	const ranges: PriceRange[] = [];
	for (const need of missing) {
		const id = priceIdsForAsset(need.asset, need.date, input.mappings).find(
			(id) => id.source === "binance_klines",
		);
		if (!id) continue;
		let range = ranges.at(-1);
		if (
			!range ||
			range.asset !== need.asset ||
			range.sourceId !== id.sourceId ||
			Date.parse(need.date) - Date.parse(range.end) > 86400000 ||
			(Date.parse(need.date) - Date.parse(range.start)) / 86400000 >= 1000
		) {
			range = {
				asset: need.asset,
				sourceId: id.sourceId,
				start: need.date,
				end: need.date,
				dates: [],
			};
			ranges.push(range);
		}
		range.end = need.date;
		range.dates.push(need.date);
	}
	return { needed, missing, ranges, fromCache: needed.length - missing.length };
}
