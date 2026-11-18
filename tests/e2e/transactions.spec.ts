import path from "node:path";
import type { Page } from "@playwright/test";
import { GENERATED } from "./support/env";
import { expect, settled, snap, test } from "./support/fixtures";
import { statement } from "./support/statements";

const rows = (page: Page) => page.getByRole("table").locator("tbody tr");

async function openAddDrawer(page: Page) {
	await page.getByRole("button", { name: "Add manual entry" }).click();
	const drawer = page.getByRole("dialog", { name: "Add manual transaction" });
	await expect(drawer).toBeVisible();
	return drawer;
}

test.describe("with a large Binance history", () => {
	test.beforeAll(async ({ request }) => {
		const { AppApi } = await import("./support/fixtures");
		const api = new AppApi(request);
		await api.reset();
		await api.importFile(
			path.join(GENERATED, "binance-large.csv"),
			"binance",
			"UTC",
		);
	});

	test("filters update the URL and the results", async ({ page }) => {
		await page.goto("/transactions");
		await expect(page.getByText("Showing 1–50 of 5000")).toBeVisible();

		await page.getByLabel("Type").selectOption("sell");
		await expect(page).toHaveURL(/[?&]type=sell/);
		await settled(page);
		const typeCells = rows(page).locator("td:nth-child(2)");
		await expect(typeCells.first()).toHaveText("Sell");
		expect(new Set(await typeCells.allTextContents())).toEqual(
			new Set(["Sell"]),
		);

		await page.getByLabel("Year").selectOption("2025-26");
		await expect(page).toHaveURL(/taxYear=2025-26/);

		await page.getByLabel("Asset").fill("btc");
		await page
			.getByRole("button", { name: "Apply search and text filters" })
			.click();
		await expect(page).toHaveURL(/asset=BTC/);
		await settled(page);
		await expect(rows(page).filter({ hasNotText: "BTC" })).toHaveCount(0);
		await expect(rows(page).first()).toContainText("BTC");
		const filteredTotal = await page
			.getByText(/^Showing \d+–\d+ of \d+$/)
			.textContent();

		await page.reload();
		await expect(page.getByLabel("Type")).toHaveValue("sell");
		await expect(page.getByLabel("Year")).toHaveValue("2025-26");
		await expect(page.getByLabel("Asset")).toHaveValue("BTC");
		await expect(page.getByText(/^Showing \d+–\d+ of \d+$/)).toHaveText(
			filteredTotal ?? "",
		);

		await page.getByLabel("Sort").selectOption("timestamp:asc");
		await expect(page).toHaveURL(/sort=timestamp%3Aasc|sort=timestamp:asc/);

		await page.getByRole("button", { name: "Clear all filters" }).click();
		await expect(page).toHaveURL(/\/transactions$/);
		await expect(page.getByText("Showing 1–50 of 5000")).toBeVisible();
		await snap(page, "transactions-list");
	});

	test("pagination moves through pages and keeps the page in the URL", async ({
		page,
	}) => {
		await page.goto("/transactions");
		const pager = page.getByRole("navigation", { name: "Pagination" });
		await expect(pager).toContainText("Page 1 of 100");
		await expect(
			pager.getByRole("button", { name: "Previous" }),
		).toBeDisabled();
		const firstPageFirstRow = await rows(page).first().textContent();
		await pager.getByRole("button", { name: "Next" }).click();
		await expect(page).toHaveURL(/page=2/);
		await expect(pager).toContainText("Showing 51–100 of 5000");
		await expect(rows(page).first()).not.toHaveText(firstPageFirstRow ?? "");
		await page.goto("/transactions?page=100");
		await expect(pager).toContainText("Showing 4951–5000 of 5000");
		await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();
		await pager.getByRole("button", { name: "Previous" }).click();
		await expect(page).toHaveURL(/page=99/);
	});
});

