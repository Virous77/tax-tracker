// Mock of every upstream Phase 2 sync talks to: Binance (spot + sapi), Binance public market
// data, CoinDCX, Etherscan V2, Blockscout and CoinGecko. Zero dependencies, node built-ins only.
//
// Run it with `node tools/mock-sync/server.mjs`, or import `startMockSync` and listen on port 0.
// Signatures, timestamps, time windows and pagination are enforced for real; the data is the
// coherent fixture user in ./fixtures.mjs.

import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
	ADDRESSES,
	BINANCE_C2C_CANCELLED,
	BINANCE_COIN_CONFIG,
	BINANCE_CONVERTS,
	BINANCE_DEPOSITS,
	BINANCE_DIVIDENDS,
	BINANCE_DUST,
	BINANCE_EARN_REWARDS,
	BINANCE_FIAT_ORDERS,
	BINANCE_SYMBOLS,
	BINANCE_TRADES,
	BINANCE_WITHDRAWALS,
	bigHistoryTransactions,
	binanceBalances,
	COINDCX_MARKETS,
	COINDCX_TRADES,
	COINGECKO_IDS,
	COINGECKO_USD_INR,
	CREDENTIALS,
	coindcxBalances,
	DATA_NOW,
	EVM_TRANSACTIONS,
	eachDay,
	evmBalances,
	formatAsset,
	formatPrice,
	isoDay,
	P2P_BUY,
	PRICE_SERIES,
	priceUnits,
	priceUnitsByAsset,
	TOKENS,
} from "./fixtures.mjs";

const DEFAULT_PORT = Number(process.env.MOCK_SYNC_PORT ?? 11601);
const DEFAULT_NOW = Date.parse(DATA_NOW);
const MAX_BODY_BYTES = 1_000_000;
const REQUEST_LOG_LIMIT = 500;
const DAY_MS = 86_400_000;
const BINANCE_RECV_WINDOW_MAX = 60_000;
const COINDCX_TIME_TOLERANCE_MS = 10_000;
const ETHERSCAN_MAX_RECORDS = 1000;
const ETHERSCAN_MAX_WINDOW = 10_000;
const ETHERSCAN_CALLS_PER_SECOND = 3;
const BLOCKSCOUT_CALLS_PER_SECOND = 5;
const BLOCKSCOUT_CREDITS_PER_CALL = 20;
const BLOCKSCOUT_CREDITS_PER_DAY = 100_000;
const COINGECKO_CALLS_PER_MINUTE = 100;
const COINGECKO_HISTORY_DAYS = 365;
const _BIG_HISTORY_ROWS = 3050;

const SCENARIOS = new Set([
	"normal",
	"empty",
	"rate_limit_once",
	"ban_418",
	"bad_signature",
	"clock_skew",
	"etherscan_rate_limit_200",
	"upstream_500_once",
	"trading_key",
	"big_history",
	"drift",
]);

const SECRET_PARAMS = new Set([
	"apikey",
	"signature",
	"api_key",
	"x_cg_demo_api_key",
]);

const WINDOWS = {
	myTrades: "24 hours",
	conversion: "30 days",
	deposit: "90 days",
	withdrawal: "90 days",
	dividend: "180 days",
	c2c: "30 days",
	earn: "30 days",
	fiat: "90 days",
};

const state = {
	scenario: "normal",
	now: DEFAULT_NOW,
	pending: {
		rateLimit: false,
		rateLimitVendor: null,
		notok: false,
		upstream500: false,
	},
	requests: [],
	coingeckoCalls: [],
	etherscanCalls: [],
	blockscout: { day: null, credits: BLOCKSCOUT_CREDITS_PER_DAY },
};

function resetState() {
	state.scenario = "normal";
	state.now = DEFAULT_NOW;
	state.pending = {
		rateLimit: false,
		rateLimitVendor: null,
		notok: false,
		upstream500: false,
	};
	state.requests = [];
	state.coingeckoCalls = [];
	state.etherscanCalls = [];
	state.blockscout = { day: null, credits: BLOCKSCOUT_CREDITS_PER_DAY };
}

// The HTTP clock stays real so a client that signs with its own clock keeps working;
// `clock_skew` pushes it 60 s ahead. `state.now` is the data clock that prices and default
// windows use, and can be pinned for deterministic answers.
function serverNow() {
	return Date.now() + (state.scenario === "clock_skew" ? 60_000 : 0);
}

function isBigHistory() {
	return state.scenario === "big_history";
}

// --- Binance ---------------------------------------------------------------

function binanceError(ctx, status, code, msg, headers = {}) {
	return send(
		ctx,
		status,
		{ code, msg },
		{ "Content-Type": "application/json; charset=utf-8", ...headers },
	);
}

function windowError(ctx, label) {
	return binanceError(
		ctx,
		400,
		-1127,
		`More than ${label} between startTime and endTime.`,
	);
}

function binanceWeights(weight) {
	return {
		"X-MBX-USED-WEIGHT-1M": String(weight),
		"X-MBX-ORDER-COUNT-10S": "0",
	};
}

function binanceBanned(ctx) {
	const until = Date.now() + 120_000;
	return binanceError(
		ctx,
		418,
		-1003,
		`Way too many requests; IP banned until ${until}. Please use the websocket for live updates to avoid bans.`,
		{ "Retry-After": "120" },
	);
}

// Binance signs the query string concatenated with the body, minus the `signature` parameter.
function binancePayload(ctx) {
	const query = ctx.url.search.startsWith("?") ? ctx.url.search.slice(1) : "";
	const unsigned = query
		.split("&")
		.filter((part) => part.length > 0 && !part.startsWith("signature="))
		.join("&");
	return `${unsigned}${ctx.rawBody}`;
}

function checkBinanceSignature(ctx) {
	const apiKey = ctx.request?.headers?.["x-mbx-apikey"] ?? null;
	const key = typeof apiKey === "string" ? apiKey : null;
	if (!key)
		return {
			status: 401,
			body: {
				code: -2015,
				msg: "Invalid API-key, IP, or permissions for action.",
			},
		};
	if (key.length < 8 || key.length > 64)
		return {
			status: 400,
			body: { code: -2014, msg: "API-key format invalid." },
		};
	if (key !== CREDENTIALS.binance.apiKey)
		return {
			status: 401,
			body: {
				code: -2015,
				msg: "Invalid API-key, IP, or permissions for action.",
			},
		};

	const signature = param(ctx, "signature");
	if (!signature)
		return {
			status: 400,
			body: {
				code: -1102,
				msg: "Mandatory parameter 'signature' was not sent, was empty/null, or malformed.",
			},
		};
	const expected = createHmac("sha256", CREDENTIALS.binance.secret)
		.update(binancePayload(ctx))
		.digest("hex");
	if (
		state.scenario === "bad_signature" ||
		expected !== signature.toLowerCase()
	)
		return {
			status: 400,
			body: {
				code: -1022,
				msg: "Signature for this request is not valid.",
			},
		};

	const recvWindow = integerParam(ctx, "recvWindow") ?? 5000;
	if (recvWindow > BINANCE_RECV_WINDOW_MAX)
		return {
			status: 400,
			body: {
				code: -1130,
				msg: "Data sent for parameter 'recvWindow' is not valid.",
			},
		};
	const timestamp = integerParam(ctx, "timestamp");
	if (timestamp === null)
		return {
			status: 400,
			body: {
				code: -1102,
				msg: "Mandatory parameter 'timestamp' was not sent, was empty/null, or malformed.",
			},
		};
	const now = serverNow();
	if (timestamp > now + 1000 || now - timestamp > recvWindow)
		return {
			status: 400,
			body: {
				code: -1021,
				msg: "Timestamp for this request is outside of the recvWindow.",
			},
		};
	return null;
}

