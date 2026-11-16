import type { Page } from "@playwright/test";
import { MOCK_LLM_IN_CONTAINER } from "./support/env";
import { expect, settled, snap, test } from "./support/fixtures";

function card(page: Page, label: string) {
	return page
		.getByText(label, { exact: true })
		.locator("xpath=following-sibling::p[1]");
}

async function saveSettings(page: Page) {
	await page.getByRole("button", { name: "Save settings" }).click();
	await expect(
		page.getByText(
			"Settings saved. Recompute any open tax report to apply changes.",
		),
	).toBeVisible();
}

async function recompute(page: Page, year = "2026-27") {
	await page.goto(`/report?taxYear=${year}`);
	await settled(page);
	// Saving settings invalidates stored reports (by design), so the empty state shows.
	await expect(
		page.getByRole("heading", { name: `No report computed for ${year}` }),
	).toBeVisible();
	await page.getByRole("button", { name: `Compute ${year} report` }).click();
	await expect(
		page.getByRole("button", { name: "Recompute report" }),
	).toBeEnabled();
}

test.beforeEach(async ({ api }) => {
	await api.reset();
});

test("fee treatment changes the report after recompute and is shown on it", async ({
	page,
	api,
}) => {
	await api.addManual({
		sourceRef: "e2e-fee-buy",
		timestamp: "2026-05-02T06:30:00.000Z",
		type: "buy",
		assetIn: "BTC",
		amountIn: "1",
		inrValue: "100000",
		feeAsset: "INR",
		feeAmount: "1000",
	});
	await api.addManual({
		sourceRef: "e2e-fee-sell",
		timestamp: "2026-08-02T06:30:00.000Z",
		type: "sell",
		assetOut: "BTC",
		amountOut: "1",
		inrValue: "110000",
		feeAsset: "INR",
		feeAmount: "1000",
	});
	await api.compute("2026-27");
	await page.goto("/report?taxYear=2026-27");
	await expect(card(page, "Taxable Income")).toHaveText("₹10,000.00");

	await page.goto("/settings");
	await settled(page);
	await page.getByLabel("Fee & GST treatment").selectOption("include");
	await saveSettings(page);
	await page.reload();
	await expect(page.getByLabel("Fee & GST treatment")).toHaveValue("include");

	await recompute(page);
	await expect(card(page, "Cost")).toHaveText("₹1,01,000.00");
	await expect(card(page, "Consideration")).toHaveText("₹1,09,000.00");
	await expect(card(page, "Taxable Income")).toHaveText("₹8,000.00");
	const used = page.locator("dl").filter({ hasText: "feeTreatment" });
	await expect(
		used.getByText("feeTreatment").locator("xpath=following-sibling::dd"),
	).toHaveText("include");
});

test("surcharge rate changes total tax after recompute", async ({
	page,
	api,
}) => {
	await api.seedWorkedExample();
	await api.compute("2026-27");
	await page.goto("/settings");
	await settled(page);
	await page.getByLabel("Surcharge rate").selectOption("0.10");
	await saveSettings(page);
	await recompute(page);
	await expect(card(page, "Taxable Income")).toHaveText("₹50,000.00");
	await expect(card(page, "Total Tax")).toHaveText("₹17,160.00");
	await expect(card(page, "Net Payable")).toHaveText("₹14,660.00");
	const used = page.locator("dl").filter({ hasText: "surchargeRate" });
	await expect(
		used.getByText("surchargeRate").locator("xpath=following-sibling::dd"),
	).toHaveText("0.10");
	await page.goto("/?taxYear=2026-27");
	await expect(
		page.getByRole("region", { name: "Tax summary" }).getByText("₹1,500.00"),
	).toBeVisible();
});

test("every engine setting carries a one-line explanation", async ({
	page,
}) => {
	await page.goto("/settings");
	await settled(page);
	for (const label of [
		"Default tax year",
		"Head of income",
		"Fee & GST treatment",
		"Lot pool scope",
		"Lot matching method",
		"USDT / USD-stablecoin INR rate",
		"Income receipt cost basis",
		"Surcharge rate",
		"Transfer match window (hours)",
		"Transfer amount tolerance (fraction)",
	]) {
		const field = page.getByLabel(label, { exact: true });
		await expect(field).toBeVisible();
		const hint = field.locator("xpath=following-sibling::p[1]");
		await expect(hint, `${label} needs an explanation`).toHaveText(
			/(\S+\s+){5,}\S+/,
		);
	}
	await expect(page.getByText("How to back up:")).toBeVisible();
	await expect(page.getByText("/data/tax-tracker.db")).toBeVisible();
	await snap(page, "settings");
});

test("cloud AI endpoint needs the warning to be acknowledged", async ({
	page,
}) => {
	await page.goto("/settings");
	await settled(page);
	await page
		.getByLabel("OpenAI-compatible base URL")
		.fill("https://api.example.com/v1");
	await page.getByLabel("Model name").fill("gpt-test");
	await expect(page.getByText("Cloud endpoint", { exact: true })).toBeVisible();
	await expect(page.getByText("Cloud endpoint warning")).toBeVisible();
	await expect(
		page.getByText("https://api.example.com/v1", { exact: true }),
	).toBeVisible();
	await snap(page, "settings-cloud-warning");

	await page.getByRole("button", { name: "Save settings" }).click();
	await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText(
		"Please acknowledge the cloud privacy warning",
	);

	await page.getByLabel("API key (optional)").fill("sk-test-123");
	await page
		.getByRole("checkbox", { name: /I understand that 20 sample CSV rows/ })
		.check();
	await saveSettings(page);
	await expect(page.getByText("Key saved")).toBeVisible();
	await expect(page.getByLabel("API key (optional)")).toHaveValue("");

	await page.reload();
	await expect(page.getByLabel("OpenAI-compatible base URL")).toHaveValue(
		"https://api.example.com/v1",
	);
	await expect(
		page.getByRole("checkbox", {
			name: /I understand that 20 sample CSV rows/,
		}),
	).toBeChecked();
	const html = await page.content();
	expect(
		html,
		"the saved API key must never be sent back to the browser",
	).not.toContain("sk-test-123");
});

test("host.docker.internal is treated the same way by UI and server", async ({
	page,
	allowConsole,
}) => {
	allowConsole(/status of 400 .*\/api\/settings$/);
	await page.goto("/settings");
	await settled(page);
	await page
		.getByLabel("OpenAI-compatible base URL")
		.fill(MOCK_LLM_IN_CONTAINER);
	await page.getByLabel("Model name").fill("mock-recipe");
	await page.getByLabel("API key (optional)").fill("mock-key");
	const ack = page.getByRole("checkbox", {
		name: /I understand that 20 sample CSV rows/,
	});
	await expect
		.soft(
			page.getByText("Cloud endpoint warning"),
			"the server treats host.docker.internal as cloud, so the UI must show the warning and acknowledgement",
		)
		.toBeVisible();
	if (await ack.isVisible()) await ack.check();
	await snap(page, "settings-host-docker-internal");
	await page.getByRole("button", { name: "Save settings" }).click();
	await expect(
		page.getByText(
			"Settings saved. Recompute any open tax report to apply changes.",
		),
	).toBeVisible();
});
