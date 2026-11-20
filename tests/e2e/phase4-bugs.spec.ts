import type { Page } from "@playwright/test";
import { REPO_ROOT } from "./support/env";
import { expect, settled, test } from "./support/fixtures";

// Open Phase 4 bugs (tests/e2e/BUGS.md "Phase 4 final"). Not serial, so each runs on its own.
const GENERIC_FILE = "generic-unknown-exchange.SYNTHETIC.csv";
const RECIPE_NAME = "E2E Example Exchange";

test.beforeEach(async ({ api }) => {
	await api.reset();
});

test("P4-E2E-4: Imports names the recipe of a generic CSV import, as Transactions does", async ({
	page,
}) => {
	await page.goto("/import");
	await settled(page);
	await page
		.getByLabel(/Drop your exchange export here/)
		.setInputFiles(`${REPO_ROOT}/examples/${GENERIC_FILE}`);
	await page.getByRole("radio", { name: /^Auto-detect / }).check();
	await page.getByRole("radio", { name: /^IST / }).check();
	await page.getByRole("button", { name: "Upload & import" }).click();
	for (const [label, value] of [
		[/^Timestamp/, "Date"],
		[/^Amount \/ Quantity/, "Volume"],
		[/^Trading Pair/, "Market"],
	] as const)
		await page.getByRole("combobox", { name: label }).selectOption(value);
	await page.getByLabel("Date format").fill("yyyy-MM-dd HH:mm:ss");
	await page.getByLabel("Recipe name").fill(RECIPE_NAME);
	await page.getByRole("button", { name: "Confirm & import" }).click();
	await expect(
		page.getByRole("heading", { name: `${GENERIC_FILE} — Import complete` }),
	).toBeVisible();
	const label = `Generic CSV · ${RECIPE_NAME}`;
	await page.goto("/transactions");
	await settled(page);
	await expect(page.getByText(label).first()).toBeVisible();
	await page.goto("/imports");
	await settled(page);
	await expect(
		page.locator("tr").filter({ hasText: GENERIC_FILE }).first(),
	).toContainText(label);
});

function staleNotice(page: Page) {
	return page.getByText("Your data changed since this report was computed.");
}

test("P4-E2E-5: Overview says when its figures come from a stale report", async ({
	page,
	api,
}) => {
	await api.seedWorkedExample();
	await api.compute("2026-27");
	await api.addManual({
		sourceRef: "e2e-p4-stale-overview",
		timestamp: "2026-09-01T06:30:00.000Z",
		type: "sell",
		assetOut: "SOL",
		amountOut: "1",
		inrValue: "90000",
	});
	await page.goto("/report?taxYear=2026-27");
	await settled(page);
	await expect(staleNotice(page)).toBeVisible();
	await page.goto("/?taxYear=2026-27");
	await settled(page);
	await expect(page.getByText("₹13,100.00").first()).toBeVisible();
	await expect(staleNotice(page)).toBeVisible();
});