function exchangeSymbols() {
	return BINANCE_SYMBOLS.map((symbol) => ({
		symbol: symbol.symbol,
		status: symbol.status,
		baseAsset: symbol.base,
		baseAssetPrecision: 8,
		quoteAsset: symbol.quote,
		quotePrecision: 8,
		quoteAssetPrecision: 8,
		orderTypes: ["LIMIT", "MARKET", "LIMIT_MAKER"],
		icebergAllowed: true,
		ocoAllowed: true,
		quoteOrderQtyMarketAllowed: true,
		allowTrailingStop: false,
		cancelReplaceAllowed: false,
		isSpotTradingAllowed: true,
		isMarginTradingAllowed: symbol.quote === "USDT",
		filters: [],
		permissions: ["SPOT", "MARGIN"],
	}));
}

function klineRows(symbol, _interval, timeZone, startTime, endTime, limit) {
	const istAligned = timeZone === "5:30" || timeZone === "05:30";
	const shift = istAligned ? -5.5 * 3_600_000 : 0;
	const first = Date.parse(`${isoDay(startTime)}T00:00:00Z`);
	const lastIso = isoDay(Math.min(endTime, state.now));
	const days = eachDay(isoDay(first), lastIso);
	const rows = [];
	for (const day of days) {
		const previous = isoDay(Date.parse(`${day}T00:00:00Z`) - DAY_MS);
		const openTime = Date.parse(`${day}T00:00:00Z`) + shift;
		if (openTime < startTime || openTime > endTime) continue;
		const open = priceUnits(symbol, previous);
		const close = priceUnits(symbol, day);
		// biome-ignore lint/complexity/useMathMinMax: Math.max throws on BigInt
		const high = ((open > close ? open : close) * 10040n) / 10000n;
		// biome-ignore lint/complexity/useMathMinMax: Math.min throws on BigInt
		const low = ((open < close ? open : close) * 9960n) / 10000n;
		const volumeUnits =
			BigInt((hashIntFor(`${symbol}:${day}:volume`) % 9_000_000) + 1_000_000) *
			1000n;
		rows.push([
			openTime,
			formatPrice(open),
			formatPrice(high),
			formatPrice(low),
			formatPrice(close),
			formatAsset(volumeUnits, 8),
			openTime + DAY_MS - 1,
			formatAsset((volumeUnits * close) / 100000000n, 8),
			(hashIntFor(`${symbol}:${day}:trades`) % 4000) + 100,
			formatAsset(volumeUnits / 2n, 8),
			formatAsset((volumeUnits * close) / 200000000n, 8),
			"0",
		]);
		if (rows.length >= limit) break;
	}
	return rows;
}

const hashIntCache = new Map();
function hashIntFor(text) {
	if (hashIntCache.has(text)) return hashIntCache.get(text);
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	hashIntCache.set(text, hash);
	return hash;
}

function handleBinance(ctx, rest, publicOnly) {
	if (state.scenario === "ban_418") return binanceBanned(ctx);

	if (rest === "/api/v3/time" && ctx.method === "GET")
		return send(ctx, 200, { serverTime: serverNow() }, binanceWeights(1));

	if (rest === "/api/v3/exchangeInfo" && ctx.method === "GET") {
		const requested = param(ctx, "symbols");
		let symbols = exchangeSymbols();
		if (requested) {
			const wanted = requested
				.replace(/^\[|\]$/g, "")
				.split(",")
				.map((name) => name.trim().replace(/^"|"$/g, "").toUpperCase())
				.filter(Boolean);
			symbols = symbols.filter((symbol) => wanted.includes(symbol.symbol));
		}
		return send(
			ctx,
			200,
			{
				timezone: "UTC",
				serverTime: serverNow(),
				rateLimits: [
					{
						rateLimitType: "REQUEST_WEIGHT",
						interval: "MINUTE",
						intervalNum: 1,
						limit: 6000,
					},
					{
						rateLimitType: "ORDERS",
						interval: "SECOND",
						intervalNum: 10,
						limit: 50,
					},
					{
						rateLimitType: "RAW_REQUESTS",
						interval: "MINUTE",
						intervalNum: 5,
						limit: 61000,
					},
				],
				exchangeFilters: [],
				symbols,
			},
			binanceWeights(20),
		);
	}

	if (rest === "/api/v3/klines" && ctx.method === "GET") {
		const symbol = (param(ctx, "symbol") ?? "").toUpperCase();
		if (!PRICE_SERIES[symbol])
			return binanceError(ctx, 400, -1121, "Invalid symbol.");
		const interval = param(ctx, "interval") ?? "1d";
		if (interval !== "1d")
			return binanceError(ctx, 400, -1120, "Invalid interval.");
		const timeZone = param(ctx, "timeZone") ?? "0";
		if (!["0", "5:30", "05:30", "UTC"].includes(timeZone))
			return binanceError(
				ctx,
				400,
				-1130,
				"Data sent for parameter 'timeZone' is not valid.",
			);
		const limit = integerParam(ctx, "limit") ?? 500;
		if (limit < 1 || limit > 1000)
			return binanceError(
				ctx,
				400,
				-1130,
				"Data sent for parameter 'limit' is not valid.",
			);
		const endTime = integerParam(ctx, "endTime") ?? state.now;
		const startTime = integerParam(ctx, "startTime") ?? endTime - 499 * DAY_MS;
		const rows = klineRows(
			symbol,
			interval,
			timeZone,
			startTime,
			endTime,
			limit,
		);
		return send(ctx, 200, rows, binanceWeights(2));
	}

	if (publicOnly)
		return binanceError(ctx, 404, -1102, `No mock route for ${rest}.`);

	const failure = checkBinanceSignature(ctx);
	if (failure) return send(ctx, failure.status, failure.body);

	if (ctx.method === "GET" && rest === "/api/v3/myTrades")
		return binanceMyTrades(ctx);
	if (ctx.method === "GET" && rest === "/api/v3/account")
		return binanceAccount(ctx);
	if (ctx.method === "POST" && rest === "/sapi/v1/asset/get-funding-asset")
		return binanceFundingAsset(ctx);
	if (ctx.method === "POST" && rest === "/sapi/v3/asset/getUserAsset")
		return binanceUserAsset(ctx);
	if (ctx.method === "GET" && rest === "/sapi/v1/capital/config/getall")
		return send(ctx, 200, BINANCE_COIN_CONFIG, binanceWeights(10));
	if (ctx.method === "GET" && rest === "/sapi/v1/capital/deposit/hisrec")
		return binanceDeposits(ctx);
	if (ctx.method === "GET" && rest === "/sapi/v1/capital/withdraw/history")
		return binanceWithdrawals(ctx);
	if (ctx.method === "GET" && rest === "/sapi/v1/convert/tradeFlow")
		return binanceConvert(ctx);
	if (ctx.method === "GET" && rest === "/sapi/v1/asset/dribblet")
		return binanceDribblet(ctx);
	if (ctx.method === "GET" && rest === "/sapi/v1/asset/assetDividend")
		return binanceDividend(ctx);
	if (ctx.method === "GET" && rest === "/sapi/v1/fiat/orders")
		return binanceFiat(ctx, "orders");
	if (ctx.method === "GET" && rest === "/sapi/v1/fiat/payments")
		return binanceFiat(ctx, "payments");
	if (
		ctx.method === "GET" &&
		rest === "/sapi/v1/c2c/orderMatch/listUserOrderHistory"
	)
		return binanceC2c(ctx);
	if (
		ctx.method === "GET" &&
		rest === "/sapi/v1/simple-earn/flexible/history/rewardsRecord"
	)
		return binanceEarn(ctx, true);
	if (
		ctx.method === "GET" &&
		rest === "/sapi/v1/simple-earn/locked/history/rewardsRecord"
	)
		return binanceEarn(ctx, false);
	if (ctx.method === "GET" && rest === "/sapi/v1/account/apiRestrictions")
		return binanceApiRestrictions(ctx);
	if (ctx.method === "GET" && rest === "/sapi/v1/spot/delist-schedule")
		return send(ctx, 200, [], binanceWeights(1));

	return binanceError(ctx, 404, -1102, `No mock route for ${rest}.`);
}

