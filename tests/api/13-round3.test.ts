import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	addManual,
	api,
	call,
	compute,
	DEFAULT_SETTINGS,
	fail,
	fixture,
	importOk,
	ok,
	putSettings,
	wipe,
} from "./lib";

beforeEach(wipe);
afterAll(wipe);

const statuses = async () =>
	Object.fromEntries(
		ok(
			await call("GET", "/api/review"),
			200,
			api.ReviewResponseSchema,
		).reportStatuses.map((s) => [s.taxYear, s.status]),
	);

async function computeBoth() {
	await addManual({
		timestamp: "2025-06-01T00:00:00.000Z",
		type: "buy",
		assetIn: "ETH",
		amountIn: "1",
		inrValue: "100",
	});
	await compute("2025-26");
	await compute("2026-27");
	expect(await statuses()).toEqual({
		"2025-26": "current",
		"2026-27": "current",
	});
}

async function missingCause(year: string) {
	const res = await call("GET", `/api/reports/${year}`);
	fail(res, 404, "report_not_computed");
	return (res.body as { error: { details: { cause: string } } }).error.details
		.cause;
}

describe("what clears a stored report", () => {
	it("a tax engine setting change clears every year with settings_changed", async () => {
		await computeBoth();
		ok(
			await putSettings({ surchargeRate: "0.10" }),
			200,
			api.PutSettingsResponseSchema,
		);
		expect(await statuses()).toEqual({
			"2025-26": "missing",
			"2026-27": "missing",
		});
		expect(await missingCause("2025-26")).toBe("settings_changed");
		expect(await missingCause("2026-27")).toBe("settings_changed");
	});

	it("a missing report blocks every export kind with the same explanation", async () => {
		await computeBoth();
		await addManual({
			timestamp: "2026-06-01T00:00:00.000Z",
			type: "buy",
			assetIn: "SOL",
			amountIn: "1",
			inrValue: "10",
		});
		for (const kind of ["schedule-vda", "tds", "income", "full"])
			for (const format of ["csv", "xlsx"]) {
				const res = await call(
					"GET",
					`/api/reports/2026-27/export?format=${format}&kind=${kind}`,
				);
				fail(res, 404, "report_not_computed");
				expect(res.body).toMatchObject({
					error: { details: { cause: "ledger_changed" } },
				});
			}
	});

	// NEW R3-1: the AI endpoint/model is not a tax engine input, yet saving it deletes
	// every stored report and the UI then says "tax engine settings changed".
	it("changing only the AI model keeps stored reports", async () => {
		await computeBoth();
		ok(
			await putSettings({
				ai: {
					baseUrl: "http://ollama:11434/v1",
					model: "another-model",
					apiKey: "",
					cloudAcknowledged: false,
				},
			}),
			200,
			api.PutSettingsResponseSchema,
		);
		expect(await statuses()).toEqual({
			"2025-26": "current",
			"2026-27": "current",
		});
	});

	it("changing only the default tax year keeps stored reports", async () => {
		await computeBoth();
		ok(
			await putSettings({ defaultTaxYear: "2025-26" }),
			200,
			api.PutSettingsResponseSchema,
		);
		expect(await statuses()).toEqual({
			"2025-26": "current",
			"2026-27": "current",
		});
	});

	it("saving unchanged settings keeps stored reports", async () => {
		await computeBoth();
		ok(await putSettings(DEFAULT_SETTINGS), 200, api.PutSettingsResponseSchema);
		expect(await statuses()).toEqual({
			"2025-26": "current",
			"2026-27": "current",
		});
	});

	// NEW R3-2: actual balances are per tax year; 2026-27 balances cannot change a 2025-26 report.
	it("actual balances for one year keep the other year's report", async () => {
		await computeBoth();
		await call("PUT", "/api/balances/actual?taxYear=2026-27", {
			json: [{ asset: "ETH", amount: "2" }],
		});
		expect(await missingCause("2026-27")).toBe("balances_changed");
		expect(await statuses()).toEqual({
			"2025-26": "current",
			"2026-27": "missing",
		});
	});
});

describe("import summaries add up for every fixture", () => {
	for (const [name, source, timezone] of [
		["binance-trade-history.csv", "binance", "UTC"],
		["binance-deposits.csv", "binance", "UTC"],
		["binance-withdrawals.csv", "binance", "UTC"],
		["binance-transaction-statement.csv", "binance", "UTC"],
		["coindcx-report.xlsx", "coindcx", "IST"],
	] as const)
		it(`${name}: read = inserted + duplicate + error + skipped, twice`, async () => {
			for (let round = 0; round < 2; round++) {
				const s = await importOk(fixture(name), name, {
					source,
					timezone,
					...(name.endsWith(".xlsx")
						? {
								type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
							}
						: {}),
				});
				expect(s.rowsRead).toBe(
					s.rowsInserted + s.rowsDuplicate + s.rowsError + s.rowsSkipped,
				);
				expect(s.rowsSkipped).toBe(s.skippedRows.length);
				if (round === 1) expect(s.rowsInserted).toBe(0);
				if (name !== "binance-transaction-statement.csv")
					expect(s.rowsSkipped).toBe(0);
			}
		});
});
