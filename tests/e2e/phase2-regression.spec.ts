import path from "node:path";
import type { Page } from "@playwright/test";
import { FIXTURES } from "./support/env";
import { expect, reset, settled, shot, test } from "./support/phase2";

test.beforeEach(async ({ api }) => reset(api, false));

const rows = (page: Page) => page.getByRole("table").locator("tbody tr");

async function upload(page: Page, file: string, zone: RegExp) {
	await page.goto("/import");
	await page.getByLabel(/Drop your exchange export here/).setInputFiles(file);
	await page.getByRole("radio", { name: /^Binance / }).check();
	await page.getByRole("radio", { name: zone }).check();
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(
		page.getByRole("heading", {
			name: `${path.basename(file)} — Import complete`,
		}),
	).toBeVisible();
}

test("a file whose header names UTC, imported as IST, warns and names both zones", async ({
	page,
}) => {
	// P2-API-6 regression: the conflict must be visible on the import summary.
	await upload(page, path.join(FIXTURES, "binance-trade-history.csv"), /^IST /);
	await expect(page.getByText(/Time zone: UTC/)).toBeVisible();
	await expect(
		page.getByText(
			"Used UTC from the file header instead of the selected IST.",
			{
				exact: true,
			},
		),
	).toHaveCount(1);
	await shot(page, "import-timezone-conflict");
	await page.goto("/imports");
	await page
		.getByRole("button", { name: "Inspect binance-trade-history.csv" })
		.click();
	await expect(page.getByRole("dialog")).toContainText(
		"Used UTC from the file header instead of the selected IST.",
	);
});

test("the zone source label agrees with the warning: header, not file name", async ({
	page,
}) => {
	// binance-trade-history.csv has no zone in its name; the zone comes from "Date(UTC)".
	await upload(page, path.join(FIXTURES, "binance-trade-history.csv"), /^IST /);
	await expect(page.getByText(/Time zone: UTC/)).toBeVisible();
	await expect(
		page.getByText(/Time zone: UTC \(from the file name\)/),
	).toHaveCount(0);
});

test("statement + Trade History: covered same-second legs leave no empty rows (P2-E2E-6)", async ({
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
		path.join(FIXTURES, "binance-transaction-statement.csv"),
		/^UTC /,
	);
	await page.goto("/transactions?pageSize=100");
	await settled(page);
	for (const day of ["15 Jun 2025", "10 May 2026"]) {
		const sameDay = rows(page).filter({ hasText: day });
		// The Trade History fills, once each; the statement legs are linked to them.
		await expect(sameDay).toHaveCount(2);
		for (const r of await sameDay.all()) {
			await expect(r).toContainText("Swap");
			await expect(r.getByText("unknown_type")).toHaveCount(0);
		}
	}
	await shot(page, "statement-trade-history-transactions");
	await page.goto("/review");
	await settled(page);
	await expect(
		page.getByText(/non-unique or incomplete trade legs/),
	).toHaveCount(0);
});

test("statement alone: ambiguous same-second groups are unclassified, not fees", async ({
	page,
	api,
}) => {
	await api.importFile(
		path.join(FIXTURES, "binance-transaction-statement.csv"),
		"binance",
		"UTC",
	);
	await page.goto("/transactions?pageSize=100");
	await settled(page);
	const ambiguous = rows(page).filter({ hasText: "15 Jun 2025" });
	await expect(ambiguous).not.toHaveCount(0);
	for (const r of await ambiguous.all()) {
		await expect(r).not.toContainText("Fee");
		await expect(r.getByText("unknown_type")).toBeVisible();
	}
	await shot(page, "statement-alone-unclassified");
});

test("no amount-free Fee rows after importing the statement (unknown operation)", async ({
	page,
	api,
}) => {
	await api.importFile(
		path.join(FIXTURES, "binance-trade-history.csv"),
		"binance",
		"UTC",
	);
	await api.importFile(
		path.join(FIXTURES, "binance-transaction-statement.csv"),
		"binance",
		"UTC",
	);
	await page.goto("/transactions?type=fee");
	await settled(page);
	await shot(page, "statement-fee-rows");
	// A fee row must move an amount; an operation the importer does not know is unclassified.
	const emptyFees: string[] = [];
	for (const r of await rows(page).all()) {
		const cells = r.locator("td");
		if ((await cells.count()) < 5) continue;
		const moved = `${await cells.nth(3).textContent()}${await cells.nth(4).textContent()}`;
		if (!/\d/.test(moved)) emptyFees.push((await r.textContent()) ?? "");
	}
	expect(emptyFees, "amount-free rows typed Fee").toEqual([]);
});

test("repeated flags of one code are one chip with a ×N count", async ({
	page,
	api,
}) => {
	await api.addManual({
		sourceRef: "e2e-grouped-flags",
		timestamp: "2026-06-01T06:30:00.000Z",
		type: "buy",
		assetIn: "BTC",
		amountIn: "0.01",
		inrValue: "60000",
		reviewFlags: [
			{ code: "parse_warning", message: "first note about this row" },
			{ code: "parse_warning", message: "second note about this row" },
			{ code: "tds_not_deducted", message: "no TDS on this row" },
		],
	});
	await page.goto("/transactions?flagged=true");
	const row = rows(page).filter({ hasText: "BTC" });
	await expect(row.getByText("parse_warning", { exact: true })).toHaveCount(1);
	await expect(row.getByText("tds_not_deducted", { exact: true })).toHaveCount(
		1,
	);
	await shot(page, "grouped-flag-chips");
	await expect(row.getByText("×2", { exact: true })).toBeVisible();
	await row.getByRole("button").first().click();
	const drawer = page.getByRole("dialog");
	await expect(drawer).toContainText("first note about this row");
	await expect(drawer).toContainText("second note about this row");
	await expect(drawer.getByText("2 reasons")).toBeVisible();
});

test("Review groups repeated report warnings into one row with a ×N count", async ({
	page,
	api,
}) => {
	for (const [i, day] of ["2025-10-01", "2025-10-02"].entries())
		await api.addManual({
			sourceRef: `e2e-grouped-income-${i}`,
			timestamp: `${day}T06:30:00.000Z`,
			type: "income",
			assetIn: "FIXT",
			amountIn: "5",
			incomeKind: "airdrop",
		});
	// Rows outside the selected year are not ledger items there; the 2026-27 report (full
	// history) carries their warning once, with a count.
	await api.compute("2026-27");
	await page.goto("/review?taxYear=2026-27");
	const group = page.locator("section").filter({
		has: page.getByRole("heading", {
			level: 2,
			name: "Missing INR valuation",
			exact: true,
		}),
	});
	const warning = group
		.locator("tbody tr")
		.filter({ hasText: "Report warning" });
	await expect(warning).toHaveCount(1);
	await expect(warning).toContainText("(×2)");
	await shot(page, "review-grouped-report-warning");
});
