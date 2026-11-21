import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { FIXTURES, GENERATED } from "./support/env";
import { expect, settled, snap, test } from "./support/fixtures";
import { statement } from "./support/statements";

// Regressions for the fixes in 70566bc (server) and 9fe338e (UI).

// Phase 2 rebuilds statement trades; the legs folded into a rebuilt trade are kept as skipped
// rows that point at the grouped transaction (packages/importers/README.md).
const STATEMENT_NAME = "statement-grouped-legs.csv";
const SKIP_REASON =
	"Statement leg is preserved in the grouped transaction raw rows.";
const staleBanner = (page: Page) =>
	page
		.getByRole("status")
		.filter({ hasText: "Your data changed since this report was computed." });

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

test.describe("grouped statement legs are skips, not errors", () => {
	test("import summary shows a neutral skipped section and the count equation", async ({
		page,
	}) => {
		await page.goto("/import");
		await page
			.getByLabel(/Drop your exchange export here/)
			.setInputFiles(statement(STATEMENT_NAME));
		await page.getByRole("radio", { name: /^Binance / }).check();
		await page.getByRole("radio", { name: /^UTC / }).check();
		await page.getByRole("button", { name: "Upload & import" }).click();
		await expect(
			page.getByRole("heading", {
				name: `${STATEMENT_NAME} — Import complete`,
			}),
		).toBeVisible();
		await expect(stat(page, "Rows read")).toHaveText("10");
		await expect(stat(page, "Inserted")).toHaveText("4");
		await expect(stat(page, "Duplicates skipped")).toHaveText("0");
		await expect(stat(page, "Skipped")).toHaveText("4");
		await expect(stat(page, "Row errors")).toHaveText("2");
		await expect(
			page.getByText(
				"10 read = 4 inserted + 0 duplicates + 4 skipped + 2 errors",
			),
		).toBeVisible();

		const skipped = page.getByRole("heading", {
			name: /^Skipped — .*\(4\)/,
		});
		await expect(skipped).toBeVisible();
		const skipTable = skipped.locator("xpath=following-sibling::div[1]");
		await expect(skipTable.locator("tbody tr")).toHaveCount(4);
		await expect(
			skipTable.locator("tbody tr").first().getByRole("cell").last(),
		).toHaveText(SKIP_REASON);
		await expect(
			page.getByRole("heading", { name: "Row Errors (2)" }),
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
		expect(await headingColour(/^Skipped — /)).not.toBe(
			await headingColour(/^Row Errors/),
		);
		// Grouped legs add no warning of their own; invalid rows are reported once (P2-API-7).
		await expect(
			page.getByRole("listitem").filter({ hasText: /^parse_warning:/ }),
		).toHaveCount(0);
		await snap(page, "import-statement-skips");
	});

	test("re-import: duplicates, skips and errors still add up; Imports list and drawer agree", async ({
		page,
		api,
	}) => {
		const file = statement(STATEMENT_NAME);
		await api.importFile(file, "binance", "UTC");
		await api.importFile(file, "binance", "UTC");
		await page.goto("/imports");
		const rows = page.getByRole("table").first().locator("tbody tr");
		await expect(rows).toHaveCount(2);
		for (const row of await rows.all())
			await expect(row).toContainText("4 skipped");

		await page
			.getByRole("button", { name: `Inspect ${STATEMENT_NAME}` })
			.first()
			.click();
		const drawer = page.getByRole("dialog", { name: STATEMENT_NAME });
		await expect(drawer).toBeVisible();
		await expect(
			drawer.getByText(
				/^10 read = (4 inserted \+ 0 duplicates|0 inserted \+ 4 duplicates) \+ 4 skipped \+ 2 errors$/,
			),
		).toBeVisible();
		await expect(
			drawer.getByRole("heading", { name: /^Skipped — .*\(4\)/ }),
		).toBeVisible();
		await expect(drawer.getByText(SKIP_REASON)).toHaveCount(4);
		await expect(
			drawer.getByRole("heading", { name: "Row Errors (2)" }),
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
			[0, 4],
			[4, 0],
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

	// Phase 4 (2d31f5f): the last report is kept as stale; the cause is in the API's 404 details,
	// and Report shows a stale banner with Recompute instead of the "Report cleared" empty state.
	async function expectCleared(page: Page, cause: string) {
		const res = await page.request.get("/api/reports/2026-27");
		expect(res.status()).toBe(404);
		const details = (await res.json()).error.details;
		expect(details.cause).toBe(cause);
		expect(Date.parse(details.invalidatedAt)).not.toBeNaN();
		await page.goto("/report?taxYear=2026-27");
		await settled(page);
		const stale = staleBanner(page);
		await expect(stale).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Report cleared for 2026-27" }),
		).toHaveCount(0);
		await stale.getByRole("button", { name: "Recompute" }).click();
		await expect(stale).toHaveCount(0);
		await page.goto("/?taxYear=2026-27");
		await settled(page);
		await expect(page.getByText(/Report cleared for/)).toHaveCount(0);
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
		await expectCleared(page, "ledger_changed");
		await snap(page, "overview-after-recompute");
	});

	test("settings change", async ({ page, api }) => {
		await computeAndCheck(page, api);
		await api.putSettings({ surchargeRate: "0.10" });
		await expectCleared(page, "settings_changed");
	});

	test("actual balances change", async ({ page, api }) => {
		await computeAndCheck(page, api);
		await api.json("PUT", "/api/balances/actual?taxYear=2026-27", [
			{ asset: "ETH", amount: "0" },
		]);
		await expectCleared(page, "balances_changed");
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
		await expect(staleBanner(page)).toBeVisible();
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
			page.getByText("1 item needs review before filing."),
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
			page.getByText("2 items need review before filing."),
		).toBeVisible();
	});

	test("Overview: report notices are not counted as review items", async ({
		page,
		api,
	}) => {
		for (const tx of flagged(1)) await api.addManual(tx);
		await api.compute("2026-27");
		await page.goto("/?taxYear=2026-27");
		await expect(
			page.getByText("1 item needs review before filing."),
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
		await settled(page);
		// Phase 4: Overview shows the stale report, so its header button is the way to compute.
		await page.getByRole("button", { name: "Compute report" }).click();
		await expect(
			page
				.locator("span")
				.getByText(
					"Report computed for tax year 2026-27 (1 transaction evaluated).",
				),
		).toBeVisible();
		await expect(
			page.getByText(/1 sale is left out of your totals/),
		).toBeVisible();
		await page.goto("/report?taxYear=2026-27");
		// Phase 4: a sale with no buy history is kept out of Schedule VDA and the report is incomplete.
		await expect(page.getByText("Schedule VDA (0 rows)")).toBeVisible();
		await expect(
			page.getByText("1 sale left out of your totals"),
		).toBeVisible();
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
	await page.goto("/review?taxYear=all");
	const g = group(page, "Import parse warning");
	const swap = g.locator("tbody tr").filter({ hasText: "Swap" });
	await expect(swap).toHaveCount(1);
	// Since d9b6170 the server merges same-code flags into one message (BUGS.md P2-E2E-7), so
	// both notes arrive as one sentence pair instead of a list; both must still be shown.
	for (const message of [
		"Gross INR value is derived from the export's indicative net INR conversion; verify with the trade report.",
		"Export does not separate GST from fees; GST has not been inferred. Verify whether fees include GST.",
	])
		await expect(swap).toContainText(message);
	const sell = g.locator("tbody tr").filter({ hasText: "Sell" }).first();
	await expect(sell.getByRole("listitem")).toHaveCount(0);
	await expect(sell).toContainText("Export does not separate GST from fees");
});