function send(ctx, status, body, headers = {}) {
	const payload =
		body === undefined
			? ""
			: typeof body === "string"
				? body
				: JSON.stringify(body);
	ctx.status = status;
	ctx.response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(payload),
		"Cache-Control": "no-store",
		...headers,
	});
	ctx.response.end(payload);
	record(ctx);
}

function record(ctx) {
	const params = {};
	for (const [key, value] of ctx.url.searchParams)
		params[key] = SECRET_PARAMS.has(key.toLowerCase()) ? "***" : value;
	state.requests.push({
		method: ctx.method,
		path: ctx.url.pathname,
		params,
		status: ctx.status,
	});
	if (state.requests.length > REQUEST_LOG_LIMIT) state.requests.shift();
}

async function readBody(request) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES)
			throw Object.assign(new Error("Request body is too large."), {
				status: 413,
			});
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function param(ctx, name) {
	const value = ctx.url.searchParams.get(name);
	if (value !== null) return value;
	return ctx.bodyParams?.get(name) ?? null;
}

function integerParam(ctx, name) {
	const raw = param(ctx, name);
	if (raw === null || raw === "") return null;
	const value = Number(raw);
	return Number.isFinite(value) ? Math.trunc(value) : null;
}

function boolParam(ctx, name, fallback = false) {
	const raw = param(ctx, name);
	if (raw === null) return fallback;
	return raw === "true" || raw === "1";
}

function sortedBy(list, key, direction = "asc") {
	const copy = [...list];
	copy.sort((left, right) => {
		const a = key(left);
		const b = key(right);
		if (a === b) return 0;
		const order = a < b ? -1 : 1;
		return direction === "asc" ? order : -order;
	});
	return copy;
}

// --- Control endpoints -----------------------------------------------------

function controlState() {
	return {
		scenario: state.scenario,
		now: new Date(state.now).toISOString(),
		pending: { ...state.pending },
	};
}

async function handleControl(ctx) {
	const path = ctx.url.pathname;
	if (path === "/__control") {
		if (ctx.method === "GET") return send(ctx, 200, controlState());
		if (ctx.method !== "POST")
			return send(
				ctx,
				405,
				{ error: "Use GET or POST on /__control." },
				{ Allow: "GET, POST" },
			);
		let body;
		try {
			body = ctx.rawBody ? JSON.parse(ctx.rawBody) : {};
		} catch {
			return send(ctx, 400, { error: "Body is not valid JSON." });
		}
		if (body.scenario !== undefined) {
			if (!SCENARIOS.has(body.scenario))
				return send(ctx, 400, {
					error: `Unknown scenario: ${body.scenario}.`,
					scenarios: [...SCENARIOS],
				});
			state.scenario = body.scenario;
			state.pending = {
				rateLimit: body.scenario === "rate_limit_once",
				rateLimitVendor: null,
				notok: body.scenario === "etherscan_rate_limit_200",
				upstream500: body.scenario === "upstream_500_once",
			};
			state.coingeckoCalls = [];
			state.etherscanCalls = [];
			state.blockscout = { day: null, credits: BLOCKSCOUT_CREDITS_PER_DAY };
		}
		if (body.now !== undefined) {
			const value =
				typeof body.now === "number" ? body.now : Date.parse(String(body.now));
			if (!Number.isFinite(value))
				return send(ctx, 400, {
					error: "`now` must be an ISO date or epoch ms.",
				});
			state.now = value;
		}
		return send(ctx, 200, controlState());
	}
	if (path === "/__requests") {
		if (ctx.method === "GET") return send(ctx, 200, state.requests);
		if (ctx.method === "DELETE") {
			state.requests = [];
			return send(ctx, 204, undefined);
		}
		return send(
			ctx,
			405,
			{ error: "Use GET or DELETE on /__requests." },
			{
				Allow: "GET, DELETE",
			},
		);
	}
	return send(ctx, 404, {
		error: `No control route for ${ctx.method} ${path}.`,
	});
}

// --- Dispatch --------------------------------------------------------------

function vendorOf(path) {
	if (path.startsWith("/binance-data/")) return "binance";
	if (path.startsWith("/binance/")) return "binance";
	if (path.startsWith("/coindcx/")) return "coindcx";
	if (path === "/etherscan" || path.startsWith("/etherscan/"))
		return "etherscan";
	if (path === "/blockscout" || path.startsWith("/blockscout/"))
		return "blockscout";
	if (path.startsWith("/coingecko/")) return "coingecko";
	return null;
}

function onceLimit(ctx, vendor) {
	if (!state.pending.rateLimit) return false;
	state.pending.rateLimit = false;
	state.pending.rateLimitVendor = vendor;
	state.scenario = "normal";
	const retryAfter = { "Retry-After": "1" };
	if (vendor === "binance")
		send(
			ctx,
			429,
			{
				code: -1003,
				msg: "Too much request weight used; current limit is 6000 request weight per 1 MINUTE. Please use the websocket for live updates to avoid polling the API.",
			},
			{ ...retryAfter, "X-MBX-USED-WEIGHT-1M": "6001" },
		);
	else if (vendor === "coindcx")
		send(
			ctx,
			429,
			{ code: 429, message: "Too many requests", status: "error" },
			retryAfter,
		);
	else if (vendor === "coingecko")
		send(
			ctx,
			429,
			{
				status: {
					error_code: 429,
					error_message: "You've exceeded the Rate Limit.",
				},
			},
			retryAfter,
		);
	else
		send(
			ctx,
			429,
			{
				status: "0",
				message: "NOTOK",
				result:
					"Max rate limit reached, please use API Key for higher rate limit",
			},
			retryAfter,
		);
	return true;
}

function onceUpstream500(ctx, vendor) {
	if (!state.pending.upstream500) return false;
	state.pending.upstream500 = false;
	state.scenario = "normal";
	if (vendor === "binance")
		send(ctx, 500, {
			code: -1000,
			msg: "An unknown error occured while processing the request.",
		});
	else if (vendor === "coindcx")
		send(ctx, 500, {
			code: 500,
			message: "Internal server error",
			status: "error",
		});
	else if (vendor === "coingecko")
		send(ctx, 500, {
			status: { error_code: 500, error_message: "Internal server error" },
		});
	else
		send(ctx, 500, {
			status: "0",
			message: "NOTOK",
			result:
				"Unexpected err, timeout occurred or server too busy. Please try again later",
		});
	return true;
}

async function handle(request, response) {
	const method = request.method ?? "GET";
	const url = new URL(request.url ?? "/", "http://mock.local");
	const ctx = {
		request,
		method,
		url,
		response,
		status: 0,
		rawBody: "",
		bodyParams: null,
	};
	try {
		ctx.rawBody = await readBody(request);
	} catch (error) {
		return send(ctx, error.status ?? 400, { error: error.message });
	}
	if (url.pathname.startsWith("/__")) return handleControl(ctx);

	const vendor = vendorOf(url.pathname);
	if (!vendor)
		return send(ctx, 404, {
			error: `No mock route for ${method} ${url.pathname}.`,
		});

	if (
		ctx.rawBody &&
		(request.headers["content-type"] ?? "").includes(
			"application/x-www-form-urlencoded",
		)
	)
		ctx.bodyParams = new URLSearchParams(ctx.rawBody);

	if (onceLimit(ctx, vendor)) return;
	if (onceUpstream500(ctx, vendor)) return;

	if (url.pathname.startsWith("/binance-data/"))
		return handleBinance(ctx, url.pathname.slice("/binance-data".length), true);
	if (url.pathname.startsWith("/binance/"))
		return handleBinance(ctx, url.pathname.slice("/binance".length), false);
	if (url.pathname.startsWith("/coindcx/"))
		return handleCoinDcx(ctx, url.pathname.slice("/coindcx".length));
	if (url.pathname === "/etherscan" || url.pathname.startsWith("/etherscan/"))
		return handleEvm(ctx, "etherscan");
	if (url.pathname === "/blockscout" || url.pathname.startsWith("/blockscout/"))
		return handleEvm(ctx, "blockscout");
	return handleCoinGecko(ctx, url.pathname.slice("/coingecko".length));
}

