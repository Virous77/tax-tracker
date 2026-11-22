import { D, EngineSettingsSchema, type LedgerTx } from "@tax/core";
import { loadRules } from "@tax/rules";
import { describe, expect, test } from "vitest";
import {
	computeVdaReport,
	LotBook,
	matchTransfers,
	valueTransaction,
} from "../src/index.js";

const settings = EngineSettingsSchema.parse({});
function tx(n: number, fields: Partial<LedgerTx>): LedgerTx {
	return {
		id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
		source: "coindcx",
		sourceRef: String(n),
		importId: null,
		timestamp: `2026-04-${String(n).padStart(2, "0")}T00:00:00Z`,
		type: "buy",
		raw: { n },
		reviewFlags: [],
		...fields,
	};
}
const buy = tx(1, { assetIn: "ETH", amountIn: "1", inrValue: "100" });
function compute(
	transactions: LedgerTx[],
	overrides: Record<string, unknown> = {},
) {
	return computeVdaReport({
		transactions,
		settings: EngineSettingsSchema.parse(overrides),
		rules: loadRules("india-vda", "2026-27"),
		taxYear: "2026-27",
		fx: () => null,
	});
}
describe("matching", () => {
	test("inclusive tolerance and window; each deposit used once", () => {
		const a = tx(1, { type: "withdrawal", assetOut: "ETH", amountOut: "1" });
		const b = tx(2, {
			type: "deposit",
			source: "wallet",
			assetIn: "ETH",
			amountIn: "0.99",
			timestamp: "2026-04-04T00:00:00Z",
		});
		expect(matchTransfers([b, a], settings)).toHaveLength(1);
		expect(
			matchTransfers([a, { ...b, amountIn: "0.989" }], settings),
		).toHaveLength(0);
		expect(
			matchTransfers(
				[a, { ...b, timestamp: "2026-04-04T00:00:01Z" }],
				settings,
			),
		).toHaveLength(0);
		expect(
			matchTransfers(
				[a, { ...a, id: "other", sourceRef: "other" }, b],
				settings,
			),
		).toHaveLength(1);
	});
	test("same-source and earlier deposits do not match", () => {
		const a = tx(2, { type: "withdrawal", assetOut: "ETH", amountOut: "1" });
		expect(
			matchTransfers(
				[
					a,
					tx(1, {
						type: "deposit",
						source: "wallet",
						assetIn: "ETH",
						amountIn: "1",
					}),
				],
				settings,
			),
		).toEqual([]);
	});
});
describe("valuation", () => {
	test("manual INR outranks price and FX; ledger price outranks FX", () => {
		expect(
			valueTransaction(
				{ ...buy, priceQuote: { asset: "USDT", price: "5" } },
				settings,
				() => {
					throw new Error("not called");
				},
				null,
			).valueInr,
		).toBe("100");
		const sell = tx(2, {
			type: "sell",
			assetOut: "ETH",
			amountOut: "2",
			priceQuote: { asset: "USDT", price: "100" },
		});
		expect(
			valueTransaction(
				sell,
				settings,
				() => ({ rate: "80", rateDate: "2026-04-01", source: "test" }),
				{ rate: "82", txId: buy.id, timestamp: buy.timestamp },
			).valueInr,
		).toBe("16400");
	});
	test.each(["trade quote", "cached price"])(
		"uses only fresh ledger USDT rates for a %s",
		(path) => {
			const sale = tx(2, {
				type: "sell",
				assetOut: "ETH",
				amountOut: "2",
				timestamp: "2026-06-23T00:00:00.000Z",
				...(path === "trade quote"
					? { priceQuote: { asset: "USDT", price: "100" } }
					: {}),
			});
			for (const [timestamp, fresh] of [
				["2026-06-18T00:00:00.000Z", true],
				["2026-06-09T00:00:00.000Z", true],
				["2026-06-08T23:59:59.999Z", false],
				["2025-10-11T00:00:00.000Z", false],
				["2026-06-23T00:00:00.001Z", false],
			] as const) {
				const result = valueTransaction(
					sale,
					settings,
					(currency, date) =>
						currency === "USD"
							? { rate: "93", rateDate: date, source: "SBI TT buying" }
							: null,
					{ rate: "95.90", txId: buy.id, timestamp },
					(_asset, date, kind) => ({
						price: "100",
						quote: "USDT",
						source: "binance_klines",
						sourceId: "ETHUSDT",
						date,
						kind,
					}),
				);
				expect(result, timestamp).toMatchObject({
					valueInr: fresh ? "19180" : "18600",
					inrRateSource:
						path === "trade quote"
							? "trade_usdt_x_usd_inr"
							: "market_price_cache",
					fx: {
						rate: fresh ? "95.90" : "93",
						source: fresh ? "ledger stablecoin/INR" : "SBI TT buying",
						...(!fresh ? { rateDate: "2026-06-23" } : {}),
					},
				});
			}
		},
	);
	test("missing disposal value is excluded", () => {
		const report = compute([
			buy,
			tx(2, { type: "sell", assetOut: "ETH", amountOut: "1" }),
		]);
		expect(report.totals.taxableIncome).toBe("0.00");
		expect(report.unresolved[0]?.reason).toBe("missing_inr_value");
		expect(report.scheduleVdaRows[0]?.income).toBeNull();
	});
});
describe("lots and unresolved history", () => {
	test("proportional cost persists across repeated partial consumption", () => {
		const book = new LotBook();
		book.add({
			asset: "ETH",
			qty: D("3"),
			costInr: D("100"),
			acquiredAt: buy.timestamp,
			txId: buy.id,
			pool: "global",
			order: 0,
			trailTxIds: [buy.id],
		});
		const slices = [
			...book.consume("ETH", "global", "1"),
			...book.consume("ETH", "global", "2"),
		];
		expect(
			slices.reduce((sum, s) => sum.plus(s.costInr ?? "0"), D("0")).toFixed(2),
		).toBe("100.00");
	});
	test("partial missing history excludes only uncovered quantity", () => {
		const report = compute([
			buy,
			tx(2, { type: "sell", assetOut: "ETH", amountOut: "2", inrValue: "400" }),
		]);
		expect(report.scheduleVdaRows).toHaveLength(2);
		expect(report.totals.consideration).toBe("200.00");
		expect(report.totals.taxableIncome).toBe("100.00");
		expect(report.unresolved).toEqual([
			{
				txId: report.scheduleVdaRows[0]?.trail.disposalTxId,
				asset: "ETH",
				quantity: "1",
				reason: "missing_history",
			},
		]);
	});
	test("unmatched deposits and gifts never invent a zero basis", () => {
		for (const type of ["deposit", "gift"] as const) {
			const report = compute([
				tx(1, { type, assetIn: "ETH", amountIn: "1", inrValue: "100" }),
				tx(2, {
					type: "sell",
					assetOut: "ETH",
					amountOut: "1",
					inrValue: "200",
				}),
			]);
			expect(report.totals.taxableIncome).toBe("0.00");
			expect(report.unresolved[0]?.reason).toBe("missing_history");
		}
	});
	test("acquisition missing valuation propagates until disposal", () => {
		const report = compute([
			tx(1, { assetIn: "ETH", amountIn: "1", assetOut: "BTC", amountOut: "1" }),
			tx(2, { type: "sell", assetOut: "ETH", amountOut: "1", inrValue: "200" }),
		]);
		expect(report.scheduleVdaRows.at(-1)?.costOfAcquisition).toBeNull();
		expect(report.totals.taxableIncome).toBe("0.00");
	});
	test("crypto-funded buy disposes USDT as a VDA", () => {
		const report = compute([
			tx(1, {
				assetIn: "USDT",
				amountIn: "100",
				assetOut: "INR",
				amountOut: "8000",
			}),
			tx(2, {
				assetIn: "ETH",
				amountIn: "1",
				assetOut: "USDT",
				amountOut: "100",
				inrValue: "8500",
			}),
		]);
		expect(report.scheduleVdaRows[0]?.asset).toBe("USDT");
		expect(report.totals.taxableIncome).toBe("500.00");
	});
	test("TDS credit can exceed tax and is not clamped", () => {
		const report = compute([
			buy,
			tx(2, {
				type: "sell",
				assetOut: "ETH",
				amountOut: "1",
				inrValue: "100",
				tdsInr: "1",
			}),
		]);
		expect(report.totals.netPayable).toBe("-1.00");
	});
	test("duplicate ledger keys and mismatched rule years fail at boundary", () => {
		expect(() => compute([buy, buy])).toThrow("Duplicate");
		expect(() =>
			computeVdaReport({
				transactions: [],
				rules: loadRules("india-vda", "2025-26"),
				settings,
				taxYear: "2026-27",
				fx: () => null,
			}),
		).toThrow("Rule period");
	});
});

