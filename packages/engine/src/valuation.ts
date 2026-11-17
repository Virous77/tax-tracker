import {
	type AmountValuation,
	D,
	type EngineSettings,
	type FxLookup,
	istDate,
	type LedgerTx,
	type PriceLookup,
	type Valuation,
} from "@tax/core";
export const USD_STABLECOINS = new Set(["USDT"]);
export const FIAT = new Set(["INR", "USD", "EUR", "GBP"]);
export interface LedgerRate {
	rate: string;
	txId: string;
	timestamp: string;
}
export function ledgerStablecoinRate(tx: LedgerTx): LedgerRate | null {
	if (!["buy", "sell", "swap"].includes(tx.type)) return null;
	if (
		tx.assetIn &&
		USD_STABLECOINS.has(tx.assetIn) &&
		tx.amountIn &&
		tx.assetOut === "INR" &&
		tx.amountOut
	)
		return {
			rate: D(tx.amountOut).div(tx.amountIn).toFixed(),
			txId: tx.id,
			timestamp: tx.timestamp,
		};
	if (
		tx.assetOut &&
		USD_STABLECOINS.has(tx.assetOut) &&
		tx.amountOut &&
		tx.assetIn === "INR" &&
		tx.amountIn
	)
		return {
			rate: D(tx.amountIn).div(tx.amountOut).toFixed(),
			txId: tx.id,
			timestamp: tx.timestamp,
		};
	if (
		tx.inrValue !== undefined &&
		D(tx.inrValue).gt("0") &&
		tx.assetIn &&
		USD_STABLECOINS.has(tx.assetIn) &&
		tx.amountIn
	)
		return {
			rate: D(tx.inrValue).div(tx.amountIn).toFixed(),
			txId: tx.id,
			timestamp: tx.timestamp,
		};
	if (
		tx.inrValue !== undefined &&
		D(tx.inrValue).gt("0") &&
		tx.assetOut &&
		USD_STABLECOINS.has(tx.assetOut) &&
		tx.amountOut
	)
		return {
			rate: D(tx.inrValue).div(tx.amountOut).toFixed(),
			txId: tx.id,
			timestamp: tx.timestamp,
		};
	return null;
}
export function valueTransaction(
	tx: LedgerTx,
	settings: EngineSettings,
	fx: FxLookup,
	ledgerRate: LedgerRate | null,
	priceLookup?: PriceLookup,
): Valuation {
	if (tx.inrValue !== undefined)
		return {
			txId: tx.id,
			valueInr: tx.inrValue,
			inrRateSource: tx.inrRateSource ?? "trade_inr",
		};
	if (tx.assetOut === "INR" && tx.amountOut)
		return { txId: tx.id, valueInr: tx.amountOut, inrRateSource: "trade_inr" };
	if (tx.assetIn === "INR" && tx.amountIn)
		return { txId: tx.id, valueInr: tx.amountIn, inrRateSource: "trade_inr" };
	const quantity =
		tx.type === "buy" || tx.type === "income" || tx.type === "gift"
			? tx.amountIn
			: tx.amountOut;
	if (tx.priceQuote?.asset === "INR" && quantity)
		return {
			txId: tx.id,
			valueInr: D(quantity).mul(tx.priceQuote.price).toFixed(),
			inrRateSource: "trade_inr",
		};
	let stableAmount: string | undefined;
	if (
		tx.priceQuote &&
		(USD_STABLECOINS.has(tx.priceQuote.asset) ||
			tx.priceQuote.asset === "USD") &&
		quantity
	)
		stableAmount = D(quantity).mul(tx.priceQuote.price).toFixed();
	else if (tx.type === "buy" && tx.assetOut && USD_STABLECOINS.has(tx.assetOut))
		stableAmount = tx.amountOut;
	else if (tx.type !== "buy" && tx.assetIn && USD_STABLECOINS.has(tx.assetIn))
		stableAmount = tx.amountIn;
	else if (tx.assetOut && USD_STABLECOINS.has(tx.assetOut))
		stableAmount = tx.amountOut;
	else if (tx.assetIn && USD_STABLECOINS.has(tx.assetIn))
		stableAmount = tx.amountIn;
	if (stableAmount !== undefined) {
		if (
			settings.usdtInrRate === "ledger_usdt_inr" &&
			ledgerRate &&
			tx.priceQuote?.asset !== "USD"
		)
			return {
				txId: tx.id,
				valueInr: D(stableAmount).mul(ledgerRate.rate).toFixed(),
				inrRateSource: "trade_usdt_x_usd_inr",
				rateTxId: ledgerRate.txId,
				fx: {
					currency: "USD",
					rate: ledgerRate.rate,
					rateDate: istDate(ledgerRate.timestamp),
					source: "ledger stablecoin/INR",
				},
			};
		const rate = fx("USD", istDate(tx.timestamp));
		if (rate)
			return {
				txId: tx.id,
				valueInr: D(stableAmount).mul(rate.rate).toFixed(),
				inrRateSource: "trade_usdt_x_usd_inr",
				fx: { currency: "USD", ...rate },
			};
	}
	const asset =
		tx.type === "buy" || tx.type === "income" || tx.type === "gift"
			? tx.assetIn
			: tx.assetOut;
	if (asset && quantity && priceLookup) {
		const price = priceLookup(
			asset,
			istDate(tx.timestamp),
			settings.marketPriceBasis,
		);
		if (
			price &&
			D(price.price).isFinite() &&
			D(price.price).gt("0") &&
			price.date <= istDate(tx.timestamp)
		) {
			const base = {
				txId: tx.id,
				inrRateSource: "market_price_cache" as const,
				marketPrice: price,
			};
			const value = D(quantity).mul(price.price);
			if (price.quote === "INR") return { ...base, valueInr: value.toFixed() };
			if (price.quote === "USD" || price.quote === "USDT") {
				const rate =
					settings.usdtInrRate === "ledger_usdt_inr" &&
					ledgerRate &&
					price.quote === "USDT"
						? {
								rate: ledgerRate.rate,
								rateDate: istDate(ledgerRate.timestamp),
								source: "ledger stablecoin/INR",
							}
						: fx("USD", istDate(tx.timestamp));
				if (rate)
					return {
						...base,
						valueInr: value.mul(rate.rate).toFixed(),
						fx: { currency: "USD", ...rate },
					};
			}
		}
	}
	return { txId: tx.id, valueInr: null };
}
export function feeValueInr(
	tx: LedgerTx,
	valuation: Valuation,
	settings: EngineSettings,
	fx: FxLookup,
	ledgerRate: LedgerRate | null,
	priceLookup?: PriceLookup,
): AmountValuation {
	const gst = D(tx.gstInr ?? "0");
	if (!tx.feeAmount || D(tx.feeAmount).isZero())
		return { txId: tx.id, valueInr: gst.toFixed(), inrRateSource: "trade_inr" };
	if (tx.feeAsset === "INR")
		return {
			txId: tx.id,
			valueInr: gst.plus(tx.feeAmount).toFixed(),
			inrRateSource: "trade_inr",
		};
	if (tx.feeAsset && USD_STABLECOINS.has(tx.feeAsset)) {
		const result = valueTransaction(
			{
				...tx,
				type: "sell",
				assetIn: undefined,
				amountIn: undefined,
				assetOut: tx.feeAsset,
				amountOut: tx.feeAmount,
				inrValue: undefined,
				inrRateSource: undefined,
				priceQuote: undefined,
			},
			settings,
			fx,
			ledgerRate,
			priceLookup,
		);
		return {
			...result,
			valueInr:
				result.valueInr === null
					? null
					: D(result.valueInr).plus(gst).toFixed(),
		};
	}
	const quantity =
		tx.feeAsset === tx.assetIn
			? tx.amountIn
			: tx.feeAsset === tx.assetOut
				? tx.amountOut
				: undefined;
	if (quantity && valuation.valueInr !== null)
		return {
			...valuation,
			valueInr: gst
				.plus(D(valuation.valueInr).mul(tx.feeAmount).div(quantity))
				.toFixed(),
		};
	if (tx.feeAsset && priceLookup) {
		const result = valueTransaction(
			{
				...tx,
				type: "sell",
				assetOut: tx.feeAsset,
				amountOut: tx.feeAmount,
				assetIn: undefined,
				amountIn: undefined,
				inrValue: undefined,
				priceQuote: undefined,
			},
			settings,
			fx,
			ledgerRate,
			priceLookup,
		);
		return {
			...result,
			valueInr:
				result.valueInr === null
					? null
					: D(result.valueInr).plus(gst).toFixed(),
		};
	}
	return { txId: tx.id, valueInr: null };
}
