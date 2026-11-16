import { describe, expect, test } from "vitest";
import {
	ApiContract,
	D,
	DecimalStringSchema,
	EngineSettingsSchema,
	formatInr,
	LedgerTxSchema,
	PositiveDecimalSchema,
	PutSettingsRequestSchema,
	parseDecimal,
	roundInr,
	SettingsResponseSchema,
	TransactionsQuerySchema,
	taxYearBounds,
	taxYearOf,
} from "../src/index.js";

describe("decimal and time boundaries", () => {
	test("exact fractions and half-up INR", () => {
		expect(D("0.1").plus("0.2").toFixed()).toBe("0.3");
		expect(roundInr("1.005")).toBe("1.01");
		expect(roundInr("-1.005")).toBe("-1.01");
		expect(formatInr("123456789.125")).toBe("₹12,34,56,789.13");
		expect(formatInr("-0.05")).toBe("-₹0.05");
		expect(() => parseDecimal("Infinity")).toThrow();
	});
	test("IST tax year", () => {
		expect(taxYearOf("2026-03-31T18:29:00Z")).toBe("2025-26");
		expect(taxYearOf("2026-03-31T18:30:00Z")).toBe("2026-27");
		expect(taxYearBounds("2026-27").endExclusiveUtc).toBe(
			"2027-03-31T18:30:00.000Z",
		);
		expect(() => taxYearBounds("2026-28")).toThrow();
	});
});
describe("boundary schemas", () => {
	test("settings defaults and tolerance", () => {
		expect(EngineSettingsSchema.parse({}).feeTreatment).toBe("exclude");
		expect(
			EngineSettingsSchema.safeParse({ transferAmountTolerance: "1.01" })
				.success,
		).toBe(false);
	});
	test("ledger validates required legs and amounts", () => {
		const tx = {
			id: "00000000-0000-4000-8000-000000000001",
			source: "manual",
			sourceRef: "1",
			importId: null,
			timestamp: "2026-04-01T00:00:00Z",
			type: "sell",
			raw: {},
			reviewFlags: [],
		};
		expect(LedgerTxSchema.safeParse(tx).success).toBe(false);
		expect(
			LedgerTxSchema.safeParse({
				...tx,
				assetOut: "ETH",
				amountOut: "0.00000001",
			}).success,
		).toBe(true);
		expect(
			LedgerTxSchema.safeParse({ ...tx, assetOut: "ETH", amountOut: 1 })
				.success,
		).toBe(false);
	});
	test("query booleans are explicit and pagination is bounded", () => {
		expect(TransactionsQuerySchema.parse({ flagged: "false" }).flagged).toBe(
			false,
		);
		expect(TransactionsQuerySchema.safeParse({ pageSize: 201 }).success).toBe(
			false,
		);
		expect(TransactionsQuerySchema.safeParse({ flagged: "yes" }).success).toBe(
			false,
		);
	});
	test("settings responses strip secrets", () => {
		const result = SettingsResponseSchema.parse({
			defaultTaxYear: "2026-27",
			ai: { apiKey: "secret", apiKeySet: true },
		});
		expect(result.ai).not.toHaveProperty("apiKey");
		expect(ApiContract.patchTransaction.path).toBe("/api/transactions/:id");
	});
});

test("malformed decimal input is a validation result", () => {
	for (const value of [
		"oops",
		"NaN",
		"Infinity",
		"1.2.3",
		"",
		"--1",
		"1e99999999999999999999999999999",
	]) {
		expect(DecimalStringSchema.safeParse(value).success).toBe(false);
		expect(PositiveDecimalSchema.safeParse(value).success).toBe(false);
		expect(
			EngineSettingsSchema.safeParse({ transferAmountTolerance: value })
				.success,
		).toBe(false);
	}
});
test("partial settings updates preserve omitted keys", () => {
	expect(PutSettingsRequestSchema.parse({ feeTreatment: "include" })).toEqual({
		feeTreatment: "include",
	});
	expect(PutSettingsRequestSchema.parse({ ai: { model: "local" } })).toEqual({
		ai: { model: "local" },
	});
	expect(PutSettingsRequestSchema.parse({})).toEqual({});
});
