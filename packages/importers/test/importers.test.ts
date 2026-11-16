import { readFileSync } from "node:fs";
import { D, type Recipe } from "@tax/core";
import { describe, expect, it } from "vitest";
import {
	applyRecipe,
	binance,
	coindcx,
	headerFingerprint,
	importFile,
	numberString,
	parseTimestamp,
	readSheets,
	recipeChecks,
	splitPair,
	writeXlsx,
} from "../src/index.js";

function file(name: string) {
	return {
		name,
		bytes: new Uint8Array(
			readFileSync(new URL(`./fixtures/${name}`, import.meta.url)),
		),
	};
}
function recipe(name: string): Recipe {
	const sheet = readSheets(file(name))[0];
	if (!sheet) throw new Error("Fixture missing");
	return {
		id: "test",
		name: "Synthetic",
		version: 1,
		fingerprint: headerFingerprint(sheet.headers, sheet.name),
		sheet: sheet.name,
		columns: {
			timestamp: "Txn Date",
			baseAsset: "Coin",
			quoteAsset: "Quote",
			amount: "Qty",
			price: "Rate",
			total: "Value",
			feeAmount: "Charges",
			feeAsset: "Charges Coin",
			id: "Ref No",
		},
		dateFormat: "dd-MM-yyyy HH:mm",
		signStyle: "negative_is_sell",
	};
}
describe("verified research fixtures", () => {
	it("imports Binance fills, preserves identical fills and raw rows, and detects layouts", () => {
		const input = file("binance-trade-history.csv");
		expect(binance.detect(input)).toBe(true);
		const result = binance.parse(input, { timezone: "UTC" });
		expect(result.rowsRead).toBe(8);
		expect(result.rowErrors).toEqual([]);
		expect(result.transactions).toHaveLength(8);
		expect(new Set(result.transactions.map((tx) => tx.sourceRef)).size).toBe(8);
		expect(result.transactions[0]?.sourceRef).not.toBe(
			result.transactions[1]?.sourceRef,
		);
		expect(
			binance
				.parse(input, { timezone: "UTC" })
				.transactions.map((tx) => tx.sourceRef),
		).toEqual(result.transactions.map((tx) => tx.sourceRef));
		expect(result.transactions.at(-1)).toMatchObject({
			type: "swap",
			assetIn: "BTC",
			amountIn: "0.01",
			assetOut: "USDT",
			amountOut: "1050",
			feeAsset: "BTC",
			feeAmount: "0.00001",
			raw: { Amount: "1,050.00000000USDT" },
		});
		expect(
			result.transactions.find(
				(tx) => tx.assetIn === "USDT" && tx.amountIn === "352",
			),
		).toMatchObject({
			feeAsset: "BNB",
			feeAmount: "0.0003",
			timestamp: "2026-03-31T18:29:58.000Z",
		});
		const older = importFile(
			file("binance-trade-history-fee-coin-layout.csv"),
			{ timezone: "UTC" },
		);
		expect(older.transactions).toHaveLength(2);
		expect(older.rowErrors).toEqual([]);
	});
	it("imports wallet rows including two-digit years, with withdrawal fee provenance", () => {
		expect(
			importFile(file("binance-deposits-2digit-year.csv"), { timezone: "UTC" })
				.transactions[0]?.timestamp,
		).toBe("2024-11-03T09:15:42.000Z");
		expect(
			importFile(file("binance-deposits.csv"), { timezone: "UTC" })
				.transactions,
		).toHaveLength(2);
		expect(
			importFile(file("binance-withdrawals.csv"), { timezone: "UTC" })
				.transactions[0],
		).toMatchObject({
			type: "withdrawal",
			amountOut: "0.003",
			feeAmount: "0.00002",
			feeAsset: "BTC",
			reviewFlags: [{ code: "parse_warning", message: expect.any(String) }],
		});
	});
	it("accounts for every statement row and avoids overlapping trade/wallet entries", () => {
		const result = binance.parse(file("binance-transaction-statement.csv"), {
			timezone: "UTC",
		});
		expect(result.rowsRead).toBe(32);
		expect(result.transactions).toHaveLength(2);
		expect(result.rowErrors).toHaveLength(30);
		expect(result.transactions[0]).toMatchObject({
			type: "income",
			incomeKind: "interest",
			amountIn: "0.00001234",
		});
		expect(
			result.rowErrors.some((row) => row.message.includes("overlaps")),
		).toBe(true);
		expect(
			result.rowErrors.some((row) => row.message.includes("Unknown")),
		).toBe(true);
	});
	it("reads CoinDCX workbook numeric text, tabs, partial fills, TDS and net INR conversion", () => {
		const input = file("coindcx-report.xlsx");
		expect(coindcx.detect(input)).toBe(true);
		const sheets = readSheets(input);
		expect(sheets.map((sheet) => sheet.rows.length)).toEqual([2, 5, 1, 2]);
		expect(sheets[0]?.rows[0]?.Quantity).toBe("2000");
		const result = coindcx.parse(input, { timezone: "IST" });
		expect(result.rowsRead).toBe(10);
		expect(result.transactions).toHaveLength(7);
		expect(result.rowErrors).toHaveLength(3);
		expect(new Set(result.transactions.map((tx) => tx.sourceRef)).size).toBe(7);
		expect(result.transactions[1]).toMatchObject({
			tdsInr: "90.74",
			assetOut: "USDT",
			inrValue: "9120",
		});
		const swap = result.transactions.find(
			(tx) => tx.sourceRef === "ST-FIXT-0003",
		);
		expect(swap).toMatchObject({
			type: "swap",
			assetOut: "USDT",
			amountOut: "80",
			tdsInr: "72.18",
			feeAsset: "USDT",
		});
		expect(D(swap?.inrValue ?? "0").toFixed(2)).toBe("7200.00");
		expect(result.transactions.every((tx) => tx.gstInr === undefined)).toBe(
			true,
		);
		expect(result.transactions.at(-1)?.timestamp).toBe(
			"2026-03-31T18:30:35.000Z",
		);
	});
	it("applies generic recipes, signed quantities, digit grouping and checks", () => {
		const input = file("generic-signed-amounts.csv");
		const result = applyRecipe(readSheets(input), recipe(input.name), {
			timezone: "IST",
		});
		expect(result.rowErrors).toEqual([]);
		expect(result.transactions[0]).toMatchObject({
			inrValue: "47500",
			priceQuote: { asset: "INR", price: "9500000" },
			sourceRef: "ZX-000101",
		});
		expect(result.transactions[2]).toMatchObject({
			type: "sell",
			amountOut: "0.002",
			inrValue: "16200",
			timestamp: "2026-03-31T18:29:00.000Z",
		});
		expect(recipeChecks(result)).toMatchObject({
			datesOk: true,
			numbersOk: true,
			rowCountIn: 4,
			rowCountOut: 4,
			negativeBalances: [],
		});
	});
});
describe("boundary checks", () => {
	it("parses pairs and dates without locale or process timezone assumptions", () => {
		for (const pair of ["BTCINR", "BTC-INR", "BTC/INR", "BTC_INR"])
			expect(splitPair(pair)).toEqual(["BTC", "INR"]);
		expect(splitPair("1INCHUSDT")).toEqual(["1INCH", "USDT"]);
		expect(numberString("1.234E-05")).toBe("0.00001234");
		expect(
			parseTimestamp("2026-04-01 00:00:00", "yyyy-MM-dd HH:mm:ss", "IST"),
		).toBe("2026-03-31T18:30:00.000Z");
		expect(() =>
			parseTimestamp("2026-02-30 00:00:00", "yyyy-MM-dd HH:mm:ss", "UTC"),
		).toThrow();
		expect(parseTimestamp("46113", "yyyy-MM-dd HH:mm:ss", "UTC", false)).toBe(
			"2026-04-01T00:00:00.000Z",
		);
	});
	it("keeps decimal strings through XLSX and never evaluates formulas", () => {
		const bytes = writeXlsx([
			{
				name: "CSV",
				rows: [
					["Date", "Side", "Pair", "Quantity", "Price", "Total"],
					[
						"2026-05-01 00:00:00",
						"BUY",
						"BTCINR",
						"0.000000000000000001",
						"10000000000000000",
						"0.01",
					],
				],
			},
		]);
		const sheets = readSheets({ name: "precise.xlsx", bytes });
		expect(sheets[0]?.rows[0]?.Quantity).toBe("0.000000000000000001");
		expect(() =>
			readSheets({
				name: "bad.xlsx",
				bytes: new TextEncoder().encode("not a workbook"),
			}),
		).toThrow();
	});
	it("reports invalid dates/numbers individually and detects negative running balances", () => {
		const input = file("generic-signed-amounts.csv");
		const sheets = readSheets(input);
		const sheet = sheets[0];
		if (!sheet) throw new Error("Missing sheet");
		sheet.rows[0] = { ...sheet.rows[0], "Txn Date": "not a date" };
		sheet.rows[1] = { ...sheet.rows[1], Qty: "not a number" };
		const result = applyRecipe(sheets, recipe(input.name), { timezone: "IST" });
		expect(result.rowErrors).toHaveLength(2);
		expect(result.rowsRead).toBe(
			result.transactions.length + result.rowErrors.length,
		);
		expect(recipeChecks(result)).toMatchObject({
			datesOk: false,
			numbersOk: false,
			rowCountIn: 4,
			rowCountOut: 2,
		});
		expect(recipeChecks(result).negativeBalances).toEqual([
			{ asset: "BTC", amount: "-0.003" },
		]);
	});
});

it("generic identities survive recipe renaming and preserve identical rows", () => {
	const input = file("generic-signed-amounts.csv");
	const sheets = readSheets(input);
	const mapping = recipe(input.name);
	const rows = sheets[0];
	if (!rows?.rows[0]) throw new Error("Missing fixture row");
	rows.rows = [rows.rows[0], rows.rows[0]];
	const columns = { ...mapping.columns, id: undefined };
	const a = applyRecipe(
		sheets,
		{ ...mapping, id: "layout-a", columns },
		{ timezone: "IST" },
	).transactions;
	const b = applyRecipe(
		sheets,
		{ ...mapping, id: "layout-b", columns },
		{ timezone: "IST" },
	).transactions;
	expect(a).toHaveLength(2);
	expect(a.map(({ source, sourceRef }) => [source, sourceRef])).toEqual(
		b.map(({ source, sourceRef }) => [source, sourceRef]),
	);
	expect(a[0]?.sourceRef).not.toBe(a[1]?.sourceRef);
	expect(a[0]?.source).toBe(`csv:${mapping.fingerprint}`);
});
