import path from "node:path";
import { FIXTURES, GENERATED } from "./support/env";
import { expect, snap, test } from "./support/fixtures";

const group = (page: import("@playwright/test").Page, title: string) =>
	page.locator("section").filter({
		has: page.getByRole("heading", { level: 2, name: title, exact: true }),
	});

test.beforeEach(async ({ api }) => {
	await api.reset();
	await api.importFile(
		path.join(GENERATED, "sell-without-buy.csv"),
		"binance",
		"UTC",
	);
	await api.importFile(
		path.join(FIXTURES, "binance-transaction-statement.csv"),
		"binance",
		"UTC",
	);
});

test("before any compute the queue does not claim everything is clean", async ({
	page,
}) => {
	// Flags are attached at compute time (apps/web/src/server/README.md). Until then the
	// queue cannot know; it must say so rather than declare a ledger with a valueless
	// income row "clean". The import screen links straight here ("Check review flags").
	await page.goto("/review");
	await expect(
		page.getByRole("heading", { level: 1, name: "Review Queue" }),
	).toBeVisible();
	await expect(page.locator(".animate-pulse")).toHaveCount(0);
	await expect(
		page.getByText("All ledger transactions are clean."),
	).toHaveCount(0);
});

test("reportStatus banner prompts a compute, then the balance mismatch appears as a report item", async ({
	page,
	api,
}) => {
	await api.json("PUT", "/api/balances/actual?taxYear=2026-27", [
		{ asset: "BTC", amount: "2" },
	]);
	await page.goto("/review?taxYear=2026-27");
	await expect(page.locator(".animate-pulse")).toHaveCount(0);
	await expect(
		page.getByText(/Report not computed for 2026-27/).first(),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Computed vs actual balance mismatch" }),
	).toHaveCount(0);
	await snap(page, "review-report-not-computed");

	await page
		.getByRole("button", { name: "Compute 2026-27 report" })
		.first()
		.click();
	const mismatch = page.locator("section").filter({
		has: page.getByRole("heading", {
			level: 2,
			name: "Computed vs actual balance mismatch",
		}),
	});
	await expect(mismatch).toBeVisible();
	await expect(page.getByText(/Report not computed for 2026-27/)).toHaveCount(
		0,
	);
	const row = mismatch.locator("tbody tr").filter({ hasText: "BTC" });
	await expect(row).toContainText("Year-end balance");
	await expect(row).toContainText("Tax year 2026-27");
	await expect(row).toContainText("BTC: computed 0, actual 2");
	await expect(
		mismatch.getByText("balance_mismatch", { exact: true }),
	).toBeVisible();
	await snap(page, "review-balance-mismatch-report-item");

	// Any ledger change deletes stored reports, so the banner must come back.
	await api.addManual({
		sourceRef: "e2e-review-invalidate",
		timestamp: "2026-06-01T06:30:00.000Z",
		type: "buy",
		assetIn: "SOL",
		amountIn: "1",
		inrValue: "1000",
	});
	await page.reload();
	await expect(
		page.getByText(/Report not computed for 2026-27/).first(),
	).toBeVisible();
});

test.describe("after computing", () => {
	test.beforeEach(async ({ api }) => {
		await api.compute("2026-27");
	});

	test("groups by reason with an explanation and a fix action", async ({
		page,
	}) => {
		await page.goto("/review");
		for (const [title, code, explanation, fix] of [
			[
				"Missing acquisition history",
				"missing_history",
				"missing cost of acquisition cannot be guessed silently",
				"Add missing buy",
			],
			[
				"Missing INR valuation",
				"missing_inr_value",
				"Set an INR value manually",
				"Edit INR value",
			],
			[
				"TDS not deducted by platform",
				"tds_not_deducted",
				"do not deduct 1% VDA TDS",
				"Review TDS in Report",
			],
		] as const) {
			const g = group(page, title);
			await expect(g).toBeVisible();
			await expect(g.getByText(code, { exact: true })).toBeVisible();
			await expect(g).toContainText(explanation);
			await expect(g.getByRole("link", { name: fix })).toBeVisible();
		}
		await snap(page, "review-groups");
	});

	test("year filter narrows the queue", async ({ page }) => {
		await page.goto("/review");
		await page.getByLabel("Tax year").selectOption("2026-27");
		await expect(page).toHaveURL(/taxYear=2026-27/);
		await expect(
			page.getByRole("heading", { name: "Missing INR valuation" }),
		).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "Missing acquisition history" }),
		).toBeVisible();
	});

	test("fix action for missing history opens a pre-filled missing buy and the item goes away", async ({
		page,
		api,
	}) => {
		await page.goto("/review?taxYear=2026-27");
		await group(page, "Missing acquisition history")
			.getByRole("link", { name: "Add missing buy" })
			.click();
		await expect(page).toHaveURL(/\/transactions\?.*add=buy/);
		await expect(page).toHaveURL(/asset=ETH/);
		const drawer = page.getByRole("dialog", { name: "Add manual transaction" });
		await expect(drawer).toBeVisible();
		await expect(drawer.getByLabel("Asset received *")).toHaveValue("ETH");
		await drawer.getByLabel("Date & time (IST)").fill("2026-05-01T10:00");
		await drawer.getByLabel("Quantity received *").fill("0.01");
		await drawer.getByLabel("Cost in INR (₹)").fill("2500");
		await drawer.getByRole("button", { name: "Add transaction" }).click();
		await expect(drawer).toBeHidden();
		await expect(page).not.toHaveURL(/add=buy/);

		await api.compute("2026-27");
		await page.goto("/review?taxYear=2026-27");
		await expect(
			page.getByRole("heading", { name: "TDS not deducted by platform" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Missing acquisition history" }),
		).toHaveCount(0);
	});

	test("resolving a flag in the drawer removes the item", async ({ page }) => {
		await page.goto("/review");
		const g = group(page, "Missing INR valuation");
		await g.getByRole("button", { name: "Inspect" }).click();
		const drawer = page.getByRole("dialog", { name: /^Income/ });
		await drawer.getByLabel("INR value (₹)").fill("10");
		await drawer.getByRole("checkbox", { name: /missing_inr_value/ }).check();
		await drawer.getByRole("button", { name: "Save changes" }).click();
		await expect(
			page.getByRole("heading", { name: "Missing INR valuation" }),
		).toHaveCount(0);
		await page.keyboard.press("Escape");
		await page.reload();
		await expect(
			page.getByRole("heading", { name: "Missing INR valuation" }),
		).toHaveCount(0);
	});

	test("edit-INR fix link lands on the flagged transaction", async ({
		page,
	}) => {
		await page.goto("/review");
		await group(page, "Missing INR valuation")
			.getByRole("link", { name: "Edit INR value" })
			.click();
		await expect(page).toHaveURL(/\/transactions\?.*flagged=true/);
		await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
		await expect(page.getByText("missing_inr_value")).toBeVisible();
	});
});

test("All years: after Compute the banner no longer says that year is not computed", async ({
	page,
}) => {
	// Review without ?taxYear needs every rule year computed for reportStatus "current",
	// but the button only computes the default year, so the prompt never goes away.
	await page.goto("/review");
	await expect(page.locator(".animate-pulse")).toHaveCount(0);
	await page
		.getByRole("button", { name: "Compute 2026-27 report" })
		.first()
		.click();
	await expect(
		page.getByRole("heading", { name: "Missing acquisition history" }),
	).toBeVisible();
	await expect(
		page.getByText(/Report not computed for 2026-27/),
		"2026-27 was just computed; the banner should name the year still missing or go away",
	).toHaveCount(0);
});