export function createMockSync() {
	const server = createServer((request, response) => {
		handle(request, response).catch((error) => {
			if (!response.headersSent)
				send(
					{
						method: request.method ?? "GET",
						url: new URL(request.url ?? "/", "http://mock.local"),
						response,
						status: 500,
					},
					500,
					{ error: `Mock failure: ${error.message}` },
				);
			else response.destroy();
		});
	});
	return { server };
}

export async function startMockSync({
	port = DEFAULT_PORT,
	host = "0.0.0.0",
	reset = true,
} = {}) {
	if (reset) resetState();
	const { server } = createMockSync();
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			const address = server.address();
			const actual =
				typeof address === "object" && address ? address.port : port;
			resolve({
				server,
				port: actual,
				url: `http://127.0.0.1:${actual}`,
				close: () =>
					new Promise((done, fail) => {
						server.closeAllConnections();
						server.close((error) => (error ? fail(error) : done()));
					}),
			});
		});
	});
}

// --- Binance signed streams ------------------------------------------------

function emptyScenario() {
	return state.scenario === "empty";
}

function historyRows(rows) {
	return emptyScenario() ? [] : rows;
}

function spotEntries(includeZeros) {
	const { spot } = binanceBalances();
	const entries = new Map(spot);
	for (const asset of ["ETH", "BNB", "USDT", "USDC", "XRP"])
		if (!entries.has(asset)) entries.set(asset, 0n);
	const rows = [];
	for (const [asset, units] of entries) {
		if (emptyScenario()) {
			rows.push({ asset, units: 0n });
			continue;
		}
		if (units === 0n && !includeZeros) continue;
		rows.push({ asset, units });
	}
	return rows;
}

function binanceMyTrades(ctx) {
	const symbol = (param(ctx, "symbol") ?? "").toUpperCase();
	if (!symbol)
		return binanceError(
			ctx,
			400,
			-1102,
			"Mandatory parameter 'symbol' was not sent, was empty/null, or malformed.",
		);
	const instrument = BINANCE_SYMBOLS.find(
		(candidate) =>
			candidate.symbol === symbol && candidate.status === "TRADING",
	);
	if (!instrument) return binanceError(ctx, 400, -1121, "Invalid symbol.");

	const limit = integerParam(ctx, "limit") ?? 500;
	if (limit < 1 || limit > 1000)
		return binanceError(
			ctx,
			400,
			-1130,
			"Data sent for parameter 'limit' is not valid.",
		);
	const fromId = integerParam(ctx, "fromId");
	const startTime = integerParam(ctx, "startTime");
	const endTime = integerParam(ctx, "endTime");
	if (startTime !== null && endTime !== null && endTime - startTime > DAY_MS)
		return windowError(ctx, WINDOWS.myTrades);
	if (startTime !== null && fromId !== null)
		return binanceError(
			ctx,
			400,
			-1128,
			"Combination of optional parameters invalid.",
		);

	let rows = historyRows(
		BINANCE_TRADES.filter(
			(trade) =>
				trade.base === instrument.base && trade.quote === instrument.quote,
		).map((trade) => trade.raw),
	)
		.filter((row) => fromId === null || row.id >= fromId)
		.filter((row) => startTime === null || row.time >= startTime)
		.filter((row) => endTime === null || row.time <= endTime);
	rows = sortedBy(rows, (row) => row.id).slice(0, limit);
	return send(ctx, 200, rows, binanceWeights(20));
}

function binanceAccount(ctx) {
	const includeZeros = !boolParam(ctx, "omitZeroBalances", false);
	const balances = spotEntries(includeZeros).map(({ asset, units }) => ({
		asset,
		free: formatAsset(units, 8),
		locked: "0.00000000",
	}));
	return send(
		ctx,
		200,
		{
			makerCommission: 15,
			takerCommission: 15,
			buyerCommission: 0,
			sellerCommission: 0,
			commissionRates: {
				maker: "0.00150000",
				taker: "0.00150000",
				buyer: "0.00000000",
				seller: "0.00000000",
			},
			canTrade: true,
			canWithdraw: false,
			canDeposit: false,
			brokered: false,
			requireSelfTradePrevention: false,
			preventSor: false,
			updateTime: state.now,
			accountType: "SPOT",
			balances,
			permissions: ["SPOT"],
			uid: 354937868,
		},
		binanceWeights(20),
	);
}

function binanceFundingAsset(ctx) {
	const asset = param(ctx, "asset");
	const { funding } = binanceBalances();
	const rows = [];
	for (const [name, units] of funding) {
		if (asset && asset.toUpperCase() !== name) continue;
		if (emptyScenario() || units === 0n) continue;
		rows.push({
			asset: name,
			free: formatAsset(units, 8),
			locked: "0.00000000",
			freeze: "0.00000000",
			withdrawing: "0.00000000",
			btcValuation: "0.00000000",
		});
	}
	return send(ctx, 200, rows, binanceWeights(1));
}

function binanceUserAsset(ctx) {
	const wanted = (param(ctx, "asset") ?? "").toUpperCase();
	const { spot, funding } = binanceBalances();
	const totals = new Map(spot);
	for (const [asset, units] of funding)
		totals.set(asset, (totals.get(asset) ?? 0n) + units);
	const rows = [];
	for (const [asset, units] of totals) {
		if (wanted && wanted !== asset) continue;
		if (emptyScenario() || units <= 0n) continue;
		rows.push({
			asset,
			free: formatAsset(units, 8),
			locked: "0.00000000",
			freeze: "0.00000000",
			withdrawing: "0.00000000",
			ipoable: "0.00000000",
			btcValuation: "0.00000000",
		});
	}
	return send(ctx, 200, rows, binanceWeights(5));
}

function windowBounds(ctx, startName, endName, label, defaultDays) {
	const end = integerParam(ctx, endName) ?? state.now;
	const start = integerParam(ctx, startName) ?? end - defaultDays * DAY_MS;
	if (end <= start) return { error: "invalid" };
	if (end - start > defaultDays * DAY_MS) return { error: label };
	return { start, end };
}

function binanceDeposits(ctx) {
	const bounds = windowBounds(ctx, "startTime", "endTime", WINDOWS.deposit, 90);
	if (bounds.error === WINDOWS.deposit)
		return windowError(ctx, WINDOWS.deposit);
	const limit = integerParam(ctx, "limit") ?? 1000;
	if (limit < 1 || limit > 1000)
		return binanceError(
			ctx,
			400,
			-1130,
			"Data sent for parameter 'limit' is not valid.",
		);
	const offset = integerParam(ctx, "offset") ?? 0;
	const coin = param(ctx, "coin");
	const status = integerParam(ctx, "status");
	const txId = param(ctx, "txId");
	let rows = historyRows(BINANCE_DEPOSITS)
		.filter((row) => coin === null || row.coin === coin.toUpperCase())
		.filter((row) => status === null || row.status === status)
		.filter((row) => txId === null || row.txId === txId)
		.filter(
			(row) =>
				!bounds.start ||
				(row.insertTime >= bounds.start &&
					row.insertTime <= (bounds.end ?? state.now)),
		);
	rows = sortedBy(rows, (row) => row.insertTime).slice(offset, offset + limit);
	return send(ctx, 200, rows, binanceWeights(1));
}

function applyTimeMs(row) {
	return Date.parse(`${row.applyTime.replace(" ", "T")}Z`);
}

