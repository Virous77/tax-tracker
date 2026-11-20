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
		"coindcx-report.xlsxCoinDCX Trade Report",
		"CoinDCX",
		// Phase 4: the zone cell also says where the zone came from.
		"ISTyour answer",
		"imported",
		"10",
		"8",
		"0",
		"2",
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
		drawer.getByRole("heading", { name: "Row Errors (2)" }),
	).toBeVisible();
	await expect(drawer.locator("pre")).toHaveCount(2);
	await snap(page, "imports-detail-drawer");
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();

	await page.getByRole("button", { name: "Inspect malformed.csv" }).click();
	const malformed = page.getByRole("dialog", { name: "malformed.csv" });
	await expect(
		malformed.getByRole("heading", { name: "Row Errors (11)" }),
	).toBeVisible();
	await expect(malformed.locator("pre")).toHaveCount(11);
	// d9b6170 (P2-API-7): invalid rows are reported once — as these row errors and one
	// import_incomplete item in Review — not again as a parse_warning notice.
	await expect(
		malformed.getByRole("heading", { name: /^Notices/ }),
	).toHaveCount(0);
	await malformed.getByRole("button", { name: "Close drawer" }).click();
	await expect(malformed).toBeHidden();
});

test("delete asks for confirmation; cancel keeps, confirm removes import and its transactions", async ({
	page,
}) => {
	await page.goto("/transactions");
	await expect(page.getByText("Showing 1–12 of 12")).toBeVisible();

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
		page.getByRole("cell", { name: /^malformed\.csv( |$)/ }),
	).toBeVisible();

	await page.getByRole("button", { name: "Delete malformed.csv" }).click();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("cell", { name: /^malformed\.csv( |$)/ }),
	).toBeVisible();

	await page.getByRole("button", { name: "Delete malformed.csv" }).click();
	await dialog.getByRole("button", { name: "Delete import" }).click();
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("cell", { name: /^malformed\.csv( |$)/ }),
	).toHaveCount(0);
	await expect(
		page.getByRole("cell", { name: /^coindcx-report\.xlsx( |$)/ }),
	).toBeVisible();

	await page.reload();
	await expect(
		page.getByRole("cell", { name: /^malformed\.csv( |$)/ }),
	).toHaveCount(0);
	await page.goto("/transactions");
	await expect(page.getByText("Showing 1–8 of 8")).toBeVisible();
});

test("icon-only row actions have a visible tooltip and an accessible name", async ({
	page,
}) => {
	await page.goto("/imports");
	const row = page
		.getByRole("table")
		.first()
		.locator("tbody tr")
		.filter({ hasText: "coindcx-report.xlsx" });
	await expect(
		row.getByRole("button", { name: "Inspect coindcx-report.xlsx" }),
	).toHaveAttribute("title", "Inspect");
	await expect(
		row.getByRole("button", { name: "Delete coindcx-report.xlsx" }),
	).toHaveAttribute("title", "Delete");
});
