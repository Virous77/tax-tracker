import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	EngineSettingsSchema,
	type LedgerTx,
	type MarketPrice,
} from "@tax/core";
import { loadRules } from "@tax/rules";
import { describe, expect, it } from "vitest";
import {
	computeHoldings,
	computeVdaReport,
	matchTransfers,
} from "../src/index.js";

const settings = EngineSettingsSchema.parse({});
const root = join(import.meta.dirname, "phase2-golden");
describe("phase 2 hand-calculated golden cases", () => {
	for (const name of readdirSync(root))
		it(name, () => {
			const input = JSON.parse(
				readFileSync(join(root, name, "input.json"), "utf8"),
			) as {
				transactions: LedgerTx[];
				taxYear: string;
				settings?: Record<string, unknown>;
				priceRows?: (MarketPrice & { asset: string })[];
			};
			const expected = JSON.parse(
				readFileSync(join(root, name, "expected.json"), "utf8"),
			);
			const before = JSON.stringify(input);
			const args = {
				...input,
				settings: EngineSettingsSchema.parse(input.settings ?? {}),
				rules: loadRules("india-vda", input.taxYear),
				fx: () => ({ rate: "80", rateDate: "2026-05-01", source: "fixture" }),
				priceLookup: (asset: string, date: string) =>
					input.priceRows?.find(
						(row) => row.asset === asset && row.date === date,
					) ?? null,
			};
			const report = computeVdaReport(args);
			expect(report).toMatchObject(expected);
			expect(JSON.stringify(input)).toBe(before);
			expect(
				computeVdaReport({
					...args,
					transactions: [...input.transactions].reverse(),
				}),
			).toEqual(report);
		});
});
const base: LedgerTx = {
	id: "00000000-0000-4000-8000-000000000001",
	source: "binance-api",
	sourceRef: "1",
	importId: null,
	timestamp: "2026-05-01T00:00:00Z",
	type: "withdrawal",
	assetOut: "ETH",
	amountOut: "1",
	txHash: "0xABCD",
	feeAsset: "ETH",
	feeAmount: "0.01",
	raw: {},
	reviewFlags: [],
};
const deposit: LedgerTx = {
	...base,
	id: "00000000-0000-4000-8000-000000000002",
	sourceRef: "2",
	type: "deposit",
	assetOut: undefined,
	amountOut: undefined,
	assetIn: "ETH",
	amountIn: "0.99",
	feeAmount: undefined,
	feeAsset: undefined,
	txHash: "abcd",
};
it("matches hashes within the same source and before the recorded withdrawal", () => {
	expect(
		matchTransfers(
			[base, { ...deposit, timestamp: "2026-04-01T00:00:00Z" }],
			settings,
		),
	).toHaveLength(1);
});
it("reserves hash pairs before an earlier heuristic candidate can consume them", () => {
	const other = {
		...base,
		id: "00000000-0000-4000-8000-000000000003",
		sourceRef: "3",
		timestamp: "2026-04-30T23:00:00Z",
		txHash: undefined,
	};
	const result = matchTransfers(
		[
			other,
			base,
			{ ...deposit, source: "evm:1", timestamp: "2026-05-01T01:00:00Z" },
		],
		settings,
	);
	expect(result).toHaveLength(1);
	expect(result[0]?.withdrawal.id).toBe(base.id);
});
it("flags a hash deposit larger than its withdrawal", () => {
	const report = computeVdaReport({
		transactions: [base, { ...deposit, amountIn: "2" }],
		settings,
		rules: loadRules("india-vda", "2026-27"),
		taxYear: "2026-27",
		fx: () => null,
	});
	expect(report.warnings.some((f) => f.code === "fee_review_required")).toBe(
		true,
	);
});
it("computes venue holdings with included transfer fees and spam excluded", () => {
	const rows = [
		base,
		{ ...deposit, source: "evm:1" },
		{
			...deposit,
			id: "00000000-0000-4000-8000-000000000003",
			sourceRef: "spam",
			assetIn: "SPAM",
			reviewFlags: [{ code: "suspected_spam" as const, message: "spam" }],
		},
	];
	expect(
		computeHoldings({
			transactions: rows,
			settings,
			asOf: "2026-05-02T00:00:00Z",
		}),
	).toEqual([
		{ asset: "ETH", venue: "binance", quantity: "-1" },
		{ asset: "ETH", venue: "evm:1", quantity: "0.99" },
	]);
});
it("values income at cache FMV and records a UTC snapshot warning", () => {
	const tx = {
		...deposit,
		type: "income" as const,
		assetIn: "ETH",
		amountIn: "2",
	};
	const report = computeVdaReport({
		transactions: [tx],
		settings: { ...settings, incomeCostBasis: "fmv_at_receipt" },
		rules: loadRules("india-vda", "2026-27"),
		taxYear: "2026-27",
		fx: () => null,
		priceLookup: () => ({
			price: "1000",
			quote: "INR",
			source: "coingecko",
			sourceId: "ethereum",
			date: "2026-05-01",
			kind: "snapshot_00utc",
			dayBasis: "UTC",
		}),
	});
	expect(report.income.rows[0]?.fmvInr).toBe("2000.00");
	expect(report.valuations[0]).toMatchObject({
		inrRateSource: "market_price_cache",
		marketPrice: { source: "coingecko", date: "2026-05-01" },
	});
	expect(report.warnings.some((f) => f.code === "parse_warning")).toBe(true);
});