function binanceWithdrawals(ctx) {
	const bounds = windowBounds(
		ctx,
		"startTime",
		"endTime",
		WINDOWS.withdrawal,
		90,
	);
	if (bounds.error === WINDOWS.withdrawal)
		return windowError(ctx, WINDOWS.withdrawal);
	const limit = integerParam(ctx, "limit") ?? 1000;
	if (limit < 1 || limit > 1000)
		return binanceError(
			ctx,
			400,
			-1130,
			"Data sent for parameter 'limit' is not valid.",
		);
	const offset = integerParam(ctx, "offset") ?? 0;
	const coin = param(ctx, "coin");
	const status = integerParam(ctx, "status");
	const idList = param(ctx, "idList");
	let rows = historyRows(BINANCE_WITHDRAWALS)
		.filter((row) => coin === null || row.coin === coin.toUpperCase())
		.filter((row) => status === null || row.status === status)
		.filter((row) => idList === null || idList.split(",").includes(row.id))
		.filter(
			(row) =>
				!bounds.start ||
				(applyTimeMs(row) >= bounds.start &&
					applyTimeMs(row) <= (bounds.end ?? state.now)),
		);
	rows = sortedBy(rows, applyTimeMs).slice(offset, offset + limit);
	return send(ctx, 200, rows);
}

function binanceConvert(ctx) {
	const startTime = integerParam(ctx, "startTime");
	const endTime = integerParam(ctx, "endTime");
	if (startTime === null || endTime === null)
		return binanceError(
			ctx,
			400,
			-1102,
			"Mandatory parameter 'startTime' and 'endTime' were not sent, were empty/null, or malformed.",
		);
	if (endTime - startTime > 30 * DAY_MS)
		return windowError(ctx, WINDOWS.conversion);
	const limit = integerParam(ctx, "limit") ?? 100;
	if (limit < 1 || limit > 1000)
		return binanceError(
			ctx,
			400,
			-1130,
			"Data sent for parameter 'limit' is not valid.",
		);
	const all = historyRows(BINANCE_CONVERTS)
		.filter((row) => row.createTime >= startTime && row.createTime <= endTime)
		.sort((left, right) => left.createTime - right.createTime);
	const list = all.slice(0, limit);
	return send(
		ctx,
		200,
		{
			list,
			startTime,
			endTime,
			limit,
			moreData: all.length > list.length,
		},
		binanceWeights(3000),
	);
}

function binanceDribblet(ctx) {
	const startTime = integerParam(ctx, "startTime");
	const endTime = integerParam(ctx, "endTime");
	const rows = historyRows(BINANCE_DUST)
		.filter((row) => startTime === null || row.operateTime >= startTime)
		.filter((row) => endTime === null || row.operateTime <= endTime);
	return send(
		ctx,
		200,
		{ total: rows.length, userAssetDribblets: rows.slice(-100) },
		binanceWeights(1),
	);
}

function binanceDividend(ctx) {
	const bounds = windowBounds(
		ctx,
		"startTime",
		"endTime",
		WINDOWS.dividend,
		180,
	);
	if (bounds.error === WINDOWS.dividend)
		return windowError(ctx, WINDOWS.dividend);
	const limit = integerParam(ctx, "limit") ?? 20;
	if (limit < 1 || limit > 500)
		return binanceError(
			ctx,
			400,
			-1130,
			"Data sent for parameter 'limit' is not valid.",
		);
	const asset = param(ctx, "asset");
	const rows = historyRows(BINANCE_DIVIDENDS)
		.filter((row) => asset === null || row.asset === asset.toUpperCase())
		.filter(
			(row) =>
				!bounds.start ||
				(row.divTime >= bounds.start &&
					row.divTime <= (bounds.end ?? state.now)),
		)
		.slice(0, limit);
	return send(ctx, 200, { rows, total: rows.length }, binanceWeights(10));
}

function fiatEnvelope(data, total) {
	const body = { code: "000000", message: "success" };
	if (data !== null) body.data = data;
	body.total = total;
	body.success = true;
	return body;
}

function binanceFiat(ctx, kind) {
	const transactionType = integerParam(ctx, "transactionType");
	if (transactionType === null)
		return binanceError(
			ctx,
			400,
			-1102,
			"Mandatory parameter 'transactionType' was not sent, was empty/null, or malformed.",
		);
	if (transactionType !== 0 && transactionType !== 1)
		return binanceError(
			ctx,
			400,
			-1130,
			"Data sent for parameter 'transactionType' is not valid.",
		);
	const bounds = windowBounds(ctx, "beginTime", "endTime", WINDOWS.fiat, 90);
	if (bounds.error === WINDOWS.fiat) return windowError(ctx, WINDOWS.fiat);
	const rows = integerParam(ctx, "rows") ?? 100;
	if (rows < 1 || rows > 500)
		return binanceError(
			ctx,
			400,
			-1130,
			"Data sent for parameter 'rows' is not valid.",
		);
	const page = integerParam(ctx, "page") ?? 1;
	if (page < 1)
		return binanceError(
			ctx,
			400,
			-1130,
			"Data sent for parameter 'page' is not valid.",
		);

	if (kind === "payments")
		// Rotki's note: the empty answer drops `data` completely. Keep that quirk.
		return send(ctx, 200, fiatEnvelope(null, 0), binanceWeights(1));

	const matches = historyRows(BINANCE_FIAT_ORDERS)
		.filter((row) => row.transactionType === transactionType)
		.filter(
			(row) =>
				!bounds.start ||
				(row.createTime >= bounds.start &&
					row.createTime <= (bounds.end ?? state.now)),
		);
	const start = (page - 1) * rows;
	return send(
		ctx,
		200,
		fiatEnvelope(matches.slice(start, start + rows), matches.length),
		binanceWeights(45000),
	);
}

function binanceC2c(ctx) {
	const bounds = windowBounds(
		ctx,
		"startTimestamp",
		"endTimestamp",
		WINDOWS.c2c,
		30,
	);
	if (bounds.error === WINDOWS.c2c) return windowError(ctx, WINDOWS.c2c);
	const rows = integerParam(ctx, "rows") ?? 100;
	if (rows < 1 || rows > 100)
		return binanceError(
			ctx,
			400,
			-1130,
			"Data sent for parameter 'rows' is not valid.",
		);
	const page = integerParam(ctx, "page") ?? 1;
	const tradeType = param(ctx, "tradeType");
	const all = historyRows([P2P_BUY, BINANCE_C2C_CANCELLED])
		.filter(
			(row) => tradeType === null || row.tradeType === tradeType.toUpperCase(),
		)
		.filter(
			(row) =>
				!bounds.start ||
				(row.createTime >= bounds.start &&
					row.createTime <= (bounds.end ?? state.now)),
		);
	const start = (page - 1) * rows;
	return send(
		ctx,
		200,
		fiatEnvelope(all.slice(start, start + rows), all.length),
		binanceWeights(1),
	);
}

function binanceEarn(ctx, flexible) {
	const type = param(ctx, "type");
	if (flexible && !type)
		return binanceError(
			ctx,
			400,
			-1102,
			"Mandatory parameter 'type' was not sent, was empty/null, or malformed.",
		);
	const bounds = windowBounds(ctx, "startTime", "endTime", WINDOWS.earn, 30);
	if (bounds.error === WINDOWS.earn)
		return binanceError(ctx, 400, -6021, "Query time range too large");
	const size = integerParam(ctx, "size") ?? 10;
	if (size < 1 || size > 100)
		return binanceError(
			ctx,
			400,
			-1130,
			"Data sent for parameter 'size' is not valid.",
		);
	const current = integerParam(ctx, "current") ?? 1;
	const asset = param(ctx, "asset");
	const source = flexible ? BINANCE_EARN_REWARDS : [];
	const all = historyRows(source)
		.filter((row) => asset === null || row.asset === asset.toUpperCase())
		.filter(
			(row) =>
				!bounds.start ||
				(row.time >= bounds.start && row.time <= (bounds.end ?? state.now)),
		);
	const start = (current - 1) * size;
	return send(
		ctx,
		200,
		{
			rows: all.slice(start, start + size).map((row) => ({
				asset: row.asset,
				rewards: row.rewards,
				projectId: row.projectId,
				type: row.type,
				time: row.time,
			})),
			total: all.length,
		},
		binanceWeights(150),
	);
}

