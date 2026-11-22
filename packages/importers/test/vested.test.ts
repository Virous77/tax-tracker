import { describe, expect, it } from "vitest";
import {
	detectSource,
	importFile,
	importFileAsync,
	positionedLines,
	readSheets,
	vested,
	writeXlsx,
} from "../src/index.js";
import type { PdfLine } from "../src/pdf/types.js";
import type { ImportResult } from "../src/types.js";
import { reportKind } from "../src/vested/account-statement-pdf.js";
import { vestedPages, vestedPdf, vestedWorkbook } from "./vested-fixture.js";

const options = { timezone: "IST" } as const;
const workbook = (commission?: string) => ({
	name: "synthetic.xlsx",
	bytes: vestedWorkbook(commission),
});
const pdf = () => ({ name: "synthetic.pdf", bytes: vestedPdf() });

function assertAccounting(result: ImportResult) {
	expect(result.rowsRead).toBe(
		result.transactions.length +
			result.rowErrors.length +
			(result.skippedRows?.length ?? 0),
	);
}

function assertStatement(result: ImportResult) {
	expect(result).toMatchObject({
		detectedTimezone: "UTC",
		timezoneSource: "file",
		timezoneOrigin: "header",
		rowsRead: 12,
		rowErrors: [],
		warnings: [
			{
				code: "parse_warning",
				message: "Used UTC from the column header instead of the selected IST.",
			},
		],
	});
	expect(result.skippedRows?.map(({ reason }) => reason)).toEqual([
		"Covered by Trades section in this Vested statement",
		"Covered by Trades section in this Vested statement",
		"Covered by Income section in this Vested statement",
		"Covered by Income section in this Vested statement",
		"Pending order not executed",
	]);
	expect(result.transactions.map(({ type }) => type)).toEqual([
		"deposit",
		"buy",
		"buy",
		"sell",
		"sell",
		"dividend",
		"foreign_tax",
	]);
	expect(
		result.transactions.every(
			(tx) => tx.assetClass === "us_equity" && tx.source === "vested",
		),
	).toBe(true);
	expect(result.transactions).toMatchObject([
		{ timestamp: "2022-06-01T00:00:00.000Z", assetIn: "USD", amountIn: "1200" },
		{
			timestamp: "2022-06-01T00:00:00.000Z",
			assetIn: "FAKE",
			amountIn: "10",
			assetOut: "USD",
			amountOut: "1000",
			feeAsset: "USD",
			feeAmount: "1",
			priceQuote: { asset: "USD", price: "100" },
			entityName: "Synthetic Alphabet - Class C Shares",
			sourceRef: "vested:trade:2022-06-01T00:00:00.000Z:FAKE:buy:10:1001#0",
		},
		{
			timestamp: "2025-04-02T12:00:00.000Z",
			assetIn: "DEMO",
			amountIn: "2.000000001",
			amountOut: "200",
			entityName: "Synthetic Semiconductor Manufacturing Co.",
		},
		{
			timestamp: "2025-06-02T17:12:43.000Z",
			assetOut: "FAKE",
			amountOut: "4",
			amountIn: "800",
			feeAsset: "USD",
			feeAmount: "2",
		},
		{ assetOut: "DEMO", amountIn: "200" },
		{
			timestamp: "2025-07-02T12:02:45.000Z",
			dividendAsset: "FAKE",
			assetIn: "USD",
			amountIn: "20",
		},
		{
			dividendAsset: "FAKE",
			assetOut: "USD",
			amountOut: "5",
			withholdingTaxAsset: "USD",
			withholdingTaxAmount: "5",
		},
	]);
	expect(result.transactions[2]).not.toHaveProperty("feeAmount");
	expect(result.transactions[2]).not.toHaveProperty("feeAsset");
	expect(result.transactions[4]).not.toHaveProperty("feeAmount");
	assertAccounting(result);
}

