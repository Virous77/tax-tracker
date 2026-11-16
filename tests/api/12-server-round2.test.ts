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
import { restartStack } from "./stack";

beforeEach(wipe);
afterAll(wipe);
const year = "2026-27";
const review = async (query = "") =>
	ok(await call("GET", `/api/review${query}`), 200, api.ReviewResponseSchema);
const buy = (extra: Record<string, unknown> = {}) =>
	addManual({
		timestamp: "2026-05-01T00:00:00.000Z",
		type: "buy",
		assetIn: "ETH",
		amountIn: "1",
		inrValue: "100",
		...extra,
	});
const balances = (rows: unknown[]) =>
	call("PUT", `/api/balances/actual?taxYear=${year}`, { json: rows });
const binanceBuy = csv([
	"Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
	"2026-05-02 00:00:00,ETHINR,BUY,100,1ETH,100INR,0INR",
]);

describe("per-year report status", () => {
	it("All years identifies exactly which report still needs computing", async () => {
		expect((await review()).computeTaxYears).toEqual(["2025-26", year]);
		await compute(year);
		expect(await review()).toMatchObject({
			reportStatus: "missing",
			reportStatuses: [
				{ taxYear: "2025-26", status: "missing" },
				{ taxYear: year, status: "current" },
			],
			computeTaxYears: ["2025-26"],
		});
		expect(await review(`?taxYear=${year}`)).toMatchObject({
			reportStatus: "current",
			reportStatuses: [{ taxYear: year, status: "current" }],
			computeTaxYears: [],
		});
		await compute("2025-26");
		expect(await review()).toMatchObject({
			reportStatus: "current",
			computeTaxYears: [],
		});
		await buy();
		expect((await review()).computeTaxYears).toEqual(["2025-26", year]);
	});
});

describe("report-derived review problems", () => {
	it("negative fee holdings appear once in Review even without an unresolved disposal", async () => {
		const tx = await buy({ feeAsset: "BNB", feeAmount: "0.01" });
		const report = await compute(year);
		expect(report.unresolved).toEqual([]);
		expect(
			report.warnings.find((w) =>
				w.message.startsWith("Crypto-denominated fee"),
			)?.code,
		).toBe("fee_review_required");
		expect(
			report.warnings.find((w) => w.message.startsWith("Negative BNB")),
		).toMatchObject({
			code: "missing_history",
			asset: "BNB",
			count: 1,
			txIds: [tx.id],
		});
		const g = (await review(`?taxYear=${year}`)).groups.find(
			(g) => g.code === "missing_history",
		);
		expect(g).toMatchObject({
			count: 1,
			items: [],
			reportItems: [
				{
					kind: "balance",
					balance: { asset: "BNB", computed: "-0.01", txIds: [tx.id] },
				},
			],
		});
	});
	it("warnings on acquisition history outside the year remain actionable in Review", async () => {
		const tx = await buy({
			timestamp: "2025-05-01T00:00:00.000Z",
			reviewFlags: [
				{ code: "parse_warning", message: "Verify the source quantity." },
			],
		});
		await compute(year);
		const g = (await review(`?taxYear=${year}`)).groups.find(
			(group) => group.code === "parse_warning",
		);
		expect(g).toMatchObject({
			count: 1,
			items: [],
			reportItems: [
				{ kind: "warning", warning: { txId: tx.id, txIds: [tx.id] } },
			],
		});
	});

	it("all unresolved reasons are review items without repeating the ledger transaction", async () => {
		const tx = await addManual({
			timestamp: "2026-05-01T00:00:00.000Z",
			type: "sell",
			assetOut: "ETH",
			amountOut: "1",
		});
		const report = await compute(year);
		expect(report.unresolved.map((row) => row.reason)).toEqual(
			expect.arrayContaining(["missing_history", "missing_inr_value"]),
		);
		const r = await review(`?taxYear=${year}`);
		for (const code of ["missing_history", "missing_inr_value"]) {
			const g = r.groups.find((g) => g.code === code);
			expect(g?.items).toEqual([]);
			expect(
				g?.reportItems.filter((item) => item.kind === "unresolved"),
			).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						unresolved: expect.objectContaining({ txId: tx.id, reason: code }),
					}),
				]),
			);
			expect(g?.count).toBe(g?.reportItems.length);
		}
	});
	it.each(["global", "per_source"])(
		"balance warnings carry the correct %s ledger trail and are counted once",
		async (lotPool) => {
			ok(await putSettings({ lotPool }), 200, api.SettingsResponseSchema);
			const manual = await buy();
			await importOk(binanceBuy, "buy.csv", { source: "binance" });
			ok(
				await balances([
					{
						asset: "ETH",
						amount: "1.5",
						...(lotPool === "per_source" ? { source: "manual" } : {}),
					},
					{
						asset: "BTC",
						amount: "1",
						...(lotPool === "per_source" ? { source: "manual" } : {}),
					},
				]),
				200,
				api.ActualBalancesResponseSchema,
			);
			const report = await compute(year);
			const warning = report.warnings.find(
				(w) => w.code === "balance_mismatch" && w.asset === "ETH",
			);
			expect(warning?.txIds).toEqual(
				report.balances.find(
					(b) =>
						b.asset === "ETH" &&
						(lotPool === "global" || b.source === "manual"),
				)?.txIds,
			);
			expect(warning?.count).toBe(1);
			expect(warning?.txIds).toContain(manual.id);
			expect(warning?.txIds).toHaveLength(lotPool === "global" ? 2 : 1);
			expect(warning?.source).toBe(
				lotPool === "per_source" ? "manual" : undefined,
			);
			expect(
				report.warnings.find(
					(w) => w.code === "balance_mismatch" && w.asset === "BTC",
				),
			).toMatchObject({ asset: "BTC", txIds: [] });
			expect(
				(await review(`?taxYear=${year}`)).groups.find(
					(g) => g.code === "balance_mismatch",
				),
			).toMatchObject({
				count: 2,
				items: [],
				reportItems: [expect.any(Object), expect.any(Object)],
			});
		},
	);
	it("ambiguous transfer matching uses its own review code", async () => {
		const withdrawal = await addManual({
			timestamp: "2026-05-01T00:00:00.000Z",
			type: "withdrawal",
			assetOut: "ETH",
			amountOut: "1",
		});
		await importOk(
			csv([
				"Date(UTC),Coin,Amount,TXID,Status",
				"2026-05-01 01:00:00,ETH,1,first,Completed",
				"2026-05-01 02:00:00,ETH,1,second,Completed",
			]),
			"deposits.csv",
			{ source: "binance" },
		);
		const report = await compute(year);
		expect(
			report.warnings.find((w) =>
				w.message.startsWith("Multiple possible transfer pairs"),
			),
		).toMatchObject({ code: "ambiguous_transfer", txIds: [withdrawal.id] });
		expect(
			(await review(`?taxYear=${year}`)).groups.find(
				(g) => g.code === "ambiguous_transfer",
			),
		).toMatchObject({
			count: 1,
			items: [{ id: withdrawal.id }],
			reportItems: [],
		});
	});

	it("CA verification and incomplete imports have distinct codes and appear in Review", async () => {
		await importOk(
			csv([
				"Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
				"bad,ETHINR,BUY,100,1ETH,100INR,0INR",
			]),
			"broken.csv",
			{ source: "binance" },
		);
		const report = await compute(year);
		for (const [code, text] of [
			["ca_verification_pending", "Section numbers"],
			["import_incomplete", "Import broken.csv"],
		]) {
			expect(
				report.warnings.find((w) => w.message.startsWith(text))?.code,
			).toBe(code);
			expect(
				(await review(`?taxYear=${year}`)).groups.find((g) => g.code === code),
			).toMatchObject({
				count: 1,
				items: [],
				reportItems: [{ kind: "warning", warning: { code } }],
			});
		}
		expect(report.warnings.filter((w) => w.code === "parse_warning")).toEqual(
			[],
		);
	});
});

