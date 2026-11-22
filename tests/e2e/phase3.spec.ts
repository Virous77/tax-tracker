import path from "node:path";
import { writeXlsx } from "../../packages/importers/src/spreadsheet";
import { DISCLAIMER_TEXT, REPO_ROOT } from "./support/env";
import { expect, setTheme, settled, test } from "./support/fixtures";
import { chooseOption, SELECT_VALUE } from "./support/select";

// Runs sequentially against a fresh Phase 3 instance (starting with disclaimer unaccepted).
test.describe.configure({ mode: "serial" });

if (process.env.BASE_URL) {
	test.use({
		baseURL: process.env.BASE_URL,
		viewport: { width: 1440, height: 900 },
		timezoneId: "Asia/Kolkata",
		locale: "en-IN",
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
	});
}

const EXAMPLES = path.join(REPO_ROOT, "examples");
const SCHWAB_SAMPLE = path.join(
	EXAMPLES,
	"us-stocks-schwab-sample.SYNTHETIC.csv",
);
const BINANCE_SAMPLE = path.join(
	EXAMPLES,
	"binance-spot-trade-history.SYNTHETIC.csv",
);

function buildSyntheticVestedXlsx(): Buffer {
	const bytes = writeXlsx([
		{
			name: "Cover",
			rows: [
				["", "ACCOUNT STATEMENT"],
				["DriveWealth Account Number", "SYNTHETIC-E2E-001"],
			],
		},
		{
			name: "All Transactions",
			rows: [
				[
					"Date",
					"Time (in UTC)",
					"Type",
					"Amount",
					"Currency",
					"Account Balance",
					"Comment",
				],
				[
					"2022-06-01",
					"12:00:00 AM",
					"CSR",
					"2,000.00",
					"USD",
					"2000.00",
					"Synthetic wire funding",
				],
				[
					"2022-06-01",
					"12:05:00 AM",
					"SPUR",
					"-1,001.00",
					"USD",
					"999.00",
					"Covered by Trades",
				],
				[
					"2025-06-02",
					"05:12:43 PM",
					"SSAL",
					"798.00",
					"USD",
					"1797.00",
					"Covered by Trades",
				],
				[
					"2025-07-02",
					"12:02:45 PM",
					"DIVM",
					"20.00",
					"USD",
					"1817.00",
					"Covered by Income",
				],
				[
					"2025-07-02",
					"12:05:00 PM",
					"DIVTAX",
					"-5.00",
					"USD",
					"1812.00",
					"Covered by Income",
				],
				[
					"2025-09-02",
					"12:05:00 AM",
					"ORDER",
					"",
					"USD",
					"",
					"Synthetic pending order",
				],
			],
		},
		{
			name: "Trades",
			rows: [
				[
					"Date",
					"Time (in UTC)",
					"Name",
					"Ticker",
					"Activity",
					"Order Type",
					"Quantity",
					"Price Per Share",
					"Cash Amount",
					"Comission Charges",
					"Currency",
				],
				[
					"2022-06-01",
					"12:05:00 AM",
					"Synthetic Computing Corp",
					"SYNTH",
					"Buy",
					"Market",
					"10",
					"100.00",
					"1,001.00",
					"1.00",
					"USD",
				],
				[
					"2025-06-02",
					"05:12:43 PM",
					"Synthetic Computing Corp",
					"SYNTH",
					"Sell",
					"Market",
					"4",
					"200.00",
					"798.00",
					"2.00",
					"USD",
				],
			],
		},
		{
			name: "Income",
			rows: [
				[
					"Date",
					"Time (in UTC)",
					"Activity",
					"Ticker",
					"Gross Cash Amount",
					"Currency",
				],
				[
					"2025-07-02",
					"12:02:45 PM",
					"Manufactured Dividend",
					"SYNTH",
					"20.00",
					"USD",
				],
				["2025-07-02", "12:05:00 PM", "Tax", "SYNTH", "-5.00", "USD"],
			],
		},
		{
			name: "Glossary",
			rows: [
				["Transaction Type", "Description"],
				["SPUR", "Synthetic stock purchase"],
			],
		},
	]);
	return Buffer.from(bytes);
}

