// Replays every fixture event with its own BigInt arithmetic and asserts that the endpoints of
// the mock server report exactly those balances — Binance, CoinDCX, and every EVM chain through
// all three provider families. Run it after changing fixtures.mjs:
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
	BINANCE_EARN_POSITIONS,
	BINANCE_EARN_REWARDS,
	BINANCE_TRADES,
	BINANCE_WITHDRAWALS,
	CHAIN_TOKENS,
	CHAIN_TRANSACTIONS,
	CHAINS,
	COINDCX_TRADES,
	CREDENTIALS,
	chainNativeAsset,
	EARN_SUBSCRIPTIONS,
	eachDay,
	FY,
	HASHES,
	INTERNAL_TRANSFERS,
	OWN_ADDRESSES,
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

function unitsAt(amount, decimals) {
	const source = String(amount).trim();
	const negative = source.startsWith("-");
	const [whole, frac = ""] = (negative ? source.slice(1) : source).split(".");
	const scale = 10n ** BigInt(decimals);
	const value =
		BigInt(whole || "0") * scale +
		BigInt(`${frac}${"0".repeat(decimals)}`.slice(0, decimals));
	return negative ? -value : value;
}

function units(amount) {
	return unitsAt(amount, 18);
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

function addNested(map, address, contract, value) {
	const byContract = map.get(address) ?? new Map();
	map.set(address, byContract);
	add(byContract, contract, value);
}

// --- replay ----------------------------------------------------------------

function replayBinance() {
	const spot = new Map();
	const funding = new Map();
	const earn = new Map();

	add(funding, "USDT", units(P2P_BUY.amount));
	for (const move of INTERNAL_TRANSFERS) {
		const source = move.from === "funding" ? funding : spot;
		const target = move.to === "earn" ? earn : spot;
		add(source, move.asset, -units(move.amount));
		add(target, move.asset, units(move.amount));
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
	// `amount` arrives on chain; `transactionFee` is charged on top, so both leave spot.
	for (const withdrawal of BINANCE_WITHDRAWALS)
		if (withdrawal.status === 6)
			add(
				spot,
				withdrawal.coin,
				-(units(withdrawal.amount) + units(withdrawal.transactionFee)),
			);
	for (const subscription of EARN_SUBSCRIPTIONS) {
		add(spot, subscription.asset, -units(subscription.amount));
		add(earn, subscription.asset, units(subscription.amount));
	}
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
	// BINANCE_EARN_REWARDS is audit-only: the matching dividend row above is the single credit.
	return { spot, funding, earn };
}

// Replays one chain from raw events: external value, internal call value, gas, the OP-stack L1
// fee, and token legs. Nothing here reads the vendor payloads that the server serves.
function replayChain(chainId, { includeL1Fee = true } = {}) {
	const own = new Set(OWN_ADDRESSES);
	const native = new Map(OWN_ADDRESSES.map((address) => [address, 0n]));
	const tokens = new Map(OWN_ADDRESSES.map((address) => [address, new Map()]));

	for (const tx of CHAIN_TRANSACTIONS[chainId] ?? []) {
		const value = BigInt(tx.valueWei);
		if (!tx.isError) {
			if (own.has(tx.from)) add(native, tx.from, -value);
			if (own.has(tx.to)) add(native, tx.to, value);
			for (const call of tx.internalCalls ?? []) {
				const callValue = BigInt(call.valueWei);
				if (own.has(call.from)) add(native, call.from, -callValue);
				if (own.has(call.to)) add(native, call.to, callValue);
			}
		}
		if (own.has(tx.from)) {
			const gas = BigInt(tx.gasUsed) * BigInt(tx.gasPriceWei);
			const l1Fee = includeL1Fee ? BigInt(tx.l1FeeWei ?? "0") : 0n;
			add(native, tx.from, -(gas + l1Fee));
		}
		for (const transfer of tx.tokenTransfers) {
			if (own.has(transfer.from))
				addNested(
					tokens,
					transfer.from,
					transfer.contract,
					-BigInt(transfer.valueUnits),
				);
			if (own.has(transfer.to))
				addNested(
					tokens,
					transfer.to,
					transfer.contract,
					BigInt(transfer.valueUnits),
				);
		}
	}
	return { native, tokens };
}

// The transfer legs a provider should serve for the fixture wallets, in one comparable shape.
function fixtureLegs(chainId, categories) {
	const own = new Set(OWN_ADDRESSES);
	const legs = [];
	for (const tx of CHAIN_TRANSACTIONS[chainId] ?? []) {
		const nativeAsset = chainNativeAsset(chainId, tx.time);
		if (categories.includes("external")) {
			legs.push({
				hash: tx.hash,
				category: "external",
				from: tx.from,
				to: tx.to,
				valueUnits: BigInt(tx.valueWei),
				contract: null,
				asset: nativeAsset,
			});
		}
		if (categories.includes("internal")) {
			for (const call of tx.internalCalls ?? []) {
				legs.push({
					hash: tx.hash,
					category: "internal",
					from: call.from,
					to: call.to,
					valueUnits: BigInt(call.valueWei),
					contract: null,
					asset: nativeAsset,
				});
			}
		}
		if (categories.includes("erc20")) {
			for (const transfer of tx.tokenTransfers) {
				legs.push({
					hash: tx.hash,
					category: "erc20",
					from: transfer.from,
					to: transfer.to,
					valueUnits: BigInt(transfer.valueUnits),
					contract: transfer.contract,
					asset: transfer.symbol,
				});
			}
		}
	}
	return legs.filter((leg) => own.has(leg.from) || own.has(leg.to));
}

function legSignature(leg) {
	return [
		leg.hash,
		leg.category,
		leg.from,
		leg.to,
		leg.contract ?? "",
		leg.valueUnits.toString(),
	].join("|");
}

function compareLegs(name, expected, actual) {
	const left = expected.map(legSignature).sort();
	const right = actual.map(legSignature).sort();
	const missing = left.filter((entry) => !right.includes(entry));
	const extra = right.filter((entry) => !left.includes(entry));
	check(
		name,
		missing.length === 0 && extra.length === 0,
		`missing ${missing.length}, extra ${extra.length}${
			missing[0] ? `, first missing ${missing[0]}` : ""
		}${extra[0] ? `, first extra ${extra[0]}` : ""}`,
	);
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

let lastExplorerCall = 0;

// Etherscan allows 3 calls a second and Blockscout 5, and the mock counts both against one
// window; one 360 ms pace keeps every call under both limits.
async function explorerCall(pathname, params, headers = {}) {
	const wait = lastExplorerCall + 360 - Date.now();
	if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
	lastExplorerCall = Date.now();
	const response = await fetch(
		`${server.url}${pathname}?${new URLSearchParams(params)}`,
		{ headers },
	);
	return { status: response.status, body: await response.json() };
}

async function etherscan(params) {
	const { chainId = 1, key = CREDENTIALS.etherscan.apiKey, ...rest } = params;
	return explorerCall("/etherscan", {
		chainid: String(chainId),
		apikey: key,
		...rest,
	});
}

async function blockscout(chainId, params) {
	return explorerCall(
		`/blockscout/${chainId}/api`,
		{ chain_id: String(chainId), ...params },
		{ authorization: CREDENTIALS.blockscout.apiKey },
	);
}

async function rpc(pathname, method, params) {
	const response = await fetch(`${server.url}${pathname}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
	return { status: response.status, body: await response.json() };
}

function alchemy(network, method, params) {
	return rpc(
		`/alchemy/${network}/v2/${CREDENTIALS.alchemy.apiKey}`,
		method,
		params,
	);
}

function nodereal(method, params) {
	return rpc(`/nodereal/${CREDENTIALS.nodereal.apiKey}`, method, params);
}

function hex(value) {
	return `0x${BigInt(value).toString(16)}`;
}

// A 32-byte ABI word, the shape eth_call returns for balanceOf(address).
function word(value) {
	return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

// Alchemy pages with `pageKey`; a two-row page forces several pages for a handful of legs.
async function alchemyLegs(chainId, address) {
	const network = CHAINS[chainId].alchemyNetwork;
	const legs = [];
	const seen = new Set();
	let pages = 0;
	for (const direction of ["fromAddress", "toAddress"]) {
		let pageKey;
		do {
			const { body } = await alchemy(network, "alchemy_getAssetTransfers", [
				{
					fromBlock: "0x0",
					toBlock: "latest",
					[direction]: address,
					category:
						chainId === 42161
							? ["external", "erc20"]
							: ["external", "internal", "erc20"],
					excludeZeroValue: false,
					withMetadata: true,
					maxCount: "0x2",
					order: "asc",
					...(pageKey ? { pageKey } : {}),
				},
			]);
			if (body.error) return { error: body.error, legs, pages };
			for (const row of body.result.transfers) {
				if (seen.has(row.uniqueId)) continue;
				seen.add(row.uniqueId);
				legs.push({
					hash: row.hash,
					category: row.category,
					from: row.from.toLowerCase(),
					to: row.to.toLowerCase(),
					valueUnits: BigInt(row.rawContract.value),
					contract: row.rawContract.address
						? row.rawContract.address.toLowerCase()
						: null,
					asset: row.asset,
				});
			}
			pageKey = body.result.pageKey;
			pages += 1;
		} while (pageKey && pages < 200);
	}
	return { legs, pages };
}

async function noderealLegs(address) {
	const legs = [];
	const seen = new Set();
	let pages = 0;
	for (const direction of ["fromAddress", "toAddress"]) {
		let pageKey;
		do {
			const { body } = await nodereal("nr_getAssetTransfers", [
				{
					fromBlock: "0x0",
					toBlock: "latest",
					[direction]: address,
					category: ["external", "internal", "20"],
					excludeZeroValue: false,
					maxCount: "0x2",
					order: "asc",
					...(pageKey ? { pageKey } : {}),
				},
			]);
			if (body.error) return { error: body.error, legs, pages };
			for (const row of body.result.transfers) {
				if (seen.has(row.uniqueId)) continue;
				seen.add(row.uniqueId);
				legs.push({
					hash: row.hash,
					category: row.category === "20" ? "erc20" : row.category,
					from: row.from.toLowerCase(),
					to: row.to.toLowerCase(),
					valueUnits: BigInt(row.value),
					contract: row.contractAddress
						? row.contractAddress.toLowerCase()
						: null,
					asset: row.asset,
				});
			}
			pageKey = body.result.pageKey;
			pages += 1;
		} while (pageKey && pages < 200);
	}
	return { legs, pages };
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

console.log("binance earn");
const flexible = await binanceGet("/sapi/v1/simple-earn/flexible/position", {
	current: "1",
	size: "100",
});
equal("flexible position answers 200", 200, flexible.status);
const locked = await binanceGet("/sapi/v1/simple-earn/locked/position", {
	current: "1",
	size: "100",
});
equal("locked position answers 200", 200, locked.status);

const flexibleServed = new Map();
for (const row of flexible.body.rows)
	add(flexibleServed, row.asset, units(row.totalAmount));
const lockedServed = new Map();
for (const row of locked.body.rows)
	add(lockedServed, row.asset, units(row.amount));

for (const [asset, value] of replayed.earn) {
	equal(
		`earn position ${asset}`,
		text(value),
		text((flexibleServed.get(asset) ?? 0n) + (lockedServed.get(asset) ?? 0n)),
	);
}

for (const subscription of EARN_SUBSCRIPTIONS) {
	const positions = [
		...BINANCE_EARN_POSITIONS.flexible.map((row) => row.totalAmount),
		...BINANCE_EARN_POSITIONS.locked.map((row) => row.amount),
	];
	check(
		`earn subscription ${subscription.asset} has a position`,
		positions.some((amount) => units(amount) === units(subscription.amount)),
		`no position for ${subscription.amount} ${subscription.asset}`,
	);
}

for (const reward of BINANCE_EARN_REWARDS) {
	const dividend = BINANCE_DIVIDENDS.find(
		(row) => row.id === reward.dividendId,
	);
	check(
		`earn reward ${reward.asset} links to a dividend`,
		Boolean(dividend),
		`no dividend ${reward.dividendId}`,
	);
	if (dividend)
		equal(
			`earn reward ${reward.asset} is not double counted`,
			dividend.amount,
			reward.rewards,
		);
}

const userAsset = await binancePost("/sapi/v3/asset/getUserAsset");
const combined = new Map();
for (const wallet of [replayed.spot, replayed.funding, replayed.earn])
	for (const [asset, value] of wallet) add(combined, asset, value);
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

console.log("binance withdrawals");
const withdrawalRows = [];
for (const [start, end] of [
	["2025-04-15", "2025-06-30"],
	["2026-02-01", "2026-03-20"],
]) {
	const page = await binanceGet("/sapi/v1/capital/withdraw/history", {
		startTime: String(Date.parse(`${start}T00:00:00Z`)),
		endTime: String(Date.parse(`${end}T00:00:00Z`)),
	});
	equal(`withdrawals ${start} answer 200`, 200, page.status);
	withdrawalRows.push(...page.body);
}
equal("withdrawal history returns every row", 5, withdrawalRows.length);

for (const row of withdrawalRows) {
	if (row.status !== 6) continue;
	const chainId = { ETH: 1, BASE: 8453, BSC: 56 }[row.network];
	check(
		`withdrawal ${row.coin}/${row.network} maps to a chain`,
		Boolean(chainId),
		String(row.network),
	);
	if (!chainId) continue;
	const tx = (CHAIN_TRANSACTIONS[chainId] ?? []).find(
		(candidate) => candidate.hash === row.txId,
	);
	check(
		`withdrawal ${row.coin}/${row.network} txId is the on-chain hash`,
		Boolean(tx),
		row.txId,
	);
	if (!tx) continue;
	if (row.coin === CHAINS[chainId].native) {
		equal(
			`withdrawal ${row.coin}/${row.network} transfers exactly amount`,
			units(row.amount).toString(),
			tx.valueWei,
		);
	} else {
		const leg = tx.tokenTransfers.find(
			(transfer) => transfer.to.toLowerCase() === row.address.toLowerCase(),
		);
		check(
			`withdrawal ${row.coin}/${row.network} has a token leg`,
			Boolean(leg),
			row.txId,
		);
		if (leg)
			equal(
				`withdrawal ${row.coin}/${row.network} token amount`,
				unitsAt(row.amount, leg.decimals).toString(),
				leg.valueUnits,
			);
	}
}

const dividends = [];
for (const [start, end] of [
	["2025-06-01", "2025-06-30"],
	["2025-12-01", "2025-12-02"],
]) {
	const page = await binanceGet("/sapi/v1/asset/assetDividend", {
		startTime: String(Date.parse(`${start}T00:00:00Z`)),
		endTime: String(Date.parse(`${end}T00:00:00Z`)),
	});
	equal(`dividends ${start} answer 200`, 200, page.status);
	dividends.push(...page.body.rows);
}
equal("dividend feed returns every row", 2, dividends.length);
for (const reward of BINANCE_EARN_REWARDS)
	check(
		`dividend ${reward.dividendId} is served`,
		dividends.some((row) => row.id === reward.dividendId),
		JSON.stringify(dividends.map((row) => row.id)),
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
const dcxReplay = new Map();
for (const trade of COINDCX_TRADES) {
	const quantity = units(trade.quantity);
	add(dcxReplay, trade.base, trade.side === "buy" ? quantity : -quantity);
}
for (const [asset, value] of dcxReplay) {
	const row = dcx.body.find((candidate) => candidate.currency === asset);
	check(
		`coindcx ${asset}`,
		row && text(units(String(row.balance))) === text(value),
		row ? String(row.balance) : "missing",
	);
}

console.log("ethereum (etherscan, free key)");
const ethereum = replayChain(1);
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
		ethereum.native.get(address).toString(),
		balance.body.result,
	);
	for (const [contract, token] of Object.entries(CHAIN_TOKENS[1])) {
		const served = await etherscan({
			module: "account",
			action: "tokenbalance",
			contractaddress: contract,
			address,
			tag: "latest",
		});
		equal(
			`${label} ${token.symbol}`,
			(ethereum.tokens.get(address).get(contract) ?? 0n).toString(),
			served.body.result,
		);
	}
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
	spam.body.result,
);
const txlist = await etherscan({
	module: "account",
	action: "txlist",
	address: ADDRESSES.walletA,
	offset: "1000",
});
equal(
	"mainnet txlist returns every wallet-A transaction",
	(CHAIN_TRANSACTIONS[1] ?? []).filter(
		(tx) =>
			tx.from.toLowerCase() === ADDRESSES.walletA.toLowerCase() ||
			tx.to.toLowerCase() === ADDRESSES.walletA.toLowerCase(),
	).length,
	txlist.body.result.length,
);

const empty = await etherscan({
	module: "account",
	action: "txlist",
	address: "0x0000000000000000000000000000000000000001",
});
check(
	"an address with no history gets the empty envelope",
	empty.body.status === "0" &&
		empty.body.message === "No transactions found" &&
		Array.isArray(empty.body.result),
	JSON.stringify(empty.body).slice(0, 120),
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
	tooWide.body.result ===
		"Result window is too large, PageNo x Offset size must be less than or equal to 10000",
	JSON.stringify(tooWide.body),
);
const badKey = await etherscan({
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
	key: "mock-wrong-key",
});
equal(
	"an unknown explorer key is refused",
	"Invalid API Key",
	badKey.body.result,
);

console.log("base (etherscan paid key)");
const base = replayChain(8453);
const baseFree = await etherscan({
	chainId: 8453,
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
});
check(
	"the free key cannot read Base",
	baseFree.body.status === "0" &&
		/upgrade your plan/i.test(baseFree.body.result),
	JSON.stringify(baseFree.body),
);
const basePaid = await etherscan({
	chainId: 8453,
	key: CREDENTIALS.etherscan.paidApiKey,
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
});
equal(
	"Base wallet A ETH includes gas and l1Fee",
	base.native.get(ADDRESSES.walletA).toString(),
	basePaid.body.result,
);
check(
	"the l1Fee actually changes the Base balance",
	replayChain(8453, { includeL1Fee: false }).native.get(ADDRESSES.walletA) !==
		base.native.get(ADDRESSES.walletA),
);
const baseUsdc = await etherscan({
	chainId: 8453,
	key: CREDENTIALS.etherscan.paidApiKey,
	module: "account",
	action: "tokenbalance",
	contractaddress: ADDRESSES.baseUsdc,
	address: ADDRESSES.walletA,
	tag: "latest",
});
equal(
	"Base wallet A USDC",
	(base.tokens.get(ADDRESSES.walletA).get(ADDRESSES.baseUsdc) ?? 0n).toString(),
	baseUsdc.body.result,
);
const baseSwap = CHAIN_TRANSACTIONS[8453].find((tx) =>
	tx.label.includes("swaps 0.005 ETH"),
);
const baseReceipt = await etherscan({
	chainId: 8453,
	key: CREDENTIALS.etherscan.paidApiKey,
	module: "proxy",
	action: "eth_getTransactionReceipt",
	txhash: baseSwap.hash,
});
equal(
	"Base receipt carries the fixture l1Fee",
	hex(baseSwap.l1FeeWei),
	baseReceipt.body.result.l1Fee,
);

console.log("arbitrum (etherscan, free key)");
const arbitrum = replayChain(42161);
const arbBalance = await etherscan({
	chainId: 42161,
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
	tag: "latest",
});
equal(
	"Arbitrum wallet A ETH includes gas and the internal swap payout",
	arbitrum.native.get(ADDRESSES.walletA).toString(),
	arbBalance.body.result,
);
for (const contract of [ADDRESSES.arbUsdc, ADDRESSES.arbUsdce]) {
	const served = await etherscan({
		chainId: 42161,
		module: "account",
		action: "tokenbalance",
		contractaddress: contract,
		address: ADDRESSES.walletA,
		tag: "latest",
	});
	equal(
		`Arbitrum wallet A ${CHAIN_TOKENS[42161][contract].symbol}`,
		(arbitrum.tokens.get(ADDRESSES.walletA).get(contract) ?? 0n).toString(),
		served.body.result,
	);
}
const arbInternals = await etherscan({
	chainId: 42161,
	module: "account",
	action: "txlistinternal",
	address: ADDRESSES.walletA,
	offset: "1000",
});
equal(
	"Etherscan serves the Arbitrum internal swap leg",
	1,
	arbInternals.body.result.length,
);
equal(
	"the Arbitrum internal leg carries the swap payout",
	fixtureLegs(42161, ["internal"])[0].valueUnits.toString(),
	arbInternals.body.result[0].value,
);
const arbSwap = CHAIN_TRANSACTIONS[42161].find((tx) =>
	tx.label.includes("swaps 10 USDC.e"),
);
const arbReceipt = await etherscan({
	chainId: 42161,
	module: "proxy",
	action: "eth_getTransactionReceipt",
	txhash: arbSwap.hash,
});
equal(
	"Arbitrum receipt reports gasUsedForL1 inside gasUsed",
	hex(4200),
	arbReceipt.body.result.gasUsedForL1,
);
equal(
	"Arbitrum receipt gasUsed is the fixture figure",
	hex(arbSwap.gasUsed),
	arbReceipt.body.result.gasUsed,
);

console.log("polygon (etherscan, free key)");
const polygon = replayChain(137);
const polyBalance = await etherscan({
	chainId: 137,
	module: "account",
	action: "balance",
	address: ADDRESSES.walletB,
	tag: "latest",
});
equal(
	"Polygon wallet B POL includes both the MATIC and POL eras",
	polygon.native.get(ADDRESSES.walletB).toString(),
	polyBalance.body.result,
);

console.log("bsc (etherscan paid key)");
const bsc = replayChain(56);
const bscFree = await etherscan({
	chainId: 56,
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
});
check(
	"the free key cannot read BSC",
	bscFree.body.status === "0" && /upgrade your plan/i.test(bscFree.body.result),
	JSON.stringify(bscFree.body),
);
const bscPaid = await etherscan({
	chainId: 56,
	key: CREDENTIALS.etherscan.paidApiKey,
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
});
equal(
	"BSC wallet A BNB",
	bsc.native.get(ADDRESSES.walletA).toString(),
	bscPaid.body.result,
);
const bscUsdt = await etherscan({
	chainId: 56,
	key: CREDENTIALS.etherscan.paidApiKey,
	module: "account",
	action: "tokenbalance",
	contractaddress: ADDRESSES.bscUsdt,
	address: ADDRESSES.walletA,
	tag: "latest",
});
equal(
	"BSC wallet A USDT at 18 decimals",
	(bsc.tokens.get(ADDRESSES.walletA).get(ADDRESSES.bscUsdt) ?? 0n).toString(),
	bscUsdt.body.result,
);

console.log("blockscout (per-chain prefixes)");
for (const chainId of [1, 42161, 137]) {
	const replay = replayChain(chainId);
	const address = chainId === 137 ? ADDRESSES.walletB : ADDRESSES.walletA;
	const served = await blockscout(chainId, {
		module: "account",
		action: "balance",
		address,
		tag: "latest",
	});
	equal(
		`blockscout ${CHAINS[chainId].name} native balance`,
		replay.native.get(address).toString(),
		served.body.result,
	);
}
const blockscoutBare = await explorerCall(
	"/blockscout",
	{
		chain_id: "1",
		module: "account",
		action: "balance",
		address: ADDRESSES.walletA,
	},
	{ authorization: CREDENTIALS.blockscout.apiKey },
);
equal(
	"blockscout accepts chain_id on the bare path too",
	ethereum.native.get(ADDRESSES.walletA).toString(),
	blockscoutBare.body.result,
);
const blockscoutBase = await blockscout(8453, {
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
});
check(
	"blockscout refuses Base without a paid plan",
	blockscoutBase.body.status === "0" &&
		/paid plan/i.test(blockscoutBase.body.result),
	JSON.stringify(blockscoutBase.body),
);
const blockscoutBsc = await blockscout(56, {
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
});
check(
	"blockscout does not index BSC",
	blockscoutBsc.body.status === "0" &&
		/not indexed/i.test(blockscoutBsc.body.result),
	JSON.stringify(blockscoutBsc.body),
);

console.log("alchemy");
const alchemyNetworks = [
	[1, "eth-mainnet"],
	[8453, "base-mainnet"],
	[42161, "arb-mainnet"],
	[137, "polygon-mainnet"],
];
for (const [chainId, network] of alchemyNetworks) {
	const replay = replayChain(chainId);
	for (const address of OWN_ADDRESSES) {
		const balance = await alchemy(network, "eth_getBalance", [
			address,
			"latest",
		]);
		equal(
			`alchemy ${network} native ${address.slice(0, 8)}`,
			hex(replay.native.get(address)),
			balance.body.result,
		);
		const contracts = Object.keys(CHAIN_TOKENS[chainId]);
		if (contracts.length === 0) continue;
		const tokens = await alchemy(network, "alchemy_getTokenBalances", [
			address,
			contracts,
		]);
		for (const row of tokens.body.result.tokenBalances)
			equal(
				`alchemy ${network} token ${row.contractAddress.slice(0, 8)} ${address.slice(0, 8)}`,
				hex(
					replay.tokens.get(address).get(row.contractAddress.toLowerCase()) ??
						0n,
				),
				row.tokenBalance,
			);
	}
	const block = await alchemy(network, "eth_blockNumber", []);
	equal(
		`alchemy ${network} head block`,
		hex(CHAINS[chainId].headBlock),
		block.body.result,
	);
}

for (const address of OWN_ADDRESSES) {
	const { legs, pages, error } = await alchemyLegs(1, address);
	check(
		`alchemy mainnet transfers ${address.slice(0, 8)}`,
		!error,
		error?.message,
	);
	compareLegs(
		`alchemy mainnet legs ${address.slice(0, 8)}`,
		fixtureLegs(1, ["external", "internal", "erc20"]).filter(
			(leg) => leg.from === address || leg.to === address,
		),
		legs,
	);
	if (address === ADDRESSES.walletA)
		check("alchemy pageKey paging was exercised", pages > 2, `pages ${pages}`);
}

const arbAlchemy = await alchemyLegs(42161, ADDRESSES.walletA);
compareLegs(
	"alchemy arbitrum serves external and erc20 only",
	fixtureLegs(42161, ["external", "erc20"]).filter(
		(leg) => leg.from === ADDRESSES.walletA || leg.to === ADDRESSES.walletA,
	),
	arbAlchemy.legs,
);
const arbInternalOnly = await alchemy(
	"arb-mainnet",
	"alchemy_getAssetTransfers",
	[
		{
			fromBlock: "0x0",
			toBlock: "latest",
			fromAddress: ADDRESSES.walletA,
			category: ["internal"],
			excludeZeroValue: false,
			maxCount: "0x3e8",
		},
	],
);
equal(
	"alchemy arbitrum returns no internal category",
	0,
	arbInternalOnly.body.result.transfers.length,
);

const baseAlchemyLegs = await alchemyLegs(8453, ADDRESSES.walletA);
compareLegs(
	"alchemy base legs",
	fixtureLegs(8453, ["external", "internal", "erc20"]),
	baseAlchemyLegs.legs,
);
const baseAlchemyReceipt = await alchemy(
	"base-mainnet",
	"eth_getTransactionReceipt",
	[baseSwap.hash],
);
equal(
	"alchemy Base receipt carries l1Fee",
	hex(baseSwap.l1FeeWei),
	baseAlchemyReceipt.body.result.l1Fee,
);

console.log("nodereal (bsc)");
for (const address of OWN_ADDRESSES) {
	const balance = await nodereal("eth_getBalance", [address, "latest"]);
	equal(
		`nodereal BSC native ${address.slice(0, 8)}`,
		hex(bsc.native.get(address)),
		balance.body.result,
	);
	const call = await nodereal("eth_call", [
		{
			to: ADDRESSES.bscUsdt,
			data: `0x70a08231${"0".repeat(24)}${address.slice(2)}`,
		},
		"latest",
	]);
	equal(
		`nodereal BSC USDT balanceOf ${address.slice(0, 8)}`,
		word(bsc.tokens.get(address).get(ADDRESSES.bscUsdt) ?? 0n),
		call.body.result,
	);
	const { legs, error } = await noderealLegs(56, address);
	check(
		`nodereal BSC transfers ${address.slice(0, 8)}`,
		!error,
		error?.message,
	);
	compareLegs(
		`nodereal BSC legs ${address.slice(0, 8)}`,
		fixtureLegs(56, ["external", "internal", "erc20"]).filter(
			(leg) => leg.from === address || leg.to === address,
		),
		legs,
	);
}
const bscCount = await nodereal("nr_getAssetTransfersCount", [
	{
		fromBlock: "0x0",
		toBlock: "latest",
		fromAddress: ADDRESSES.walletA,
		category: ["external", "internal", "20"],
	},
]);
equal(
	"nodereal transfer count matches the fixture",
	fixtureLegs(56, ["external", "internal", "erc20"]).filter(
		(leg) => leg.from === ADDRESSES.walletA && leg.valueUnits !== 0n,
	).length,
	Number(BigInt(bscCount.body.result.count)),
);
const bscWindow = await nodereal("nr_getTransactionByAddress", [
	{
		fromBlock: hex(46_799_500),
		toBlock: hex(46_800_500),
		address: ADDRESSES.walletA,
	},
]);
equal(
	"nodereal transaction-by-address window returns both withdrawals",
	2,
	bscWindow.body.result.transactions.length,
);
const bscTooWide = await nodereal("nr_getAssetTransfers", [
	{
		fromBlock: "0x0",
		toBlock: hex(50_000_000),
		fromAddress: ADDRESSES.walletA,
		category: ["external"],
	},
]);
check(
	"nodereal refuses a block range above 100k",
	/normal|block range is too large/i.test(
		bscTooWide.body.error?.message ?? "",
	) && /100000/.test(bscTooWide.body.error?.message ?? ""),
	JSON.stringify(bscTooWide.body),
);

console.log("fixture links");
const bridge = CHAIN_TRANSACTIONS[8453].find(
	(tx) => tx.to === ADDRESSES.baseStandardBridge,
);
check(
	"the Base bridge transaction calls L2StandardBridge",
	Boolean(bridge) &&
		ADDRESSES.baseStandardBridge ===
			"0x4200000000000000000000000000000000000010",
	bridge?.hash,
);

console.log("scenarios");
async function control(body) {
	const response = await fetch(`${server.url}/__control`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return response.json();
}

await control({ scenario: "empty" });
const emptyExplorer = await etherscan({
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
});
equal("empty scenario zeroes the explorer", "0", emptyExplorer.body.result);
const emptyBlockscout = await blockscout(1, {
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
});
equal("empty scenario zeroes blockscout", "0", emptyBlockscout.body.result);
const emptyAlchemy = await alchemy("eth-mainnet", "eth_getBalance", [
	ADDRESSES.walletA,
	"latest",
]);
equal("empty scenario zeroes alchemy", "0x0", emptyAlchemy.body.result);
const emptyNodeReal = await nodereal("nr_getAssetTransfers", [
	{ fromAddress: ADDRESSES.walletA, category: ["external"] },
]);
equal(
	"empty scenario empties nodereal transfers",
	0,
	emptyNodeReal.body.result.transfers.length,
);
await control({ scenario: "normal" });

await control({ scenario: "upstream_500_once" });
const alchemy500 = await alchemy("eth-mainnet", "eth_blockNumber", []);
equal("alchemy surfaces a 500 once", 500, alchemy500.status);
equal(
	"alchemy 500 uses the JSON-RPC error body",
	-32603,
	alchemy500.body.error.code,
);
const alchemyRecovered = await alchemy("eth-mainnet", "eth_blockNumber", []);
equal("alchemy recovers after the 500", 200, alchemyRecovered.status);

await control({ scenario: "etherscan_rate_limit_200" });
const rateLimited = await etherscan({
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
});
check(
	"etherscan rate limit is a NOTOK envelope",
	rateLimited.body.status === "0" &&
		/max rate limit/i.test(rateLimited.body.result),
	JSON.stringify(rateLimited.body),
);
const afterRateLimit = await etherscan({
	module: "account",
	action: "balance",
	address: ADDRESSES.walletA,
});
equal(
	"the explorer recovers after the rate limit",
	ethereum.native.get(ADDRESSES.walletA).toString(),
	afterRateLimit.body.result,
);

await control({ scenario: "drift" });
const drift = await etherscan({
	module: "account",
	action: "tokenbalance",
	contractaddress: TOKENS.USDC.contract,
	address: ADDRESSES.walletB,
	tag: "latest",
});
equal(
	"drift shifts mainnet wallet B USDC by 0.5",
	(
		(ethereum.tokens.get(ADDRESSES.walletB).get(TOKENS.USDC.contract) ?? 0n) +
		500000n
	).toString(),
	drift.body.result,
);
const driftOtherChain = await etherscan({
	chainId: 137,
	module: "account",
	action: "balance",
	address: ADDRESSES.walletB,
});
equal(
	"drift leaves other chains alone",
	polygon.native.get(ADDRESSES.walletB).toString(),
	driftOtherChain.body.result,
);
await control({ scenario: "normal" });

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
check(
	"alchemy key is redacted in the log path",
	log.some((entry) => entry.path === "/alchemy/eth-mainnet/v2/***"),
	JSON.stringify(log.map((entry) => entry.path).slice(0, 5)),
);
check(
	"nodereal key is redacted in the log path",
	log.some((entry) => entry.path === "/nodereal/***"),
	JSON.stringify(log.map((entry) => entry.path).slice(0, 5)),
);

await server.close();

console.log("");
if (failures.length) {
	console.error(`${failures.length} fixture check(s) failed:`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("fixture balances reconcile exactly.");
