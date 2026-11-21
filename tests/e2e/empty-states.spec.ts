import { expect, settled, snap, test } from "./support/fixtures";
import { chooseOption, SELECT_VALUE } from "./support/select";

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

// An empty ledger has nothing to compute: Review opens on the default year and says so, rather
// than asking for reports of years with no rows. A year with rows but no report asks once.
test("review empty state opens on the default year and never asks to compute an empty year", async ({
	page,
	api,
}) => {
	await page.goto("/review");
	await expect(page).toHaveURL(/\/review$/);
	await expect(page.getByLabel("Tax year")).toHaveAttribute(
		SELECT_VALUE,
		"2025-26",
	);
	await expect(
		page.getByRole("heading", { name: "No transactions in 2025-26" }),
	).toBeVisible();
	await expect(page.getByText(/Reports? not computed/)).toHaveCount(0);
	await expect(page.getByRole("button", { name: /^Compute / })).toHaveCount(0);
	await chooseOption(page.getByLabel("Tax year"), "");
	await expect(
		page.getByRole("heading", { name: "No transactions yet" }),
	).toBeVisible();
	await expect(page.getByText(/Reports? not computed/)).toHaveCount(0);
	await snap(page, "empty-review");

	const { id } = await api.addManual({
		sourceRef: "e2e-empty-states-review",
		timestamp: "2026-09-01T06:30:00.000Z",
		type: "buy",
		assetIn: "BTC",
		amountIn: "1",
		inrValue: "100000",
	});
	await page.goto("/review?taxYear=all");
	await expect(
		page.getByRole("heading", { name: "Report not computed for 2026-27" }),
	).toBeVisible();
	await expect(page.getByText(/Reports? not computed/)).toHaveCount(1);
	await expect(
		page.getByRole("button", { name: "Compute 2026-27 report" }),
	).toBeVisible();
	await expect(
		page.getByText("All items reviewed"),
		"a ledger without a report is not 'all reviewed'",
	).toHaveCount(0);
	await api.json("DELETE", `/api/transactions/${id}`);
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
	// A custom select (like a native one used by hand) does not fire on re-picking the current year.
	await chooseOption(page.getByLabel("Tax year"), "2026-27");
	await expect(page).toHaveURL(/taxYear=2026-27/);
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
	await expect(page.getByLabel("Fee & GST treatment")).toHaveAttribute(
		SELECT_VALUE,
		"exclude",
	);
	await expect(page.getByLabel("Surcharge rate")).toHaveAttribute(
		SELECT_VALUE,
		"0",
	);
	// Phase 4 (2d31f5f): a fresh install defaults to the latest completed year in IST.
	await expect(page.getByLabel("Default tax year")).toHaveAttribute(
		SELECT_VALUE,
		"2025-26",
	);
	await expect(page.getByLabel("OpenAI-compatible base URL")).toHaveValue(
		"http://ollama:11434/v1",
	);
	await expect(page.getByText("Local endpoint")).toBeVisible();
	await expect(page.getByText("Cloud endpoint warning")).toHaveCount(0);
	await snap(page, "empty-settings");
});
