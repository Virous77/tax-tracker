import type { PriceFillSummary } from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import {
	binanceKlines,
	coingeckoContractId,
	coingeckoHistory,
	createPriceRequest,
	planPriceFill,
	priceIdsForAsset,
	priceLookupFromCache,
} from "@tax/prices";
import { UpstreamError } from "@tax/sync/http";
import { startBackgroundJob } from "./background";
import { baseUrls } from "./connectors";
import { ApiError } from "./errors";
import { checkYear } from "./reports";
import { getSettings } from "./settings";
import { providers, vaultSession } from "./vault";

function plan(db: TaxDatabase, taxYear: string) {
	return planPriceFill({
		transactions: db.transactions.active(),
		taxYear,
		settings: getSettings(db),
		cache: db.prices.all(),
		mappings: db.prices.mappings(),
	});
}
export function pricesStatus(db: TaxDatabase, taxYear: string) {
	checkYear(taxYear);
	const current = plan(db, taxYear);
	const lookup = priceLookupFromCache(db.prices.all(), db.prices.mappings());
	const missing = current.needed.filter(
		(row) => !lookup(row.asset, row.date, getSettings(db).marketPriceBasis),
	);
	return {
		enabled: getSettings(db).prices.enabled,
		needed: current.needed.length,
		cached: current.needed.length - missing.length,
		missing,
		sources: { binanceKlines: true, coingecko: providers(db).coingecko },
	};
}
export function startPriceFill(db: TaxDatabase, taxYear: string) {
	checkYear(taxYear);
	if (!getSettings(db).prices.enabled)
		throw new ApiError(
			409,
			"prices_disabled",
			"Enable price lookups in Settings first.",
		);
	return startBackgroundJob(db, "price_fill", { taxYear }, async (ctx) => {
		const current = plan(db, taxYear);
		const urls = baseUrls();
		const request = createPriceRequest();
		const now = Date.now();
		let done = 0;
		const enabled = () => {
			ctx.signal.throwIfAborted();
			if (!getSettings(db).prices.enabled)
				throw new ApiError(
					409,
					"prices_disabled",
					"Price lookups were disabled.",
				);
		};
		const fetchPrice = (url: string, init?: RequestInit) => {
			enabled();
			return request(url, { ...init, signal: ctx.signal });
		};
		for (const range of current.ranges) {
			enabled();
			try {
				const rows = await binanceKlines({
					request: fetchPrice,
					baseUrl: urls.binanceData,
					symbol: range.sourceId,
					start: range.start,
					end: range.end,
					now,
				});
				db.atomic(() => {
					if (range.asset !== "LUNA")
						db.prices.map({
							asset: range.asset,
							source: "binance_klines",
							sourceId: range.sourceId,
						});
					db.prices.save(rows);
				});
			} catch (error) {
				if (!(error instanceof UpstreamError && error.code === "-1121"))
					throw error;
			}
			ctx.progress({
				stream: `prices:${range.sourceId}`,
				streamsDone: ++done,
				streamsTotal: current.ranges.length,
				rowsFetched: done,
			});
		}
		const settings = getSettings(db);
		const vault = await vaultSession(db);
		if (settings.prices.coingeckoFallback && vault.has("provider:coingecko")) {
			const lookup = priceLookupFromCache(
				db.prices.all(),
				db.prices.mappings(),
			);
			const gaps = current.missing.filter(
				(row) => !lookup(row.asset, row.date, settings.marketPriceBasis),
			);
			if (gaps.length) {
				vault.requireUnlocked();
				const apiKey = vault.get("provider:coingecko") ?? "";
				for (const gap of gaps) {
					enabled();
					let mapping = priceIdsForAsset(
						gap.asset,
						gap.date,
						db.prices.mappings(),
					).find((row) => row.source === "coingecko");
					if (
						!mapping &&
						gap.date >=
							new Date(now - 365 * 86400000).toISOString().slice(0, 10)
					) {
						try {
							const sourceId = await coingeckoContractId({
								request: fetchPrice,
								apiKey,
								baseUrl: urls.coingecko,
								asset: gap.asset,
							});
							if (sourceId)
								mapping = { asset: gap.asset, source: "coingecko", sourceId };
						} catch (error) {
							if (!(error instanceof UpstreamError && error.status === 404))
								throw error;
						}
					}
					if (!mapping) continue;
					const row = await coingeckoHistory({
						request: fetchPrice,
						apiKey,
						baseUrl: urls.coingecko,
						coinId: mapping.sourceId,
						date: gap.date,
						now,
					});
					if (row)
						db.atomic(() => {
							if (gap.asset !== "LUNA") db.prices.map(mapping);
							db.prices.save([row]);
						});
				}
			}
		}
		const lookup = priceLookupFromCache(db.prices.all(), db.prices.mappings());
		const missing = current.needed.filter(
			(row) => !lookup(row.asset, row.date, getSettings(db).marketPriceBasis),
		);
		const result: PriceFillSummary = {
			requested: current.needed.length,
			fetched: current.missing.filter((row) =>
				Boolean(lookup(row.asset, row.date, getSettings(db).marketPriceBasis)),
			).length,
			fromCache: current.fromCache,
			missing,
		};
		return result;
	});
}
