import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GENERATED } from "./env";

// Synthetic Binance Transaction History statements for the Phase 1 specs. Since Phase 2 the
// statement is a ledger source (trades rebuilt from one received + one spent + one fee leg), so
// these files contain only what each scenario needs and never touch the asset under test.

const HEADER = `"User_ID","UTC_Time","Account","Operation","Coin","Change","Remark"`;

const row = (
	time: string,
	account: string,
	operation: string,
	coin: string,
	change: string,
	remark = "",
) =>
	["100000002", time, account, operation, coin, change, remark]
		.map((cell) => `"${cell}"`)
		.join(",");

const FILES = {
	// No ETH at all: the ETH sell in sell-without-buy.csv stays a sell without a buy. One
	// unambiguous BNB trade (3 legs → 1 swap, 2 legs skipped), interest, and an airdrop that has
	// no INR value (missing_inr_value) in tax year 2025-26.
	"statement-without-eth.csv": [
		row("2025-06-14 14:41:33", "Spot", "Deposit", "USDT", "500.00000000"),
		row("2025-08-20 10:05:01", "Spot", "Transaction Buy", "BNB", "0.10000000"),
		row(
			"2025-08-20 10:05:01",
			"Spot",
			"Transaction Spend",
			"USDT",
			"-85.00000000",
		),
		row("2025-08-20 10:05:01", "Spot", "Transaction Fee", "BNB", "-0.00010000"),
		row(
			"2025-09-01 00:13:22",
			"Earn",
			"Simple Earn Flexible Interest",
			"USDT",
			"0.01234000",
		),
		row(
			"2025-10-05 08:00:00",
			"Spot",
			"Airdrop Assets",
			"FIXT",
			"25.00000000",
			"Synthetic airdrop row",
		),
	],
	// Two unambiguous trades (4 legs folded into their swaps → skipped) and two broken rows.
	// 10 read = 4 inserted + 0 duplicates + 4 skipped + 2 errors.
	"statement-grouped-legs.csv": [
		row("2025-06-14 14:41:33", "Spot", "Deposit", "USDT", "1000.00000000"),
		row("2025-06-15 03:12:44", "Spot", "Transaction Buy", "BTC", "0.01000000"),
		row(
			"2025-06-15 03:12:44",
			"Spot",
			"Transaction Spend",
			"USDT",
			"-850.00000000",
		),
		row("2025-06-15 03:12:44", "Spot", "Transaction Fee", "BTC", "-0.00001000"),
		row("2025-08-20 10:05:01", "Spot", "Transaction Buy", "BNB", "0.10000000"),
		row(
			"2025-08-20 10:05:01",
			"Spot",
			"Transaction Spend",
			"USDT",
			"-85.00000000",
		),
		row("2025-08-20 10:05:01", "Spot", "Transaction Fee", "BNB", "-0.00010000"),
		row(
			"2025-09-01 00:13:22",
			"Earn",
			"Simple Earn Flexible Interest",
			"USDT",
			"0.01234000",
		),
		row(
			"not-a-date",
			"Spot",
			"Deposit",
			"USDT",
			"5.00000000",
			"Row with a broken date",
		),
		row(
			"2025-12-02 16:45:30",
			"Spot",
			"Deposit",
			"ETH",
			"abc",
			"Row with a broken amount",
		),
	],
} as const;

export type StatementFixture = keyof typeof FILES;

export function statement(name: StatementFixture) {
	mkdirSync(GENERATED, { recursive: true });
	const file = path.join(GENERATED, name);
	writeFileSync(file, `${[HEADER, ...FILES[name]].join("\n")}\n`);
	return file;
}
