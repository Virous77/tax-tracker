import { createHash, randomUUID } from "node:crypto";
import { D, type LedgerTx, parseDecimal } from "@tax/core";
import { normaliseHeader } from "./spreadsheet.js";
import { timezoneOffsetMinutes } from "./timezone.js";
import type { ImportTimezone } from "./types.js";
export class RowParseError extends Error {
	constructor(
		message: string,
		public field: "date" | "number" | "other" = "other",
	) {
		super(message);
	}
}
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}
export function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}
export function headerFingerprint(headers: string[], sheet = "CSV"): string {
	return sha256(
		JSON.stringify({
			headers: headers.map(normaliseHeader),
			sheet: normaliseHeader(sheet),
		}),
	);
}
export function numberString(value: string, absolute = false): string {
	try {
		const trimmed = value.trim();
		const accounting = trimmed.startsWith("(") && trimmed.endsWith(")");
		const normalized = (accounting ? trimmed.slice(1, -1).trim() : trimmed)
			.replace(/^([+-]?)[₹$£€]\s*/, "$1")
			.replaceAll(",", "");
		const parsed = parseDecimal(accounting ? `-${normalized}` : normalized);
		return (absolute ? parsed.abs() : parsed).toFixed();
	} catch {
		throw new RowParseError("Invalid numeric cell.", "number");
	}
}
export const KNOWN_QUOTES = [
	"FDUSD",
	"USDT",
	"USDC",
	"BUSD",
	"TUSD",
	"DAI",
	"INR",
	"USD",
	"EUR",
	"GBP",
	"TRY",
	"BRL",
	"BTC",
	"ETH",
	"BNB",
];
export function splitPair(
	pair: string,
	quotes: string[] = KNOWN_QUOTES,
): [string, string] {
	const value = pair.trim().toUpperCase();
	const parts = value.split(/[-/_]/);
	if (parts.length === 2 && parts[0] && parts[1]) return [parts[0], parts[1]];
	for (const quote of [...quotes]
		.map((v) => v.toUpperCase())
		.sort((a, b) => b.length - a.length))
		if (value.endsWith(quote) && value.length > quote.length)
			return [value.slice(0, -quote.length), quote];
	throw new RowParseError("Pair cannot be split; supply known quote assets.");
}
export function parseAmountWithAsset(
	value: string,
	expected?: string,
): { amount: string; asset: string } {
	const compact = value.trim().replaceAll(",", "").replace(/\s+/g, "");
	// Digit-leading symbols cannot be separated unambiguously without a known suffix.
	expected ??= ["1000SATS", "1INCH"].find((asset) =>
		compact.toUpperCase().endsWith(asset),
	);
	if (expected && compact.toUpperCase().endsWith(expected.toUpperCase()))
		return {
			amount: numberString(compact.slice(0, -expected.length)),
			asset: expected.toUpperCase(),
		};
	if (expected)
		throw new RowParseError(
			"Amount asset does not match the trade pair.",
			"number",
		);
	if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(compact))
		throw new RowParseError("Amount is missing an asset suffix.", "number");
	const match = compact.match(
		/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([A-Za-z][A-Za-z0-9._:-]*)$/,
	);
	if (!match?.[1] || !match[2])
		throw new RowParseError(
			"Amount and asset cannot be separated safely.",
			"number",
		);
	return {
		amount: numberString(match[1]),
		asset: match[2].toUpperCase(),
	};
}
export function amountAsset(
	value: string,
	expected?: string,
): { amount: string; asset: string } {
	const parsed = parseAmountWithAsset(value, expected);
	return { ...parsed, amount: D(parsed.amount).abs().toFixed() };
}
export function parseTimestamp(
	value: string,
	format: string,
	timezone: ImportTimezone,
	date1904?: boolean,
	dateAsOf: "as_of" | "first" = "as_of",
): string {
	const explicitUtc = / UTC$/i.test(value.trim());
	const raw = value.trim().replace(/ UTC$/i, "");
	const asOf = raw.match(
		/^(\d{1,2}\/\d{1,2}\/\d{4})\s+as of\s+(\d{1,2}\/\d{1,2}\/\d{4})$/i,
	);
	const input = asOf?.[dateAsOf === "first" ? 1 : 2] ?? raw;
	const offsetMinutes = timezoneOffsetMinutes(explicitUtc ? "UTC" : timezone);
	try {
		if (
			/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(
				input,
			)
		) {
			const datePart = input.slice(0, 10);
			const calendar = new Date(`${datePart}T00:00:00Z`);
			if (
				calendar.toISOString().slice(0, 10) !== datePart ||
				Number(input.slice(11, 13)) > 23
			)
				throw new Error();
			const time = new Date(input);
			if (!Number.isFinite(time.getTime())) throw new Error();
			return time.toISOString();
		}
		// Serial arithmetic is only for a date cell; it never converts an amount to a JS number.
		if (
			(format === "excel" || date1904 !== undefined) &&
			/^\d{4,6}(?:\.\d+)?$/.test(input)
		) {
			const serial = D(input);
			const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
			const ms = Number(serial.mul("86400000").round().toFixed());
			const local = new Date(epoch + ms).toISOString().replace("Z", "");
			return parseTimestamp(
				local,
				"yyyy-MM-dd'T'HH:mm:ss.SSS",
				explicitUtc ? "UTC" : timezone,
			);
		}
		let pattern = format;
		if (pattern === "ISO" || pattern === "ISO8601")
			pattern = input.includes("T")
				? "yyyy-MM-dd'T'HH:mm:ss"
				: "yyyy-MM-dd HH:mm:ss";
		if (/^\d\d-\d\d-\d\d /.test(input) && pattern === "yyyy-MM-dd HH:mm:ss")
			pattern = "yy-MM-dd HH:mm:ss";
		const tokenPattern = /yyyy|SSS|yy|MM|dd|HH|mm|ss|'([^']*)'|./g;
		const fields: string[] = [];
		let regex = "^";
		for (const match of pattern.matchAll(tokenPattern)) {
			const token = match[0];
			if (["yyyy", "yy", "MM", "dd", "HH", "mm", "ss", "SSS"].includes(token)) {
				fields.push(token);
				regex +=
					token === "yyyy"
						? "(\\d{4})"
						: token === "SSS"
							? "(\\d{1,3})"
							: "(\\d{1,2})";
			} else
				regex += (match[1] ?? token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		regex += "$";
		const parts = input.match(new RegExp(regex));
		if (!parts) throw new Error();
		const values = Object.fromEntries(
			fields.map((field, index) => [field, parts[index + 1] ?? ""]),
		);
		const year = Number(values.yyyy ?? `20${values.yy ?? ""}`);
		const month = Number(values.MM);
		const day = Number(values.dd);
		const hour = Number(values.HH ?? "0");
		const minute = Number(values.mm ?? "0");
		const second = Number(values.ss ?? "0");
		const millis = Number((values.SSS ?? "0").padEnd(3, "0"));
		const date = new Date(
			Date.UTC(year, month - 1, day, hour, minute, second, millis),
		);
		if (
			date.getUTCFullYear() !== year ||
			date.getUTCMonth() !== month - 1 ||
			date.getUTCDate() !== day ||
			date.getUTCHours() !== hour ||
			date.getUTCMinutes() !== minute ||
			date.getUTCSeconds() !== second
		)
			throw new Error();
		return new Date(date.getTime() - offsetMinutes * 60000).toISOString();
	} catch {
		throw new RowParseError(
			"Date does not match the recipe format or is not a valid calendar date.",
			"date",
		);
	}
}
export function sourceReferences(): (raw: unknown, id?: string) => string {
	const counts = new Map<string, number>();
	return (raw, id) => {
		if (id?.trim()) return id.trim();
		const hash = sha256(canonical(raw));
		const ordinal = counts.get(hash) ?? 0;
		counts.set(hash, ordinal + 1);
		return `${hash}#${ordinal}`;
	};
}
export function baseTransaction(
	source: string,
	sourceRef: string,
	timestamp: string,
	raw: LedgerTx["raw"],
): LedgerTx {
	return {
		id: randomUUID(),
		source,
		sourceRef,
		timestamp,
		type: "transfer",
		importId: null,
		raw,
		reviewFlags: [],
	};
}

export function tradePriceQuote(
	side: string,
	type: LedgerTx["type"],
	asset: string,
	price: string,
) {
	const parsed = numberString(price);
	if (!D(parsed).gt("0"))
		throw new RowParseError("Trade price must be positive.", "number");
	// The engine prices a swap per outgoing unit; a quote-funded buy disposes the quote itself.
	return { asset, price: type === "swap" && side === "buy" ? "1" : parsed };
}
