// Replays every fixture event with its own BigInt arithmetic and asserts that the endpoints of
// the mock server report exactly those balances. Run it after changing fixtures.mjs:
//
//   node tools/mock-sync/check-fixture.mjs
//
// Exits non-zero with a list of differences, so it can be used as a test.

import { createHmac } from "node:crypto";
import {
	ADDRESSES,
	BINANCE_CONVERTS,
	BINANCE_DEPOSITS,
	BINANCE_DIVIDENDS,
	BINANCE_DUST,
	BINANCE_EARN_REWARDS,
	BINANCE_TRADES,
	BINANCE_WITHDRAWALS,
	COINDCX_TRADES,
	CREDENTIALS,
	EVM_TRANSACTIONS,
	eachDay,
	FY,
	HASHES,
	INTERNAL_TRANSFERS,
	P2P_BUY,
	TOKENS,
} from "./fixtures.mjs";
import { startMockSync } from "./server.mjs";

const failures = [];

function check(name, condition, detail) {
	if (condition) {
		console.log(`  ok    ${name}`);
		return;
	}
	failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
	console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function equal(name, expected, actual) {
	check(name, expected === actual, `expected ${expected}, got ${actual}`);
}

// --- own decimal arithmetic ------------------------------------------------

function units(amount) {
	const text = String(amount).trim();
	const negative = text.startsWith("-");
	const [whole, frac = ""] = (negative ? text.slice(1) : text).split(".");
	const value =
		BigInt(whole || "0") * 10n ** 18n +
		BigInt(`${frac}${"0".repeat(18)}`.slice(0, 18));
	return negative ? -value : value;
}

function text(value) {
	const negative = value < 0n;
	const abs = negative ? -value : value;
	const whole = abs / 10n ** 18n;
	const frac = (abs % 10n ** 18n).toString().padStart(18, "0");
	const trimmed = frac.replace(/0+$/, "");
	return `${negative ? "-" : ""}${whole}${trimmed ? `.${trimmed}` : ""}`;
}

function add(map, key, value) {
	map.set(key, (map.get(key) ?? 0n) + value);
}

// --- replay ----------------------------------------------------------------

function replayBinance() {
	const spot = new Map();
	const funding = new Map();

	add(funding, "USDT", units(P2P_BUY.amount));
	const wallets = { funding, spot };
	for (const move of INTERNAL_TRANSFERS) {
		add(wallets[move.from], move.asset, -units(move.amount));
		add(wallets[move.to], move.asset, units(move.amount));
	}
	for (const { raw, base, quote } of BINANCE_TRADES) {
		const direction = raw.isBuyer ? 1n : -1n;
		add(spot, base, direction * units(raw.qty));
		add(spot, quote, -direction * units(raw.quoteQty));
		add(spot, raw.commissionAsset, -units(raw.commission));
	}
	for (const deposit of BINANCE_DEPOSITS)
		if (deposit.status === 1 || deposit.status === 6)
			add(spot, deposit.coin, units(deposit.amount));
	for (const withdrawal of BINANCE_WITHDRAWALS)
		if (withdrawal.status === 6)
			add(spot, withdrawal.coin, -units(withdrawal.amount));
	for (const dividend of BINANCE_DIVIDENDS)
		add(spot, dividend.asset, units(dividend.amount));
	for (const dribblet of BINANCE_DUST)
		for (const detail of dribblet.userAssetDribbletDetails) {
			add(spot, detail.fromAsset, -units(detail.amount));
			add(spot, detail.targetAsset, units(detail.transferedAmount));
		}
	for (const convert of BINANCE_CONVERTS) {
		if (convert.orderStatus !== "SUCCESS") continue;
		add(spot, convert.fromAsset, -units(convert.fromAmount));
		add(spot, convert.toAsset, units(convert.toAmount));
	}
	for (const reward of BINANCE_EARN_REWARDS)
		add(spot, reward.asset, units(reward.rewards));
	return { spot, funding };
}

function replayEvm() {
	const own = new Set([ADDRESSES.walletA, ADDRESSES.walletB]);
	const native = new Map();
	const tokens = new Map();
	for (const address of own) {
		native.set(address, 0n);
		tokens.set(address, new Map());
	}
	for (const tx of EVM_TRANSACTIONS) {
		const value = BigInt(tx.valueWei);
		if (!tx.isError) {
			if (own.has(tx.from)) add(native, tx.from, -value);
			if (own.has(tx.to)) add(native, tx.to, value);
		}
		if (own.has(tx.from))
			add(native, tx.from, -(BigInt(tx.gasUsed) * BigInt(tx.gasPriceWei)));
		for (const transfer of tx.tokenTransfers) {
			const amount = BigInt(transfer.valueUnits);
			if (own.has(transfer.from)) {
				const byToken = tokens.get(transfer.from);
				add(byToken, transfer.contract, -amount);
			}
			if (own.has(transfer.to)) {
				const byToken = tokens.get(transfer.to);
				add(byToken, transfer.contract, amount);
			}
		}
	}
	return { native, tokens };
}

function replayCoinDcx() {
	const balances = new Map();
	for (const trade of COINDCX_TRADES) {
		const quantity = units(trade.quantity);
		add(balances, trade.base, trade.side === "buy" ? quantity : -quantity);
	}
	return balances;
}

// --- HTTP helpers ----------------------------------------------------------

const server = await startMockSync({ port: 0 });

async function binanceGet(path, params = {}) {
	return signed(path, params, "GET");
}

async function binancePost(path, params = {}) {
	return signed(path, params, "POST");
}

async function signed(path, params, method) {
	const time = await fetch(`${server.url}/binance/api/v3/time`).then((r) =>
		r.json(),
	);
	const query = new URLSearchParams({
		...params,
		timestamp: String(time.serverTime),
		recvWindow: "5000",
	}).toString();
	const signature = createHmac("sha256", CREDENTIALS.binance.secret)
		.update(query)
		.digest("hex");
	const response = await fetch(
		`${server.url}/binance${path}?${query}&signature=${signature}`,
		{ method, headers: { "X-MBX-APIKEY": CREDENTIALS.binance.apiKey } },
	);
	return { status: response.status, body: await response.json() };
}

async function coinDcx(path, extra = {}) {
	const payload = JSON.stringify({ ...extra, timestamp: Date.now() });
	const signature = createHmac("sha256", CREDENTIALS.coindcx.secret)
		.update(payload)
		.digest("hex");
	const response = await fetch(`${server.url}/coindcx${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-AUTH-APIKEY": CREDENTIALS.coindcx.apiKey,
			"X-AUTH-SIGNATURE": signature,
		},
		body: payload,
	});
	return { status: response.status, body: await response.json() };
}

let lastEtherscanCall = 0;

// The free tier allows 3 calls a second; pace the check the way the real client does.
async function etherscan(params) {
	const wait = lastEtherscanCall + 350 - Date.now();
	if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
	lastEtherscanCall = Date.now();
	const query = new URLSearchParams({
		chainid: "1",
		apikey: CREDENTIALS.etherscan.apiKey,
		...params,
	}).toString();
	const response = await fetch(`${server.url}/etherscan?${query}`);
	return response.json();
}

// --- the checks ------------------------------------------------------------

console.log("binance");
const replayed = replayBinance();
const account = await binanceGet("/api/v3/account", {
	omitZeroBalances: "false",
});
equal("account answers 200", 200, account.status);
const servedSpot = new Map(
	account.body.balances.map((row) => [
		row.asset,
		units(row.free) + units(row.locked),
	]),
);
for (const [asset, value] of replayed.spot)
	equal(`spot ${asset}`, text(value), text(servedSpot.get(asset) ?? 0n));
for (const asset of replayed.spot.keys())
	if ((replayed.spot.get(asset) ?? 0n) !== 0n)
		check(
			`spot ${asset} is served`,
			servedSpot.has(asset),
			"missing from /api/v3/account",
		);
const funding = await binancePost("/sapi/v1/asset/get-funding-asset");
equal("funding answers 200", 200, funding.status);
const servedFunding = new Map(
	funding.body.map((row) => [row.asset, units(row.free) + units(row.locked)]),
);
for (const [asset, value] of replayed.funding)
	equal(`funding ${asset}`, text(value), text(servedFunding.get(asset) ?? 0n));

const userAsset = await binancePost("/sapi/v3/asset/getUserAsset");
const combined = new Map();
for (const [asset, value] of replayed.spot) add(combined, asset, value);
for (const [asset, value] of replayed.funding) add(combined, asset, value);
for (const [asset, value] of combined)
	if (value > 0n) {
		const row = userAsset.body.find((candidate) => candidate.asset === asset);
		equal(
			`getUserAsset ${asset}`,
			text(value),
			row ? text(units(row.free)) : "missing",
		);
	}

const trades = await binanceGet("/api/v3/myTrades", {
	symbol: "ETHUSDT",
	limit: "1000",
});
equal("myTrades returns every ETHUSDT fill", 5, trades.body.length);
const bnbTrades = await binanceGet("/api/v3/myTrades", { symbol: "BNBUSDT" });
equal("myTrades for a symbol with no fills is empty", 0, bnbTrades.body.length);

const withdrawals = await binanceGet("/sapi/v1/capital/withdraw/history", {
	startTime: String(Date.parse("2025-04-01T00:00:00Z")),
	endTime: String(Date.parse("2025-06-30T00:00:00Z")),
});
equal(
	"withdrawal txId is the wallet-A incoming hash",
	HASHES.binanceToWalletA,
	withdrawals.body[0].txId,
);

const deposits = await binanceGet("/sapi/v1/capital/deposit/hisrec", {
	startTime: String(Date.parse("2025-12-01T00:00:00Z")),
	endTime: String(Date.parse("2025-12-31T00:00:00Z")),
});
equal(
	"deposit txId is the wallet-B outgoing hash",
	HASHES.walletBToBinance,
	deposits.body[0].txId,
);

console.log("coindcx");
const dcx = await coinDcx("/exchange/v1/users/balances");
equal("balances answers 200", 200, dcx.status);
const replayedDcx = replayCoinDcx();
for (const [asset, value] of replayedDcx) {
	const row = dcx.body.find((candidate) => candidate.currency === asset);
	check(
		`coindcx ${asset}`,
		row && text(units(String(row.balance))) === text(value),
		row ? String(row.balance) : "missing",
	);
}

console.log("ethereum");
const replayedEvm = replayEvm();
for (const [address, label] of [
	[ADDRESSES.walletA, "wallet A"],
	[ADDRESSES.walletB, "wallet B"],
]) {
	const balance = await etherscan({
		module: "account",
		action: "balance",
		address,
		tag: "latest",
	});
	equal(
		`${label} ETH`,
		replayedEvm.native.get(address).toString(),
		balance.result,
	);
	const usdc = await etherscan({
		module: "account",
		action: "tokenbalance",
		contractaddress: TOKENS.USDC.contract,
		address,
		tag: "latest",
	});
	equal(
		`${label} USDC`,
		(
			replayedEvm.tokens.get(address).get(TOKENS.USDC.contract) ?? 0n
		).toString(),
		usdc.result,
	);
}
const spam = await etherscan({
	module: "account",
	action: "tokenbalance",
	contractaddress: TOKENS.SPAM_USDT.contract,
	address: ADDRESSES.walletA,
	tag: "latest",
});
equal(
	"wallet A lookalike-USDT balance is the spam transfer",
	"50000000000",
	spam.result,
);
const empty = await etherscan({
	module: "account",
	action: "txlist",
	address: "0x0000000000000000000000000000000000000001",
});
check(
	"an address with no history gets the empty envelope",
	empty.status === "0" &&
		empty.message === "No transactions found" &&
		Array.isArray(empty.result),
	JSON.stringify(empty).slice(0, 120),
);
const tooWide = await etherscan({
	module: "account",
	action: "txlist",
	address: ADDRESSES.walletA,
	page: "11",
	offset: "1000",
});
check(
	"page x offset above 10000 is refused",
	tooWide.result ===
		"Result window is too large, PageNo x Offset size must be less than or equal to 10000",
	JSON.stringify(tooWide),
);

console.log("klines");
const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];
const fyDays = eachDay(FY.start, FY.end);
check("tax year has 365 days", fyDays.length === 365, String(fyDays.length));
for (const symbol of symbols) {
	const query = new URLSearchParams({
		symbol,
		interval: "1d",
		startTime: String(Date.parse("2025-03-31T18:30:00Z")),
		endTime: String(Date.parse("2026-03-31T18:29:59Z")),
		limit: "1000",
		timeZone: "5:30",
	}).toString();
	const response = await fetch(
		`${server.url}/binance-data/api/v3/klines?${query}`,
	);
	const rows = await response.json();
	check(
		`${symbol} has one candle per FY day`,
		rows.length === 365,
		String(rows.length),
	);
	const istDay = (msValue) =>
		new Date(msValue + 5.5 * 3_600_000).toISOString().slice(0, 10);
	const days = rows.map((row) => istDay(row[0]));
	check(
		`${symbol} candles cover exactly the tax year`,
		days.join(",") === fyDays.join(","),
		`${days[0]} .. ${days.at(-1)}`,
	);
}

console.log("request log");
const log = await fetch(`${server.url}/__requests`).then((r) => r.json());
const signedCall = log.find(
	(entry) => entry.path === "/binance/api/v3/account",
);
check(
	"signature is redacted in the log",
	signedCall?.params.signature === "***",
);
check(
	"api keys are redacted in the log",
	signedCall?.params.apikey === undefined,
);
const apiKeyCall = log.find((entry) => entry.path === "/etherscan");
check(
	"etherscan apikey is redacted in the log",
	apiKeyCall?.params.apikey === "***",
	JSON.stringify(apiKeyCall?.params ?? {}),
);

await server.close();

console.log("");
if (failures.length) {
	console.error(`${failures.length} fixture check(s) failed:`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("fixture balances reconcile exactly.");