test.describe("flags, drawer and editing", () => {
	test.beforeEach(async ({ api }) => {
		await api.reset();
		await api.importFile(
			path.join(GENERATED, "sell-without-buy.csv"),
			"binance",
			"UTC",
		);
		await api.importFile(
			statement("statement-without-eth.csv"),
			"binance",
			"UTC",
		);
		// Review flags are attached when a report is computed (see BUGS.md).
		await api.compute("2026-27");
	});

	test("flag chips and the flagged-only filter", async ({ page }) => {
		await page.goto("/transactions");
		await page.getByLabel("Flagged for review only").click();
		await expect(page).toHaveURL(/flagged=true/);
		await expect(page.getByLabel("Flagged for review only")).toBeChecked();
		// The ETH sell, the statement's rebuilt BNB buy (fee paid in BNB) and the airdrop. The
		// statement's USDT deposit and interest are not flagged and must not be listed.
		await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
		await expect(rows(page).filter({ hasText: "Deposit" })).toHaveCount(0);
		const swap = rows(page)
			.filter({ hasText: "Swap" })
			.filter({ hasText: "ETH" });
		await expect(swap.getByText("tds_not_deducted")).toBeVisible();
		// The crypto-fee note moved from parse_warning to its own code (70566bc).
		await expect(swap.getByText("fee_review_required")).toBeVisible();
		await expect(swap.getByText("parse_warning")).toHaveCount(0);
		const bnb = rows(page)
			.filter({ hasText: "Swap" })
			.filter({ hasText: "BNB" });
		await expect(bnb.getByText("fee_review_required")).toBeVisible();
		await expect(bnb.getByText("tds_not_deducted")).toHaveCount(0);
		await expect(
			rows(page).filter({ hasText: "Income" }).getByText("missing_inr_value"),
		).toBeVisible();
	});

	test("drawer shows the raw original row; edits persist after reload; flag can be resolved", async ({
		page,
	}) => {
		await page.goto("/transactions?flagged=true");
		const incomeRow = rows(page).filter({ hasText: "missing_inr_value" });
		await incomeRow.getByRole("button").first().click();
		const drawer = page.getByRole("dialog", { name: /^Income/ });
		await expect(drawer).toBeVisible();
		await expect(
			drawer.getByRole("heading", { name: "Raw Original Row" }),
		).toBeVisible();
		await expect(drawer.locator("pre")).toContainText("Operation");
		await snap(page, "transactions-drawer");

		await drawer.getByLabel("Transaction type").selectOption("income");
		await drawer.getByLabel("Income kind").selectOption("airdrop");
		await drawer.getByLabel("INR value (₹)").fill("1234.50");
		await drawer
			.getByLabel("Note (saved for CA / audit trail)")
			.fill("e2e: valued from CoinGecko close");
		await drawer.getByRole("checkbox", { name: /missing_inr_value/ }).check();
		await drawer.getByRole("button", { name: "Save changes" }).click();
		await expect(drawer.getByText("₹1,234.50")).toBeVisible();

		await page.goto("/transactions?type=income");
		const edited = rows(page).filter({ hasText: "₹1,234.50" });
		await expect(edited).toHaveCount(1);
		await expect(edited).toContainText("airdrop");
		await expect(edited.getByText("missing_inr_value")).toHaveCount(0);
		await edited.getByRole("button").first().click();
		const again = page.getByRole("dialog", { name: /^Income/ });
		await expect(again.getByLabel("INR value (₹)")).toHaveValue("1234.50");
		await expect(
			again.getByLabel("Note (saved for CA / audit trail)"),
		).toHaveValue("e2e: valued from CoinGecko close");
		await expect(again.getByLabel("Income kind")).toHaveValue("airdrop");
	});
});

