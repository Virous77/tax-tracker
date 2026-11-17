import type { AssetPriceId, CachedPrice, PriceLookup } from "@tax/core";
import { priceIdsForAsset } from "./mapping.js";
export function priceLookupFromCache(
	rows: readonly CachedPrice[],
	mappings: readonly AssetPriceId[] = [],
): PriceLookup {
	return (asset, date, basis) => {
		for (const id of priceIdsForAsset(asset, date, mappings).sort(
			(a, b) =>
				Number(b.source === "binance_klines") -
				Number(a.source === "binance_klines"),
		)) {
			const row = rows.find(
				(row) =>
					row.source === id.source &&
					row.sourceId === id.sourceId &&
					row.date === date &&
					(row.source === "binance_klines"
						? row.dayBasis === "IST" && row.kind === basis
						: row.kind === "snapshot_00utc"),
			);
			if (row)
				return {
					price: row.price,
					quote: row.quote,
					source: row.source,
					sourceId: row.sourceId,
					date: row.date,
					kind: row.kind,
					dayBasis: row.dayBasis,
				};
		}
		return null;
	};
}
