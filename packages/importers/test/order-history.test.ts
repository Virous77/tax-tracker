import { readFileSync } from "node:fs";
import type { Recipe } from "@tax/core";
import { describe, expect, it } from "vitest";
import {
	applyRecipe,
	binance,
	binanceKind,
	binanceReportKinds,
	coindcx,
	coindcxReportKinds,
	csvRecords,
	detectSource,
	headerFingerprint,
	importFile,
	parseAmountWithAsset,
	parseBinance,
	parseCoinDcx,
	parseTimestamp,
	readSheets,
	timezoneFromFileName,
	writeXlsx,
} from "../src/index.js";

const binanceName = "binance-spot-order-history(UTC+5).csv";
function fixture(name: string) {
	return {
		name,
		bytes: new Uint8Array(
			readFileSync(new URL(`./fixtures/${name}`, import.meta.url)),
		),
	};
}
function accountable(result: ReturnType<typeof importFile>) {
	expect(
		result.transactions.length +
			result.rowErrors.length +
			(result.skippedRows?.length ?? 0),
	).toBe(result.rowsRead);
}

describe("Binance Spot Order History", () => {
	it.each([binanceName, binanceName.replace(".csv", ".xlsx")])(
		"imports %s with duplicate Time, suffixed quantities and every supported status",
		(name) => {
			const file = fixture(name);
			expect(binance.detect(file)).toBe(true);
			const result = importFile(file, { timezone: "UTC" });
			expect(result.reportKind).toBe("binance:spot-order-history");
			expect(result.sheets?.[0]?.reportKind).toBe(result.reportKind);
			expect(result.rowsRead).toBe(5);
			expect(result.rowErrors).toEqual([]);
			expect(result.transactions).toHaveLength(4);
			expect(result.skippedRows).toEqual([
				{
					rowIndex: 2,
					sheet: expect.any(String),
					reason: expect.stringContaining("CANCELED has zero executed"),
					raw: expect.objectContaining({ Status: "CANCELED" }),
				},
			]);
			expect(result.transactions[0]).toMatchObject({
				source: "binance",
				sourceRef: "order:synthetic-b1",
				type: "swap",
				assetIn: "1INCH",
				amountIn: "12",
				assetOut: "USDT",
				amountOut: "24",
				priceQuote: { asset: "USDT", price: "1" },
				timestamp: "2025-08-02T05:01:00.000Z",
				raw: {
					Time: "2025-08-02 10:00:00",
					"Time#2": "2025-08-02 10:01:00",
					"Executed²": "12.01INCH",
				},
			});
			expect(result.transactions[1]).toMatchObject({
				type: "swap",
				assetOut: "FOO",
				amountOut: "3",
				assetIn: "ETH",
				amountIn: "0.06",
				priceQuote: { asset: "ETH", price: "0.02" },
			});
			expect(result.transactions[2]).toMatchObject({
				sourceRef: "order:synthetic-b4",
				amountIn: "2",
				amountOut: "8",
			});
			expect(result.transactions[3]).toMatchObject({
				assetIn: "1000SATS",
				amountIn: "400",
				amountOut: "0.4",
			});
			expect(
				result.transactions.every(
					(tx) => tx.feeAmount === undefined && tx.feeAsset === undefined,
				),
			).toBe(true);
			expect(
				result.warnings.filter((warning) =>
					warning.message.includes("has no fees"),
				),
			).toEqual([
				{
					code: "parse_warning",
					message: expect.stringContaining("Trade History"),
				},
			]);
			expect(result).toMatchObject({
				detectedTimezone: "+05:00",
				timezoneSource: "file",
			});
			expect(result.warnings).toContainEqual({
				code: "parse_warning",
				message: expect.stringContaining("Used +05:00"),
			});
			expect(
				importFile(file, { timezone: "+05:00" }).warnings.some((warning) =>
					warning.message.includes("instead of"),
				),
			).toBe(false);
			const repeated = importFile(file, { timezone: "IST" });
			expect(
				repeated.transactions.map((tx) => [tx.source, tx.sourceRef]),
			).toEqual(result.transactions.map((tx) => [tx.source, tx.sourceRef]));
			expect(new Set(result.transactions.map((tx) => tx.sourceRef)).size).toBe(
				4,
			);
			accountable(result);
		},
	);
	it("uses the user's fixed offset without a filename offset, and applies half-hour filename offsets", () => {
		const original = fixture(binanceName);
		const user = importFile(
			{ ...original, name: "orders.csv" },
			{ timezone: "-03:30" },
		);
		expect(user.timezoneSource).toBe("user");
		expect(user.detectedTimezone).toBeUndefined();
		expect(user.transactions[0]?.timestamp).toBe("2025-08-02T13:31:00.000Z");
		const detected = importFile(
			{ ...original, name: "orders(UTC+5:30).csv" },
			{ timezone: "IST" },
		);
		expect(detected.detectedTimezone).toBe("+05:30");
		expect(detected.transactions[0]?.timestamp).toBe(
			"2025-08-02T04:31:00.000Z",
		);
		expect(
			detected.warnings.some((warning) =>
				warning.message.includes("instead of"),
			),
		).toBe(false);
	});
	it("keeps order identities stable when an order is updated and rejects suffix mismatches", () => {
		const sheets = readSheets(fixture(binanceName), {
			allowDuplicateHeaders: true,
		});
		const row = sheets[0]?.rows[0];
		if (!row) throw new Error("Missing fixture");
		row["Time#2"] = "2025-08-02 10:05:00";
		expect(
			parseBinance(sheets, { timezone: "UTC" }).transactions[0]?.sourceRef,
		).toBe("order:synthetic-b1");
		row["Executed²"] = "12ETH";
		let result = parseBinance(sheets, { timezone: "UTC" });
		expect(result.rowErrors[0]?.message).toContain("does not match");
		accountable(result);
		row["Executed²"] = "-1.01INCH";
		result = parseBinance(sheets, { timezone: "UTC" });
		expect(result.rowErrors[0]?.message).toContain("between zero");
	});
});

