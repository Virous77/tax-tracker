import { createHash } from "node:crypto";
import { type ConnectorRow, D, type LedgerTx, LedgerTxSchema } from "@tax/core";
import { UpstreamError } from "./http.js";
export type ApiRow = Record<string, unknown>;
export type SyncTx = ConnectorRow["tx"];
export function object(value: unknown): ApiRow {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new UpstreamError("Expected an upstream object");
	return value as ApiRow;
}
export function rows(value: unknown): ApiRow[] {
	if (!Array.isArray(value)) throw new UpstreamError("Expected upstream rows");
	return value.map(object);
}
export function text(row: ApiRow, key: string): string {
	const value = row[key];
	if (typeof value !== "string" && typeof value !== "number")
		throw new UpstreamError(`Missing or invalid upstream field: ${key}`);
	if (typeof value === "number" && !Number.isSafeInteger(value))
		throw new UpstreamError("Upstream numbers must be parsed from source text");
	return String(value);
}
export function amount(row: ApiRow, key: string): string {
	const value = row[key];
	if (typeof value !== "string")
		throw new UpstreamError("Amounts must retain their JSON source text");
	const result = D(value);
	if (!result.isFinite() || result.lt("0"))
		throw new UpstreamError("Invalid upstream amount");
	return result.toFixed();
}
export function iso(value: string | number): string {
	return new Date(
		typeof value === "number" || /^\d+$/.test(value)
			? Number(value)
			: value.includes("T")
				? value
				: `${value.replace(" ", "T")}Z`,
	).toISOString();
}
export function base(
	source: string,
	ref: string,
	timestamp: string,
	raw: unknown,
): SyncTx {
	return {
		source,
		sourceRef: ref,
		timestamp,
		type: "transfer",
		raw: raw ?? null,
		reviewFlags: [],
	};
}
export function validated(tx: SyncTx): SyncTx {
	const {
		id: _id,
		importId: _import,
		...parsed
	} = LedgerTxSchema.parse({
		...tx,
		id: "00000000-0000-4000-8000-000000000000",
		importId: null,
	});
	return parsed;
}
export function unknownRow(tx: SyncTx, message: string): SyncTx {
	return validated({
		...base(tx.source, tx.sourceRef, tx.timestamp, tx.raw),
		reviewFlags: [{ code: "unknown_type", message }],
	});
}
export function stableHash(value: unknown): string {
	const canonical = (v: unknown): string =>
		Array.isArray(v)
			? `[${v.map(canonical).join(",")}]`
			: v && typeof v === "object"
				? `{${Object.entries(v)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([k, item]) => `${JSON.stringify(k)}:${canonical(item)}`)
						.join(",")}}`
				: (JSON.stringify(v) ?? "null");
	return createHash("sha256").update(canonical(value)).digest("hex");
}
export const FIAT = new Set([
	"INR",
	"USD",
	"EUR",
	"GBP",
	"TRY",
	"BRL",
	"AUD",
	"CAD",
	"RUB",
	"UAH",
	"NGN",
	"CNY",
	"JPY",
	"AED",
	"ZAR",
	"PLN",
]);
export function splitPair(symbol: string): [string, string] | undefined {
	const pair = symbol.toUpperCase().split(/[-/_]/);
	if (pair.length === 2 && pair[0] && pair[1]) return [pair[0], pair[1]];
	for (const quote of [
		"FDUSD",
		"USDT",
		"USDC",
		"BUSD",
		"TUSD",
		"DAI",
		...FIAT,
		"BTC",
		"ETH",
		"BNB",
	].sort((a, b) => b.length - a.length))
		if (symbol.endsWith(quote) && symbol.length > quote.length)
			return [symbol.slice(0, -quote.length), quote];
}
export function trade(
	tx: SyncTx,
	side: string,
	asset: string,
	quote: string,
	quantity: string,
	total: string,
	price: string,
): SyncTx {
	if (!["buy", "sell"].includes(side))
		return unknownRow(tx, "Unknown trade side; original row retained");
	tx.type = FIAT.has(quote) ? (side as "buy" | "sell") : "swap";
	tx.assetIn = side === "buy" ? asset : quote;
	tx.amountIn = side === "buy" ? quantity : total;
	tx.assetOut = side === "buy" ? quote : asset;
	tx.amountOut = side === "buy" ? total : quantity;
	// The engine consumes price per outgoing unit, matching the file importers (research §1.5).
	tx.priceQuote = {
		asset: quote,
		price: tx.type === "swap" && side === "buy" ? "1" : price,
	};
	if (quote === "INR") {
		tx.inrValue = total;
		tx.inrRateSource = "trade_inr";
	}
	return tx;
}
export function cursorObject(value: unknown): ApiRow {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as ApiRow)
		: {};
}
export function fee(tx: SyncTx, asset: string, value: string): void {
	tx.feeAsset = asset;
	tx.feeAmount = value;
}
export type { LedgerTx };
