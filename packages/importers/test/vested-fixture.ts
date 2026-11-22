import { writeXlsx } from "../src/spreadsheet.js";
import { type FixtureText, syntheticPdf } from "./pdf-fixture.js";

const trades = [
	[
		"Date",
		"Time (in UTC)",
		"Name",
		"Ticker",
		"Activity",
		"Order Type",
		"Quantity",
		"Price Per Share",
		"Cash Amount",
		"Comission Charges",
		"Currency",
	],
	[
		"2022-06-01",
		"12:00:00 AM",
		"Synthetic Alphabet - Class C Shares",
		"FAKE",
		"Buy",
		"Market",
		"10",
		"100",
		"1,001.00",
		"1.00",
		"USD",
	],
	[
		"2025-04-02",
		"12:00:00 PM",
		"Synthetic Semiconductor Manufacturing Co.",
		"DEMO",
		"BUY",
		"Limit",
		"2.000000001",
		"100",
		"200.00",
		"",
		"USD",
	],
	[
		"2025-06-02",
		"05:12:43 PM",
		"Synthetic Alphabet - Class C Shares",
		"FAKE",
		"Sell",
		"Market",
		"4",
		"200",
		"798.00",
		"2.00",
		"USD",
	],
	[
		"2025-09-02",
		"09:05:00 AM",
		"Synthetic Semiconductor Manufacturing Co.",
		"DEMO",
		"sell",
		"Limit",
		"1",
		"200",
		"200.00",
		"0",
		"USD",
	],
];
const income = [
	[
		"Date",
		"Time (in UTC)",
		"Activity",
		"Ticker",
		"Gross Cash Amount",
		"Currency",
	],
	[
		"2025-07-02",
		"12:02:45 PM",
		"Manufactured Dividend",
		"FAKE",
		"20.00",
		"USD",
	],
	["2025-07-02", "12:05:00 PM", "Tax", "FAKE", "-5.00", "USD"],
];
const cash = [
	[
		"Date",
		"Time (in UTC)",
		"Type",
		"Amount",
		"Currency",
		"Account Balance",
		"Comment",
	],
	[
		"2022-06-01",
		"12:00:00 AM",
		"CSR",
		"1,200.00",
		"USD",
		"1200",
		"Synthetic deposit",
	],
	[
		"2022-06-01",
		"12:00:00 AM",
		"SPUR",
		"-1,001.00",
		"USD",
		"199",
		"Synthetic buy",
	],
	[
		"2025-06-02",
		"05:12:43 PM",
		"SSAL",
		"798.00",
		"USD",
		"997",
		"Synthetic sell",
	],
	[
		"2025-07-02",
		"12:02:45 PM",
		"DIVM",
		"20.00",
		"USD",
		"1017",
		"Synthetic dividend",
	],
	[
		"2025-07-02",
		"12:05:00 PM",
		"DIVTAX",
		"-5.00",
		"USD",
		"1012",
		"Synthetic withholding",
	],
	[
		"2025-09-02",
		"12:05:00 AM",
		"ORDER",
		"",
		"USD",
		"",
		"Synthetic pending order",
	],
];
const glossary = [
	["Transaction Type", "Description"],
	["SPUR", "Synthetic purchase description"],
];

export function vestedWorkbook(commission = "Commission Charges") {
	return writeXlsx([
		{
			name: "Cover",
			rows: [
				["", "ACCOUNT STATEMENT"],
				["DriveWealth Account Number", "SYNTHETIC"],
			],
		},
		{ name: "All Transactions", rows: cash },
		{
			name: "Trades",
			rows: trades.map((row, i) =>
				i
					? row
					: row.map((value) =>
							value === "Comission Charges" ? commission : value,
						),
			),
		},
		{ name: "Income", rows: income },
		{ name: "Glossary", rows: glossary },
	]);
}

export function vestedPages(): FixtureText[][] {
	const cells = (row: string[], y: number, xs: number[]) =>
		row.flatMap((text, index) =>
			text ? [{ text, x: xs[index] ?? 22, y, fontSize: 6 }] : [],
		);
	const header = (section: string) => [
		{ text: "Vested", x: 22, y: 35 },
		{ text: section, x: 22, y: 52 },
		{ text: "01.01.2022 - 31.12.2025", x: 22, y: 68 },
	];
	const foot = (page: number) => [
		{ text: `Page ${page}`, x: 22, y: 770 },
		{ text: "31.12.2025", x: 540, y: 770 },
	];
	const tradeXs = [22, 63, 112, 236, 261, 293, 334, 377, 425, 472, 550];
	const cashXs = [22, 69, 124, 187, 236, 295, 365];
	const incomeXs = [22, 75, 158, 261, 334, 462];
	return [
		[
			...header("ACCOUNT STATEMENT"),
			{ text: "DriveWealth Account Number: SYNTHETIC", x: 22, y: 120 },
			...foot(1),
		],
		[
			...header("All Transactions"),
			...cash.flatMap((row, i) => cells(row, 90 + i * 15, cashXs)),
			...foot(2),
		],
		[
			...header("Trades"),
			...trades
				.slice(0, 3)
				.flatMap((row, i) => cells(row, 90 + i * 15, tradeXs)),
			...foot(3),
		],
		[
			...header("Trades"),
			...trades.slice(3).flatMap((row, i) => cells(row, 90 + i * 15, tradeXs)),
			...foot(4),
		],
		[
			...header("Income"),
			...income.flatMap((row, i) => cells(row, 90 + i * 15, incomeXs)),
			...glossary.flatMap((row, i) => cells(row, 220 + i * 15, [22, 187])),
			...foot(5),
		],
	];
}

export function vestedPdf() {
	return syntheticPdf(vestedPages());
}