describe("CoinDCX Order history", () => {
	it("detects the CSV and handles filled, partial, cancelled and open orders", () => {
		const file = fixture("coindcx-order-history.csv");
		expect(coindcx.detect(file)).toBe(true);
		expect(detectSource(readSheets(file))).toBe("coindcx");
		const result = importFile(file, { timezone: "IST" });
		expect(result.reportKind).toBe("coindcx:order-history");
		expect(result).toMatchObject({
			rowsRead: 6,
			rowErrors: [],
			detectedTimezone: "UTC",
			timezoneSource: "file",
		});
		expect(result.transactions).toHaveLength(4);
		expect(result.skippedRows?.map((row) => row.reason)).toEqual([
			expect.stringContaining("cancelled has zero executed"),
			expect.stringContaining("open has zero executed"),
		]);
		expect(result.transactions[0]).toMatchObject({
			sourceRef: "order:synthetic-c1",
			type: "sell",
			assetOut: "USDT",
			amountOut: "20",
			assetIn: "INR",
			amountIn: "1620",
			inrValue: "1620",
			feeAsset: "INR",
			feeAmount: "8.1",
			tdsInr: "16.119",
			timestamp: "2025-08-01T10:01:00.000Z",
			raw: { "Created At": "2025-08-01 10:00:00 UTC" },
		});
		expect(result.transactions[1]).toMatchObject({
			type: "buy",
			amountIn: "4",
			amountOut: "204",
			inrValue: "204",
			feeAsset: "INR",
			feeAmount: "1.02",
		});
		expect(result.transactions[2]).toMatchObject({
			type: "swap",
			assetIn: "BTC",
			amountIn: "0.01",
			assetOut: "USDT",
			amountOut: "510",
			feeAsset: "USDT",
			feeAmount: "2.55",
			priceQuote: { asset: "USDT", price: "1" },
		});
		expect(result.transactions[2]?.inrValue).toBeUndefined();
		expect(result.transactions[3]).toMatchObject({
			type: "sell",
			amountOut: "1",
			inrValue: "52",
		});
		expect(
			importFile(file, { timezone: "-03:30" }).transactions.map((tx) => [
				tx.sourceRef,
				tx.timestamp,
			]),
		).toEqual(result.transactions.map((tx) => [tx.sourceRef, tx.timestamp]));
		expect(new Set(result.transactions.map((tx) => tx.sourceRef)).size).toBe(4);
		accountable(result);
	});
	it("rejects inconsistent quantities and pairs without silently inventing a value", () => {
		const sheets = readSheets(fixture("coindcx-order-history.csv"));
		const row = sheets[0]?.rows[0];
		if (!row) throw new Error("Missing fixture");
		row["Remaining Quantity"] = "21";
		expect(parseCoinDcx(sheets, { timezone: "UTC" }).rowErrors[0]?.field).toBe(
			"number",
		);
		row["Remaining Quantity"] = "0";
		row.Pair = "I-BTC_INR";
		expect(
			parseCoinDcx(sheets, { timezone: "UTC" }).rowErrors[0]?.message,
		).toContain("Market does not match");
	});
});