describe("fee and transfer edge cases", () => {
	test("fee FX and GST are recorded in valuation provenance", () => {
		const rows = [
			tx(1, { assetIn: "USDT", amountIn: "10", inrValue: "800" }),
			tx(2, {
				assetIn: "ETH",
				amountIn: "1",
				inrValue: "1000",
				feeAsset: "USDT",
				feeAmount: "1",
				gstInr: "2",
			}),
		];
		const report = compute(rows, { feeTreatment: "include" });
		expect(report.valuations[1]?.fee).toMatchObject({
			valueInr: "82.00",
			rateTxId: rows[0]?.id,
			fx: { rate: "80", rateDate: "2026-04-01" },
		});
		const sale = compute(
			[
				...rows,
				tx(3, {
					type: "sell",
					assetOut: "ETH",
					amountOut: "1",
					inrValue: "1200",
				}),
			],
			{ feeTreatment: "include" },
		);
		expect(sale.totals.cost).toBe("1082.00");
	});
	test("unknown third-coin fee makes the affected leg unresolved", () => {
		const report = compute(
			[
				buy,
				tx(2, {
					type: "sell",
					assetOut: "ETH",
					amountOut: "1",
					inrValue: "150",
					feeAsset: "BNB",
					feeAmount: "0.1",
				}),
			],
			{ feeTreatment: "include" },
		);
		expect(report.totals.totalTax).toBe("0.00");
		expect(report.scheduleVdaRows[0]?.considerationReceived).toBeNull();
		expect(report.unresolved[0]?.reason).toBe("missing_inr_value");
	});
	test("network fee metadata does not duplicate the matched amount difference", () => {
		const rows = [
			buy,
			tx(2, {
				type: "withdrawal",
				assetOut: "ETH",
				amountOut: "1",
				feeAsset: "ETH",
				feeAmount: "0.01",
			}),
			tx(3, {
				type: "deposit",
				source: "wallet",
				assetIn: "ETH",
				amountIn: "0.99",
			}),
			tx(4, {
				type: "sell",
				source: "wallet",
				assetOut: "ETH",
				amountOut: "0.99",
				inrValue: "150",
			}),
		];
		const report = compute(rows, { lotPool: "per_source" });
		expect(report.balances.map((b) => b.computed)).toEqual(["0", "0"]);
		expect(report.unresolved).toEqual([]);
		expect(report.totals.cost).toBe("99.00");
		expect(report.totals.taxableIncome).toBe("51.00");
	});
	test("transferred older lots return ahead of newer local lots", () => {
		const report = compute(
			[
				buy,
				tx(2, { type: "withdrawal", assetOut: "ETH", amountOut: "1" }),
				tx(3, {
					assetIn: "ETH",
					amountIn: "1",
					inrValue: "200",
					source: "wallet",
				}),
				tx(4, {
					type: "deposit",
					assetIn: "ETH",
					amountIn: "1",
					source: "wallet",
				}),
				tx(5, {
					type: "sell",
					assetOut: "ETH",
					amountOut: "1",
					inrValue: "300",
					source: "wallet",
				}),
			],
			{ lotPool: "per_source" },
		);
		expect(report.scheduleVdaRows[0]?.costOfAcquisition).toBe("100.00");
		expect(
			report.scheduleVdaRows[0]?.trail.rawRefs.map((r) => r.sourceRef),
		).toEqual(["1", "2", "4", "5"]);
	});
	test("same-timestamp transfers need review instead of losing in-transit lots", () => {
		const report = compute(
			[
				buy,
				tx(2, { type: "withdrawal", assetOut: "ETH", amountOut: "1" }),
				tx(3, {
					timestamp: "2026-04-02T00:00:00Z",
					type: "deposit",
					assetIn: "ETH",
					amountIn: "1",
					source: "aaa-wallet",
				}),
				tx(4, {
					type: "sell",
					assetOut: "ETH",
					amountOut: "1",
					inrValue: "200",
					source: "aaa-wallet",
				}),
			],
			{ lotPool: "per_source" },
		);
		expect(report.unresolved[0]?.reason).toBe("missing_history");
		expect(report.scheduleVdaRows[0]?.dateOfAcquisition).toBeNull();
	});
	test("FMV income basis stays unknown when FMV is missing", () => {
		const report = compute(
			[
				tx(1, {
					type: "income",
					incomeKind: "staking",
					assetIn: "ETH",
					amountIn: "1",
				}),
				tx(2, {
					type: "sell",
					assetOut: "ETH",
					amountOut: "1",
					inrValue: "200",
				}),
			],
			{ incomeCostBasis: "fmv_at_receipt" },
		);
		expect(report.income.rows[0]?.fmvInr).toBeNull();
		expect(report.totals.taxableIncome).toBe("0.00");
		expect(report.unresolved[0]?.reason).toBe("missing_inr_value");
	});
});
test("FX lookup rejects invalid or future publication rates at the boundary", () => {
	const row = tx(1, {
		assetIn: "ETH",
		amountIn: "1",
		assetOut: "USDT",
		amountOut: "100",
	});
	for (const rate of [
		{ rate: "-1", rateDate: "2026-03-31", source: "test" },
		{ rate: "80", rateDate: "2026-04-02", source: "test" },
	])
		expect(() =>
			computeVdaReport({
				transactions: [row],
				settings,
				rules: loadRules("india-vda", "2026-27"),
				taxYear: "2026-27",
				fx: () => rate,
			}),
		).toThrow();
});
test("aggregate TDS threshold uses gross transfers across all sources", () => {
	const report = compute([
		buy,
		tx(2, { type: "sell", assetOut: "ETH", amountOut: "1", inrValue: "6000" }),
		tx(3, {
			assetIn: "BTC",
			amountIn: "1",
			inrValue: "100",
			source: "binance",
		}),
		tx(4, {
			type: "sell",
			assetOut: "BTC",
			amountOut: "1",
			inrValue: "5000",
			source: "binance",
		}),
	]);
	expect(
		report.tds.bySource.find((r) => r.source === "binance")?.possiblyDueInr,
	).toBe("50.00");
});

