import { createHash } from "node:crypto";

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

const TIMESTAMP_HEADERS = new Set([
	"date",
	"time",
	"datetime",
	"timestamp",
	"txndate",
	"txntime",
	"transactiondate",
	"transactiontime",
	"tradedate",
	"tradetime",
	"createdat",
	"createdtime",
	"createdon",
	"executedat",
	"executiontime",
	"filledat",
	"filledtime",
	"utctime",
	"isttime",
	"dateutc",
	"timeutc",
	"valuedate",
]);
const SIDE_HEADERS = new Set([
	"side",
	"type",
	"trade",
	"action",
	"operation",
	"direction",
	"transactiontype",
	"sideindicator",
	"buysell",
]);
const PAIR_HEADERS = new Set([
	"pair",
	"market",
	"symbol",
	"instrument",
	"tradingpair",
	"marketsymbol",
	"pairname",
]);
const BASE_ASSET_HEADERS = new Set([
	"coin",
	"asset",
	"base",
	"baseasset",
	"currency",
	"token",
	"coinname",
	"assetname",
]);
const QUOTE_ASSET_HEADERS = new Set([
	"quote",
	"quoteasset",
	"quotecurrency",
	"marketcurrency",
	"counterasset",
]);
const AMOUNT_HEADERS = new Set([
	"amount",
	"qty",
	"quantity",
	"volume",
	"executed",
	"size",
	"units",
	"filled",
	"filledqty",
	"coinamount",
	"assetamount",
	"quantityexecuted",
]);
const PRICE_HEADERS = new Set([
	"price",
	"rate",
	"unitprice",
	"avgprice",
	"averageprice",
	"priceperunit",
	"executionprice",
	"nav",
]);
const TOTAL_HEADERS = new Set([
	"total",
	"value",
	"grossvalue",
	"totalvalue",
	"consideration",
	"netamount",
	"tradevalue",
	"amounttotal",
	"cost",
]);
const FEE_AMOUNT_HEADERS = new Set([
	"fee",
	"fees",
	"charges",
	"commission",
	"feeamount",
	"tradingfee",
	"brokerage",
	"chargesamount",
	"txnfee",
]);
const FEE_ASSET_HEADERS = new Set([
	"feecoin",
	"feecurrency",
	"feeasset",
	"chargescoin",
	"chargecurrency",
	"feeccy",
]);
const TDS_HEADERS = new Set([
	"tds",
	"tdsamount",
	"tdsinr",
	"tdsdeducted",
	"taxdeducted",
]);
const ID_HEADERS = new Set([
	"id",
	"ref",
	"refno",
	"reference",
	"referenceno",
	"referencenumber",
	"orderref",
	"orderreference",
	"orderid",
	"orderno",
	"tradeid",
	"transactionid",
	"txnid",
	"uniqueref",
	"recordid",
]);
const TX_HASH_HEADERS = new Set([
	"txhash",
	"transactionhash",
	"blockchainhash",
	"hash",
	"txid",
]);

// Order decides which role claims a header first when names are ambiguous.
const COLUMN_ROLES = [
	["timestamp", isTimestampHeader],
	["side", (key) => SIDE_HEADERS.has(key)],
	["pair", (key) => PAIR_HEADERS.has(key)],
	["baseAsset", (key) => BASE_ASSET_HEADERS.has(key)],
	["quoteAsset", (key) => QUOTE_ASSET_HEADERS.has(key)],
	["amount", (key) => AMOUNT_HEADERS.has(key)],
	["price", (key) => PRICE_HEADERS.has(key)],
	["total", (key) => TOTAL_HEADERS.has(key)],
	["feeAsset", (key) => FEE_ASSET_HEADERS.has(key)],
	["feeAmount", (key) => FEE_AMOUNT_HEADERS.has(key)],
	["tds", (key) => TDS_HEADERS.has(key)],
	["txHash", (key) => TX_HASH_HEADERS.has(key)],
	["id", (key) => ID_HEADERS.has(key)],
];

const COLUMN_ORDER = [
	"timestamp",
	"type",
	"side",
	"pair",
	"baseAsset",
	"quoteAsset",
	"amount",
	"price",
	"total",
	"feeAmount",
	"feeAsset",
	"tds",
	"id",
	"txHash",
];

const SIDE_RULES = [
	[/^(buy|b|purchase|purchased|bought|credit|c|buy crypto)$/, "buy"],
	[/^(sell|s|sale|sold|debit|d|sell crypto)$/, "sell"],
	[
		/^(deposit|deposited|receive|received|in|transfer in|transferin|credit in)$/,
		"deposit",
	],
	[
		/^(withdraw|withdrawn|withdrawal|send|sent|out|transfer out|transferout)$/,
		"withdrawal",
	],
	[
		/^(income|interest|reward|rewards|staking|airdrop|dividend|bonus|referral|mining|commission)$/,
		"income",
	],
];

const ISO_WITH_ZONE =
	/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;