function binanceApiRestrictions(ctx) {
	const trading = state.scenario === "trading_key";
	return send(
		ctx,
		200,
		{
			ipRestrict: false,
			createTime: Date.parse("2025-04-06T18:20:00Z"),
			enableReading: true,
			enableWithdrawals: false,
			enableInternalTransfer: false,
			enableMargin: false,
			enableFutures: false,
			permitsUniversalTransfer: false,
			enableVanillaOptions: false,
			enableFixApiTrade: false,
			enableFixReadOnly: false,
			enableSpotAndMarginTrading: trading,
			enablePortfolioMarginTrading: false,
		},
		binanceWeights(1),
	);
}

// --- CoinDCX ---------------------------------------------------------------

function coinDcxError(ctx, status, message) {
	return send(ctx, status, { code: status, message, status: "error" });
}

function handleCoinDcx(ctx, rest) {
	if (ctx.method === "GET" && rest === "/exchange/v1/markets_details")
		return send(ctx, 200, COINDCX_MARKETS);

	if (ctx.method !== "POST")
		return coinDcxError(
			ctx,
			405,
			"Every authenticated CoinDCX call is a POST.",
		);

	const apiKey = ctx.request?.headers?.["x-auth-apikey"] ?? null;
	const signature = ctx.request?.headers?.["x-auth-signature"] ?? null;
	if (typeof apiKey !== "string" || apiKey !== CREDENTIALS.coindcx.apiKey)
		return coinDcxError(ctx, 401, "Your API key is wrong");
	const expected = createHmac("sha256", CREDENTIALS.coindcx.secret)
		.update(ctx.rawBody)
		.digest("hex");
	if (typeof signature !== "string" || expected !== signature.toLowerCase())
		return coinDcxError(ctx, 401, "Invalid credentials");

	let body;
	try {
		body = ctx.rawBody ? JSON.parse(ctx.rawBody) : {};
	} catch {
		return coinDcxError(ctx, 400, "Body is not valid JSON");
	}
	const timestamp = Number(body.timestamp);
	if (!Number.isFinite(timestamp))
		return coinDcxError(ctx, 400, "timestamp is required");
	if (Math.abs(serverNow() - timestamp) > COINDCX_TIME_TOLERANCE_MS)
		return coinDcxError(ctx, 401, "timestamp is outside the accepted window");

	if (rest === "/exchange/v1/orders/trade_history")
		return coinDcxTrades(ctx, body);
	if (rest === "/exchange/v1/users/balances") return coinDcxBalances(ctx);
	if (rest === "/exchange/v1/users/info")
		return send(ctx, 200, [
			{
				coindcx_id: "mock-coindcx-user",
				first_name: "Mock",
				last_name: "Fixture",
				mobile_number: "",
				email: "fixture@example.invalid",
			},
		]);
	return coinDcxError(ctx, 404, `No mock route for ${rest}.`);
}

function coinDcxTrades(ctx, body) {
	const limit = Math.min(Math.max(Number(body.limit) || 500, 1), 500);
	const fromId = Number(body.from_id) || 0;
	const symbol = typeof body.symbol === "string" ? body.symbol : null;
	const rows = (emptyScenario() ? [] : COINDCX_TRADES)
		.filter((trade) => trade.id >= fromId)
		.filter((trade) => symbol === null || trade.symbol === symbol)
		.filter(
			(trade) =>
				body.from_timestamp === undefined ||
				trade.timestamp >= body.from_timestamp,
		)
		.filter(
			(trade) =>
				body.to_timestamp === undefined || trade.timestamp <= body.to_timestamp,
		)
		.sort((left, right) =>
			body.sort === "desc" ? right.id - left.id : left.id - right.id,
		)
		.slice(0, limit);
	return send(
		ctx,
		200,
		// Numbers, not strings: CoinDCX sends JSON floats and the client keeps their digits.
		rows.map((trade) => ({
			id: trade.id,
			order_id: trade.order_id,
			side: trade.side,
			fee_amount: Number(trade.fee_amount),
			ecode: trade.ecode,
			quantity: Number(trade.quantity),
			price: Number(trade.price),
			symbol: trade.symbol,
			timestamp: trade.timestamp,
		})),
	);
}

function coinDcxBalances(ctx) {
	const { crypto, quote } = coindcxBalances();
	const rows = [];
	for (const asset of ["BTC", "ETH"]) {
		const units = emptyScenario() ? 0n : (crypto.get(asset) ?? 0n);
		rows.push({
			currency: asset,
			balance: Number(formatAsset(units, 8)),
			locked_balance: 0,
		});
	}
	// Locked balance on one asset, and the fiat wallet at zero, so both paths are exercised.
	rows[1].locked_balance = 0;
	rows.push({
		currency: quote.asset,
		balance: 0,
		locked_balance: 0,
	});
	return send(ctx, 200, rows);
}

// --- Etherscan / Blockscout ------------------------------------------------

function etherscanNotOk(ctx, result) {
	return send(ctx, 200, { status: "0", message: "NOTOK", result });
}

function etherscanEmpty(ctx) {
	return send(ctx, 200, {
		status: "0",
		message: "No transactions found",
		result: [],
	});
}

function bumpCallWindow(list, limit) {
	const now = Date.now();
	list.push(now);
	while (list.length && now - list[0] > 1000) list.shift();
	return list.length <= limit;
}

function hexBlock(block) {
	return `0x${block.toString(16)}`;
}

function allEvmTransactions() {
	return isBigHistory()
		? [...EVM_TRANSACTIONS, ...bigHistoryTransactions()]
		: EVM_TRANSACTIONS;
}

function renderTxList(tx) {
	const gas = BigInt(tx.gasUsed) * BigInt(tx.gasPriceWei);
	return {
		blockNumber: String(tx.blockNumber),
		blockHash: `0x${createHash("sha256").update(`mock-block:${tx.blockNumber}`).digest("hex")}`,
		timeStamp: String(Math.floor(Date.parse(tx.time) / 1000)),
		hash: tx.hash,
		nonce: String(tx.blockNumber % 5000),
		transactionIndex: String(tx.blockNumber % 200),
		from: tx.from,
		to: tx.to,
		value: tx.valueWei,
		gas: String(tx.gasUsed),
		gasPrice: tx.gasPriceWei,
		input: tx.isError ? "0x" : tx.methodId,
		methodId: tx.methodId,
		functionName: tx.functionName,
		contractAddress: tx.contractAddress,
		cumulativeGasUsed: String(gas + BigInt(tx.blockNumber % 1_000_000)),
		txreceipt_status: tx.isError ? "0" : "1",
		gasUsed: String(tx.gasUsed),
		confirmations: String(Math.max(0, 24_700_000 - tx.blockNumber)),
		isError: tx.isError ? "1" : "0",
	};
}

function renderTokenTx(tx, transfer) {
	return {
		blockNumber: String(tx.blockNumber),
		timeStamp: String(Math.floor(Date.parse(tx.time) / 1000)),
		hash: tx.hash,
		nonce: String(tx.blockNumber % 5000),
		blockHash: `0x${createHash("sha256").update(`mock-block:${tx.blockNumber}`).digest("hex")}`,
		from: transfer.from,
		contractAddress: transfer.contract,
		to: transfer.to,
		value: transfer.valueUnits,
		tokenName: transfer.name,
		tokenSymbol: transfer.symbol,
		tokenDecimal: String(transfer.decimals),
		statusRep: transfer.statusRep,
		transactionIndex: String(tx.blockNumber % 200),
		gas: String(tx.gasUsed),
		gasPrice: tx.gasPriceWei,
		gasUsed: String(tx.gasUsed),
		cumulativeGasUsed: String(BigInt(tx.gasUsed) * BigInt(tx.gasPriceWei)),
		input: "deprecated",
		methodId: tx.methodId,
		functionName: tx.functionName,
		confirmations: String(Math.max(0, 24_700_000 - tx.blockNumber)),
	};
}

