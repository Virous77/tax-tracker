import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { FIXTURES, GENERATED } from "./support/env";
import { expect, settled, snap, test } from "./support/fixtures";

// Regressions for the fixes in 70566bc (server) and 9fe338e (UI).

const STATEMENT = path.join(FIXTURES, "binance-transaction-statement.csv");
const SKIP_REASON =
	"Statement row overlaps trade/deposit/withdrawal exports; import the dedicated history file. This row is preserved but not applied.";
const CLEARED_AT = String.raw`on \d{2} \w{3} \d{4}, \d{2}:\d{2} IST`;

function stat(scope: Page | Locator, label: string) {
	return scope
		.getByText(label, { exact: true })
		.locator("xpath=following-sibling::p[1]");
}

const group = (page: Page, title: string) =>
	page.locator("section").filter({
		has: page.getByRole("heading", { level: 2, name: title, exact: true }),
	});

const warningsList = (page: Page) =>
	page
		.getByRole("heading", { name: /^Report Warnings/ })
		.locator("xpath=following-sibling::ul[1]");

test.beforeEach(async ({ api }) => {
	await api.reset();
});

test.describe("statement overlap rows are skips, not errors", () => {
	test("import summary shows a neutral skipped section and the count equation", async ({
		page,
	}) => {
		await page.goto("/import");
		await page
			.getByLabel(/Drop your exchange export here/)
			.setInputFiles(STATEMENT);
		await page.getByRole("radio", { name: /^Binance / }).check();
		await page.getByRole("radio", { name: /^UTC \(/ }).check();
		await page.getByRole("button", { name: "Upload & import" }).click();
		await expect(
			page.getByRole("heading", {
				name: "binance-transaction-statement.csv — Import complete",
			}),
		).toBeVisible();
		await expect(stat(page, "Rows read")).toHaveText("32");
		await expect(stat(page, "Inserted")).toHaveText("2");
		await expect(stat(page, "Duplicates skipped")).toHaveText("0");
		await expect(stat(page, "Skipped")).toHaveText("27");
		await expect(stat(page, "Row errors")).toHaveText("3");
		await expect(
			page.getByText(
				"32 read = 2 inserted + 0 duplicates + 27 skipped + 3 errors",
			),
		).toBeVisible();

		const skipped = page.getByRole("heading", {
			name: /Skipped — covered by another export \(27\)/,
		});
		await expect(skipped).toBeVisible();
		const skipTable = skipped.locator("xpath=following-sibling::div[1]");
		await expect(skipTable.locator("tbody tr")).toHaveCount(27);
		await expect(
			skipTable.locator("tbody tr").first().getByRole("cell").last(),
		).toHaveText(SKIP_REASON);
		await expect(
			page.getByRole("heading", { name: "Row Errors (3)" }),
		).toBeVisible();

		// Skips are informational: not styled with the loss/error colour the row errors use.
		const skipColour = await stat(page, "Skipped").evaluate(
			(el) => getComputedStyle(el).color,
		);
		const errorColour = await stat(page, "Row errors").evaluate(
			(el) => getComputedStyle(el).color,
		);
		expect(skipColour).not.toBe(errorColour);
		const headingColour = (name: RegExp) =>
			page
				.getByRole("heading", { name })
				.evaluate((el) => getComputedStyle(el).color);
		expect(await headingColour(/^Skipped — covered/)).not.toBe(
			await headingColour(/^Row Errors/),
		);
		// The one import warning is about the 3 row errors; overlap skips add none.
		await expect(page.getByText("Warnings (1)")).toBeVisible();
		await expect(
			page.getByRole("listitem").filter({ hasText: /^parse_warning:/ }),
		).toHaveText([
			"parse_warning: Some source rows require review; inspect row errors before computing tax.",
		]);
		await snap(page, "import-statement-skips");
	});

	test("re-import: duplicates, skips and errors still add up; Imports list and drawer agree", async ({
		page,
		api,
	}) => {
		await api.importFile(STATEMENT, "binance", "UTC");
		await api.importFile(STATEMENT, "binance", "UTC");
		await page.goto("/imports");
		const rows = page.getByRole("table").first().locator("tbody tr");
		await expect(rows).toHaveCount(2);
		for (const row of await rows.all())
			await expect(row).toContainText("27 skipped (overlap)");

		await page
			.getByRole("button", {
				name: "Inspect binance-transaction-statement.csv",
			})
			.first()
			.click();
		const drawer = page.getByRole("dialog", {
			name: "binance-transaction-statement.csv",
		});
		await expect(drawer).toBeVisible();
		await expect(
			drawer.getByText(
				/^32 read = (2 inserted \+ 0 duplicates|0 inserted \+ 2 duplicates) \+ 27 skipped \+ 3 errors$/,
			),
		).toBeVisible();
		await expect(
			drawer.getByRole("heading", {
				name: /Skipped — covered by another export \(27\)/,
			}),
		).toBeVisible();
		await expect(drawer.getByText(SKIP_REASON)).toHaveCount(27);
		await expect(
			drawer.getByRole("heading", { name: "Row Errors (3)" }),
		).toBeVisible();

		const summaries = await api.json<
			Array<{
				rowsRead: number;
				rowsInserted: number;
				rowsDuplicate: number;
				rowsError: number;
				rowsSkipped: number;
			}>
		>("GET", "/api/imports");
		expect(
			summaries.map((s) => [s.rowsInserted, s.rowsDuplicate]).sort(),
		).toEqual([
			[0, 2],
			[2, 0],
		]);
		for (const s of summaries)
			expect(
				s.rowsInserted + s.rowsDuplicate + s.rowsError + s.rowsSkipped,
			).toBe(s.rowsRead);
	});
});

test.describe("a cleared report explains why", () => {
	async function computeAndCheck(
		page: Page,
		api: import("./support/fixtures").AppApi,
	) {
		await api.seedWorkedExample();
		await api.compute("2026-27");
		await page.goto("/report?taxYear=2026-27");
		await expect(
			page.getByRole("button", { name: "Recompute report" }),
		).toBeEnabled();
	}

	async function expectCleared(page: Page, cause: string) {
		const re = new RegExp(
			`^Your report was cleared because ${cause} ${CLEARED_AT} — compute again`,
		);
		await page.goto("/report?taxYear=2026-27");
		await settled(page);
		await expect(
			page.getByRole("heading", { name: "Report cleared for 2026-27" }),
		).toBeVisible();
		await expect(page.getByText(re)).toBeVisible();
		await page.goto("/?taxYear=2026-27");
		await settled(page);
		await expect(
			page.getByRole("heading", { name: "Report cleared for 2026-27" }),
		).toBeVisible();
		await expect(page.getByText(re)).toBeVisible();
		await page.getByRole("button", { name: "Compute 2026-27 report" }).click();
		await expect(
			page.getByRole("heading", { name: "Report cleared for 2026-27" }),
		).toHaveCount(0);
	}

	test("ledger change", async ({ page, api }) => {
		await computeAndCheck(page, api);
		await api.addManual({
			sourceRef: "e2e-r3-ledger",
			timestamp: "2026-06-01T06:30:00.000Z",
			type: "buy",
			assetIn: "SOL",
			amountIn: "1",
			inrValue: "1000",
		});
		await expectCleared(page, "transactions changed");
		await snap(page, "overview-after-recompute");
	});

	test("settings change", async ({ page, api }) => {
		await computeAndCheck(page, api);
		await api.putSettings({ surchargeRate: "0.10" });
		await expectCleared(page, "tax engine settings changed");
	});

	test("actual balances change", async ({ page, api }) => {
		await computeAndCheck(page, api);
		await api.json("PUT", "/api/balances/actual?taxYear=2026-27", [
			{ asset: "ETH", amount: "0" },
		]);
		await expectCleared(page, "actual balances changed");
	});

	test("first cause is kept until recompute; API details match", async ({
		page,
		api,
	}) => {
		await computeAndCheck(page, api);
		await api.putSettings({ surchargeRate: "0.10" });
		await api.json("PUT", "/api/balances/actual?taxYear=2026-27", [
			{ asset: "ETH", amount: "0" },
		]);
		const res = await page.request.get("/api/reports/2026-27");
		expect(res.status()).toBe(404);
		const body = (await res.json()) as {
			error: {
				code: string;
				details: { cause: string; invalidatedAt: string };
			};
		};
		expect(body.error.code).toBe("report_not_computed");
		expect(body.error.details.cause).toBe("settings_changed");
		expect(Date.parse(body.error.details.invalidatedAt)).not.toBeNaN();
		await page.goto("/report?taxYear=2026-27");
		await expect(
			page.getByText(/cleared because tax engine settings changed/),
		).toBeVisible();
	});
});

test.describe("singular and plural wording", () => {
	const flagged = (n: number) =>
		Array.from({ length: n }, (_, i) => ({
			sourceRef: `e2e-r3-flag-${i}`,
			timestamp: `2026-06-0${i + 1}T06:30:00.000Z`,
			type: "buy",
			assetIn: "BTC",
			amountIn: "1",
			inrValue: "1000",
			reviewFlags: [{ code: "parse_warning", message: `check row ${i}` }],
		}));

	test("Overview: one item needs review", async ({ page, api }) => {
		for (const tx of flagged(1)) await api.addManual(tx);
		await page.goto("/?taxYear=2026-27");
		await expect(
			page.getByText("1 flagged transaction item needs review before filing."),
		).toBeVisible();
		await page.goto("/review?taxYear=2026-27");
		await expect(
			group(page, "Import parse warning").getByText("1 item", {
				exact: true,
			}),
		).toBeVisible();
	});

	test("Overview: two items need review", async ({ page, api }) => {
		for (const tx of flagged(2)) await api.addManual(tx);
		await page.goto("/?taxYear=2026-27");
		await expect(
			page.getByText("2 flagged transaction items need review before filing."),
		).toBeVisible();
	});

	test("Report: one Schedule VDA row and one transaction evaluated", async ({
		page,
		api,
	}) => {
		await api.addManual({
			sourceRef: "e2e-r3-single-sell",
			timestamp: "2026-08-01T06:30:00.000Z",
			type: "sell",
			assetOut: "ETH",
			amountOut: "1",
			inrValue: "250000",
		});
		await page.goto("/?taxYear=2026-27");
		await page.getByRole("button", { name: "Compute 2026-27 report" }).click();
		await expect(
			page
				.locator("span")
				.getByText(
					"Report computed for tax year 2026-27 (1 transaction evaluated).",
				),
		).toBeVisible();
		await expect(
			page.getByText(/1 unresolved disposal slice excluded/),
		).toBeVisible();
		await page.goto("/report?taxYear=2026-27");
		await expect(page.getByText("Schedule VDA (1 row)")).toBeVisible();
		await expect(page.getByText(/\b1 (rows|transactions|items)\b/)).toHaveCount(
			0,
		);
	});
});

test.describe("report warnings carry asset/source context", () => {
	test("global pool: negative holding shows the asset chip and links its transaction", async ({
		page,
		api,
	}) => {
		await api.importFile(
			path.join(GENERATED, "sell-without-buy.csv"),
			"binance",
			"UTC",
		);
		await api.compute("2026-27");
		await page.goto("/report?taxYear=2026-27");
		const item = warningsList(page)
			.locator("li")
			.filter({ hasText: "Negative ETH holding: -0.01" });
		await expect(item).toHaveCount(1);
		await expect(item.locator("code")).toHaveText("missing_history");
		await expect(
			item.locator("span").filter({ hasText: /^ETH$/ }),
		).toBeVisible();
		await expect(
			item.getByRole("link", { name: "View transaction" }),
		).toBeVisible();
		// Report-wide notices have no chip.
		const notice = warningsList(page)
			.locator("li")
			.filter({ hasText: "Section numbers pending CA verification" });
		await expect(notice.locator("code")).toHaveText("ca_verification_pending");
		await expect(notice.locator("span")).toHaveCount(0);
	});

	test("per-source pool: balance mismatch shows asset · source and every contributing transaction", async ({
		page,
		api,
	}) => {
		await api.importFile(
			path.join(FIXTURES, "coindcx-report.xlsx"),
			"coindcx",
			"IST",
		);
		await api.putSettings({ lotPool: "per_source" });
		await api.json("PUT", "/api/balances/actual?taxYear=2026-27", [
			{ asset: "BTC", source: "coindcx", amount: "0.004" },
		]);
		await api.compute("2026-27");
		await page.goto("/report?taxYear=2026-27");
		const item = warningsList(page)
			.locator("li")
			.filter({ hasText: "balance_mismatch" });
		await expect(item).toHaveCount(1);
		await expect(
			item.locator("span").filter({ hasText: /^BTC · CoinDCX$/ }),
		).toBeVisible();
		await expect(item.getByText("(×", { exact: false })).toHaveCount(0);
		await expect(
			item.getByRole("link", { name: "View 4 transactions" }),
		).toBeVisible();
		await snap(page, "report-warning-chips");

		await page.goto("/review?taxYear=2026-27");
		const row = group(page, "Computed vs actual balance mismatch").locator(
			"tbody tr",
		);
		await expect(row).toHaveCount(1);
		await expect(row).toContainText("CoinDCX");
		await expect(row).toContainText("BTC");
	});
});

test("Review lists every flag message of a transaction, not only the first", async ({
	page,
	api,
}) => {
	await api.importFile(
		path.join(FIXTURES, "coindcx-report.xlsx"),
		"coindcx",
		"IST",
	);
	await page.goto("/review");
	const g = group(page, "Import parse warning");
	const swap = g.locator("tbody tr").filter({ hasText: "Swap" });
	await expect(swap).toHaveCount(1);
	const messages = swap.getByRole("listitem");
	await expect(messages).toHaveText([
		"Gross INR value is derived from the export's indicative net INR conversion; verify with the trade report.",
		"Export does not separate GST from fees; GST has not been inferred. Verify whether fees include GST.",
	]);
	const sell = g.locator("tbody tr").filter({ hasText: "Sell" }).first();
	await expect(sell.getByRole("listitem")).toHaveCount(0);
	await expect(sell).toContainText("Export does not separate GST from fees");
});
