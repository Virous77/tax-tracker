import path from "node:path";
import { FIXTURES, GENERATED } from "./support/env";
import { expect, snap, test } from "./support/fixtures";

test.beforeEach(async ({ api }) => {
	await api.reset();
	await api.importFile(path.join(GENERATED, "malformed.csv"), "binance", "UTC");
	await api.importFile(
		path.join(FIXTURES, "coindcx-report.xlsx"),
		"auto",
		"IST",
	);
});

test("lists every import with its counts", async ({ page }) => {
	await page.goto("/imports");
	const rows = page.getByRole("table").first().locator("tbody tr");
	await expect(rows).toHaveCount(2);
	const coindcx = rows.filter({ hasText: "coindcx-report.xlsx" });
	await expect(coindcx.getByRole("cell")).toHaveText([
		"coindcx-report.xlsx",
		"CoinDCX",
		"IST",
		"imported",
		"10",
		"7",
		"0",
		"3",
		/IST$/,
		"",
	]);
	await snap(page, "imports-list");
});

test("detail drawer shows sheets, row errors and raw rows", async ({
	page,
}) => {
	await page.goto("/imports");
	await page
		.getByRole("button", { name: "Inspect coindcx-report.xlsx" })
		.click();
	const drawer = page.getByRole("dialog", { name: "coindcx-report.xlsx" });
	await expect(drawer).toBeVisible();
	await expect(drawer.getByText("CoinDCX", { exact: true })).toBeVisible();
	await expect(drawer.getByRole("heading", { name: "Sheets" })).toBeVisible();
	await expect(
		drawer.getByRole("listitem").filter({ hasText: /rows ·/ }),
	).toHaveCount(4);
	await expect(
		drawer.getByRole("heading", { name: "Row Errors (3)" }),
	).toBeVisible();
	await expect(drawer.locator("pre")).toHaveCount(3);
	await snap(page, "imports-detail-drawer");
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();

	await page.getByRole("button", { name: "Inspect malformed.csv" }).click();
	const malformed = page.getByRole("dialog", { name: "malformed.csv" });
	await expect(
		malformed.getByRole("heading", { name: "Row Errors (11)" }),
	).toBeVisible();
	await expect(malformed.locator("pre")).toHaveCount(11);
	await expect(
		malformed.getByRole("heading", { name: "Warnings (1)" }),
	).toBeVisible();
	await malformed.getByRole("button", { name: "Close drawer" }).click();
	await expect(malformed).toBeHidden();
});

test("delete asks for confirmation; cancel keeps, confirm removes import and its transactions", async ({
	page,
}) => {
	await page.goto("/transactions");
	await expect(page.getByText("Showing 1–11 of 11")).toBeVisible();

	await page.goto("/imports");
	await page.getByRole("button", { name: "Delete malformed.csv" }).click();
	const dialog = page.getByRole("dialog", { name: "Delete import?" });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(
		'This will permanently delete "malformed.csv" along with all 4 imported transactions',
	);
	await snap(page, "imports-delete-confirm");
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("cell", { name: "malformed.csv", exact: true }),
	).toBeVisible();

	await page.getByRole("button", { name: "Delete malformed.csv" }).click();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("cell", { name: "malformed.csv", exact: true }),
	).toBeVisible();

	await page.getByRole("button", { name: "Delete malformed.csv" }).click();
	await dialog.getByRole("button", { name: "Delete import" }).click();
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("cell", { name: "malformed.csv", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("cell", { name: "coindcx-report.xlsx", exact: true }),
	).toBeVisible();

	await page.reload();
	await expect(
		page.getByRole("cell", { name: "malformed.csv", exact: true }),
	).toHaveCount(0);
	await page.goto("/transactions");
	await expect(page.getByText("Showing 1–7 of 7")).toBeVisible();
});
