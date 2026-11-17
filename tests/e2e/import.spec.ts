import path from "node:path";
import type { Page } from "@playwright/test";
import { FIXTURES, GENERATED } from "./support/env";
import { expect, snap, test } from "./support/fixtures";

const fileInput = (page: Page) =>
	page.getByLabel(/Drop your exchange export here/);

function stat(page: Page, label: string) {
	return page
		.getByText(label, { exact: true })
		.locator("xpath=following-sibling::p[1]");
}

async function upload(
	page: Page,
	file: string,
	source: "Auto-detect" | "Binance" | "CoinDCX" | "Other CSV / XLSX",
	tz: "IST" | "UTC",
) {
	await page.goto("/import");
	await fileInput(page).setInputFiles(file);
	await page.getByRole("radio", { name: new RegExp(`^${source} `) }).check();
	await page.getByRole("radio", { name: new RegExp(`^${tz} `) }).check();
	await page.getByRole("button", { name: "Upload & import" }).click();
}

test.beforeEach(async ({ api }) => {
	await api.reset();
});

test("Binance trade history (UTC) shows the import summary", async ({
	page,
}) => {
	await upload(
		page,
		path.join(FIXTURES, "binance-trade-history.csv"),
		"Binance",
		"UTC",
	);
	await expect(
		page.getByRole("heading", {
			name: "binance-trade-history.csv — Import complete",
		}),
	).toBeVisible();
	await expect(
		page.getByText("Source: Binance · Time zone: UTC (from the file name)"),
	).toBeVisible();
	await expect(stat(page, "Rows read")).toHaveText("8");
	await expect(stat(page, "Inserted")).toHaveText("8");
	await expect(stat(page, "Duplicates skipped")).toHaveText("0");
	await expect(stat(page, "Row errors")).toHaveText("0");
	await snap(page, "import-binance-summary");

	await page.getByRole("link", { name: "View transactions" }).click();
	await expect(page).toHaveURL(/\/transactions$/);
	await expect(page.getByText("Showing 1–8 of 8")).toBeVisible();
});

test("re-importing the same file inserts nothing and reports duplicates", async ({
	page,
	api,
}) => {
	await api.importFile(
		path.join(FIXTURES, "binance-trade-history.csv"),
		"binance",
		"UTC",
	);
	await upload(
		page,
		path.join(FIXTURES, "binance-trade-history.csv"),
		"Binance",
		"UTC",
	);
	await expect(stat(page, "Rows read")).toHaveText("8");
	await expect(stat(page, "Inserted")).toHaveText("0");
	await expect(stat(page, "Duplicates skipped")).toHaveText("8");
	await page.goto("/transactions");
	await expect(page.getByText("Showing 1–8 of 8")).toBeVisible();
});

test("CoinDCX workbook (IST) shows per-sheet summary and row errors", async ({
	page,
}) => {
	await upload(
		page,
		path.join(FIXTURES, "coindcx-report.xlsx"),
		"Auto-detect",
		"IST",
	);
	await expect(
		page.getByRole("heading", {
			name: "coindcx-report.xlsx — Import complete",
		}),
	).toBeVisible();
	await expect(
		page.getByText("Source: CoinDCX · Time zone: IST (your answer)"),
	).toBeVisible();
	await expect(stat(page, "Rows read")).toHaveText("10");
	await expect(stat(page, "Inserted")).toHaveText("8");
	await expect(stat(page, "Row errors")).toHaveText("2");

	const sheetHeading = page.getByRole("heading", { name: "Per-sheet summary" });
	await expect(sheetHeading).toBeVisible();
	const sheetList = sheetHeading.locator("xpath=following-sibling::div[1]");
	for (const [sheet, rows] of [
		["Instant Orders", 2],
		["Spot Orders", 5],
		["Futures Orders (USDT-M)", 1],
		["Crypto Dep&Wdl,Airdrop,Staking", 2],
	] as const) {
		await expect(
			sheetList.getByText(sheet, { exact: true }).locator(".."),
		).toContainText(`${rows} rows`);
	}
	await expect(
		page.getByRole("heading", { name: "Row Errors (2)" }),
	).toBeVisible();
	const errorTable = page
		.getByRole("heading", { name: "Row Errors (2)" })
		.locator("xpath=following-sibling::div[1]")
		.getByRole("table");
	await expect(errorTable.locator("tbody tr")).toHaveCount(2);
	await expect(page.getByText(/parse_warning/).first()).toBeVisible();
	await snap(page, "import-coindcx-summary");
});

