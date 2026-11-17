import type { AssetPriceId } from "@tax/core";

const coins: Record<string, string> = {
	BTC: "bitcoin",
	ETH: "ethereum",
	USDT: "tether",
	USDC: "usd-coin",
	DAI: "dai",
	WETH: "weth",
	WBTC: "wrapped-bitcoin",
	BNB: "binancecoin",
	SOL: "solana",
	XRP: "ripple",
	ADA: "cardano",
	DOGE: "dogecoin",
	LINK: "chainlink",
	UNI: "uniswap",
	AAVE: "aave",
	POL: "polygon-ecosystem-token",
	MATIC: "matic-network",
	SHIB: "shiba-inu",
	PEPE: "pepe",
	LUNC: "terra-luna",
	LUNA: "terra-luna-2",
};
export const DEFAULT_ASSET_PRICE_IDS: AssetPriceId[] = Object.entries(
	coins,
).flatMap(([asset, sourceId]) => [
	{ asset, source: "coingecko", sourceId },
	...(asset === "USDT" || asset === "WETH" || asset === "WBTC"
		? []
		: [{ asset, source: "binance_klines", sourceId: `${asset}USDT` }]),
]);
export function priceIdsForAsset(
	asset: string,
	date: string,
	mappings: readonly AssetPriceId[] = [],
) {
	const rows = [
		...DEFAULT_ASSET_PRICE_IDS.filter(
			(row) =>
				row.asset === asset &&
				!mappings.some((m) => m.asset === asset && m.source === row.source),
		),
		...mappings.filter((row) => row.asset === asset),
	];
	if (asset === "LUNA" && date < "2022-05-28")
		return rows.map((row) => ({
			...row,
			sourceId: row.source === "binance_klines" ? "LUNCUSDT" : "terra-luna",
		}));
	// Exchange tickers are usable on Binance; unknown contracts never use a claimed symbol.
	if (
		!rows.some((row) => row.source === "binance_klines") &&
		!asset.startsWith("ERC20:") &&
		!["USDT", "WETH", "WBTC"].includes(asset)
	)
		rows.push({ asset, source: "binance_klines", sourceId: `${asset}USDT` });
	return rows;
}