describe("Vested Account Statement", () => {
	it.each(["Comission Charges", "Commission Charges"])(
		"imports XLSX with %s",
		(commission) => {
			const input = workbook(commission);
			expect(vested.detect(input)).toBe(true);
			expect(detectSource(readSheets(input))).toBe("vested");
			const result = importFile(input, options);
			expect(result.reportKind).toBe("vested:account-statement-xlsx");
			assertStatement(result);
			expect(result.transactions[2]?.raw).toMatchObject({
				[commission]: "",
				Currency: "USD",
			});
		},
	);

	it("maps positioned lines with split and wrapped company names and repeated headers", () => {
		const lines = positionedLines(
			vestedPages().map((page, i) => ({
				page: i + 1,
				height: 792,
				items: page.map(({ text, x, y, fontSize = 10 }) => ({
					str: text,
					x,
					y,
					width: text.length * fontSize * 0.44,
					height: fontSize,
				})),
			})),
		);
		const header = lines.find((line) => line.page === 3 && line.y === 90);
		const trade = lines.find((line) => line.page === 3 && line.y === 105);
		const name = trade?.cells.find((cell) =>
			cell.str.startsWith("Synthetic Alphabet"),
		);
		if (!header || !trade || !name) throw new Error("Missing synthetic trade");
		name.str = "Synthetic";
		name.width = 22;
		trade.cells.splice(trade.cells.indexOf(name) + 1, 0, {
			...name,
			str: "Alphabet -",
			x: 140,
			width: 25,
		});
		const wrap: PdfLine = {
			...trade,
			y: 109,
			cells: [{ ...name, str: "Class C Shares", y: 109, width: 37 }],
		};
		lines.splice(lines.indexOf(trade) + 1, 0, wrap);
		const continuation = lines.find((line) => line.page === 4 && line.y === 90);
		if (!continuation) throw new Error("Missing synthetic continuation");
		lines.splice(lines.indexOf(continuation), 0, { ...header, page: 4, y: 80 });

		expect(reportKind.verified).toBe(true);
		const result = reportKind.parse(lines, options);
		assertStatement(result);
		expect(result.transactions[1]?.raw).toMatchObject({ wrappedLines: [wrap] });
	});

	it("reads real PDF bytes and generates the same canonical references as XLSX", async () => {
		const result = await importFileAsync(pdf(), {
			...options,
			source: "vested",
		});
		expect(result.reportKind).toBe("vested:account-statement-pdf");
		assertStatement(result);
		expect(result.transactions[2]?.raw).toMatchObject({ line: { page: 3 } });
		const xlsx = await importFileAsync(workbook(), {
			...options,
			source: "vested",
		});
		expect(
			result.transactions.map(({ id: _id, raw: _raw, ...tx }) => tx),
		).toEqual(xlsx.transactions.map(({ id: _id, raw: _raw, ...tx }) => tx));
	});

	it("preserves corporate actions and reports uncovered, malformed and unknown rows", () => {
		const types = [
			["ACATS_CASH", "10"],
			["CSD", "-5"],
			["FEE", "-1"],
			["INT", "2"],
			["SLIP", "3"],
			["JNLC", "4"],
			["SLIPNRA", "-2"],
			["PTP_WITHHOLDING", "-3"],
			["STOCK_SPLIT", ""],
			["MERGER_ACQUISITION", "0"],
			["SPINOFF", "0"],
			["SC", "0"],
			["STCK", "0"],
			["EXTRA", ""],
			["SPUR", "100"],
			["DIV", "20"],
			["CSR", "oops"],
			["CSR", "10"],
		];
		const result = importFile(
			{
				name: "synthetic.xlsx",
				bytes: writeXlsx([
					{
						name: "All Transactions",
						rows: [
							[
								"Date",
								"Time (in UTC)",
								"Type",
								"Amount",
								"Currency",
								"Account Balance",
								"Comment",
							],
							...types.map(([type, amount], i) => [
								"2025-08-01",
								i === types.length - 1 ? "13:05:00 AM" : "12:05:00 AM",
								type ?? "",
								amount ?? "",
								"USD",
								"",
								"",
							]),
						],
					},
				]),
			},
			{ timezone: "UTC" },
		);
		assertAccounting(result);
		expect(result.transactions.slice(0, 8)).toMatchObject([
			{
				type: "deposit",
				amountIn: "10",
				timestamp: "2025-08-01T00:05:00.000Z",
			},
			{ type: "withdrawal", amountOut: "5" },
			{ type: "fee", feeAsset: "USD", feeAmount: "1" },
			{ type: "income", incomeKind: "interest", amountIn: "2" },
			{ type: "income", incomeKind: "other", amountIn: "3" },
			{ type: "income", incomeKind: "other", amountIn: "4" },
			{
				type: "foreign_tax",
				amountOut: "2",
				withholdingTaxAmount: "2",
				withholdingTaxAsset: "USD",
			},
			{
				type: "foreign_tax",
				amountOut: "3",
				withholdingTaxAmount: "3",
				withholdingTaxAsset: "USD",
			},
		]);
		const flags = result.transactions
			.slice(8)
			.map(({ type, reviewFlags }) => [type, reviewFlags[0]?.code]);
		expect(flags).toEqual([
			...Array.from({ length: 5 }, () => ["transfer", "corporate_action"]),
			["transfer", "unknown_type"],
		]);
		expect(result.rowErrors).toMatchObject([
			{
				message: expect.stringContaining("requires the Trades section"),
				raw: { Type: "SPUR" },
			},
			{
				message: expect.stringContaining("requires the Income section"),
				raw: { Type: "DIV" },
			},
			{ field: "number", raw: { Type: "CSR", Amount: "oops" } },
			{ field: "date", raw: { Type: "CSR", "Time (in UTC)": "13:05:00 AM" } },
		]);
	});

	it("preserves unknown income, counts identical events and rejects inconsistent fees", () => {
		const duplicate = [
			"2025-12-01",
			"01:00:00 PM",
			"Dividend",
			"FAKE",
			"10",
			"USD",
		];
		const result = importFile(
			{
				name: "synthetic.xlsx",
				bytes: writeXlsx([
					{
						name: "Income",
						rows: [
							[
								"Date",
								"Time (in UTC)",
								"Activity",
								"Ticker",
								"Gross Cash Amount",
								"Currency",
							],
							duplicate,
							duplicate,
							[
								"2025-12-01",
								"01:00:00 PM",
								"Synthetic adjustment",
								"FAKE",
								"5",
								"USD",
							],
						],
					},
					{
						name: "Trades",
						rows: [
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
								"Commission Charges",
								"Currency",
							],
							[
								"2025-12-01",
								"01:00:00 PM",
								"Synthetic Alphabet",
								"FAKE",
								"Sell",
								"Market",
								"4",
								"200",
								"790",
								"2",
								"USD",
							],
						],
					},
				]),
			},
			{ timezone: "UTC", source: "vested" },
		);
		assertAccounting(result);
		expect(result.transactions.map(({ sourceRef }) => sourceRef)).toEqual([
			"vested:income:2025-12-01T13:00:00.000Z:FAKE:dividend:10#0",
			"vested:income:2025-12-01T13:00:00.000Z:FAKE:dividend:10#1",
			"vested:income:2025-12-01T13:00:00.000Z:FAKE:synthetic adjustment:5#0",
		]);
		expect(result.transactions[2]).toMatchObject({
			reviewFlags: [{ code: "unknown_type" }],
			raw: { Activity: "Synthetic adjustment" },
		});
		expect(result.rowErrors).toMatchObject([
			{
				field: "number",
				message: expect.stringContaining("commission disagree"),
			},
		]);
	});

	it("accepts a standalone Vested CSV and rejects unrelated files for an explicit source", async () => {
		const bytes = new TextEncoder().encode(
			"Date,Time (in UTC),Activity,Ticker,Gross Cash Amount,Currency\n2025-12-01,01:00:00 PM,Dividend,FAKE,10,USD",
		);
		const csv = await importFileAsync(
			{ name: "synthetic.csv", bytes },
			{ ...options, source: "vested" },
		);
		expect(csv).toMatchObject({
			reportKind: "vested:account-statement-csv",
			transactions: [{ type: "dividend" }],
		});
		expect(() =>
			importFile(
				{
					name: "synthetic.csv",
					bytes: new TextEncoder().encode("Other,Header\n1,2"),
				},
				{ ...options, source: "vested" },
			),
		).toThrow("Vested Account Statement");
	});
});
