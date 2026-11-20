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
		page.getByRole("radio", { name: /^IST \(\+05:30\) Asia\/Kolkata/ }),
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
			"No transactions yet — import an export file, connect an exchange, or add a manual transaction.",
		),
	).toBeVisible();
	await expect(
		page.getByRole("navigation", { name: "Pagination" }),
	).toHaveCount(0);
	await snap(page, "empty-transactions");
});

// reportStatuses contract: with no stored report Review must not claim the ledger is clean,
// and the All-years view names every missing year (computeTaxYears), not just the default.
test("review empty state asks for a compute instead of claiming clean", async ({
	page,
}) => {
	await page.goto("/review");
	await expect(
		page.getByRole("heading", {
			name: "Reports not computed for 2025-26, 2026-27",
		}),
	).toBeVisible();
	await expect(
		page.getByText("All ledger transactions are clean."),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Compute 2025-26 & 2026-27 reports" }),
	).toBeVisible();
	await page.getByLabel("Tax year").selectOption("2026-27");
	await expect(
		page.getByRole("heading", { name: "Report not computed for 2026-27" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Compute 2026-27 report" }),
	).toBeVisible();
	await page.getByLabel("Tax year").selectOption("");
	await snap(page, "empty-review");
});

// Phase 4: on an empty ledger the report offers an import or sample data instead of a compute.
test("report empty state offers an import or sample data", async ({ page }) => {
	await page.goto("/report");
	const empty = page.getByRole("heading", {
		name: "No transactions yet — import an export file",
	});
	await expect(empty).toBeVisible();
	await expect(page.getByRole("link", { name: "Import file" })).toHaveAttribute(
		"href",
		"/import",
	);
	await expect(
		page.getByRole("button", { name: "Try with sample data" }),
	).toBeVisible();
	await page.getByLabel("Tax year").selectOption("2025-26");
	await expect(page).toHaveURL(/taxYear=2025-26/);
	await expect(empty).toBeVisible();
	await expect(page.getByText(/cleared because/)).toHaveCount(0);
	for (const year of ["2025-26", "2026-27"]) {
		const res = await page.request.get(`/api/reports/${year}`);
		expect(res.status()).toBe(404);
		expect(await res.json()).toMatchObject({
			error: {
				code: "report_not_computed",
				details: { cause: "never_computed", invalidatedAt: null },
			},
		});
	}
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