test("TDS includes manual disposals and credits but skips an ordinary manual buy", () => {
	const manualBuy = { ...buy, source: "manual" };
	const sale = tx(2, {
		type: "sell",
		source: "manual",
		assetOut: "ETH",
		amountOut: "1",
		inrValue: "120",
	});
	expect(compute([manualBuy]).tds).toEqual({ bySource: [], checklist: [] });

	const withSale = compute([manualBuy, sale]).tds;
	expect(withSale.bySource).toMatchObject([
		{ source: "manual", transferValueInr: "120.00", txIds: [sale.id] },
	]);
	expect(withSale.checklist).toEqual([expect.stringContaining("manual:")]);

	const withCredit = compute([{ ...manualBuy, tdsInr: "2" }]).tds;
	expect(withCredit.bySource).toMatchObject([
		{ source: "manual", tdsInr: "2.00", txIds: [manualBuy.id] },
	]);
	expect(withCredit.checklist).toEqual([
		expect.stringContaining("manual: match ledger TDS 2.00"),
	]);
});

test("unmatched later deposits do not leapfrog a known older FIFO lot", () => {
	const report = compute([
		buy,
		tx(2, { type: "deposit", assetIn: "ETH", amountIn: "1", source: "wallet" }),
		tx(3, { type: "sell", assetOut: "ETH", amountOut: "1", inrValue: "200" }),
	]);
	expect(report.totals.taxableIncome).toBe("100.00");
	expect(report.unresolved).toEqual([]);
});
test("ambiguous transfer candidates are visible for review", () => {
	const report = compute([
		buy,
		tx(2, { type: "withdrawal", assetOut: "ETH", amountOut: "1" }),
		tx(3, {
			type: "deposit",
			assetIn: "ETH",
			amountIn: "1",
			source: "wallet-a",
		}),
		tx(4, {
			type: "deposit",
			assetIn: "ETH",
			amountIn: "1",
			source: "wallet-b",
		}),
	]);
	expect(
		report.warnings.some((f) =>
			f.message.includes("Multiple possible transfer pairs"),
		),
	).toBe(true);
});
