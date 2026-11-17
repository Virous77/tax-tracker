export interface MarketPrice {
	price: string;
	quote: string;
	source: string;
	sourceId: string;
	date: string;
	kind: string;
	dayBasis?: "IST" | "UTC";
}
export type PriceLookup = (
	asset: string,
	date: string,
	basis: "close" | "vwap",
) => MarketPrice | null;
export interface CachedPrice extends MarketPrice {
	dayBasis: "IST" | "UTC";
	final: boolean;
	fetchedAt: string;
}
export interface AssetPriceId {
	asset: string;
	chain?: string;
	source: string;
	sourceId: string;
}
