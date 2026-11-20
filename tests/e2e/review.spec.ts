import path from "node:path";
import { GENERATED } from "./support/env";
import { expect, settled, snap, test } from "./support/fixtures";
import { statement } from "./support/statements";

// Phase 4 (2d31f5f): an input change keeps the last report as stale, so after reset() and an
// import the Review banner is the stale one with Recompute, not "Report not computed".
const staleBanner = (page: import("@playwright/test").Page) =>
	page
		.getByRole("status")
		.filter({ hasText: "Your data changed since this report was computed." });

const group = (page: import("@playwright/test").Page, title: string) =>
	page.locator("section").filter({
		has: page.getByRole("heading", { level: 2, name: title, exact: true }),
	});

// The statement is a ledger source since Phase 2, so it must not cover the ETH sold here: it
// holds no ETH (and no BTC) and keeps the income row without an INR value.
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
});

test("before any compute the queue does not claim everything is clean", async ({
	page,
}) => {
	// Flags are attached at compute time (apps/web/src/server/README.md). Until then the
	// queue cannot know; it must say so rather than declare a ledger with a valueless
	// income row "clean". The import screen links straight here ("Check review flags").
	await page.goto("/review?taxYear=all");
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
	await expect(staleBanner(page)).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Computed vs actual balance mismatch" }),
	).toHaveCount(0);
	await snap(page, "review-report-not-computed");

	await staleBanner(page).getByRole("button", { name: "Recompute" }).click();
	const mismatch = page.locator("section").filter({
		has: page.getByRole("heading", {
			level: 2,
			name: "Computed vs actual balance mismatch",
		}),
	});
	await expect(mismatch).toBeVisible();
	await expect(staleBanner(page)).toHaveCount(0);
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
	await expect(staleBanner(page)).toBeVisible();
});

test.describe("after computing", () => {
	// Phase 4: the All-years view uses every year's report, and a stale 2025-26 one from reset()
	// would hide that year's items, so both years are computed.
	test.beforeEach(async ({ api }) => {
		await api.compute("2025-26");
		await api.compute("2026-27");
	});

	test("groups by reason with an explanation and a fix action", async ({
		page,
	}) => {
		await page.goto("/review?taxYear=all");
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
			await expect(g.getByRole("link", { name: fix }).first()).toBeVisible();
		}
		await snap(page, "review-groups");
	});

	test("a sell without a buy shows both the negative holding and the unresolved slice", async ({
		page,
	}) => {
		// One sell without history yields two distinct report checks (server README):
		// a negative year-end holding and an unresolved FIFO slice. Both need a fix link.
		await page.goto("/review?taxYear=2026-27");
		const g = group(page, "Missing acquisition history");
		const rows = g.locator("tbody tr");
		await expect(rows).toHaveCount(2);
		await expect(g.getByText("2 items")).toBeVisible();
		const negative = rows.filter({ hasText: "Negative holding" });
		await expect(negative).toContainText("Global");
		await expect(negative).toContainText("ETH: computed -0.01");
		await expect(negative).toContainText("Negative ETH holding: -0.01");
		await expect(
			negative.getByRole("link", { name: "View 1 transaction" }),
		).toBeVisible();
		const slice = rows.filter({ hasText: "Unresolved slice" });
		await expect(slice).toContainText("Unresolved 0.01 ETH: missing_history.");
		await expect(slice).toContainText("Reason: Missing acquisition history");
		await expect(
			negative.getByRole("link", { name: "Add missing buy" }),
		).toHaveAttribute(
			"href",
			"/transactions?add=buy&asset=ETH&taxYear=2026-27",
		);
		// Phase 4: the slice's link dates the new buy just before the sale.
		await expect(
			slice.getByRole("link", { name: "Add missing buy" }),
		).toHaveAttribute(
			"href",
			"/transactions?add=buy&asset=ETH&taxYear=2026-27&before=2026-05-15T10%3A00%3A00.000Z",
		);
		// The swap itself is not repeated as a ledger item in this group.
		await expect(rows.filter({ hasText: "Inspect" })).toHaveCount(0);
		await snap(page, "review-negative-holding");
	});

	test("singular and plural item counts", async ({ page }) => {
		await page.goto("/review?taxYear=2026-27");
		await expect(
			group(page, "TDS not deducted by platform").getByText("1 item", {
				exact: true,
			}),
		).toBeVisible();
		await expect(
			group(page, "Missing acquisition history").getByText("2 items", {
				exact: true,
			}),
		).toBeVisible();
		await expect(page.getByText(/\b1 items\b|\b[02-9] item\b/)).toHaveCount(0);
	});

	test("year filter narrows the queue", async ({ page }) => {
		await page.goto("/review?taxYear=all");
		const income = page.getByRole("row").filter({ hasText: "05 Oct 2025" });
		await expect(income).toHaveCount(1);
		await page.getByLabel("Tax year").selectOption("2026-27");
		await expect(page).toHaveURL(/taxYear=2026-27/);
		await expect(
			page.getByRole("heading", { name: "Missing acquisition history" }),
		).toBeVisible();
		await settled(page);
		// The 2025-26 income row leaves the ledger items. Its missing-INR warning is still
		// carried by the 2026-27 report (full history), so it stays as a report-warning row
		// linking back to the transaction (server README, "warning" report items).
		await expect(income).toHaveCount(0);
		const inr = group(page, "Missing INR valuation").locator("tbody tr");
		await expect(inr).toHaveCount(1);
		await expect(inr).toContainText("Tax year 2026-27");
		await expect(inr).toContainText("Report warning");
		await expect(inr.getByRole("button", { name: "Inspect" })).toHaveCount(0);
	});

	test("fix action for missing history opens a pre-filled missing buy and the item goes away", async ({
		page,
		api,
	}) => {
		await page.goto("/review?taxYear=2026-27");
		await group(page, "Missing acquisition history")
			.getByRole("link", { name: "Add missing buy" })
			.first()
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
		await page.goto("/review?taxYear=all");
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
		await page.goto("/review?taxYear=all");
		await group(page, "Missing INR valuation")
			.getByRole("link", { name: "Edit INR value" })
			.click();
		await expect(page).toHaveURL(/\/transactions\?.*flagged=true/);
		await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
		await expect(page.getByText("missing_inr_value")).toBeVisible();
	});
});

