import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	allTx,
	api,
	call,
	compute,
	fixture,
	importOk,
	ok,
	putSettings,
	wipe,
} from "./lib";

beforeEach(wipe);
afterAll(wipe);

describe("SBI TT rate lookup (docs/research/libraries.md, packages/rates)", () => {
	it("USDT trades valued with sbi_usd_tt: same compute twice → byte-identical report", async () => {
		ok(
			await putSettings({ usdtInrRate: "sbi_usd_tt" }),
			200,
			api.PutSettingsResponseSchema,
		);
		await importOk(fixture("binance-trade-history.csv"), "t.csv", {
			source: "binance",
			timezone: "UTC",
		});
		const a = await call("POST", "/api/reports/2025-26/compute");
		const b = await call("POST", "/api/reports/2025-26/compute");
		ok(a, 200, api.ComputeReportResponseSchema);
		expect(b.text).toBe(a.text);
	});

	it("every FX valuation uses a published rate dated on or before the trade", async () => {
		ok(
			await putSettings({ usdtInrRate: "sbi_usd_tt" }),
			200,
			api.PutSettingsResponseSchema,
		);
		await importOk(fixture("binance-trade-history.csv"), "t.csv", {
			source: "binance",
			timezone: "UTC",
		});
		const r = await compute("2025-26");
		const ledger = new Map(r.ledger.map((t) => [t.id, t]));
		const fx = r.valuations.filter((v) => v.fx);
		expect(fx.length).toBeGreaterThan(0);
		for (const v of fx) {
			const tx = ledger.get(v.txId);
			const istDate = new Date(Date.parse(tx?.timestamp ?? "") + 330 * 60_000)
				.toISOString()
				.slice(0, 10);
			expect(v.fx?.rateDate <= istDate, `${v.fx?.rateDate} > ${istDate}`).toBe(
				true,
			);
			expect(Number(v.fx?.rate)).toBeGreaterThan(50);
			expect(v.inrRateSource).toBe("trade_usdt_x_usd_inr");
		}
	});

	it("recompute after re-import of the same file gives the same totals", async () => {
		await importOk(fixture("binance-trade-history.csv"), "t.csv", {
			source: "binance",
			timezone: "UTC",
		});
		const a = await compute("2025-26");
		await importOk(fixture("binance-trade-history.csv"), "t.csv", {
			source: "binance",
			timezone: "UTC",
		});
		const b = await compute("2025-26");
		expect(b.totals).toEqual(a.totals);
		expect(b.generatedFrom.txCount).toBe(a.generatedFrom.txCount);
	});
});

describe("CoinDCX TDS columns (docs/research/export-formats.md B3/B4)", () => {
	it("TDS from the trade sheets becomes the report's TDS credit, per year", async () => {
		await importOk(fixture("coindcx-report.xlsx"), "c.xlsx", {
			source: "coindcx",
			timezone: "IST",
		});
		const a = await compute("2025-26");
		const cdx = a.tds.bySource.find((s) => s.source === "coindcx");
		expect(cdx).toMatchObject({ deductedByPlatform: true, tdsInr: "404.49" });
		expect(a.totals.tdsCredit).toBe("404.49");
		const b = await compute("2026-27");
		expect(b.totals.tdsCredit).toBe("161.05");
	});

	it("crypto-quoted (USDT pair) buy carries TDS 72.18 even though it is a buy", async () => {
		await importOk(fixture("coindcx-report.xlsx"), "c.xlsx", {
			source: "coindcx",
			timezone: "IST",
		});
		const tx = (await allTx({ source: "coindcx" })).find(
			(t) => t.assetIn === "ETH",
		);
		expect(tx?.tdsInr).toBe("72.18");
	});
});

describe("Binance overlap and identical rows (export-formats.md A8)", () => {
	it("statement after the dedicated histories adds only what they cannot give (income)", async () => {
		await importOk(fixture("binance-trade-history.csv"), "t.csv", {
			source: "binance",
			timezone: "UTC",
		});
		await importOk(fixture("binance-deposits.csv"), "d.csv", {
			source: "binance",
			timezone: "UTC",
		});
		await importOk(fixture("binance-withdrawals.csv"), "w.csv", {
			source: "binance",
			timezone: "UTC",
		});
		const st = await importOk(
			fixture("binance-transaction-statement.csv"),
			"s.csv",
			{ source: "binance", timezone: "UTC" },
		);
		const txs = await allTx();
		expect(txs.length).toBe(11 + st.rowsInserted);
		for (const t of txs.filter((x) => x.importId === st.id))
			expect(["income"]).toContain(t.type);
	});

	it("both identical ETH sells become separate disposals in the report", async () => {
		await importOk(fixture("binance-trade-history.csv"), "t.csv", {
			source: "binance",
			timezone: "UTC",
		});
		const r = await compute("2026-27");
		const eth = r.scheduleVdaRows.filter(
			(x) => x.asset === "ETH" && x.dateOfTransfer === "2026-05-10",
		);
		const disposals = new Set(eth.map((x) => x.trail.disposalTxId));
		expect(disposals.size).toBe(2);
	});
});
