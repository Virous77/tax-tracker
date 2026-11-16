import { expect, settled, snap, test } from "./support/fixtures";

// Runs first, against the freshly created data dir: no imports, no reports, default settings.

test("overview empty state offers import and manual entry", async ({
	page,
}) => {
	await page.goto("/");
	await expect(
		page.getByRole("heading", {
			name: "No transactions yet — import an export file",
		}),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "Import file" })).toHaveAttribute(
		"href",
		"/import",
	);
	await expect(
		page.getByRole("link", { name: "Add manual transaction" }),
	).toBeVisible();
	await snap(page, "empty-overview");
});

test("import screen starts with an empty drop zone and disabled submit", async ({
	page,
}) => {
	await page.goto("/import");
	await expect(page.getByText("Drop your exchange export here")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Upload & import" }),
	).toBeDisabled();
	await expect(
		page.getByRole("radio", { name: /^Auto-detect / }),
	).toBeChecked();
	await expect(
		page.getByRole("radio", { name: /IST \(Asia\/Kolkata/ }),
	).toBeChecked();
	await snap(page, "empty-import");
});

test("imports list empty state", async ({ page }) => {
	await page.goto("/imports");
	await expect(
		page.getByRole("heading", { name: "No files imported yet" }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "Import a file" })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: /Saved CSV Recipes/ }),
	).toHaveCount(0);
	await snap(page, "empty-imports");
});

test("transactions empty state", async ({ page }) => {
	await page.goto("/transactions");
	await expect(
		page.getByRole("heading", { name: "No transactions match" }),
	).toBeVisible();
	await expect(
		page.getByText(
			"No transactions yet — import an export file or add a manual transaction.",
		),
	).toBeVisible();
	await expect(
		page.getByRole("navigation", { name: "Pagination" }),
	).toHaveCount(0);
	await snap(page, "empty-transactions");
});

test("review empty state", async ({ page }) => {
	await page.goto("/review");
	await expect(
		page.getByRole("heading", { name: "No review flags found" }),
	).toBeVisible();
	await expect(
		page.getByText("All ledger transactions are clean."),
	).toBeVisible();
	await snap(page, "empty-review");
});

test("report empty state offers to compute", async ({ page }) => {
	await page.goto("/report");
	await expect(
		page.getByRole("heading", { name: "No report computed for 2026-27" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Compute 2026-27 report" }),
	).toBeVisible();
	await page.getByLabel("Tax year").selectOption("2025-26");
	await expect(page).toHaveURL(/taxYear=2025-26/);
	await expect(
		page.getByRole("heading", { name: "No report computed for 2025-26" }),
	).toBeVisible();
	await snap(page, "empty-report");
});

test("settings shows defaults on a fresh install", async ({ page }) => {
	await page.goto("/settings");
	await settled(page);
	await expect(page.getByLabel("Fee & GST treatment")).toHaveValue("exclude");
	await expect(page.getByLabel("Surcharge rate")).toHaveValue("0");
	await expect(page.getByLabel("Default tax year")).toHaveValue("2026-27");
	await expect(page.getByLabel("OpenAI-compatible base URL")).toHaveValue(
		"http://ollama:11434/v1",
	);
	await expect(page.getByText("Local endpoint")).toBeVisible();
	await expect(page.getByText("Cloud endpoint warning")).toHaveCount(0);
	await snap(page, "empty-settings");
});
