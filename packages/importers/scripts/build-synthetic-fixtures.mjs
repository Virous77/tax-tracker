import { mkdir, readFile, writeFile } from "node:fs/promises";
import { csvRecords, writeXlsx } from "../dist/index.js";

const directory = new URL("../test/fixtures/report-kinds/", import.meta.url);
await mkdir(directory, { recursive: true });
const definitions = {
	"binance-convert": [
		[
			"Date",
			"Pair",
			"Type",
			"Sell",
			"Buy",
			"Price",
			"Inverse Price",
			"Date Updated",
			"Status",
		],
		[
			"2026-04-01 00:00:00",
			"ETHBTC",
			"Instant",
			"0.5 ETH",
			"0.01 BTC",
			"0.02",
			"50",
			"2026-04-01 00:00:01",
			"Successful",
		],
		[
			"2026-04-01 00:00:02",
			"ETHBTC",
			"Instant",
			"0.5 ETH",
			"0.01 BTC",
			"0.02",
			"50",
			"2026-04-01 00:00:02",
			"Pending",
		],
	],
	"binance-fiat-deposit": [
		[
			"Date(UTC+0)",
			"Coin",
			"Amount",
			"Status",
			"Payment Method",
			"Indicated Amount",
			"Fee",
			"Order ID",
		],
		[
			"2026-04-01 00:00:00",
			"EUR",
			"100",
			"Successful",
			"Bank",
			"100",
			"1",
			"fiat-synthetic-1",
		],
		[
			"2026-04-01 00:00:01",
			"EUR",
			"100",
			"Pending",
			"Bank",
			"100",
			"1",
			"fiat-synthetic-2",
		],
	],
	"binance-wallet-legacy-deposit": [
		[
			"Date(UTC)",
			"Coin",
			"Network",
			"Amount",
			"TransactionFee",
			"Address",
			"TXID",
			"SourceAddress",
			"PaymentID",
			"Status",
		],
		[
			"2026-04-01 00:00:00",
			"ETH",
			"ETH",
			"1",
			"0",
			"synthetic-address",
			"synthetic-hash",
			"",
			"",
			"Completed",
		],
	],
	"binance-trade-assets-unverified": [
		[
			"Date(UTC)",
			"Pair",
			"Base Asset",
			"Quote Asset",
			"Type",
			"Price",
			"Amount",
			"Total",
			"Fee",
			"Fee Coin",
		],
		[
			"2026-04-01 00:00:00",
			"BTCUSDT",
			"BTC",
			"USDT",
			"BUY",
			"100",
			"1",
			"100",
			"0.01",
			"BNB",
		],
	],
	"binance-futures-trades-unverified": [
		[
			"Date(UTC)",
			"Pair",
			"Side",
			"Price",
			"Quantity",
			"Amount",
			"Fee",
			"Realized Profit",
		],
		["2026-04-01 00:00:00", "BTCUSDT", "BUY", "100", "1", "100", "0.01", "2"],
	],
	"binance-futures-transactions": [
		["Date(UTC)", "type", "Amount", "Asset", "Symbol", "Transaction ID"],
		...[
			"REALIZED_PNL",
			"FUNDING_FEE",
			"COMMISSION",
			"TRANSFER",
			"NEW_UNKNOWN_TYPE",
		].map((type, index) => [
			"2026-04-01 00:00:00",
			type,
			"-1",
			"USDT",
			"BTCUSDT",
			`synthetic-futures-${index}`,
		]),
	],
	"coindcx-futures-inr-unverified": [
		[
			"Transaction ID",
			"Transaction time",
			"Type of Transaction",
			"Gross P&L for this transaction(in INR)",
			"Net P&L for this transaction(in INR)",
			"Fees(in INR)",
		],
		[
			"synthetic-inr-future-1",
			"2026-04-01 00:00:00",
			"Realised P&L",
			"100",
			"99",
			"1",
		],
	],
	"coindcx-options-unverified": [
		["Position ID", "Option Contract", "Entry Time"],
		["synthetic-option-1", "SYNTHETIC-CONTRACT", "2026-04-01 00:00:00"],
	],
};
const income = {
	interest: [
		"Simple Earn Flexible Interest",
		"Savings Interest",
		"Savings distribution",
		"Pool Distribution",
		"Launchpool Interest",
	],
	staking: [
		"Staking Rewards",
		"ETH 2.0 Staking Rewards",
		"Simple Earn Locked Rewards",
		"POS savings interest",
		"BNB Vault Rewards",
		"Swap Farming Rewards",
		"Liquid Swap rewards",
	],
	airdrop: [
		"Airdrop Assets",
		"Distribution",
		"Simple Earn Flexible Airdrop",
		"HODLer Airdrops Distribution",
		"Launchpool Airdrop",
		"Megadrop Rewards",
		"Cash Voucher distribution",
		"Campaign Related Reward",
	],
	referral: [
		"Commission Rebate",
		"Commission History",
		"Referral Kickback",
		"Referral Commission",
		"Referrer rebates",
		"Commission Fee Shared With You",
	],
	mining: ["Super BNB Mining"],
};
const statement = [
	["User_ID", "UTC_Time", "Account", "Operation", "Coin", "Change", "Remark"],
];
let second = 0;
const row = (operation, asset, change, account = "Spot", at = second++) =>
	statement.push([
		"synthetic-user",
		`2026-04-01 00:${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`,
		account,
		operation,
		asset,
		change,
		"synthetic",
	]);