describe("intentional statement skips", () => {
	it("skip-only files have no row errors or parse warnings, preserve skips on detail/list and re-import", async () => {
		const content = csv([
			"UTC_Time,Account,Operation,Coin,Change,Remark",
			"2026-05-01 00:00:00,Spot,Deposit,ETH,1,covered elsewhere",
			"2026-05-02 00:00:00,Spot,Withdraw,ETH,-1,covered elsewhere",
		]);
		for (let attempt = 0; attempt < 2; attempt++) {
			const imported = await importOk(content, "statement.csv", {
				source: "binance",
			});
			expect(imported).toMatchObject({
				rowsRead: 2,
				rowsInserted: 0,
				rowsDuplicate: 0,
				rowsError: 0,
				rowsSkipped: 2,
				warnings: [],
			});
			expect(imported.skippedRows.map((row) => row.rowIndex)).toEqual([0, 1]);
			const detail = ok(
				await call("GET", `/api/imports/${imported.id}`),
				200,
				api.GetImportResponseSchema,
			);
			expect(detail.skippedRows).toEqual(imported.skippedRows);
			expect(detail.rowErrors).toEqual([]);
			const list = ok(
				await call("GET", "/api/imports"),
				200,
				api.ListImportsResponseSchema,
			);
			expect(list.find((row) => row.id === imported.id)?.skippedRows).toEqual(
				imported.skippedRows,
			);
		}
		expect(
			(await compute(year)).warnings.some(
				(w) => w.code === "import_incomplete",
			),
		).toBe(false);
	});
});

describe("report missing reasons", () => {
	it("a fresh database reports never_computed with no invalidation date", async () => {
		await restartStack({});
		const error = fail(
			await call("GET", `/api/reports/${year}`),
			404,
			"report_not_computed",
		);
		expect(api.ReportMissingDetailsSchema.parse(error?.details)).toEqual({
			invalidatedAt: null,
			cause: "never_computed",
		});
	});
	it.each(["ledger_changed", "settings_changed", "balances_changed"])(
		"404 explains %s and recompute restores the report",
		async (cause) => {
			await compute(year);
			const startedAt = new Date().toISOString();
			if (cause === "ledger_changed") await buy();
			if (cause === "settings_changed")
				ok(
					await putSettings({ feeTreatment: "include" }),
					200,
					api.SettingsResponseSchema,
				);
			if (cause === "balances_changed")
				ok(
					await balances([{ asset: "ETH", amount: "1" }]),
					200,
					api.ActualBalancesResponseSchema,
				);
			const error = fail(
				await call("GET", `/api/reports/${year}`),
				404,
				"report_not_computed",
			);
			const details = api.ReportMissingDetailsSchema.parse(error?.details);
			expect(details.cause).toBe(cause);
			expect(details.invalidatedAt).not.toBeNull();
			expect((details.invalidatedAt ?? "") >= startedAt).toBe(true);
			await buy();
			expect(
				fail(
					await call("GET", `/api/reports/${year}`),
					404,
					"report_not_computed",
				)?.details,
			).toEqual(details);
			await compute(year);
			ok(
				await call("GET", `/api/reports/${year}`),
				200,
				api.GetReportResponseSchema,
			);
		},
	);
});
