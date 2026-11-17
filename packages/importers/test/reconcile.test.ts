import type { LedgerTx } from "@tax/core";
import { describe, expect, it } from "vitest";
import { importFile, reconcileReportKinds, writeXlsx } from "../src/index.js";

function parse(
	venue: "binance" | "coindcx",
	rows: string[][],
	name = "synthetic(UTC+5:30).xlsx",
) {
	return importFile(
		{ name, bytes: writeXlsx([{ name: "Synthetic", rows }]) },
		{ source: venue, timezone: "UTC" },
	).transactions;
}
function order(id = "order-1", quantity = "1") {
	return parse("binance", [
		[
			"Time",
			"OrderNo",
			"Pair",
			"Type¹",
			"Side",
			"Order Price",
			"Order Amount",
			"Time",
			"Executed²",
			"Average Price",
			"Trading total³",
			"Status",
		],
		[
			"2026-04-01 10:00:00",
			id,
			"BTCUSDT",
			"Limit",
			"BUY",
			"100",
			`${quantity}BTC`,
			"2026-04-01 10:01:00",
			`${quantity}BTC`,
			"100",
			"100USDT",
			"FILLED",
		],
	]);
}
function fills() {
	return parse(
		"binance",
		[
			["Date(UTC)", "Pair", "Side", "Price", "Executed", "Amount", "Fee"],
			[
				"2026-04-01 04:30:10",
				"BTCUSDT",
				"BUY",
				"100",
				"0.4BTC",
				"40USDT",
				"0.01BNB",
			],
			[
				"2026-04-01 04:30:50",
				"BTCUSDT",
				"BUY",
				"100",
				"0.6BTC",
				"60USDT",
				"0.02BNB",
			],
		],
		"fills.xlsx",
	);
}
function statement(
	op: string,
	asset: string,
	amount: string,
	time = "2026-04-01 04:30:10",
) {
	return parse(
		"binance",
		[
			[
				"User_ID",
				"UTC_Time",
				"Account",
				"Operation",
				"Coin",
				"Change",
				"Remark",
			],
			["synthetic", time, "Spot", op, asset, amount, ""],
		],
		"statement.xlsx",
	);
}
function single(rows: LedgerTx[]) {
	const row = rows[0];
	if (!row) throw new Error("Missing synthetic tx");
	return row;
}
describe("report-kind reconciliation", () => {
	it("supersedes an aggregate Binance order only when fills in its UTC window sum to executed quantity", () => {
		const existing = order();
		const incoming = fills();
		const result = reconcileReportKinds(existing, incoming);
		expect(result).toEqual({
			insert: expect.any(Array),
			supersede: [
				{
					existingId: existing[0]?.id,
					byIncomingRefs: incoming.map((r) => r.sourceRef).sort(),
				},
			],
			duplicates: [],
			ambiguous: [],
		});
		expect(result.insert).toEqual(incoming);
		expect(reconcileReportKinds(incoming, existing)).toMatchObject({
			insert: [],
			supersede: [],
			duplicates: [
				{ incomingRef: existing[0]?.sourceRef, existingId: incoming[0]?.id },
			],
			ambiguous: [],
		});
	});
	it("keeps mismatched and incomplete fills and reports ambiguity in both directions", () => {
		const existing = order("partial", "2");
		const incoming = fills();
		const result = reconcileReportKinds(existing, incoming);
		expect(result.supersede).toEqual([]);
		expect(result.insert).toEqual(incoming);
		expect(result.ambiguous).toHaveLength(2);
		expect(
			reconcileReportKinds(incoming, existing).ambiguous[0]?.candidates,
		).toEqual(incoming.map((tx) => tx.id).sort());
	});
	it("does not claim one fill for competing indistinguishable orders", () => {
		const existing = [...order("a"), ...order("b")];
		const incoming = fills();
		const result = reconcileReportKinds(existing, incoming);
		expect(result.supersede).toEqual([]);
		expect(result.ambiguous).toHaveLength(2);
		expect(result.ambiguous[0]?.candidates).toEqual(
			existing.map((tx) => tx.id).sort(),
		);
	});
	it("does not match another asset, side or execution window", () => {
		const existing = order();
		for (const update of [
			{ assetIn: "ETH" },
			{ timestamp: "2026-04-01T05:00:00.000Z" },
			{ assetOut: "BTC", assetIn: "USDT" },
		]) {
			const incoming = fills().map((tx) => ({ ...tx, ...update }));
			expect(reconcileReportKinds(existing, incoming)).toMatchObject({
				insert: incoming,
				supersede: [],
				ambiguous: [],
			});
		}
	});
	it("keeps identical real fills as a multiset and recognizes exact reimports by source/ref", () => {
		const incoming = fills();
		const second = {
			...single(incoming),
			id: single(order()).id,
			sourceRef: "identical-second-fill",
		};
		const result = reconcileReportKinds([], [single(incoming), second]);
		expect(result.insert).toHaveLength(2);
		expect(reconcileReportKinds(incoming, incoming).duplicates).toHaveLength(2);
	});
	it("uses existing fills plus later incoming fills to complete an order", () => {
		const aggregated = order();
		const incoming = fills();
		const result = reconcileReportKinds(
			[...aggregated, single(incoming)],
			incoming.slice(1),
		);
		expect(result.supersede).toEqual([
			{
				existingId: aggregated[0]?.id,
				byIncomingRefs: [incoming[1]?.sourceRef],
			},
		]);
	});
	it("is deterministic under input permutations and never mutates inputs", () => {
		const existing = order();
		const incoming = fills();
		const before = JSON.stringify([existing, incoming]);
		const result = reconcileReportKinds(existing, incoming);
		expect(
			reconcileReportKinds([...existing].reverse(), [...incoming].reverse()),
		).toEqual(result);
		expect(JSON.stringify([existing, incoming])).toBe(before);
	});
	it("joins CoinDCX Spot Orders by Order ID while leaving Instant Orders separate", () => {
		const existing = parse("coindcx", [
			[
				"Order ID",
				"Market",
				"Pair",
				"Total Quantity",
				"Remaining Quantity",
				"Price Per Unit",
				"Avg Price",
				"Fee Amount",
				"Total Tds INR",
				"Side",
				"Order Type",
				"Status",
				"Exchange Code",
				"Created At",
				"Updated At",
			],
			[
				"synthetic-id",
				"BTCINR",
				"I-BTC_INR",
				"1",
				"0",
				"100",
				"100",
				"1",
				"1",
				"sell",
				"limit_order",
				"filled",
				"I",
				"2026-04-01 00:00:00 UTC",
				"2026-04-01 00:01:00 UTC",
			],
		]);
		const incoming = parse(
			"coindcx",
			[
				[
					"Order ID",
					"Trade ID",
					"Crypto Pair",
					"Base currency",
					"Trade Completion time",
					"Side (Buy/Sell)",
					"Quantity",
					"Gross Amount Paid/Received by the user(in base currency)",
					"Avg Buying/Selling Price(in base currency)",
				],
				[
					"synthetic-id",
					"fill-1",
					"BTCINR",
					"INR",
					"2026-04-01 00:00:10",
					"Sell",
					"0.4",
					"40",
					"100",
				],
				[
					"synthetic-id",
					"fill-2",
					"BTCINR",
					"INR",
					"2026-04-01 00:00:50",
					"Sell",
					"0.6",
					"60",
					"100",
				],
			],
			"coindcx.xlsx",
		);
		expect(incoming).toHaveLength(2);
		expect(reconcileReportKinds(existing, incoming).supersede).toEqual([
			{ existingId: existing[0]?.id, byIncomingRefs: ["fill-1", "fill-2"] },
		]);
		expect(reconcileReportKinds(incoming, existing).insert).toEqual([]);
		const instant = parse("coindcx", [
			[
				"Trade ID",
				"Trade Completion time",
				"Side (Buy/Sell)",
				"Crypto",
				"Quantity",
				"Gross Amount Paid/Received by the user(in INR)",
				"Avg Buying/Selling Price(in INR)",
			],
			["instant-id", "2026-04-01 00:00:10", "Sell", "BTC", "1", "100", "100"],
		]);
		expect(reconcileReportKinds(existing, instant)).toMatchObject({
			insert: instant,
			supersede: [],
			ambiguous: [],
		});
	});
	it("supersedes statement transfers with dedicated history in either import order, preserving income and other periods", () => {
		const dedicated = parse(
			"binance",
			[
				[
					"Date(UTC+0)",
					"Coin",
					"Network",
					"Amount",
					"Address",
					"TXID",
					"Status",
				],
				[
					"2026-04-01 04:30:10",
					"ETH",
					"ETH",
					"1",
					"synthetic",
					"synthetic-hash",
					"Completed",
				],
			],
			"deposits.xlsx",
		);
		const supplemental = statement("Deposit", "ETH", "1");
		expect(reconcileReportKinds(supplemental, dedicated).supersede).toEqual([
			{
				existingId: supplemental[0]?.id,
				byIncomingRefs: [dedicated[0]?.sourceRef],
			},
		]);
		expect(reconcileReportKinds(dedicated, supplemental)).toMatchObject({
			insert: [],
			duplicates: [
				{
					incomingRef: supplemental[0]?.sourceRef,
					existingId: dedicated[0]?.id,
				},
			],
		});
		const unrelated = [
			...statement("Deposit", "ETH", "1", "2026-03-01 00:00:00"),
			...statement("Savings Interest", "ETH", "1"),
		];
		expect(reconcileReportKinds(dedicated, unrelated).insert).toHaveLength(2);
	});
	it("reports overlapping mismatches instead of silently suppressing statement rows", () => {
		const dedicated = parse(
			"binance",
			[
				[
					"Date(UTC+0)",
					"Coin",
					"Network",
					"Amount",
					"Address",
					"TXID",
					"Status",
				],
				[
					"2026-04-01 04:30:10",
					"ETH",
					"ETH",
					"1",
					"synthetic",
					"synthetic-hash",
					"Completed",
				],
			],
			"deposits.xlsx",
		);
		const supplemental = statement("Deposit", "ETH", "2");
		expect(reconcileReportKinds(dedicated, supplemental)).toMatchObject({
			insert: supplemental,
			duplicates: [],
			ambiguous: [
				{
					incomingRef: supplemental[0]?.sourceRef,
					candidates: [dedicated[0]?.id],
				},
			],
		});
	});
});

