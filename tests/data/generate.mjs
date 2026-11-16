#!/usr/bin/env node
// Deterministic edge-case input pack. Regenerating must produce identical bytes.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
const fixtures = new URL(
	"../../packages/importers/test/fixtures/",
	import.meta.url,
);

const TRADE_HEADER = "Date(UTC),Pair,Side,Price,Executed,Amount,Fee";
const SEED = 20260401;
const UNITS = 10n ** 10n; // coin amounts are held as 1e-10 units

function mulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function intBetween(rnd, min, max) {
	return min + Math.floor(rnd() * (max - min + 1));
}

function priceFrom(text) {
	const [whole, fraction = ""] = text.split(".");
	return (
		BigInt(whole) * 10n ** 8n + BigInt(fraction.padEnd(8, "0").slice(0, 8))
	);
}

function decimalString(units, decimals) {
	const negative = units < 0n;
	const absolute = negative ? -units : units;
	const divisor = 10n ** BigInt(decimals);
	const whole = absolute / divisor;
	const fraction = (absolute % divisor).toString().padStart(decimals, "0");
	return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function write(name, content) {
	const bytes = Buffer.isBuffer(content)
		? content
		: Buffer.from(content, "utf8");
	writeFileSync(join(outDir, name), bytes);
	console.log(`  ${name.padEnd(24)} ${String(bytes.length).padStart(9)} bytes`);
}

const MARKETS = [
	{ base: "BTC", quote: "USDT", price: "88000", precision: 2, weight: 5 },
	{ base: "ETH", quote: "USDT", price: "3600", precision: 2, weight: 5 },
	{ base: "BNB", quote: "USDT", price: "850", precision: 2, weight: 4 },
	{ base: "SOL", quote: "USDT", price: "150", precision: 2, weight: 4 },
	{ base: "ADA", quote: "USDT", price: "0.62", precision: 4, weight: 3 },
	{ base: "DOGE", quote: "USDT", price: "0.14", precision: 5, weight: 3 },
	{ base: "XRP", quote: "USDT", price: "2.10", precision: 3, weight: 3 },
	{ base: "DOT", quote: "USDT", price: "5.50", precision: 2, weight: 2 },
	{ base: "LINK", quote: "USDT", price: "18.00", precision: 2, weight: 2 },
	{ base: "MATIC", quote: "USDT", price: "0.45", precision: 4, weight: 2 },
	{ base: "USDT", quote: "INR", price: "84.00", precision: 2, weight: 4 },
	{ base: "BTC", quote: "INR", price: "8100000", precision: 2, weight: 2 },
	{ base: "ETH", quote: "INR", price: "300000", precision: 2, weight: 2 },
	{ base: "ETH", quote: "BTC", price: "0.0408", precision: 6, weight: 2 },
	{ base: "BNB", quote: "BTC", price: "0.00966", precision: 7, weight: 1 },
];
const MARKET_WEIGHT = MARKETS.reduce((sum, market) => sum + market.weight, 0);
const USDT_INR = MARKETS.find(
	(market) => market.base === "USDT" && market.quote === "INR",
);

function pickMarket(rnd) {
	let target = rnd() * MARKET_WEIGHT;
	for (const market of MARKETS) {
		target -= market.weight;
		if (target <= 0) return market;
	}
	return MARKETS[MARKETS.length - 1];
}

function marketPrice(market, rnd) {
	const base = priceFrom(market.price);
	const moved = (base * BigInt(920 + intBetween(rnd, 0, 160))) / 1000n;
	const step = 10n ** BigInt(8 - market.precision);
	return (moved / step) * step || step;
}

function notional(quote, rnd) {
	if (quote === "INR") return BigInt(intBetween(rnd, 50_000, 800_000)) * UNITS;
	if (quote === "USDT") return BigInt(intBetween(rnd, 100, 3_000)) * UNITS;
	return BigInt(intBetween(rnd, 2_000_000, 20_000_000));
}

function tradeRow(market, side, price, qty, total, fee, timestamp) {
	return [
		timestamp,
		`${market.base}${market.quote}`,
		side,
		decimalString(price, market.precision),
		`${decimalString(qty, 10)}${market.base}`,
		`${decimalString(total, 8)}${market.quote}`,
		`${decimalString(fee, 10)}${market.quote}`,
	].join(",");
}

function binanceLarge() {
	const rnd = mulberry32(SEED);
	const balances = new Map();
	const balance = (asset) => balances.get(asset) ?? 0n;
	const credit = (asset, units) => balances.set(asset, balance(asset) + units);
	const debit = (asset, units) => balances.set(asset, balance(asset) - units);
	const check = () => {
		for (const [asset, units] of balances)
			if (units < 0n) throw new Error(`Negative ${asset} balance: ${units}`);
	};

	const start = Date.UTC(2025, 3, 1, 6, 0, 0);
	const end = Date.UTC(2026, 8, 30, 18, 0, 0);
	const rows = [];
	const add = (market, side, timestamp) => {
		const price = marketPrice(market, rnd);
		const quantity =
			side === "BUY"
				? (notional(market.quote, rnd) * 100_000_000n) / price
				: (balance(market.base) * BigInt(intBetween(rnd, 100, 400))) / 1000n;
		if (quantity <= 0n) return false;
		const proceeds = (quantity * price) / UNITS;
		if (proceeds <= 0n) return false;
		const cost = proceeds * 100n;
		const fee = cost / 1000n || 1n;
		if (side === "BUY") {
			if (market.quote !== "INR" && cost + fee > balance(market.quote))
				return false;
			credit(market.base, quantity);
			if (market.quote !== "INR") debit(market.quote, cost + fee);
		} else {
			if (quantity > balance(market.base) || fee >= cost) return false;
			debit(market.base, quantity);
			if (market.quote !== "INR") credit(market.quote, cost - fee);
		}
		check();
		rows.push(
			tradeRow(market, side, price, quantity, proceeds, fee, timestamp),
		);
		return true;
	};

	const step = Math.floor((end - start) / 5000);
	let sequence = 0;
	const nextTimestamp = () => {
		const time = start + sequence * step + Math.floor(rnd() * step * 0.8);
		sequence++;
		return new Date(time).toISOString().slice(0, 19).replace("T", " ");
	};

	while (rows.length < 5000) {
		const timestamp = nextTimestamp();
		const market = pickMarket(rnd);
		const canBuy = market.quote === "INR" || balance(market.quote) > 0n;
		const canSell = balance(market.base) > 0n;
		const order =
			canBuy && canSell
				? rnd() < 0.6
					? ["BUY", "SELL"]
					: ["SELL", "BUY"]
				: canBuy
					? ["BUY"]
					: canSell
						? ["SELL"]
						: [];
		let done = false;
		for (const side of order)
			if (add(market, side, timestamp)) {
				done = true;
				break;
			}
		if (!done && !add(USDT_INR, "BUY", timestamp))
			throw new Error("Could not find a funded trade");
	}
	if (rows.length !== 5000)
		throw new Error(`Expected 5000 rows, wrote ${rows.length}`);
	return `${[TRADE_HEADER, ...rows.reverse()].join("\n")}\n`;
}

function duplicates() {
	const fixture = readFileSync(
		new URL("binance-trade-history.csv", fixtures),
		"utf8",
	)
		.split(/\r?\n/)
		.filter((line) => line.trim());
	const shared = fixture.slice(-4); // half of the fixture's 8 rows, byte for byte
	if (fixture[0] !== TRADE_HEADER || shared.length !== 4)
		throw new Error("binance-trade-history.csv changed shape");
	const fresh = [
		"2026-04-15 11:30:00,ETHUSDT,SELL,3700.00,0.0200000000ETH,74.00000000USDT,0.0740000000USDT",
		"2026-03-01 09:10:00,BNBUSDT,SELL,900.00,0.0500000000BNB,45.00000000USDT,0.0450000000USDT",
		"2026-02-10 12:00:00,SOLUSDT,BUY,150.00,2.0000000000SOL,300.00000000USDT,0.3000000000USDT",
		"2026-01-05 08:45:00,BTCUSDT,BUY,92000.00,0.0030000000BTC,276.00000000USDT,0.27600000000USDT",
	];
	return `${[TRADE_HEADER, ...fresh, ...shared].join("\n")}\n`;
}

function malformed() {
	const rows = [
		"2026-01-10 10:00:00,BTCUSDT,BUY,88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT",
		"2026-13-45 10:00:00,ETHUSDT,BUY,3600.00,0.0100000000ETH,36.00000000USDT,0.0360000000USDT",
		"not-a-date,BTCUSDT,SELL,88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT",
		",BTCUSDT,BUY,88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT",
		"2026-01-12 10:00:00,BTCUSDT,BUY,88000.00,abc,88.00000000USDT,0.0880000000USDT",
		"",
		'2026-01-14 10:00:00,BTCUSDT,BUY,105000.00,0.0100000000BTC,"1,050.00000000USDT",0.0000100000BTC',
		"2026-01-15 10:00:00,BTCUSDT,BUY",
		"2026-01-16 10:00:00,BTCUSDT,SELL,88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT,EXTRA",
		"2026-01-17 10:00:00,比特币USDT,BUY,88000.00,0.0010000000比特币,88.00000000USDT,0.0880000000USDT",
		"2026-01-18 10:00:00,DÖGEUSDT,BUY,0.15,10.0000000000DÖGE,1.50000000USDT,0.0015000000USDT",
		"",
		"2026-01-19 10:00:00,BTCUSDT,BUY,-88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT",
		"2026-01-20 10:00:00,BTCUSDT,HODL,88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT",
		'"2026-01-21 10:00:00",BTCUSDT,BUY,88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT',
		" 2026-01-22 10:00:00 ,BTCUSDT,BUY,88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT",
		"2026-01-23 10:00:00,BTCUSDT,BUY,88000.00,,88.00000000USDT,0.0880000000USDT",
	];
	return `\uFEFF${[TRADE_HEADER, ...rows].join("\r\n")}\r\n`;
}

function huge() {
	const lines = [TRADE_HEADER];
	const target = 26 * 1024 * 1024;
	let size = TRADE_HEADER.length + 1;
	for (let index = 0; size < target; index++) {
		const seconds = index % 60;
		const minutes = Math.floor(index / 60) % 60;
		const line = `2026-01-${String((index % 28) + 1).padStart(2, "0")} ${String(Math.floor(index / 3600) % 24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},BTCUSDT,BUY,88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT`;
		lines.push(line);
		size += line.length + 1;
	}
	return `${lines.join("\n")}\n`;
}

function csvInjection() {
	return `${[
		"Date,Pair,Side,Qty,Price,Reference,Note",
		"2025-05-01 10:00:00,BTCINR,Buy,0.001,8000000,=1+1,@SUM(A1:A2)",
		"2025-05-02 10:00:00,ETHINR,Buy,0.01,250000,+2+3,-2+3",
		"2025-06-01 10:00:00,BTCINR,Sell,-0.001,8100000,=cmd|calc!A0,@cmd",
		"2025-06-02 10:00:00,BTCINR,Buy,0.001,8100000,+cmd,-1",
	].join("\n")}\n`;
}

function genericNewLayout() {
	return `${[
		"Timestamp,Instrument,Amount,Price,Net Amount,Fee,Fee Coin,Order Ref",
		'2025-04-05 09:15:00,ETH-INR,0.050,245000,"12,250.00",12.25,INR,OD-9001',
		'2025-06-21 14:40:12,ETH-INR,-0.020,268000,"-5,360.00",5.36,INR,OD-9002',
		'2025-09-30 18:05:45,BTCINR,0.002,8100000,"16,200.00",16.2,INR,OD-9003',
		'2026-03-31 23:59:45,BTCINR,-0.001,8100000,"-8,100.00",8.1,INR,OD-9004',
		'2026-04-01 00:00:15,BTCINR,-0.0005,8100000,"-4,050.00",4.05,INR,OD-9005',
	].join("\n")}\n`;
}

function genericDdMmYyyy() {
	return `${[
		"Txn Date,Coin,Market,Side,Quantity,Rate,Value,Charges,Charges Coin",
		'05/04/2025 10:15,BTC,BTCINR,Buy,0.002,8000000,"16,000.00",16,INR',
		'12/06/2025 16:40,ETH,ETHINR,Buy,0.5,260000,"1,30,000.00",130,INR',
		'31/03/2026 23:59,BTC,BTCINR,Sell,0.001,8100000,"8,100.00",8.1,INR',
		'01/04/2026 00:01,BTC,BTCINR,Sell,0.0005,8100000,"4,050.00",4.05,INR',
	].join("\n")}\n`;
}

function main() {
	mkdirSync(outDir, { recursive: true });
	console.log(`Writing edge-case pack to ${outDir}`);
	write("binance-large.csv", binanceLarge());
	write("duplicates.csv", duplicates());
	write("malformed.csv", malformed());
	write("empty.csv", `${TRADE_HEADER}\n`);
	write("zero-bytes.csv", Buffer.alloc(0));
	write(
		"not-a-csv.csv",
		Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x7f]),
			Buffer.from("this is binary noise, not a CSV\n\u0000\u0001", "latin1"),
		]),
	);
	write(
		"fake.xlsx",
		`${TRADE_HEADER}\n2026-01-10 10:00:00,BTCUSDT,BUY,88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT\n`,
	);
	write("huge.csv", huge());
	write(
		"sell-without-buy.csv",
		`${TRADE_HEADER}\n2026-05-15 10:00:00,ETHUSDT,SELL,3900.00,0.0100000000ETH,39.00000000USDT,0.0390000000USDT\n`,
	);
	write(
		"year-boundary.csv",
		`${[
			TRADE_HEADER,
			"2026-03-31 18:30:00,BTCUSDT,SELL,88100.00,0.0010000000BTC,88.10000000USDT,0.0881000000USDT",
			"2026-03-31 18:29:59,BTCUSDT,SELL,88000.00,0.0010000000BTC,88.00000000USDT,0.0880000000USDT",
			"2026-03-31 17:00:00,BTCUSDT,BUY,87900.00,0.0020000000BTC,175.80000000USDT,0.1758000000USDT",
		].join("\n")}\n`,
	);
	write(
		"tiny-amounts.csv",
		`${[
			TRADE_HEADER,
			"2026-01-05 10:00:00,BTCUSDT,BUY,88000.00,0.00000001BTC,0.00088000USDT,0.00000088USDT",
			"2026-01-06 10:00:00,BTCUSDT,SELL,88200.00,0.00000001BTC,0.00088200USDT,0.00000088USDT",
			"2026-01-07 10:00:00,ETHUSDT,BUY,3600.00,0.00000001ETH,0.00003600USDT,0.00000004USDT",
			"2026-01-08 10:00:00,ETHUSDT,SELL,3650.00,0.00000001ETH,0.00003650USDT,0.00000004USDT",
		].join("\n")}\n`,
	);
	write("csv-injection.csv", csvInjection());
	write("generic-new-layout.csv", genericNewLayout());
	write("generic-ddmmyyyy.csv", genericDdMmYyyy());
	const hugeSize = statSync(join(outDir, "huge.csv")).size;
	if (hugeSize <= 25 * 1024 * 1024)
		throw new Error(`huge.csv is only ${hugeSize} bytes`);
	console.log("Done.");
}

main();
