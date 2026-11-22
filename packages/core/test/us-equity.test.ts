import { expect, test } from "vitest";
import {
	ApiContract,
	addCalendarMonths,
	CreateManualTransactionRequestSchema,
	EngineSettingsSchema,
	EquityCyPriceSchema,
	LedgerTxSchema,
	ListTransactionsQuerySchema,
	lastDayOfPreviousMonth,
	PutSettingsRequestSchema,
	transactionTaxInputs,
} from "../src/index.js";

test("calendar months clamp the day and previous month-end handles leap years", () => {
	expect(addCalendarMonths("2024-02-29", 24)).toBe("2026-02-28");
	expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
	expect(addCalendarMonths("2025-01-31", -2)).toBe("2024-11-30");
	expect(addCalendarMonths("2025-03-12", 24)).toBe("2027-03-12");
	expect(lastDayOfPreviousMonth("2026-01-02")).toBe("2025-12-31");
	expect(lastDayOfPreviousMonth("2024-03-01")).toBe("2024-02-29");
});

const base = {
	id: "00000000-0000-4000-8000-000000000001",
	source: "manual",
	sourceRef: "entry",
	importId: null,
	timestamp: "2026-06-16T00:00:00.000Z",
	raw: { entry: "user" },
	reviewFlags: [],
};

test("keeps the legacy class default and validates equity dividend and withholding legs", () => {
	const legacy = LedgerTxSchema.parse({
		...base,
		type: "deposit",
		assetIn: "BTC",
		amountIn: "1",
	});
	expect(legacy.assetClass).toBe("vda");
	expect(transactionTaxInputs({ ...legacy, assetClass: undefined })).toEqual(
		transactionTaxInputs(legacy),
	);
	expect(LedgerTxSchema.safeParse({ ...base, type: "dividend" }).success).toBe(
		false,
	);
	expect(
		LedgerTxSchema.safeParse({ ...base, type: "foreign_tax" }).success,
	).toBe(false);

	const dividend = {
		...base,
		type: "dividend",
		assetClass: "us_equity",
		dividendAsset: "VTI",
		assetIn: "USD",
		amountIn: "9.24",
		withholdingTaxAmount: "2.31",
		withholdingTaxAsset: "USD",
	};
	expect(LedgerTxSchema.safeParse(dividend).success).toBe(true);
	expect(
		LedgerTxSchema.safeParse({ ...dividend, withholdingTaxAsset: undefined })
			.success,
	).toBe(false);
	expect(
		LedgerTxSchema.safeParse({ ...dividend, withholdingTaxAmount: undefined })
			.success,
	).toBe(false);
	const parsed = LedgerTxSchema.parse(dividend);
	expect(transactionTaxInputs(parsed)).not.toEqual(
		transactionTaxInputs({ ...parsed, withholdingTaxAmount: "3" }),
	);
	expect(transactionTaxInputs(parsed)).not.toEqual(
		transactionTaxInputs({ ...parsed, entityName: "Vanguard" }),
	);
});

test("supports manual broker entries and partial settings without applying settings defaults", () => {
	expect(
		CreateManualTransactionRequestSchema.parse({
			...base,
			venue: "us_broker",
			type: "foreign_tax",
			assetClass: "us_equity",
			dividendAsset: "VTI",
			assetOut: "USD",
			amountOut: "2.31",
		}),
	).toMatchObject({
		type: "foreign_tax",
		venue: "us_broker",
		assetClass: "us_equity",
	});
	expect(
		ListTransactionsQuerySchema.parse({ assetClass: "all" }).assetClass,
	).toBe("all");
	expect(
		ListTransactionsQuerySchema.safeParse({ assetClass: "stocks" }).success,
	).toBe(false);
	expect(EngineSettingsSchema.parse({})).toMatchObject({
		usEquityFeeTreatment: "include",
		usEquityFxBasis: "prev_month_end",
	});
	expect(PutSettingsRequestSchema.parse({})).toEqual({});
	expect(
		PutSettingsRequestSchema.parse({ usEquityFxBasis: "trade_date" }),
	).toEqual({ usEquityFxBasis: "trade_date" });
});

test("validates Schedule FA price dates and query parameters", () => {
	const price = { symbol: "VTI", calendarYear: 2026, peakPriceUsd: "300" };
	expect(EquityCyPriceSchema.safeParse(price).success).toBe(false);
	expect(
		EquityCyPriceSchema.safeParse({ ...price, peakDate: "2025-12-31" }).success,
	).toBe(false);
	expect(
		EquityCyPriceSchema.safeParse({ ...price, peakDate: "2026-01-01" }).success,
	).toBe(true);
	expect(
		ApiContract.getEquityPrices.request.parse({ calendarYear: "2026" }),
	).toEqual({ calendarYear: 2026 });
	expect(
		ApiContract.getUsEquityReport.request.parse({ allowStale: "false" }),
	).toEqual({ allowStale: false });
	expect(
		ApiContract.putEquityPrices.request.safeParse({
			calendarYear: 2025,
			prices: [{ ...price, peakDate: "2026-06-01" }],
		}).success,
	).toBe(false);
	expect(
		ApiContract.exportUsEquityReport.request.parse({
			format: "xlsx",
			kind: "schedule-fa",
		}),
	).toEqual({ format: "xlsx", kind: "schedule-fa" });
});