it("reconciles statement withdrawal totals including the separately exported network fee", () => {
	const dedicated = parse(
		"binance",
		[
			[
				"Date(UTC+0)",
				"Coin",
				"Network",
				"Amount",
				"Fee",
				"Address",
				"TXID",
				"Status",
			],
			[
				"2026-04-01 04:30:10",
				"ETH",
				"ETH",
				"1",
				"0.01",
				"synthetic",
				"synthetic-hash",
				"Completed",
			],
		],
		"withdrawals.xlsx",
	);
	const supplemental = statement("Withdraw", "ETH", "-1.01");
	expect(reconcileReportKinds(supplemental, dedicated).supersede).toHaveLength(
		1,
	);
	expect(reconcileReportKinds(dedicated, supplemental).insert).toEqual([]);
});

it("supersedes a reconstructed statement trade with its fee-bearing fill in either direction", () => {
	const supplemental = parse(
		"binance",
		[
			[
				"User_ID",
				"UTC_Time",
				"Account",
				"Operation",
				"Coin",
				"Change",
				"Remark",
			],
			[
				"synthetic",
				"2026-04-01 04:30:10",
				"Spot",
				"Transaction Buy",
				"BTC",
				"0.4",
				"",
			],
			[
				"synthetic",
				"2026-04-01 04:30:10",
				"Spot",
				"Transaction Spend",
				"USDT",
				"-40",
				"",
			],
		],
		"statement.xlsx",
	);
	const dedicated = [single(fills())];
	expect(reconcileReportKinds(supplemental, dedicated).supersede).toHaveLength(
		1,
	);
	expect(reconcileReportKinds(dedicated, supplemental).insert).toEqual([]);
	const together = reconcileReportKinds([], [...supplemental, ...dedicated]);
	expect(together.insert).toEqual(dedicated);
	expect(together.duplicates).toHaveLength(1);
});

it("keeps competing identical statement events ambiguous instead of choosing a row to supersede", () => {
	const first = single(statement("Deposit", "ETH", "1"));
	const second = {
		...first,
		id: single(order()).id,
		sourceRef: "second-statement-event",
	};
	const dedicated = parse(
		"binance",
		[
			["Date(UTC+0)", "Coin", "Network", "Amount", "Address", "TXID", "Status"],
			[
				"2026-04-01 04:30:10",
				"ETH",
				"ETH",
				"1",
				"synthetic",
				"synthetic-hash",
				"Completed",
			],
		],
		"deposits.xlsx",
	);
	const result = reconcileReportKinds([first, second], dedicated);
	expect(result.supersede).toEqual([]);
	expect(result.ambiguous).toEqual([
		{
			incomingRef: dedicated[0]?.sourceRef,
			candidates: [first.id, second.id].sort(),
		},
	]);
});