// Tested in order; the first format every sample satisfies wins.
const DATE_FORMATS = [
	"yyyy-MM-dd HH:mm:ss",
	"yyyy-MM-dd'T'HH:mm:ss.SSS",
	"yyyy-MM-dd'T'HH:mm:ss",
	"yyyy-MM-dd HH:mm",
	"yyyy-MM-dd",
	"dd-MM-yyyy HH:mm:ss",
	"dd-MM-yyyy HH:mm",
	"dd/MM/yyyy HH:mm:ss",
	"dd/MM/yyyy HH:mm",
	"MM/dd/yyyy HH:mm:ss",
	"MM/dd/yyyy HH:mm",
	"dd/MM/yyyy",
	"MM/dd/yyyy",
	"yyyy/MM/dd HH:mm:ss",
	"yyyy/MM/dd",
	"dd-MM-yy HH:mm",
	"yy-MM-dd HH:mm:ss",
	"yyyy.MM.dd HH:mm:ss",
];

function isTimestampHeader(key) {
	return (
		TIMESTAMP_HEADERS.has(key) ||
		(/(date|time)$/.test(key) && !/update$/.test(key))
	);
}

function headerKey(value) {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function headerFingerprint(headers, sheet) {
	const normalise = (value) =>
		value
			.trim()
			.toLowerCase()
			.replace(/[\s*]+/g, "");
	return createHash("sha256")
		.update(
			JSON.stringify({
				headers: headers.map(normalise),
				sheet: normalise(sheet),
			}),
		)
		.digest("hex");
}

function normaliseRows(headers, rows) {
	if (!Array.isArray(rows)) return [];
	return rows
		.filter((row) => row && typeof row === "object")
		.map((row) =>
			Array.isArray(row)
				? Object.fromEntries(headers.map((name, i) => [name, row[i] ?? ""]))
				: row,
		);
}

function claimFallback(headers, keys, used, pattern) {
	const index = keys.findIndex((key, i) => !used.has(i) && pattern.test(key));
	if (index === -1) return undefined;
	used.add(index);
	return headers[index];
}

function pickColumns(headers) {
	const keys = headers.map(headerKey);
	const used = new Set();
	const picked = {};
	for (const [role, matches] of COLUMN_ROLES) {
		const index = keys.findIndex((key, i) => !used.has(i) && matches(key));
		if (index === -1) continue;
		used.add(index);
		picked[role] = headers[index];
	}
	picked.timestamp ??=
		claimFallback(headers, keys, used, /(date|time)/) ?? headers[0] ?? "";
	picked.amount ??=
		claimFallback(
			headers,
			keys,
			used,
			/(amount|qty|quantity|size|volume|unit|coin|balance)/,
		) ??
		headers.find((_, i) => !used.has(i)) ??
		headers[0] ??
		"";
	const columns = {};
	for (const role of COLUMN_ORDER)
		if (picked[role] !== undefined) columns[role] = picked[role];
	return columns;
}

function parseWithFormat(value, format) {
	const tokens = [];
	let source = "^";
	for (const match of format.matchAll(
		/yyyy|SSS|yy|MM|dd|HH|mm|ss|'([^']*)'|./g,
	)) {
		const token = match[0];
		if (["yyyy", "yy", "MM", "dd", "HH", "mm", "ss", "SSS"].includes(token)) {
			tokens.push(token);
			source +=
				token === "yyyy"
					? "(\\d{4})"
					: token === "yy"
						? "(\\d{2})"
						: token === "SSS"
							? "(\\d{1,3})"
							: "(\\d{1,2})";
		} else {
			source += (match[1] ?? token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	}
	const parts = value.match(new RegExp(`${source}$`));
	if (!parts) return null;
	const fields = Object.fromEntries(
		tokens.map((token, index) => [token, parts[index + 1]]),
	);
	const year = Number(fields.yyyy ?? `20${fields.yy ?? ""}`);
	const month = Number(fields.MM ?? "1");
	const day = Number(fields.dd ?? "1");
	if (year < 1900 || year > 2100) return null;
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	return { year, month, day };
}

function detectDateFormat(values) {
	const samples = values.map((value) => value.trim()).filter(Boolean);
	if (!samples.length) return "yyyy-MM-dd HH:mm:ss";
	if (samples.every((value) => ISO_WITH_ZONE.test(value))) return "ISO";
	let best;
	for (const format of DATE_FORMATS) {
		const matched = samples.filter((value) =>
			parseWithFormat(value, format),
		).length;
		if (matched === samples.length) return format;
		if (matched > 0 && (!best || matched > best.matched))
			best = { format, matched };
	}
	return best?.format ?? "yyyy-MM-dd HH:mm:ss";
}

function sideKey(value) {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildSideMap(values) {
	const mapped = new Map();
	for (const raw of values) {
		const key = sideKey(raw);
		if (!key || mapped.has(key)) continue;
		const rule = SIDE_RULES.find(([pattern]) => pattern.test(key));
		if (rule) mapped.set(key, [raw.trim(), rule[1]]);
	}
	return mapped.size ? Object.fromEntries(mapped.values()) : undefined;
}

function buildPairSplit(columns, rows) {
	if (columns.pair === undefined) return undefined;
	const pairs = rows
		.map((row) =>
			String(row[columns.pair] ?? "")
				.trim()
				.toUpperCase(),
		)
		.filter(Boolean);
	if (!pairs.length) return undefined;
	const needsSplit = pairs.some(
		(pair) =>
			!/[-/_]/.test(pair) &&
			KNOWN_QUOTES.some(
				(quote) => pair.length > quote.length && pair.endsWith(quote),
			),
	);
	if (!needsSplit) return undefined;
	const quoteValues =
		columns.quoteAsset === undefined
			? []
			: rows
					.map((row) =>
						String(row[columns.quoteAsset] ?? "")
							.trim()
							.toUpperCase(),
					)
					.filter((value) => /^[A-Z0-9]{2,10}$/.test(value));
	return {
		knownQuotes: [...new Set([...quoteValues, ...KNOWN_QUOTES])],
	};
}

/**
 * Turns the app's `recipes/suggest` user message into a Recipe that the Zod
 * schema in packages/core accepts. Header order and samples decide the mapping;
 * nothing is invented for columns the file does not have.
 */
export function buildRecipe(payload = {}) {
	const headers = Array.isArray(payload.headers)
		? payload.headers.map(String)
		: [];
	const rows = normaliseRows(headers, payload.rows);
	const sample = (column) =>
		rows
			.map((row) => String(row[column] ?? ""))
			.filter((value) => value.trim());
	const columns = pickColumns(headers);
	const dateFormat = detectDateFormat(sample(columns.timestamp));
	const sideMap = buildSideMap(sample(columns.side));
	const signed = sample(columns.amount).some((value) => /^\s*-/.test(value));
	const sheet = typeof payload.sheet === "string" ? payload.sheet : undefined;
	const fingerprint =
		typeof payload.fingerprint === "string" && payload.fingerprint.length
			? payload.fingerprint
			: headerFingerprint(headers, sheet ?? "CSV");
	const id = `mock-recipe-${createHash("sha256")
		.update(`${fingerprint}|${JSON.stringify(columns)}`)
		.digest("hex")
		.slice(0, 12)}`;
	const recipe = {
		id,
		name: `Mock recipe for ${sheet ?? "CSV"}`,
		version: 1,
		fingerprint,
		columns,
		dateFormat,
		signStyle: sideMap
			? "side_column"
			: signed
				? "negative_is_sell"
				: "side_column",
	};
	if (sheet) recipe.sheet = sheet;
	if (payload.timezone === "IST" || payload.timezone === "UTC")
		recipe.timezone = payload.timezone;
	if (sideMap) recipe.sideMap = sideMap;
	const pairSplit = buildPairSplit(columns, rows);
	if (pairSplit) recipe.pairSplit = pairSplit;
	return recipe;
}

/** The app sends a JSON user message; plain CSV is accepted so the mock is easy to poke by hand. */
export function readUserPayload(body) {
	const messages = Array.isArray(body?.messages) ? body.messages : [];
	const user = messages.find(
		(message) =>
			message?.role === "user" && typeof message.content === "string",
	);
	if (!user) return {};
	try {
		const parsed = JSON.parse(user.content);
		if (parsed && typeof parsed === "object" && Array.isArray(parsed.headers))
			return {
				sheet: typeof parsed.sheet === "string" ? parsed.sheet : undefined,
				fingerprint:
					typeof parsed.fingerprint === "string"
						? parsed.fingerprint
						: undefined,
				timezone: parsed.timezone,
				headers: parsed.headers.map(String),
				rows: Array.isArray(parsed.rows) ? parsed.rows : [],
			};
	} catch {
		// Not JSON: fall through to the CSV reader below.
	}
	return payloadFromCsvText(user.content);
}

export function payloadFromCsvText(text) {
	const [header = [], ...data] = parseCsvRows(text);
	const headers = header.map((value) => value.trim());
	return {
		sheet: "CSV",
		headers,
		rows: data.map((values) =>
			Object.fromEntries(headers.map((name, i) => [name, values[i] ?? ""])),
		),
	};
}

export function parseCsvRows(text) {
	const rows = [];
	let row = [];
	let cell = "";
	let quoted = false;
	const source = text.replace(/^\uFEFF/, "");
	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (char === '"') {
			if (quoted && source[i + 1] === '"') {
				cell += '"';
				i++;
			} else quoted = !quoted;
		} else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
			row.push(cell);
			cell = "";
			if (char !== ",") {
				if (char === "\r" && source[i + 1] === "\n") i++;
				if (row.some((value) => value !== "")) rows.push(row);
				row = [];
			}
		} else cell += char;
	}
	if (cell || row.length) {
		row.push(cell);
		if (row.some((value) => value !== "")) rows.push(row);
	}
	return rows;
}