test.describe("manual entries", () => {
	test.beforeEach(async ({ api }) => {
		await api.reset();
	});

	test("add gift with cost, income and missing buy", async ({ page }) => {
		await page.goto("/transactions");

		let drawer = await openAddDrawer(page);
		await drawer.getByRole("button", { name: "Gift", exact: true }).click();
		await drawer.getByLabel("Date & time (IST)").fill("2026-06-01T10:00");
		await drawer.getByLabel("Asset received *").fill("btc");
		await drawer.getByLabel("Quantity received *").fill("0.01");
		await drawer.getByLabel("Cost / FMV in INR (₹)").fill("55000");
		await drawer.getByLabel("Note").fill("gift from parent");
		await snap(page, "transactions-add-gift");
		await drawer.getByRole("button", { name: "Add transaction" }).click();
		await expect(drawer).toBeHidden();
		await expect(rows(page).filter({ hasText: "Gift" })).toContainText(
			"₹55,000.00",
		);

		drawer = await openAddDrawer(page);
		await drawer.getByRole("button", { name: "Income", exact: true }).click();
		await drawer.getByLabel("Date & time (IST)").fill("2026-07-01T10:00");
		await drawer.getByLabel("Income kind").selectOption("staking");
		await drawer.getByLabel("Asset received *").fill("ETH");
		await drawer.getByLabel("Quantity received *").fill("0.1");
		await drawer.getByLabel("FMV at receipt in INR (₹)").fill("20000");
		await drawer.getByRole("button", { name: "Add transaction" }).click();
		await expect(drawer).toBeHidden();
		await expect(rows(page).filter({ hasText: "staking" })).toContainText(
			"₹20,000.00",
		);

		drawer = await openAddDrawer(page);
		await drawer
			.getByRole("button", { name: "Missing Buy", exact: true })
			.click();
		await drawer.getByLabel("Date & time (IST)").fill("2026-05-01T09:30");
		await drawer.getByLabel("Asset received *").fill("SOL");
		await drawer.getByLabel("Quantity received *").fill("2");
		await drawer.getByLabel("Cost in INR (₹)").fill("15000");
		await drawer.getByRole("button", { name: "Add transaction" }).click();
		await expect(drawer).toBeHidden();

		await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
		const buy = rows(page).filter({ hasText: "SOL" });
		await expect(buy).toContainText("Buy");
		await expect(buy).toContainText("Manual");
		await expect(buy).toContainText("01 May 2026");
		await page.reload();
		await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
		await snap(page, "transactions-manual-entries");
	});

	test("validation errors are shown and nothing is saved", async ({
		page,
		allowConsole,
	}) => {
		allowConsole(/status of 400 .*\/api\/transactions$/);
		await page.goto("/transactions");
		const drawer = await openAddDrawer(page);
		await drawer.getByRole("button", { name: "Sell", exact: true }).click();
		await drawer.getByRole("button", { name: "Add transaction" }).click();
		await expect(drawer).toBeVisible();
		const invalid = await drawer
			.getByLabel("Asset sold *")
			.evaluate((el: HTMLInputElement) => el.validity.valueMissing);
		expect(invalid).toBe(true);

		await drawer
			.getByRole("button", { name: "Missing Buy", exact: true })
			.click();
		await drawer.getByLabel("Asset received *").fill("BTC");
		await drawer.getByLabel("Quantity received *").fill("not-a-number");
		await drawer.getByLabel("Cost in INR (₹)").fill("1000");
		await drawer.getByRole("button", { name: "Add transaction" }).click();
		const banner = drawer.getByRole("alert");
		await expect(banner).toBeVisible();
		await snap(page, "transactions-validation-error");
		await expect(
			banner,
			"error must be a readable sentence, not a raw Zod issue dump",
		).not.toContainText(/[{[]|invalid_format|\^\[/);
		await expect(banner).toContainText(/quantity|amount/i);
		await drawer.getByRole("button", { name: "Cancel" }).click();
		await expect(
			page.getByRole("heading", { name: "No transactions match" }),
		).toBeVisible();
	});
});