test("All years: after Recompute the stale banner goes away", async ({
	page,
}) => {
	// Review without ?taxYear needs every rule year current; Recompute must compute every year
	// in computeTaxYears, not the default year again and again (BUGS N1).
	await page.goto("/review?taxYear=all");
	await expect(page.locator(".animate-pulse")).toHaveCount(0);
	await expect(staleBanner(page)).toBeVisible();
	await staleBanner(page).getByRole("button", { name: "Recompute" }).click();
	await expect(
		page.getByRole("heading", { name: "Missing acquisition history" }),
	).toBeVisible();
	await expect(
		staleBanner(page),
		"both years were just computed; the banner must go away",
	).toHaveCount(0);
	await page.reload();
	await expect(
		page.getByRole("heading", { name: "Missing acquisition history" }),
	).toBeVisible();
	await expect(staleBanner(page)).toHaveCount(0);
});

// The "Not computed: <year>" wording needs a year that was never computed, which only a fresh
// database has; here the other year is stale, and Recompute computes just that one.
test("All years with one year current recomputes only the stale year", async ({
	page,
	api,
}) => {
	await api.compute("2026-27");
	await page.goto("/review?taxYear=all");
	await expect(page.locator(".animate-pulse")).toHaveCount(0);
	const banner = staleBanner(page);
	await expect(banner).toBeVisible();
	const computed: string[] = [];
	page.on("request", (req) => {
		const m = /\/api\/reports\/([\d-]+)\/compute$/.exec(req.url());
		if (m && req.method() === "POST") computed.push(m[1] as string);
	});
	await banner.getByRole("button", { name: "Recompute" }).click();
	await expect(banner).toHaveCount(0);
	expect(computed).toEqual(["2025-26"]);
	await expect(
		page.getByRole("button", { name: /Compute .* report/ }),
	).toHaveCount(0);
});