test("malformed.csv lists every bad row instead of dropping it", async ({
	page,
}) => {
	await upload(page, path.join(GENERATED, "malformed.csv"), "Binance", "UTC");
	await expect(stat(page, "Rows read")).toHaveText("15");
	await expect(stat(page, "Inserted")).toHaveText("4");
	await expect(stat(page, "Row errors")).toHaveText("11");
	const heading = page.getByRole("heading", { name: "Row Errors (11)" });
	await expect(heading).toBeVisible();
	await expect(
		heading.locator("xpath=following-sibling::div[1]").locator("tbody tr"),
	).toHaveCount(11);
	await snap(page, "import-malformed-row-errors");
});

test("a file over 25 MB is refused with a clear message", async ({ page }) => {
	await page.goto("/import");
	await fileInput(page).setInputFiles(path.join(GENERATED, "huge.csv"));
	await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText(
		/25 MB/,
	);
	await expect(
		page.getByRole("button", { name: "Upload & import" }),
	).toBeDisabled();
});

test("binary noise named .csv shows a readable error", async ({
	page,
	allowConsole,
}) => {
	allowConsole(/status of 422 .*\/api\/imports$/);
	await upload(
		page,
		path.join(GENERATED, "not-a-csv.csv"),
		"Auto-detect",
		"IST",
	);
	await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText(
		"File is not a supported, safe CSV or XLSX workbook.",
	);
	await snap(page, "import-not-a-csv-error");
	await page.goto("/imports");
	await expect(
		page.getByRole("heading", { name: "No files imported yet" }),
	).toBeVisible();
});

test("a header-only CSV says it has no data rows", async ({
	page,
	allowConsole,
}) => {
	allowConsole(/status of 422 .*\/api\/imports$/);
	await upload(page, path.join(GENERATED, "empty.csv"), "Auto-detect", "IST");
	await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText(
		"File contains no data rows.",
	);
});

test("upload works with the keyboard alone", async ({ page }) => {
	await page.goto("/import");
	await expect(
		page.getByRole("heading", { name: "Import", level: 1 }),
	).toBeVisible();
	const input = fileInput(page);
	await input.focus();
	await expect(input).toBeFocused();
	const chooserPromise = page.waitForEvent("filechooser");
	await page.keyboard.press("Space");
	const chooser = await chooserPromise;
	await chooser.setFiles(path.join(FIXTURES, "binance-trade-history.csv"));
	await expect(page.getByText("binance-trade-history.csv")).toBeVisible();

	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("radio", { name: /^Auto-detect / }),
	).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect(page.getByRole("radio", { name: /^Binance / })).toBeChecked();
	await page.keyboard.press("Tab");
	// The file name contains "binance", so the app pre-selects UTC.
	await expect(page.getByRole("radio", { name: /^UTC / })).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(
		page.getByRole("button", { name: "Upload & import" }),
	).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(stat(page, "Inserted")).toHaveText("8");
});

test("the drop zone shows a visible focus ring when tabbed to", async ({
	page,
}) => {
	await page.goto("/import");
	await expect(
		page.getByRole("heading", { name: "Import", level: 1 }),
	).toBeVisible();
	await page.getByRole("link", { name: "Import history" }).focus();
	await page.keyboard.press("Tab");
	await expect(fileInput(page)).toBeFocused();
	const zone = page.locator("label", { has: fileInput(page) });
	const ring = await zone.evaluate((el) => {
		const input = el.querySelector("input") as HTMLInputElement;
		const ownBox = input.getBoundingClientRect();
		const z = getComputedStyle(el);
		const zoneHasRing =
			(z.outlineStyle !== "none" && z.outlineWidth !== "0px") ||
			z.boxShadow !== "none";
		return {
			inputVisible: ownBox.width > 4 && ownBox.height > 4,
			zoneHasRing,
		};
	});
	await snap(page, "import-dropzone-focus");
	expect(
		ring.inputVisible || ring.zoneHasRing,
		"keyboard focus on the file picker must be visible (the input is sr-only and the drop zone shows no focus style)",
	).toBe(true);
});

test.describe("same-origin check in Docker (BUGS.md #1, fixed)", () => {
	test("a real browser upload is accepted by the API's same-origin check", async ({
		page,
	}) => {
		await upload(
			page,
			path.join(FIXTURES, "binance-trade-history.csv"),
			"Binance",
			"UTC",
		);
		await expect(
			page.getByRole("heading", {
				name: "binance-trade-history.csv — Import complete",
			}),
		).toBeVisible();
	});
});