describe("report boundaries", () => {
	it("registers independent report kinds and falls back to generic for unknown headers", () => {
		const sheet = readSheets(fixture(binanceName), {
			allowDuplicateHeaders: true,
		})[0];
		if (!sheet) throw new Error("Missing sheet");
		expect(binanceKind(sheet)).toBe("binance:spot-order-history");
		for (const kind of [...binanceReportKinds, ...coindcxReportKinds]) {
			expect(typeof kind.detect).toBe("function");
			expect(typeof kind.parse).toBe("function");
		}
		expect(
			detectSource([{ name: "CSV", headers: ["Unknown"], rows: [] }]),
		).toBe("generic");
	});
	it("retains BOM/superscript header coverage and the XLSX fixture matches the synthetic CSV", () => {
		const csv = fixture(binanceName);
		expect([...csv.bytes.slice(0, 3)]).toEqual([239, 187, 191]);
		const rows = csvRecords(new TextDecoder().decode(csv.bytes));
		expect(rows[0]).toContain("Type¹");
		const rebuilt = readSheets(
			{
				name: "orders.xlsx",
				bytes: writeXlsx([{ name: "Spot Order History", rows }]),
			},
			{ allowDuplicateHeaders: true },
		);
		expect(rebuilt).toEqual(
			readSheets(fixture(binanceName.replace(".csv", ".xlsx")), {
				allowDuplicateHeaders: true,
			}),
		);
	});
	it("requires duplicate header opt-in, preserves collisions, and shows a generic recipe warning", () => {
		const file = {
			name: "generic.csv",
			bytes: new TextEncoder().encode(
				"Date,Date,Date#2,Asset,Quantity\n2025-08-01 00:00:00,2025-08-02 00:00:00,third,FOO,2\n",
			),
		};
		expect(() => readSheets(file)).toThrow("duplicate");
		const sheets = readSheets(file, { allowDuplicateHeaders: true });
		const sheet = sheets[0];
		if (!sheet) throw new Error("Missing sheet");
		expect(sheet.headers).toEqual([
			"Date",
			"Date#3",
			"Date#2",
			"Asset",
			"Quantity",
		]);
		expect(sheet.rows[0]?.["Date#3"]).toBe("2025-08-02 00:00:00");
		const recipe: Recipe = {
			id: "duplicate",
			name: "Duplicate",
			version: 1,
			fingerprint: headerFingerprint(sheet.headers, sheet.name),
			columns: {
				timestamp: "Date#3",
				baseAsset: "Asset",
				amount: "Quantity",
				type: "Date#2",
			},
			sideMap: { third: "deposit" },
			dateFormat: "yyyy-MM-dd HH:mm:ss",
			signStyle: "side_column",
		};
		const result = applyRecipe(sheets, recipe, { timezone: "+05:00" });
		expect(result.warnings).toContainEqual({
			code: "parse_warning",
			message: expect.stringContaining("Date#3"),
		});
		expect(result).toMatchObject({ rowErrors: [], timezoneSource: "user" });
		expect(result.transactions[0]?.timestamp).toBe("2025-08-01T19:00:00.000Z");
		expect(importFile(file, { timezone: "+05:00", recipe }).rowErrors).toEqual(
			[],
		);
	});
	it.each([
		["0.1ETH", "0.1", "ETH"],
		["0.11INCH", "0.1", "1INCH"],
		["2e-31000SATS", "0.002", "1000SATS"],
		["1.2e+3ETH", "1200", "ETH"],
		["1,200.5USDT", "1200.5", "USDT"],
	])("splits amount %s safely", (value, amount, asset) => {
		expect(parseAmountWithAsset(value ?? "")).toEqual({ amount, asset });
	});
	it.each(["1e-8", "1E3", "0.1", "ETH"])(
		"rejects a cell missing an amount or asset: %s",
		(value) => {
			expect(() => parseAmountWithAsset(value)).toThrow();
		},
	);
	it("validates a caller-provided asset and supports unknown digit-leading symbols with a known suffix", () => {
		expect(parseAmountWithAsset("3e-2123TOKEN", "123TOKEN")).toEqual({
			amount: "0.03",
			asset: "123TOKEN",
		});
		expect(() => parseAmountWithAsset("0.1ETH", "BTC")).toThrow(
			"does not match",
		);
	});
	it.each([
		["report(UTC+5).csv", "+05:00"],
		["report(UTC+5:30).xlsx", "+05:30"],
		["report(UTC-3).csv", "-03:00"],
		["report(UTC-3:30).csv", "-03:30"],
		["report.csv", undefined],
		["report(UTC+15).csv", undefined],
		["report(UTC+5:60).csv", undefined],
	])("detects timezone from %s", (name, expected) => {
		expect(timezoneFromFileName(name ?? "")).toBe(expected);
	});
	it("supports negative offsets and explicit UTC independently of the user answer", () => {
		expect(
			parseTimestamp("2025-08-01 00:00:00", "yyyy-MM-dd HH:mm:ss", "-03:30"),
		).toBe("2025-08-01T03:30:00.000Z");
		expect(
			parseTimestamp(
				"2025-08-01 00:00:00 UTC",
				"yyyy-MM-dd HH:mm:ss",
				"+05:00",
			),
		).toBe("2025-08-01T00:00:00.000Z");
		expect(() =>
			parseTimestamp("2025-08-01 00:00:00", "yyyy-MM-dd HH:mm:ss", "+25:00"),
		).toThrow("Timezone offset");
	});
});
