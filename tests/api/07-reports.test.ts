import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	addManual,
	api,
	call,
	compute,
	csv,
	fail,
	importOk,
	ok,
	putSettings,
	wipe,
} from "./lib";

import { parseCsv, unzip, xmlText } from "./zip";

beforeEach(wipe);
afterAll(wipe);

const getReport = (year: string) => call("GET", `/api/reports/${year}`);
const buy = (
	ts: string,
	asset: string,
	qty: string,
	inr: string,
	extra: Record<string, unknown> = {},
) =>
	addManual({
		timestamp: ts,
		type: "buy",
		assetIn: asset,
		amountIn: qty,
		inrValue: inr,
		...extra,
	});
const sell = (
	ts: string,
	asset: string,
	qty: string,
	inr: string,
	extra: Record<string, unknown> = {},
) =>
	addManual({
		timestamp: ts,
		type: "sell",
		assetOut: asset,
		amountOut: qty,
		inrValue: inr,
		...extra,
	});

describe("report lifecycle", () => {
	it("GET before compute → 404", async () => {
		fail(await getReport("2026-27"), 404, "not_found");
		fail(await getReport("2025-26"), 404, "not_found");
	});

	it("compute stores the report; GET returns the same report", async () => {
		await buy("2026-04-01T06:00:00.000Z", "ETH", "1", "200000");
		const r = await compute("2026-27");
		const g = ok(await getReport("2026-27"), 200, api.GetReportResponseSchema);
		expect(g).toEqual(r);
	});

	it("an empty ledger computes to zeros for both years", async () => {
		for (const year of ["2025-26", "2026-27"]) {
			const r = await compute(year);
			expect(r.totals).toMatchObject({
				taxableIncome: "0.00",
				totalTax: "0.00",
				netPayable: "0.00",
			});
			expect(r.scheduleVdaRows).toEqual([]);
			expect(r.disclaimer.length).toBeGreaterThan(10);
		}
	});

	it.each(["1999", "2026", "abc"])("invalid tax year %s → 400", async (y) => {
		fail(
			await call("POST", `/api/reports/${y}/compute`),
			400,
			"validation_error",
		);
		fail(await getReport(y), 400, "validation_error");
	});

	it("a tax year with no rule file is a clean 4xx, not a 500", async () => {
		const res = await call("POST", "/api/reports/2030-31/compute");
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	it("compute with a body is rejected (contract says empty)", async () => {
		fail(
			await call("POST", "/api/reports/2026-27/compute", {
				json: { force: true },
			}),
			400,
		);
	});

	it("rule labels: 2025-26 uses the 1961 Act, 2026-27 the 2025 Act; sections unverified", async () => {
		const a = await compute("2025-26");
		const b = await compute("2026-27");
		expect(a.act).toBe("Income-tax Act, 1961");
		expect(a.sections.vdaTax).toBe("Section 115BBH");
		expect(a.sections.vdaTds).toBe("Section 194S");
		expect(b.act).toBe("Income-tax Act, 2025");
		expect(b.sections.vdaTax).toBe("Section 194, table serial 4");
		expect(a.sectionsVerified).toBe(false);
		expect(b.sectionsVerified).toBe(false);
	});

	it("a data change invalidates the stored report", async () => {
		await buy("2026-04-01T06:00:00.000Z", "ETH", "1", "200000");
		await compute("2026-27");
		await sell("2026-04-02T06:00:00.000Z", "ETH", "1", "250000");
		fail(await getReport("2026-27"), 404);
	});

	it("a settings change invalidates the stored report", async () => {
		await compute("2026-27");
		ok(
			await putSettings({ surchargeRate: "0.10" }),
			200,
			api.PutSettingsResponseSchema,
		);
		fail(await getReport("2026-27"), 404);
	});
});

describe("golden cases through the API", () => {
	it("01 worked example: tax 15,600, TDS 2,500, net 13,100", async () => {
		await buy("2026-04-01T06:00:00.000Z", "ETH", "1", "200000");
		await sell("2026-04-02T06:00:00.000Z", "ETH", "1", "250000", {
			tdsInr: "2500",
		});
		const r = await compute("2026-27");
		expect(r.totals).toEqual({
			consideration: "250000.00",
			cost: "200000.00",
			taxableIncome: "50000.00",
			lossesNotSetOff: "0.00",
			baseTax: "15000.00",
			surcharge: "0.00",
			cess: "600.00",
			totalTax: "15600.00",
			totalTaxRounded: "15600",
			tdsCredit: "2500.00",
			netPayable: "13100.00",
		});
		expect(r.scheduleVdaRows).toHaveLength(1);
		expect(r.scheduleVdaRows[0]).toMatchObject({
			asset: "ETH",
			quantity: "1",
			costOfAcquisition: "200000.00",
			considerationReceived: "250000.00",
			income: "50000.00",
			loss: "0.00",
			dateOfAcquisition: "2026-04-01",
			dateOfTransfer: "2026-04-02",
			headOfIncome: "capital_gains",
		});
		expect(r.generatedFrom.txCount).toBe(2);
	});

	it("02 loss on another coin is shown but not set off", async () => {
		await buy("2026-04-01T06:00:00.000Z", "ETH", "1", "200000");
		await sell("2026-04-02T06:00:00.000Z", "ETH", "1", "250000", {
			tdsInr: "2500",
		});
		await buy("2026-04-03T06:00:00.000Z", "BTC", "1", "80000");
		await sell("2026-04-04T06:00:00.000Z", "BTC", "1", "50000");
		const r = await compute("2026-27");
		expect(r.totals).toMatchObject({
			consideration: "300000.00",
			cost: "280000.00",
			taxableIncome: "50000.00",
			lossesNotSetOff: "30000.00",
			totalTax: "15600.00",
			netPayable: "13100.00",
		});
	});

	it("04 swap BTC→ETH then sell ETH: tax 31.20", async () => {
		await buy("2026-04-01T06:00:00.000Z", "BTC", "1", "100");
		await addManual({
			timestamp: "2026-04-02T06:00:00.000Z",
			type: "swap",
			assetOut: "BTC",
			amountOut: "1",
			assetIn: "ETH",
			amountIn: "2",
			inrValue: "150",
		});
		await sell("2026-04-03T06:00:00.000Z", "ETH", "2", "200");
		const r = await compute("2026-27");
		expect(r.totals).toMatchObject({
			consideration: "350.00",
			cost: "250.00",
			taxableIncome: "100.00",
			baseTax: "30.00",
			cess: "1.20",
			totalTax: "31.20",
			totalTaxRounded: "31",
		});
		expect(
			r.scheduleVdaRows.map((x) => [
				x.asset,
				x.costOfAcquisition,
				x.considerationReceived,
			]),
		).toEqual([
			["BTC", "100.00", "150.00"],
			["ETH", "150.00", "200.00"],
		]);
	});

	it("06 fee exclude → 156; switch to include → recompute → 144.96 (145)", async () => {
		await buy("2026-04-01T06:00:00.000Z", "ETH", "1", "1000", {
			feeAsset: "INR",
			feeAmount: "10",
			gstInr: "1.8",
		});
		await sell("2026-04-02T06:00:00.000Z", "ETH", "1", "1500", {
			feeAsset: "INR",
			feeAmount: "20",
			gstInr: "3.6",
		});
		const ex = await compute("2026-27");
		expect(ex.totals).toMatchObject({
			consideration: "1500.00",
			cost: "1000.00",
			taxableIncome: "500.00",
			totalTax: "156.00",
			totalTaxRounded: "156",
		});
		expect(ex.generatedFrom.settings.feeTreatment).toBe("exclude");
		ok(
			await putSettings({ feeTreatment: "include" }),
			200,
			api.PutSettingsResponseSchema,
		);
		const inc = await compute("2026-27");
		expect(inc.totals).toMatchObject({
			consideration: "1476.40",
			cost: "1011.80",
			taxableIncome: "464.60",
			baseTax: "139.38",
			cess: "5.58",
			totalTax: "144.96",
			totalTaxRounded: "145",
		});
		expect(inc.generatedFrom.settings.feeTreatment).toBe("include");
	});

	it("09 sell with no history: cost null, unresolved, excluded from totals", async () => {
		const tx = await sell("2026-04-01T06:00:00.000Z", "ETH", "1", "100");
		const r = await compute("2026-27");
		expect(r.totals).toMatchObject({
			consideration: "0.00",
			cost: "0.00",
			taxableIncome: "0.00",
			totalTax: "0.00",
			netPayable: "0.00",
		});
		expect(r.scheduleVdaRows).toHaveLength(1);
		expect(r.scheduleVdaRows[0]).toMatchObject({ costOfAcquisition: null });
		expect(r.unresolved).toEqual([
			{ txId: tx.id, asset: "ETH", quantity: "1", reason: "missing_history" },
		]);
		expect(r.balances.find((b) => b.asset === "ETH")?.computed).toBe("-1");
	});

	it("12 IST year boundary: 18:29Z buy in 2025-26, 18:31Z sell in 2026-27, 2027 sale ignored", async () => {
		await buy("2026-03-31T18:29:00.000Z", "ETH", "1", "100");
		await sell("2026-03-31T18:31:00.000Z", "ETH", "1", "150");
		await sell("2027-03-31T18:31:00.000Z", "ETH", "1", "1000");
		const r = await compute("2026-27");
		expect(r.totals).toMatchObject({
			consideration: "150.00",
			cost: "100.00",
			taxableIncome: "50.00",
			totalTax: "15.60",
			totalTaxRounded: "16",
		});
		expect(r.scheduleVdaRows).toHaveLength(1);
		expect(r.scheduleVdaRows[0]).toMatchObject({
			dateOfAcquisition: "2026-03-31",
			dateOfTransfer: "2026-04-01",
		});
		const prev = await compute("2025-26");
		expect(prev.scheduleVdaRows).toEqual([]);
		expect(prev.balances.find((b) => b.asset === "ETH")?.computed).toBe("1");
	});

	it("13 surcharge 15%: total 17,940, net 15,440", async () => {
		ok(
			await putSettings({ surchargeRate: "0.15" }),
			200,
			api.PutSettingsResponseSchema,
		);
		await buy("2026-04-01T06:00:00.000Z", "ETH", "1", "200000");
		await sell("2026-04-02T06:00:00.000Z", "ETH", "1", "250000", {
			tdsInr: "2500",
		});
		const r = await compute("2026-27");
		expect(r.totals).toMatchObject({
			baseTax: "15000.00",
			surcharge: "2250.00",
			cess: "690.00",
			totalTax: "17940.00",
			tdsCredit: "2500.00",
			netPayable: "15440.00",
		});
		expect(r.generatedFrom.settings.surchargeRate).toBe("0.15");
	});

	const binanceInr = csv([
		"Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
		"2026-04-02 06:00:00,ETHINR,SELL,30000,1ETH,30000INR,0INR",
		"2026-04-01 06:00:00,ETHINR,BUY,20000,1ETH,20000INR,0INR",
	]);

	it("14 Binance sell: tds_not_deducted warning, possibly due 300, no credit", async () => {
		await importOk(binanceInr, "binance-inr.csv", {
			source: "binance",
			timezone: "UTC",
		});
		const r = await compute("2026-27");
		expect(r.totals).toMatchObject({
			consideration: "30000.00",
			cost: "20000.00",
			taxableIncome: "10000.00",
			totalTax: "3120.00",
			tdsCredit: "0.00",
			netPayable: "3120.00",
		});
		const bn = r.tds.bySource.find((s) => s.source === "binance");
		expect(bn).toMatchObject({
			deductedByPlatform: false,
			possiblyDueInr: "300.00",
		});
		expect(r.warnings.map((w) => w.code)).toContain("tds_not_deducted");
		expect(r.tds.checklist.length).toBeGreaterThan(0);
	});

	it("14b specified person: possibly due 0, warning still shown", async () => {
		ok(
			await putSettings({ specifiedPerson: true }),
			200,
			api.PutSettingsResponseSchema,
		);
		await importOk(binanceInr, "binance-inr.csv", {
			source: "binance",
			timezone: "UTC",
		});
		const r = await compute("2026-27");
		expect(
			r.tds.bySource.find((s) => s.source === "binance")?.possiblyDueInr,
		).toBe("0.00");
		expect(r.warnings.map((w) => w.code)).toContain("tds_not_deducted");
	});

	it("18 balance mismatch via PUT /api/balances/actual: computed 1.5, actual 1.4, difference -0.1", async () => {
		await buy("2026-04-01T06:00:00.000Z", "ETH", "2", "200");
		await sell("2026-04-02T06:00:00.000Z", "ETH", "0.5", "100");
		const first = await compute("2026-27");
		expect(first.totals).toMatchObject({
			taxableIncome: "50.00",
			totalTax: "15.60",
		});
		const put = ok(
			await call("PUT", "/api/balances/actual?taxYear=2026-27", {
				json: [{ asset: "ETH", amount: "1.4" }],
			}),
			200,
			api.PutActualBalancesResponseSchema,
		);
		expect(put).toEqual([{ asset: "ETH", amount: "1.4" }]);
		expect(
			ok(
				await call("GET", "/api/balances/actual?taxYear=2026-27"),
				200,
				api.ActualBalancesResponseSchema,
			),
		).toEqual([{ asset: "ETH", amount: "1.4" }]);
		fail(await getReport("2026-27"), 404);
		const r = await compute("2026-27");
		expect(r.balances.find((b) => b.asset === "ETH")).toMatchObject({
			computed: "1.5",
			actual: "1.4",
			difference: "-0.1",
		});
		expect(r.warnings.map((w) => w.code)).toContain("balance_mismatch");
		for (const format of ["csv", "xlsx"]) {
			const exported = await call(
				"GET",
				`/api/reports/2026-27/export?format=${format}&kind=full`,
			);
			expect(exported.status).toBe(200);
			if (format === "csv")
				expect(parseCsv(exported.text).flat()).toContain("'-0.1");
			else {
				const files = unzip(exported.bytes);
				const cells = [...files.entries()]
					.filter(([name]) => name.startsWith("xl/worksheets/"))
					.flatMap(([, data]) => xmlText(data.toString("utf8")));
				expect(cells).toContain("-0.1");
			}
		}
	});
});

describe("balances endpoint", () => {
	it("actual balances are stored per tax year", async () => {
		ok(
			await call("PUT", "/api/balances/actual?taxYear=2025-26", {
				json: [
					{ asset: "BTC", amount: "0.5" },
					{ asset: "ETH", amount: "2" },
				],
			}),
			200,
			api.PutActualBalancesResponseSchema,
		);
		expect(
			ok(
				await call("GET", "/api/balances/actual?taxYear=2026-27"),
				200,
				api.ActualBalancesResponseSchema,
			),
		).toEqual([]);
		const got = ok(
			await call("GET", "/api/balances/actual?taxYear=2025-26"),
			200,
			api.ActualBalancesResponseSchema,
		);
		expect(got).toHaveLength(2);
		expect(got).toContainEqual({ asset: "ETH", amount: "2" });
	});

	it("per-source balances need lotPool per_source; global pool rejects them with 400", async () => {
		fail(
			await call("PUT", "/api/balances/actual?taxYear=2026-27", {
				json: [{ asset: "ETH", source: "binance", amount: "2" }],
			}),
			400,
			"validation_error",
		);
		ok(
			await putSettings({ lotPool: "per_source" }),
			200,
			api.PutSettingsResponseSchema,
		);
		const put = ok(
			await call("PUT", "/api/balances/actual?taxYear=2026-27", {
				json: [{ asset: "ETH", source: "binance", amount: "2" }],
			}),
			200,
			api.PutActualBalancesResponseSchema,
		);
		expect(put).toEqual([{ asset: "ETH", source: "binance", amount: "2" }]);
	});

	it("PUT replaces the whole list", async () => {
		await call("PUT", "/api/balances/actual?taxYear=2026-27", {
			json: [{ asset: "BTC", amount: "1" }],
		});
		await call("PUT", "/api/balances/actual?taxYear=2026-27", {
			json: [{ asset: "ETH", amount: "3" }],
		});
		expect(
			ok(
				await call("GET", "/api/balances/actual?taxYear=2026-27"),
				200,
				api.ActualBalancesResponseSchema,
			),
		).toEqual([{ asset: "ETH", amount: "3" }]);
	});

	it.each([
		["missing taxYear", "", [{ asset: "BTC", amount: "1" }]],
		["bad asset", "?taxYear=2026-27", [{ asset: "btc", amount: "1" }]],
		[
			"non-decimal amount",
			"?taxYear=2026-27",
			[{ asset: "BTC", amount: "lots" }],
		],
		["not an array", "?taxYear=2026-27", { asset: "BTC", amount: "1" }],
	])("%s → 400", async (_n, q, body) => {
		fail(
			await call("PUT", `/api/balances/actual${q}`, { json: body }),
			400,
			"validation_error",
		);
	});

	it("GET without taxYear → 400", async () => {
		fail(await call("GET", "/api/balances/actual"), 400, "validation_error");
	});
});
