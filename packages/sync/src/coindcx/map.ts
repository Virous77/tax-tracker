import { D } from "@tax/core";
import {
	type ApiRow,
	amount,
	base,
	fee,
	iso,
	type SyncTx,
	splitPair,
	text,
	trade,
	unknownRow,
	validated,
} from "../values.js";
export function mapCoinDcxTrade(raw: ApiRow, markets: ApiRow[]): SyncTx {
	const tx = base(
		"coindcx-api",
		`trade:${text(raw, "id")}`,
		iso(text(raw, "timestamp")),
		raw,
	);
	const symbol = text(raw, "symbol");
	const market = markets.find(
		(row) =>
			(row.coindcx_name === symbol || row.symbol === symbol) &&
			(row.ecode === undefined || row.ecode === raw.ecode),
	);
	const pair: [string, string] | undefined = market
		? [
				text(market, "target_currency_short_name"),
				text(market, "base_currency_short_name"),
			]
		: splitPair(symbol);
	if (!pair)
		return unknownRow(
			tx,
			"Market metadata is missing and the pair cannot be split safely",
		);
	if (!market)
		tx.reviewFlags.push({
			code: "parse_warning",
			message:
				"Market missing from markets_details; pair split using known quote assets",
		});
	const [asset, quote] = pair;
	const mapped = trade(
		tx,
		text(raw, "side"),
		asset,
		quote,
		amount(raw, "quantity"),
		D(amount(raw, "quantity")).mul(amount(raw, "price")).toFixed(),
		amount(raw, "price"),
	);
	if (mapped !== tx) return mapped;
	fee(tx, quote, amount(raw, "fee_amount"));
	tx.reviewFlags.push({
		code: "parse_warning",
		message:
			"CoinDCX does not specify fee currency. The fee is treated as quote currency and GST is shown together with fees.",
	});
	if (!["I", "B", "KC"].includes(String(raw.ecode)))
		tx.reviewFlags.push({
			code: "unknown_type",
			message:
				"Unrecognised CoinDCX exchange code; verify market and fee treatment",
		});
	return validated(tx);
}