test.describe("Phase 3: US Stocks, Vested & Tax Isolation E2E", () => {
	test("1. Health check, API edge cases & first-run disclaimer acknowledgement", async ({
		page,
		allowConsole,
	}) => {
		// Before any US equity report is computed, /us-stocks polls GET /api/us-equity/reports/:year?allowStale=true -> 404.
		allowConsole(/status of 404 .*\/api\/us-equity\/reports\//);

		const healthRes = await page.request.get("/api/health");
		expect(healthRes.status()).toBe(200);
		const health = (await healthRes.json()) as {
			ok: boolean;
			dbOk: boolean;
		};
		expect(health.ok).toBe(true);
		expect(health.dbOk).toBe(true);

		// Uncomputed US equity report returns 404 report_not_computed.
		const missingReportRes = await page.request.get(
			"/api/us-equity/reports/2025-26",
		);
		expect(missingReportRes.status()).toBe(404);
		const missingBody = (await missingReportRes.json()) as {
			error: { code: string };
		};
		expect(missingBody.error.code).toBe("report_not_computed");

		// API validation: peakDate outside calendarYear rejected with 400.
		const badPriceDateRes = await page.request.put("/api/us-equity/prices", {
			data: {
				calendarYear: 2025,
				prices: [
					{
						calendarYear: 2025,
						symbol: "AAPL",
						peakPriceUsd: "250.00",
						peakDate: "2024-12-31",
					},
				],
			},
		});
		expect(badPriceDateRes.status()).toBe(400);

		// API validation: duplicate symbol in metadata rejected with 409.
		const dupMetaRes = await page.request.put("/api/us-equity/metadata", {
			data: [
				{ symbol: "AAPL", entityName: "APPLE INC" },
				{ symbol: "AAPL", entityName: "APPLE INC DUP" },
			],
		});
		expect(dupMetaRes.status()).toBe(409);

		// API validation: invalid manual US equity type & venue rejected with 400.
		const badManualRes = await page.request.post("/api/transactions", {
			data: {
				sourceRef: "e2e-bad-us-eq",
				importId: null,
				timestamp: "2025-07-01T12:00:00.000Z",
				type: "gift",
				assetClass: "us_equity",
				venue: "binance",
				assetIn: "AAPL",
				amountIn: "1",
				raw: { manualEntry: true },
				reviewFlags: [],
			},
		});
		expect(badManualRes.status()).toBe(400);

		// CSRF check: cross-origin mutation rejected with 403.
		const csrfRes = await page.request.post(
			"/api/us-equity/reports/2025-26/compute",
			{
				headers: { Origin: "https://evil.example" },
				data: {},
			},
		);
		expect(csrfRes.status()).toBe(403);

		// First-run disclaimer blocks /us-stocks until acknowledged.
		await page.goto("/us-stocks");
		const dialog = page.getByRole("dialog", { name: "Before you start" });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText("Not tax advice.");
		await dialog.getByRole("button", { name: "I understand" }).click();
		await expect(dialog).toBeHidden();

		await settled(page);
		await expect(
			page.getByRole("heading", { name: "US Stocks" }),
		).toBeVisible();
		await expect(page.getByText("No US stock transactions yet")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Import broker CSV" }),
		).toBeVisible();
	});

	test("2. Upload Schwab synthetic CSV via /import UI with auto-detected recipe", async ({
		page,
	}) => {
		await page.goto("/import");
		await settled(page);

		await page.locator('input[type="file"]').setInputFiles(SCHWAB_SAMPLE);
		await page.getByRole("button", { name: "Upload & import" }).click();

		await expect(
			page.getByText(
				/us-stocks-schwab-sample\.SYNTHETIC\.csv — Import complete/,
			),
		).toBeVisible();
		await expect(
			page.getByText(
				"15 read = 15 inserted + 0 duplicates + 0 skipped + 0 errors",
			),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "View US Stocks" }),
		).toBeVisible();
	});

	test("3. Upload synthetic Vested XLSX via /import UI, verify UTC detection and clean dedupe", async ({
		page,
	}) => {
		const vestedBuffer = buildSyntheticVestedXlsx();

		await page.goto("/import");
		await settled(page);

		await page.locator('input[type="file"]').setInputFiles({
			name: "vested-account-statement.SYNTHETIC.xlsx",
			mimeType:
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			buffer: vestedBuffer,
		});
		await page.getByRole("button", { name: "Upload & import" }).click();

		await expect(
			page.getByText(
				/vested-account-statement\.SYNTHETIC\.xlsx — Import complete/,
			),
		).toBeVisible();
		await expect(page.getByText(/Vested Account Statement/i)).toBeVisible();
		await expect(page.getByText(/Time zone:\s*UTC/i)).toBeVisible();
		// 6 cash (1 CSR inserted + 5 skipped) + 2 trades + 2 income = 10 read: 5 inserted, 0 dup, 5 skipped, 0 errors.
		await expect(
			page.getByText(
				"10 read = 5 inserted + 0 duplicates + 5 skipped + 0 errors",
			),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "View US Stocks" }),
		).toBeVisible();

		// Re-upload identical Vested XLSX -> 0 new rows, 5 duplicates, 5 skipped, 0 errors.
		await page.getByRole("button", { name: "Import another file" }).click();
		await page.locator('input[type="file"]').setInputFiles({
			name: "vested-account-statement.SYNTHETIC.xlsx",
			mimeType:
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			buffer: vestedBuffer,
		});
		await page.getByRole("button", { name: "Upload & import" }).click();

		await expect(
			page.getByText(
				/vested-account-statement\.SYNTHETIC\.xlsx — Import complete/,
			),
		).toBeVisible();
		await expect(
			page.getByText(
				"10 read = 0 inserted + 5 duplicates + 5 skipped + 0 errors",
			),
		).toBeVisible();
	});

	test("4. /us-stocks FY 2025-26: compute, Capital Gains, Trail, Dividends & Form 67, Schedule FA edit, Holdings, Exports & FY 2026-27", async ({
		page,
		allowConsole,
	}) => {
		// Uncomputed 2025-26 and 2026-27 return 404 before compute button is clicked.
		allowConsole(/status of 404 .*\/api\/us-equity\/reports\//);

		await page.goto("/us-stocks?taxYear=2025-26");
		await settled(page);

		// Compute button does not wrap.
		const computeBtn = page
			.getByRole("button", { name: /^Compute report$/ })
			.first();
		await expect(computeBtn).toBeVisible();
		const btnBox = await computeBtn.boundingBox();
		expect(btnBox?.height ?? 999).toBeLessThanOrEqual(48);

		await computeBtn.click();
		await expect(
			page.getByRole("region", { name: "US Stocks summary KPIs" }),
		).toBeVisible();

		// KPI cards & pending CA verification badge.
		const kpis = page.getByRole("region", { name: "US Stocks summary KPIs" });
		await expect(kpis.getByText("LTCG Tax")).toBeVisible();
		await expect(kpis.getByText("Net Capital Gains")).toBeVisible();
		await expect(kpis.getByText("Gross Dividends")).toBeVisible();
		await expect(kpis.getByText("Form 67 Foreign Tax Paid")).toBeVisible();
		await expect(
			kpis.getByText("Schedule FA Holdings (CY 2025)"),
		).toBeVisible();
		await expect(
			page.getByText("Pending CA verification").first(),
		).toBeVisible();

		// Capital Gains tab: verify LT (AAPL, SYNTH) and ST (NVDA), SBI rate provenance, Loss Set-Off & Trail drawer.
		const cgPanel = page.getByRole("tabpanel");
		await expect(cgPanel.getByText("AAPL")).toBeVisible();
		await expect(cgPanel.getByText("SYNTH")).toBeVisible();
		await expect(cgPanel.getByText("NVDA")).toBeVisible();
		await expect(cgPanel.getByText("Long-Term").first()).toBeVisible();
		await expect(cgPanel.getByText("Short-Term").first()).toBeVisible();
		// SBI TT buying rate date provenance is shown beneath Cost/Proceeds.
		await expect(
			cgPanel.getByText(/₹\d+\.\d+ \(202\d-\d{2}-\d{2}\)/).first(),
		).toBeVisible();
		await expect(
			cgPanel.getByRole("heading", {
				name: "Capital Loss Set-Off & Carry-Forward",
			}),
		).toBeVisible();
		await expect(
			cgPanel.getByRole("heading", { name: "LTCG Tax Computation" }),
		).toBeVisible();

		// Open Trail drawer and confirm untouched raw source row renders.
		await cgPanel.getByRole("button", { name: "Trail" }).first().click();
		const trailDrawer = page.getByRole("dialog", { name: /Audit Trail/ });
		await expect(trailDrawer).toBeVisible();
		await expect(
			trailDrawer.getByText("2. SBI TT Buying FX Provenance"),
		).toBeVisible();
		await expect(
			trailDrawer.getByText(/4\. Untouched Raw Source Rows/),
		).toBeVisible();
		await trailDrawer.getByRole("button", { name: /Close/i }).click();
		await expect(trailDrawer).toBeHidden();

		// Dividends & Form 67 tab.
		await page.getByRole("tab", { name: /Dividends & Form 67/ }).click();
		const divPanel = page.getByRole("tabpanel");
		await expect(divPanel.getByText("AAPL").first()).toBeVisible();
		await expect(divPanel.getByText("MSFT").first()).toBeVisible();
		await expect(divPanel.getByText("VTI").first()).toBeVisible();
		await expect(divPanel.getByText("SYNTH").first()).toBeVisible();
		await expect(divPanel.getByText("25%").first()).toBeVisible();
		await expect(
			divPanel.getByRole("heading", {
				name: "Form 67 Foreign Tax Credit Worksheet",
			}),
		).toBeVisible();
		await expect(
			divPanel.getByText("United States of America (2)").first(),
		).toBeVisible();
		await expect(divPanel.getByText("Article 10(2)(b)").first()).toBeVisible();
		await expect(divPanel.getByText("Form 67 Filing Notes")).toBeVisible();

		// Schedule FA Table A3 tab (CY 2025): verify missing price amber badges, then edit & recompute.
		await page.getByRole("tab", { name: /Schedule FA \(CY 2025\)/ }).click();
		const faPanel = page.getByRole("tabpanel");
		await expect(
			faPanel.getByText(/missing CY 2025 peak or Dec 31 closing USD price/i),
		).toBeVisible();
		const aaplRow = faPanel.locator("tbody tr", { hasText: "(AAPL)" });
		await expect(aaplRow.getByText("Missing peak price")).toBeVisible();
		await expect(aaplRow.getByText("Missing closing price")).toBeVisible();

		await aaplRow
			.getByRole("button", { name: /Edit prices & entity details/ })
			.click();
		const faDrawer = page.getByRole("dialog", {
			name: /Schedule FA · AAPL \(CY 2025\)/,
		});
		await expect(faDrawer).toBeVisible();
		await faDrawer
			.getByLabel("Entity Address")
			.fill("One Synthetic Way, Cupertino, CA");
		await faDrawer.getByLabel("ZIP / Postal Code").fill("95014");
		await faDrawer.getByLabel("Peak Price (USD)").fill("259.02");
		await faDrawer.getByLabel("Peak Date (in 2025)").fill("2025-12-26");
		await faDrawer.getByLabel("Dec 31 Closing Price (USD)").fill("250.42");
		await faDrawer.getByRole("button", { name: "Save & Recompute" }).click();
		await expect(faDrawer).toBeHidden();

		// Confirm AAPL peak & closing values populate and its missing-price badges clear.
		await expect(
			aaplRow.getByText("One Synthetic Way, Cupertino, CA, 95014"),
		).toBeVisible();
		await expect(aaplRow.getByText("Missing peak price")).toHaveCount(0);
		await expect(aaplRow.getByText("Missing closing price")).toHaveCount(0);
		await expect(aaplRow.getByText("$259.02")).toBeVisible();
		await expect(aaplRow.getByText("$250.42")).toBeVisible();

		// Holdings tab: enter actual share balance and reconcile.
		await page.getByRole("tab", { name: /Holdings/ }).click();
		const holdingsPanel = page.getByRole("tabpanel");
		const aaplInput = holdingsPanel.getByLabel(/Actual balance for AAPL/);
		await expect(aaplInput).toBeVisible();
		await aaplInput.fill("12");
		await holdingsPanel
			.getByRole("button", { name: "Save actual balances" })
			.click();
		await expect(
			holdingsPanel.getByText("Actual US stock balances saved and reconciled."),
		).toBeVisible();
		const aaplHoldingRow = holdingsPanel.locator("tbody tr", {
			hasText: "AAPL",
		});
		await expect(aaplHoldingRow.locator("td").last()).toHaveText("0");

		// Exports: verify all 5 kinds across both CSV and XLSX formats.
		const kinds = [
			"capital-gains",
			"dividends",
			"form67",
			"schedule-fa",
			"full",
		] as const;
		for (const kind of kinds) {
			const csvRes = await page.request.get(
				`/api/us-equity/reports/2025-26/export?format=csv&kind=${kind}`,
			);
			expect(csvRes.status(), `csv ${kind}`).toBe(200);
			expect(csvRes.headers()["content-disposition"]).toContain(
				`tax-tracker-us-equity-2025-26-${kind}.csv`,
			);
			const csvText = await csvRes.text();
			expect(csvText).toContain(DISCLAIMER_TEXT);
			expect(csvText).toContain("Section numbers pending CA verification");
			expect(csvText).toContain("2025-26");

			const xlsxRes = await page.request.get(
				`/api/us-equity/reports/2025-26/export?format=xlsx&kind=${kind}`,
			);
			expect(xlsxRes.status(), `xlsx ${kind}`).toBe(200);
			expect(xlsxRes.headers()["content-disposition"]).toContain(
				`tax-tracker-us-equity-2025-26-${kind}.xlsx`,
			);
			const xlsxBytes = await xlsxRes.body();
			expect(xlsxBytes.byteLength).toBeGreaterThan(200);
			// XLSX files are ZIP containers starting with "PK".
			expect(xlsxBytes[0]).toBe(0x50);
			expect(xlsxBytes[1]).toBe(0x4b);
		}

		// Formula-injection safety check: store metadata starting with "=cmd", recompute, verify safeCell prefix in CSV.
		const metaListRes = await page.request.get("/api/us-equity/metadata");
		const existingMeta = (await metaListRes.json()) as Array<
			Record<string, unknown>
		>;
		await page.request.put("/api/us-equity/metadata", {
			data: [
				...existingMeta.filter((m) => m.symbol !== "NVDA"),
				{
					symbol: "NVDA",
					entityName: "=SUM(1,2)",
					entityAddress: "+123 Synthetic Ave",
				},
			],
		});
		await page.request.post("/api/us-equity/reports/2025-26/compute", {
			data: {},
		});
		const safeCsvRes = await page.request.get(
			"/api/us-equity/reports/2025-26/export?format=csv&kind=schedule-fa",
		);
		const safeCsvText = await safeCsvRes.text();
		expect(safeCsvText).toContain(`"'=SUM(1,2)"`);
		expect(safeCsvText).toContain(`"'+123 Synthetic Ave"`);
		// Restore clean metadata and recompute 2025-26.
		await page.request.put("/api/us-equity/metadata", { data: existingMeta });
		await page.request.post("/api/us-equity/reports/2025-26/compute", {
			data: {},
		});

		// Switch to Tax Year 2026-27 -> compute -> verify CY 2026 Schedule FA and 2025 Act section labels.
		await chooseOption(
			page.getByRole("combobox", { name: "Tax year" }),
			"2026-27",
		);
		await settled(page);
		await page
			.getByRole("button", { name: /Compute (2026-27 )?report/ })
			.first()
			.click();
		await expect(
			page.getByRole("region", { name: "US Stocks summary KPIs" }),
		).toBeVisible();
		await expect(page.getByText("Income-tax Act, 2025")).toBeVisible();
		await expect(page.getByText("CY 2026 Schedule FA")).toBeVisible();

		await page
			.getByRole("button", { name: /Settings, Rules & Warnings/ })
			.click();
		await expect(page.getByText(/Section 197/)).toBeVisible();
		await expect(page.getByText("Rule 206")).toBeVisible();
	});

	test("5. Overview (/) shows US Stocks summary card alongside VDA", async ({
		page,
	}) => {
		await page.goto("/?taxYear=2025-26");
		await settled(page);

		const usSummary = page.getByRole("region", { name: "US Stocks summary" });
		await expect(usSummary).toBeVisible();
		await expect(usSummary.getByText("CY 2025 Schedule FA")).toBeVisible();
		await expect(usSummary.getByText("LTCG Tax (12.5% + cess)")).toBeVisible();
		await expect(usSummary.getByText("Gross Dividends")).toBeVisible();
		await expect(usSummary.getByText("Form 67 Tax Paid")).toBeVisible();
		await expect(
			usSummary.getByRole("link", { name: "Open US Stocks report" }),
		).toBeVisible();
	});

	test("6. Transactions (/transactions): Asset Class filter, drawer inspection & manual US Stock Dividend", async ({
		page,
	}) => {
		await page.goto("/transactions");
		await settled(page);

		const assetClassSelect = page.getByRole("combobox", {
			name: "Asset class",
		});
		await chooseOption(assetClassSelect, "us_equity");
		await expect(assetClassSelect).toHaveAttribute(SELECT_VALUE, "us_equity");
		await expect(page.locator("tbody tr").first()).toContainText("US Stocks");

		// Open Transaction drawer on a US stock row.
		await page.locator("tbody tr").first().getByRole("button").first().click();
		const txDrawer = page.getByRole("dialog");
		await expect(txDrawer).toBeVisible();
		await expect(txDrawer.getByText("US Stocks")).toBeVisible();
		await txDrawer.getByRole("button", { name: /Close/i }).click();
		await expect(txDrawer).toBeHidden();

		// Add a manual US Stock Dividend with withholding tax via AddManualTxDrawer.
		await page.getByRole("button", { name: "Add manual entry" }).click();
		const addDrawer = page.getByRole("dialog", {
			name: "Add manual transaction",
		});
		await expect(addDrawer).toBeVisible();
		await addDrawer.getByRole("button", { name: "US Stocks" }).click();
		await addDrawer.getByRole("button", { name: "Dividend" }).click();
		await addDrawer.getByLabel("Date & time (IST)").fill("2025-10-15T12:00");
		await addDrawer.getByLabel("Stock ticker *").fill("MSFT");
		await addDrawer.getByLabel("Gross dividend (USD) *").fill("10.00");
		await addDrawer.getByLabel("US tax withheld (USD)").fill("2.50");
		await addDrawer
			.getByLabel("Company / entity name (optional, for Schedule FA)")
			.fill("MICROSOFT CORP");
		await addDrawer.getByRole("button", { name: "Add transaction" }).click();
		await expect(addDrawer).toBeHidden();

		// Confirm manual dividend appears and US Stocks 2025-26 report is marked stale.
		await expect(page.locator("tbody")).toContainText("Dividend");
		await page.goto("/us-stocks?taxYear=2025-26");
		await settled(page);
		await expect(
			page.getByText("Your data changed since this report was computed."),
		).toBeVisible();
		await page.getByRole("button", { name: "Recompute" }).first().click();
		await expect(
			page.getByText("Your data changed since this report was computed."),
		).toBeHidden();
	});

	test("7. VDA isolation & Settings usEquityFxBasis invalidates only US Stocks, never VDA", async ({
		page,
	}) => {
		// Import Binance synthetic VDA trades via /import UI.
		await page.goto("/import");
		await settled(page);
		await page.locator('input[type="file"]').setInputFiles(BINANCE_SAMPLE);
		await page.getByRole("button", { name: "Upload & import" }).click();
		await expect(
			page.getByText(
				/binance-spot-trade-history\.SYNTHETIC\.csv — Import complete/,
			),
		).toBeVisible();

		// Compute VDA report for 2025-26 and confirm strict VDA / US Equity isolation.
		await page.goto("/report?taxYear=2025-26");
		await settled(page);
		await page
			.getByRole("button", { name: /Compute (2025-26 )?report/ })
			.first()
			.click();
		await expect(
			page.getByRole("button", { name: "Recompute report" }),
		).toBeVisible();

		const vdaRes = await page.request.get("/api/reports/2025-26");
		expect(vdaRes.status()).toBe(200);
		const vdaReport = (await vdaRes.json()) as {
			scheduleVdaRows: Array<{ asset: string }>;
			balances: Array<{ asset: string }>;
			stale?: boolean;
		};
		expect(vdaReport.stale).toBeUndefined();
		const vdaAssets = [
			...vdaReport.scheduleVdaRows.map((r) => r.asset),
			...vdaReport.balances.map((b) => b.asset),
		];
		for (const ticker of ["AAPL", "MSFT", "VTI", "NVDA", "SYNTH"]) {
			expect(vdaAssets).not.toContain(ticker);
		}
		expect(vdaAssets).toContain("BTC");

		const eqRes = await page.request.get("/api/us-equity/reports/2025-26");
		expect(eqRes.status()).toBe(200);
		const eqReport = (await eqRes.json()) as {
			capitalGains: { rows: Array<{ asset: string }> };
			scheduleFa: { rows: Array<{ asset: string }> };
			balances: Array<{ asset: string }>;
		};
		const eqAssets = [
			...eqReport.capitalGains.rows.map((r) => r.asset),
			...eqReport.scheduleFa.rows.map((r) => r.asset),
			...eqReport.balances.map((b) => b.asset),
		];
		for (const coin of ["BTC", "ETH", "USDT", "BNB"]) {
			expect(eqAssets).not.toContain(coin);
		}

		// Filter Transactions by VDA vs US Stocks to verify UI filter separation.
		await page.goto("/transactions");
		await settled(page);
		const assetClassSelect = page.getByRole("combobox", {
			name: "Asset class",
		});
		await chooseOption(assetClassSelect, "vda");
		await expect(page.locator("tbody")).toContainText("BTC");
		await expect(page.locator("tbody")).not.toContainText("AAPL");
		await chooseOption(assetClassSelect, "us_equity");
		await expect(page.locator("tbody")).toContainText("AAPL");
		await expect(page.locator("tbody")).not.toContainText("BTC");

		// Change usEquityFxBasis in /settings -> invalidates US Stocks, NOT VDA.
		await page.goto("/settings");
		await settled(page);
		const fxSelect = page.getByRole("combobox", {
			name: "USD to INR exchange rate basis",
		});
		await expect(fxSelect).toHaveAttribute(SELECT_VALUE, "prev_month_end");
		await chooseOption(fxSelect, "trade_date");
		await expect(fxSelect).toHaveAttribute(SELECT_VALUE, "trade_date");
		await page.getByRole("button", { name: "Save settings" }).click();
		await expect(page.getByText(/Settings saved/i)).toBeVisible();

		// VDA 2025-26 report must remain current (not invalidated).
		const vdaAfterRes = await page.request.get("/api/reports/2025-26");
		expect(vdaAfterRes.status()).toBe(200);
		const vdaAfter = (await vdaAfterRes.json()) as { stale?: boolean };
		expect(vdaAfter.stale).toBeUndefined();

		// US Stocks 2025-26 report must be stale (404 without allowStale, stale: true with allowStale).
		const eqStrictRes = await page.request.get(
			"/api/us-equity/reports/2025-26",
		);
		expect(eqStrictRes.status()).toBe(404);
		const eqStaleRes = await page.request.get(
			"/api/us-equity/reports/2025-26?allowStale=true",
		);
		expect(eqStaleRes.status()).toBe(200);
		const eqStale = (await eqStaleRes.json()) as { stale?: boolean };
		expect(eqStale.stale).toBe(true);

		// Confirm stale banner on /us-stocks, then recompute.
		await page.goto("/us-stocks?taxYear=2025-26");
		await settled(page);
		await expect(
			page.getByText("Your data changed since this report was computed."),
		).toBeVisible();
		await page.getByRole("button", { name: "Recompute" }).first().click();
		await expect(
			page.getByText("Your data changed since this report was computed."),
		).toBeHidden();
	});

	test("8. Responsive (390px mobile) & dark mode smoke check on /us-stocks", async ({
		page,
	}) => {
		await setTheme(page, "dark");
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/us-stocks?taxYear=2025-26");
		await settled(page);

		// Dark mode applied and zero horizontal overflow at 390px.
		expect(
			await page.evaluate(() =>
				document.documentElement.getAttribute("data-theme"),
			),
		).toBe("dark");
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
		).toBeLessThanOrEqual(390);

		const recomputeBtn = page
			.getByRole("button", { name: "Recompute" })
			.first();
		await expect(recomputeBtn).toBeVisible();
		const box = await recomputeBtn.boundingBox();
		expect(box?.height ?? 999).toBeLessThanOrEqual(48);

		// Switch through tabs on mobile dark mode and verify zero horizontal overflow.
		for (const tabPattern of [
			/Dividends & Form 67/,
			/Schedule FA \(CY 2025\)/,
			/Holdings/,
		]) {
			await page.getByRole("tab", { name: tabPattern }).click();
			await expect(page.getByRole("tabpanel")).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(390);
		}
	});
});
