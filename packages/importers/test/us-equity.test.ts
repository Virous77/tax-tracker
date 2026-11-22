import { readFileSync } from "node:fs";
import type { Recipe } from "@tax/core";
import { expect, test } from "vitest";
import {
	applyRecipe,
	headerFingerprint,
	importFile,
	numberString,
	parseTimestamp,
	readSheets,
	type TableSheet,
} from "../src/index.js";

function schwabRecipe(sheet: TableSheet): Recipe {
	return {
		id: "test-schwab",
		name: "Schwab Test",
		version: 1,
		fingerprint: headerFingerprint(sheet.headers, sheet.name),
		assetClass: "us_equity",
		defaultQuoteAsset: "USD",
		defaultFeeAsset: "USD",
		dateFormat: "MM/dd/yyyy",
		signStyle: "side_column",
		columns: {
			timestamp: "Date",
			side: "Action",
			baseAsset: "Symbol",
			description: "Description",
			amount: "Quantity",
			price: "Price",
			feeAmount: "Fees & Comm",
			total: "Amount",
		},
		sideMap: {
			Buy: "buy",
			Sell: "sell",
			"NRA Tax Adj": "foreign_tax",
			"Qualified Dividend": "dividend",
			"Wire Funds Received": "deposit",
		},
	};
}

test.each([
	["-$2.31", "-2.31"],
	["-$2,455.00", "-2455"],
	["+$10.00", "10"],
	["($2.31)", "-2.31"],
	["( ₹1,234.50 )", "-1234.5"],
])("parses the broker amount %s", (input, expected) => {
	expect(numberString(input)).toBe(expected);
});

test("chooses the effective Schwab date by default and supports the posted date", () => {
	const value = "01/02/2026 as of 12/31/2025";
	expect(parseTimestamp(value, "MM/dd/yyyy", "UTC")).toBe(
		"2025-12-31T00:00:00.000Z",
	);
	expect(parseTimestamp(value, "MM/dd/yyyy", "UTC", undefined, "first")).toBe(
		"2026-01-02T00:00:00.000Z",
	);
	expect(() =>
		parseTimestamp("01/02/2026 as of 02/30/2025", "MM/dd/yyyy", "UTC"),
	).toThrow();
});

test("imports all nine Schwab rows with gross proceeds, effective dates, and unchanged raw rows", () => {
	const file = {
		name: "us-broker-schwab-like.csv",
		bytes: readFileSync(
			new URL("./fixtures/us-broker-schwab-like.csv", import.meta.url),
		),
	};
	const [sheet] = readSheets(file);
	if (!sheet) throw new Error("Missing fixture CSV");
	const opts = {
		source: "generic",
		timezone: "UTC",
		recipe: schwabRecipe(sheet),
	} as const;
	const result = importFile(file, opts);
	expect(result.rowsRead).toBe(9);
	expect(result.rowErrors).toEqual([]);
	expect(result.warnings).toEqual([]);
	expect(result.transactions).toHaveLength(9);
	expect(result.transactions.map(({ raw }) => raw)).toEqual(sheet.rows);
	expect(result.transactions.map(({ assetClass }) => assetClass)).toEqual(
		Array(9).fill("us_equity"),
	);
	expect(result.transactions.map(({ sourceRef }) => sourceRef)).toEqual(
		importFile(file, opts).transactions.map(({ sourceRef }) => sourceRef),
	);
	expect(result.transactions[0]).toMatchObject({
		type: "sell",
		assetOut: "VTI",
		amountOut: "4",
		assetIn: "USD",
		amountIn: "1249.6",
		feeAmount: "0.03",
		feeAsset: "USD",
	});
	expect(result.transactions[1]).toMatchObject({
		type: "foreign_tax",
		dividendAsset: "VTI",
		assetOut: "USD",
		amountOut: "2.31",
		withholdingTaxAmount: "2.31",
		withholdingTaxAsset: "USD",
	});
	expect(result.transactions[2]).toMatchObject({
		type: "dividend",
		dividendAsset: "VTI",
		amountIn: "9.24",
		entityName: "VANGUARD TOTAL STOCK MARKET ETF",
	});
	expect(result.transactions[3]).toMatchObject({
		timestamp: "2025-12-31T00:00:00.000Z",
		amountOut: "0.65",
	});
	expect(result.transactions[4]).toMatchObject({
		timestamp: "2025-12-31T00:00:00.000Z",
		amountIn: "2.6",
	});
	expect(result.transactions[5]).toMatchObject({
		amountIn: "1340.5",
		feeAmount: "0.02",
	});
	expect(result.transactions[6]).toMatchObject({
		type: "buy",
		assetOut: "USD",
		amountOut: "2455",
		assetIn: "VTI",
	});
	expect(result.transactions[8]).toMatchObject({
		type: "deposit",
		assetIn: "USD",
		amountIn: "5000",
	});
});

test("handles inline tax, currency, blank-symbol cash, and explicitly skipped rows", () => {
	const row = {
		Date: "04/01/2026",
		Action: "Buy",
		Symbol: "AAPL",
		Description: "Apple",
		Quantity: "1",
		Price: "$100",
		"Fees & Comm": "$2",
		Amount: "($102.01)",
		Currency: "USD",
		Tax: "",
	};
	const cash = {
		...row,
		Action: "Cash Out",
		Symbol: "",
		Quantity: "",
		Price: "",
		"Fees & Comm": "0",
		Amount: "-$25",
	};
	const dividend = {
		...cash,
		Action: "Qualified Dividend",
		Symbol: "AAPL",
		"Fees & Comm": "$0.00",
		Amount: "$8",
		Tax: "($2)",
	};
	const skip = { ...cash, Date: "", Action: "Memo", Amount: "" };
	const invalid = { ...row, Date: "04/31/2026" };
	const sheet = {
		name: "CSV",
		headers: Object.keys(row),
		rows: [row, cash, dividend, skip, invalid],
	};
	const config = schwabRecipe(sheet);
	const recipe = {
		...config,
		defaultQuoteAsset: undefined,
		columns: { ...config.columns, withholdingTax: "Tax", currency: "Currency" },
		sideMap: { ...config.sideMap, "Cash Out": "withdrawal", Memo: "skip" },
	} satisfies Recipe;
	const result = applyRecipe([sheet], recipe, { timezone: "UTC" });
	expect(result.transactions[0]).toMatchObject({
		type: "buy",
		amountOut: "100",
		feeAmount: "2",
	});
	expect(result.transactions[1]).toMatchObject({
		type: "withdrawal",
		assetOut: "USD",
		amountOut: "25",
	});
	expect(result.transactions[1]).not.toHaveProperty("feeAmount");
	expect(result.transactions[2]).toMatchObject({
		type: "dividend",
		amountIn: "8",
		withholdingTaxAmount: "2",
		withholdingTaxAsset: "USD",
	});
	expect(result.transactions[2]).not.toHaveProperty("feeAsset");
	expect(result.skippedRows).toMatchObject([{ rowIndex: 3, raw: skip }]);
	expect(result.rowErrors).toMatchObject([{ rowIndex: 4, field: "date" }]);
	expect(result.rowsRead).toBe(
		result.transactions.length +
			result.rowErrors.length +
			(result.skippedRows?.length ?? 0),
	);
});