function renderInternalTx(tx, call) {
	return {
		blockNumber: String(tx.blockNumber),
		timeStamp: String(Math.floor(Date.parse(tx.time) / 1000)),
		hash: tx.hash,
		from: call.from,
		to: call.to,
		value: call.valueWei,
		contractAddress: "",
		input: "0x",
		type: call.type,
		gas: String(tx.gasUsed),
		gasUsed: String(tx.gasUsed),
		traceId: call.traceId,
		isError: call.isError ? "1" : "0",
		errCode: "",
	};
}

function validateEvmRequest(ctx, provider) {
	const chainParam = provider === "blockscout" ? "chain_id" : "chainid";
	const chain =
		param(ctx, chainParam) ??
		(provider === "blockscout" ? param(ctx, "chainid") : null);
	if (!chain)
		return `Missing or unsupported chainid parameter (required for v2 api), please refer to https://api.etherscan.io/v2/chainid`;
	if (chain !== "1") {
		if (["8453", "56", "10", "43114"].includes(chain))
			return `Free API access is not supported for this chain. Please upgrade your plan to access this chain.`;
		return `Missing or unsupported chainid parameter (required for v2 api), please refer to https://api.etherscan.io/v2/chainid`;
	}
	const key = param(ctx, "apikey");
	const expected = CREDENTIALS[provider].apiKey;
	if (!key) return "Missing/Invalid API Key";
	if (key !== expected) {
		const bucket = state.invalidKeys ?? { count: 0, first: Date.now() };
		if (Date.now() - bucket.first > 30_000) {
			bucket.count = 0;
			bucket.first = Date.now();
		}
		bucket.count += 1;
		state.invalidKeys = bucket;
		if (bucket.count > 5)
			return "Too many invalid api key attempts, please try again later";
		return "Invalid API Key";
	}
	return null;
}

function handleEvm(ctx, provider) {
	if (state.scenario === "etherscan_rate_limit_200" && state.pending.notok) {
		state.pending.notok = false;
		state.scenario = "normal";
		return etherscanNotOk(
			ctx,
			"Max rate limit reached, please use API Key for higher rate limit",
		);
	}

	const failure = validateEvmRequest(ctx, provider);
	if (failure) return etherscanNotOk(ctx, failure);

	const limit =
		provider === "blockscout"
			? BLOCKSCOUT_CALLS_PER_SECOND
			: ETHERSCAN_CALLS_PER_SECOND;
	if (!bumpCallWindow(state.etherscanCalls, limit))
		return etherscanNotOk(
			ctx,
			"Max rate limit reached, please use API Key for higher rate limit",
		);

	const headers = {};
	if (provider === "blockscout") {
		const today = isoDay(Date.now());
		if (state.blockscout.day !== today)
			state.blockscout = { day: today, credits: BLOCKSCOUT_CREDITS_PER_DAY };
		state.blockscout.credits -= BLOCKSCOUT_CREDITS_PER_CALL;
		headers["x-credits-remaining"] = String(
			Math.max(0, state.blockscout.credits),
		);
		headers["x-ratelimit-limit"] = String(BLOCKSCOUT_CALLS_PER_SECOND);
		headers["x-ratelimit-remaining"] = String(
			Math.max(0, limit - state.etherscanCalls.length),
		);
		headers["x-ratelimit-reset"] = String(Date.now() + 1000);
	}
	const moduleName = param(ctx, "module");
	const action = param(ctx, "action");

	if (moduleName === "proxy") {
		if (action === "eth_blockNumber")
			return send(
				ctx,
				200,
				{ jsonrpc: "2.0", id: 1, result: hexBlock(24_700_000) },
				headers,
			);
		return send(ctx, 200, { jsonrpc: "2.0", id: 1, result: null }, headers);
	}

	if (moduleName !== "account")
		return etherscanNotOk(ctx, "Error! Missing Or invalid Module name");

	const address = (param(ctx, "address") ?? "").toLowerCase();
	if (!/^0x[0-9a-f]{40}$/.test(address))
		return etherscanNotOk(ctx, "Error! Invalid address format");

	if (action === "balance") {
		const { native } = evmBalances(allEvmTransactions());
		const units = emptyScenario() ? 0n : (native.get(address) ?? 0n);
		return send(
			ctx,
			200,
			{ status: "1", message: "OK", result: units.toString() },
			headers,
		);
	}

	if (action === "balancemulti") {
		const addresses = (param(ctx, "address") ?? "")
			.split(",")
			.map((entry) => entry.trim().toLowerCase())
			.filter((entry) => /^0x[0-9a-f]{40}$/.test(entry));
		if (addresses.length > 20)
			return etherscanNotOk(ctx, "Error! Invalid address format");
		const { native } = evmBalances(allEvmTransactions());
		const result = addresses.map((entry) => ({
			account: entry,
			balance: (emptyScenario() ? 0n : (native.get(entry) ?? 0n)).toString(),
		}));
		return send(ctx, 200, { status: "1", message: "OK", result }, headers);
	}

	if (action === "tokenbalance") {
		const contract = (param(ctx, "contractaddress") ?? "").toLowerCase();
		const { tokens } = evmBalances(allEvmTransactions());
		const units = emptyScenario()
			? 0n
			: (tokens.get(address)?.get(contract) ?? 0n);
		const drift =
			state.scenario === "drift" &&
			address === ADDRESSES.walletB &&
			contract === TOKENS.USDC.contract
				? 500000n
				: 0n;
		return send(
			ctx,
			200,
			{ status: "1", message: "OK", result: (units + drift).toString() },
			headers,
		);
	}

	const supported = ["txlist", "txlistinternal", "tokentx"];
	if (!supported.includes(action))
		return etherscanNotOk(ctx, "Error! Missing Or invalid Action name");

	const page = integerParam(ctx, "page") ?? 1;
	const offset = integerParam(ctx, "offset") ?? 10;
	if (page < 1 || offset < 1)
		return etherscanNotOk(ctx, "Error! Invalid pagination. Please try again.");
	if (page * offset > ETHERSCAN_MAX_WINDOW)
		return etherscanNotOk(
			ctx,
			"Result window is too large, PageNo x Offset size must be less than or equal to 10000",
		);
	const startblock = integerParam(ctx, "startblock") ?? 0;
	const endblock = integerParam(ctx, "endblock") ?? 99_999_999;
	const sort = param(ctx, "sort") === "desc" ? "desc" : "asc";
	const contractFilter = param(ctx, "contractaddress");

	const transactions = allEvmTransactions().filter(
		(tx) =>
			tx.blockNumber >= startblock &&
			tx.blockNumber <= endblock &&
			(tx.from === address || tx.to === address),
	);

	let rows;
	if (action === "txlist") rows = transactions.map((tx) => renderTxList(tx));
	else if (action === "tokentx")
		rows = transactions.flatMap((tx) =>
			tx.tokenTransfers
				.filter(
					(transfer) => transfer.from === address || transfer.to === address,
				)
				.filter(
					(transfer) =>
						!contractFilter ||
						transfer.contract === contractFilter.toLowerCase(),
				)
				.map((transfer) => renderTokenTx(tx, transfer)),
		);
	else
		rows = transactions.flatMap((tx) =>
			(tx.internalCalls ?? [])
				.filter((call) => call.from === address || call.to === address)
				.map((call) => renderInternalTx(tx, call)),
		);

	if (emptyScenario()) return etherscanEmpty(ctx);
	if (rows.length === 0) return etherscanEmpty(ctx);

	const ordered = sortedBy(
		rows,
		(row) => Number(row.blockNumber) * 1000 + Number(row.transactionIndex ?? 0),
		sort,
	);
	const capped = Math.min(offset, ETHERSCAN_MAX_RECORDS);
	const start = (page - 1) * capped;
	return send(
		ctx,
		200,
		{
			status: "1",
			message: "OK",
			result: ordered.slice(start, start + capped),
		},
		headers,
	);
}