for (const operations of Object.values(income))
	for (const op of operations) row(op, "ETH", "0.001");
for (const operations of [
	["Transaction Buy", "Transaction Spend", "Transaction Fee"],
	["Transaction Revenue", "Transaction Sold", "Transaction Related"],
	["Buy", "Sell", "Fee"],
]) {
	const at = second++;
	operations.forEach((op, i) => {
		row(
			op,
			i === 0 ? "ETH" : i === 1 ? "USDT" : "BNB",
			i === 0 ? "1" : i === 1 ? "-100" : "-0.01",
			"Spot",
			at,
		);
	});
}
for (const op of [
	"Binance Convert",
	"Small assets exchange BNB",
	"Small Assets Exchange BNB",
	"ETH 2.0 Staking",
	"Stablecoins Auto-Conversion",
	"Asset Conversion Transfer",
	"Large OTC trading",
	"Buy Crypto With Card",
]) {
	const at = second++;
	row(op, "ETH", "-1", "Spot", at);
	row(op, "BNB", "2", "Spot", at);
}
row("BNB Fee Deduction", "BNB", "-0.001");
for (const op of ["Deposit", "Fiat Deposit", "Buy Crypto"]) row(op, "ETH", "1");
for (const op of ["Withdraw", "Fiat Withdraw", "Fiat Withdrawal", "Send"])
	row(op, "ETH", "-1");
for (const op of [
	"transfer_in",
	"transfer_out",
	"Transfer Between Main and Funding Wallet",
	"Transfer Between Spot Account and UM Futures Account",
	"Transfer Between Spot Account and CM Futures Account",
	"Transfer Between Main Account/Futures and Margin Account",
	"Simple Earn Flexible Subscription",
	"Simple Earn Flexible Redemption",
	"Simple Earn Locked Subscription",
	"Simple Earn Locked Redemption",
	"Staking Purchase",
	"Staking Redemption",
	"POS savings purchase",
	"POS savings redemption",
	"Savings purchase",
	"Savings Principal redemption",
	"Launchpool Subscription/Redemption",
])
	row(op, "ETH", "1");
for (const op of [
	"Realized Profit and Loss",
	"Funding Fee",
	"Token Swap - Redenomination/Rebranding",
	"Binance Card Spending",
	"Crypto Box",
	"New Operation Not In Catalogue",
])
	row(op, "ETH", "1");
row("Distribution", "ETH", "-1");
row("Unknown Without Change", "ETH", "");
row("Borrow", "ETH", "1", "Cross Margin");
row("New Futures Operation", "ETH", "-1", "Coin-M Futures");
definitions["binance-statement-all-operations"] = statement;

for (const [venue, sourceName, statuses] of [
	[
		"binance",
		"binance-spot-order-history(UTC+5).csv",
		[
			"FILLED",
			"PARTIALLY_FILLED",
			"CANCELED",
			"NEW",
			"PENDING_CANCEL",
			"REJECTED",
			"EXPIRED",
			"EXPIRED_IN_MATCH",
		],
	],
	[
		"coindcx",
		"coindcx-order-history.csv",
		[
			"init",
			"open",
			"partially_filled",
			"filled",
			"partially_cancelled",
			"cancelled",
			"rejected",
		],
	],
]) {
	const sourceGrid = csvRecords(
		await readFile(
			new URL(`../test/fixtures/${sourceName}`, import.meta.url),
			"utf8",
		),
	);
	const header = sourceGrid[0];
	const sourceRow = sourceGrid[1];
	if (!header || !sourceRow) throw new Error("Missing synthetic fixture");
	definitions[`${venue}-order-statuses`] = [
		header,
		...statuses.map((status, index) => {
			const row = [...sourceRow];
			row[header.indexOf("Status")] = status;
			row[header.indexOf(venue === "binance" ? "OrderNo" : "Order ID")] =
				`synthetic-status-${index}`;
			if (venue === "binance") row[header.indexOf("Executed²")] = "01INCH";
			else
				row[header.indexOf("Remaining Quantity")] =
					row[header.indexOf("Total Quantity")];
			return row;
		}),
	];
}
for (const [name, grid] of Object.entries(definitions)) {
	const csv = `${grid
		.map((cells) =>
			cells
				.map((c) => (/[",\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c))
				.join(","),
		)
		.join("\n")}\n`;
	await writeFile(new URL(`${name}.csv`, directory), csv);
	await writeFile(
		new URL(`${name}.xlsx`, directory),
		writeXlsx([{ name: "Synthetic", rows: grid }]),
	);
}
for (const name of [
	"binance-trade-history",
	"binance-trade-history-fee-coin-layout",
	"binance-deposits",
	"binance-withdrawals",
	"coindcx-order-history",
]) {
	const csv = await readFile(
		new URL(`../test/fixtures/${name}.csv`, import.meta.url),
		"utf8",
	);
	await writeFile(
		new URL(`${name}.xlsx`, directory),
		writeXlsx([{ name: "Synthetic", rows: csvRecords(csv) }]),
	);
}