// --- CoinGecko -------------------------------------------------------------

function coingeckoError(ctx, status, code, message) {
	return send(ctx, status, {
		status: { error_code: code, error_message: message },
	});
}

function coingeckoCurrency(ctx) {
	const vs = (param(ctx, "vs_currency") ?? "usd").toLowerCase();
	return vs === "inr" ? "inr" : "usd";
}

function coingeckoValue(units, currency) {
	const value = currency === "inr" ? units * COINGECKO_USD_INR : units;
	return Number(formatPrice(value));
}

function handleCoinGecko(ctx, rest) {
	const key = ctx.request?.headers?.["x-cg-demo-api-key"];
	if (typeof key !== "string" || key.length === 0)
		return coingeckoError(ctx, 401, 10002, "API Key Missing");
	if (key !== CREDENTIALS.coingecko.apiKey)
		return coingeckoError(ctx, 401, 10002, "API Key Invalid");

	if (!bumpCallWindow(state.coingeckoCalls, COINGECKO_CALLS_PER_MINUTE))
		return coingeckoError(ctx, 429, 429, "You've exceeded the Rate Limit.");

	if (ctx.method === "GET" && rest === "/api/v3/coins/list") {
		return send(ctx, 200, [
			{
				id: "bitcoin",
				symbol: "btc",
				name: "Bitcoin",
				platforms: {},
			},
			{
				id: "ethereum",
				symbol: "eth",
				name: "Ethereum",
				platforms: {},
			},
			{
				id: "tether",
				symbol: "usdt",
				name: "Tether",
				platforms: { ethereum: ADDRESSES.usdtContract },
			},
			{
				id: "usd-coin",
				symbol: "usdc",
				name: "USDC",
				platforms: { ethereum: ADDRESSES.usdcContract },
			},
			{
				id: "bridged-usdc",
				symbol: "usdc",
				name: "Bridged USDC",
				platforms: {
					"polygon-pos": "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
				},
			},
			{
				id: "binancecoin",
				symbol: "bnb",
				name: "BNB",
				platforms: {},
			},
			{
				id: "ripple",
				symbol: "xrp",
				name: "XRP",
				platforms: {},
			},
		]);
	}

	const historyMatch = rest.match(/^\/api\/v3\/coins\/([^/]+)\/history$/);
	if (ctx.method === "GET" && historyMatch) {
		const id = historyMatch[1];
		if (!(id in COINGECKO_IDS))
			return coingeckoError(ctx, 404, 10004, "Coin not found");
		const raw = param(ctx, "date");
		const day = raw ? isoDay(ddMmYyyyToIso(raw)) : isoDay(state.now - DAY_MS);
		if (!day) return coingeckoError(ctx, 400, 10014, "Invalid date");
		const tooOld =
			Date.parse(`${day}T00:00:00Z`) <
			state.now - COINGECKO_HISTORY_DAYS * DAY_MS;
		if (tooOld)
			return coingeckoError(
				ctx,
				401,
				10005,
				"Public API is limited to dates within the past 365 days. Please upgrade your plan to access older data.",
			);
		const currency = coingeckoCurrency(ctx);
		const asset = COINGECKO_IDS[id]
			? PRICE_SERIES[COINGECKO_IDS[id]].asset
			: id === "usd-coin"
				? "USDC"
				: "USDT";
		const units = priceUnitsByAsset(asset, day);
		const price = coingeckoValue(units, currency);
		return send(ctx, 200, {
			id,
			symbol: asset.toLowerCase(),
			name: id,
			localization: {},
			image: { thumb: "", small: "", large: "" },
			market_data: {
				current_price: { [currency]: price },
				market_cap: { [currency]: price * 1_000_000 },
				total_volume: { [currency]: price * 10_000 },
			},
			last_updated: new Date(`${day}T00:00:00Z`).toISOString(),
		});
	}

	const rangeMatch = rest.match(
		/^\/api\/v3\/coins\/([^/]+)\/market_chart\/range$/,
	);
	if (ctx.method === "GET" && rangeMatch) {
		const id = rangeMatch[1];
		if (!(id in COINGECKO_IDS))
			return coingeckoError(ctx, 404, 10004, "Coin not found");
		const from = parseCoingeckoDate(param(ctx, "from"));
		const to = parseCoingeckoDate(param(ctx, "to"));
		if (from === null || to === null || to < from)
			return coingeckoError(ctx, 400, 10014, "Invalid date range");
		const tooOld = from < state.now - COINGECKO_HISTORY_DAYS * DAY_MS;
		if (tooOld)
			return coingeckoError(
				ctx,
				401,
				10005,
				"Public API is limited to dates within the past 365 days. Please upgrade your plan to access older data.",
			);
		const currency = coingeckoCurrency(ctx);
		const asset = COINGECKO_IDS[id]
			? PRICE_SERIES[COINGECKO_IDS[id]].asset
			: id === "usd-coin"
				? "USDC"
				: "USDT";
		const first = isoDay(from);
		const last = isoDay(Math.min(to, state.now));
		const prices = [];
		const marketCaps = [];
		const volumes = [];
		for (const day of eachDay(first, last)) {
			const stamp = Date.parse(`${day}T00:00:00Z`);
			const price = coingeckoValue(priceUnitsByAsset(asset, day), currency);
			prices.push([stamp, price]);
			marketCaps.push([stamp, Math.round(price * 1_000_000)]);
			volumes.push([stamp, Math.round(price * 10_000)]);
		}
		return send(ctx, 200, {
			prices,
			market_caps: marketCaps,
			total_volumes: volumes,
		});
	}

	return send(ctx, 404, { error: `No mock route for ${rest}.` });
}

function ddMmYyyyToIso(text) {
	const [day, month, year] = text.split("-");
	return `${year}-${month}-${day}T00:00:00Z`;
}

function parseCoingeckoDate(value) {
	if (value === null) return null;
	if (/^\d+$/.test(value)) {
		const numeric = Number(value);
		return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
	}
	const parsed = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
	return Number.isFinite(parsed) ? parsed : null;
}

// --- CLI -------------------------------------------------------------------

function parseArgs(argv) {
	let port = DEFAULT_PORT;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") return { help: true };
		if (arg === "--port") port = Number(argv[++index]);
		else if (arg.startsWith("--port="))
			port = Number(arg.slice("--port=".length));
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!Number.isInteger(port) || port < 0 || port > 65535)
		throw new Error(`Invalid port: ${port}`);
	return { port };
}

const USAGE = `Usage: node tools/mock-sync/server.mjs [--port <port>]

  --port   port to listen on (default: 11601, or MOCK_SYNC_PORT)
`;

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`mock-sync: ${error.message}\n\n${USAGE}`);
		process.exit(1);
	}
	if (options.help) {
		console.log(USAGE);
		return;
	}
	const running = await startMockSync({ port: options.port });
	console.log(`mock-sync listening on http://0.0.0.0:${running.port}`);
	console.log(`  data clock    ${new Date(DEFAULT_NOW).toISOString()}`);
	console.log(`  scenario      normal  (POST /__control {"scenario":"..."})`);
	for (const [name, value] of Object.entries({
		BINANCE_API_BASE: `${running.url}/binance`,
		BINANCE_DATA_BASE: `${running.url}/binance-data`,
		COINDCX_API_BASE: `${running.url}/coindcx`,
		ETHERSCAN_API_BASE: `${running.url}/etherscan`,
		BLOCKSCOUT_API_BASE: `${running.url}/blockscout`,
		COINGECKO_API_BASE: `${running.url}/coingecko/api/v3`,
	}))
		console.log(`  ${name.padEnd(20)}${value}`);
	const stop = () => running.close().then(() => process.exit(0));
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main().catch((error) => {
		console.error(`mock-sync: ${error.message}`);
		process.exit(1);
	});
