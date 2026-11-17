import path from "node:path";
import type { Page } from "@playwright/test";
import { GENERATED, MOCK_LLM_IN_CONTAINER, MOCK_LLM_PORT } from "./support/env";
import { expect, snap, test } from "./support/fixtures";

async function uploadGeneric(page: Page, file: string) {
	await page.goto("/import");
	await page
		.getByLabel(/Drop your exchange export here/)
		.setInputFiles(path.join(GENERATED, file));
	await page.getByRole("radio", { name: /^Auto-detect / }).check();
	await page.getByRole("radio", { name: /^IST / }).check();
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(
		page.getByRole("heading", { name: `Map Generic CSV / Sheet: ${file}` }),
	).toBeVisible();
}

const column = (page: Page, label: RegExp) =>
	page.getByRole("combobox", { name: label });

function stat(page: Page, label: string) {
	return page
		.getByText(label, { exact: true })
		.locator("xpath=following-sibling::p[1]");
}

async function useMockModel(
	api: { putSettings: (p: object) => Promise<unknown> },
	model: string,
) {
	await api.putSettings({
		ai: {
			baseUrl: MOCK_LLM_IN_CONTAINER,
			model,
			apiKey: "mock-key",
			cloudAcknowledged: true,
		},
	});
}

test.beforeEach(async ({ api }) => {
	await api.reset();
});

test("AI-assisted wizard: payload preview, suggestion, hand edit, preview, save, reuse", async ({
	page,
	api,
	request,
}) => {
	await useMockModel(api, "mock-recipe");
	await uploadGeneric(page, "generic-new-layout.csv");
	await expect(
		page.getByRole("heading", { name: "1. Detected headers (8)" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Preview AI payload" }).click();
	const notice = page.getByText("This is exactly what will be sent to");
	await expect(notice).toContainText(
		`This is exactly what will be sent to mock-recipe at ${MOCK_LLM_IN_CONTAINER}`,
	);
	// host.docker.internal is a local endpoint (shared isLocalAiEndpoint in @tax/core).
	await expect(page.getByText("Local endpoint", { exact: true })).toBeVisible();
	await expect(page.getByText("Cloud endpoint — leaves machine")).toHaveCount(
		0,
	);
	const payloadBox = notice.locator("xpath=ancestor::div[2]").locator("pre");
	await expect(payloadBox).toContainText("Order Ref");
	const previewed = JSON.parse((await payloadBox.textContent()) ?? "null");
	await snap(page, "wizard-payload-preview");

	// The wizard's own header guesses equal the mock's answer, so wait for the real reply.
	const suggested = page.waitForResponse(
		(r) => r.url().endsWith("/api/recipes/suggest") && r.status() === 200,
	);
	await page.getByRole("button", { name: "Send & suggest recipe" }).click();
	await suggested;
	await expect(column(page, /^Trading Pair/)).toHaveValue("Instrument");
	await expect(column(page, /^Total \/ Consideration/)).toHaveValue(
		"Net Amount",
	);
	await expect(column(page, /^Trade \/ Order ID/)).toHaveValue("Order Ref");
	await expect(column(page, /^Fee Asset/)).toHaveValue("Fee Coin");
	await expect(page.getByLabel("Buy / Sell sign style")).toHaveValue(
		"negative_is_sell",
	);
	await expect(page.getByLabel("Date format")).toHaveValue(
		"yyyy-MM-dd HH:mm:ss",
	);

	const lastSent = await (
		await request.get(`http://127.0.0.1:${MOCK_LLM_PORT}/__last-request`)
	).json();
	expect(
		lastSent,
		"previewed payload must equal what reached the model",
	).toEqual(previewed);

	await page.getByLabel("Date format").fill("dd/MM/yyyy");
	await page.getByRole("button", { name: "Preview 10 rows" }).click();
	await expect(page.getByText("Dates failed")).toBeVisible();

	await page.getByLabel("Date format").fill("yyyy-MM-dd HH:mm:ss");
	await page.getByLabel("Recipe name").fill("E2E Signed Exchange");
	await page.getByRole("button", { name: "Preview 10 rows" }).click();
	await expect(
		page.getByRole("heading", {
			name: /4\. Preview: Original vs Converted \(first 5\s+rows\)/,
		}),
	).toBeVisible();
	await expect(page.getByText("Dates OK")).toBeVisible();
	await expect(page.getByText("Numbers OK")).toBeVisible();
	await expect(page.getByText("5 in / 5 out")).toBeVisible();
	const previewTable = page
		.getByRole("table")
		.filter({ hasText: "Converted Ledger Row" });
	await expect(previewTable.locator("tbody tr")).toHaveCount(5);
	await expect(previewTable.locator("tbody tr").first()).toContainText(
		"OD-9001",
	);
	await expect(previewTable.locator("tbody tr").first()).toContainText("Buy");
	await snap(page, "wizard-row-preview");

	await expect(page.getByLabel("Save recipe for future imports")).toBeChecked();
	await expect(page.getByLabel("Save as")).toHaveValue("E2E Signed Exchange");
	await page.getByRole("button", { name: "Confirm & import" }).click();
	await expect(
		page.getByRole("heading", {
			name: "generic-new-layout.csv — Import complete",
		}),
	).toBeVisible();
	await expect(stat(page, "Inserted")).toHaveText("5");
	await expect(stat(page, "Row errors")).toHaveText("0");

	await page.goto("/imports");
	await expect(
		page.getByRole("heading", { name: "Saved CSV Recipes (1)" }),
	).toBeVisible();
	await expect(
		page.getByRole("cell", { name: "E2E Signed Exchange", exact: true }),
	).toBeVisible();

	await page.goto("/import");
	await page
		.getByLabel(/Drop your exchange export here/)
		.setInputFiles(path.join(GENERATED, "generic-new-layout.csv"));
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(
		page.getByRole("heading", {
			name: "generic-new-layout.csv — Import complete",
		}),
	).toBeVisible();
	await expect(page.getByText(/Map Generic CSV/)).toHaveCount(0);
	await expect(stat(page, "Duplicates skipped")).toHaveText("5");
});

for (const [model, message] of [
	["mock-500", "AI endpoint returned HTTP 500"],
	["mock-garbage", "AI"],
	["mock-invalid", "does not match the required schema"],
] as const) {
	test(`AI failure (${model}) shows a readable error and keeps the form usable`, async ({
		page,
		api,
		allowConsole,
	}) => {
		allowConsole(/\/api\/recipes\/suggest$/);
		await useMockModel(api, model);
		await uploadGeneric(page, "generic-ddmmyyyy.csv");
		await page.getByRole("button", { name: "Send & suggest recipe" }).click();
		const banner = page.getByRole("alert").filter({ hasText: /\S/ });
		await expect(banner).toContainText(message);
		await expect(banner).not.toContainText("{");
		await expect(
			page.getByRole("button", { name: "Preview 10 rows" }),
		).toBeEnabled();
		await snap(page, `wizard-ai-error-${model}`);
	});
}

test("manual recipe path works end to end without AI", async ({ page }) => {
	await uploadGeneric(page, "generic-ddmmyyyy.csv");
	await column(page, /^Timestamp/).selectOption("Txn Date");
	await column(page, /^Amount \/ Quantity/).selectOption("Quantity");
	await column(page, /^Side column/).selectOption("Side");
	await column(page, /^Trading Pair/).selectOption("Market");
	await column(page, /^Unit Price/).selectOption("Rate");
	await column(page, /^Total \/ Consideration/).selectOption("Value");
	await column(page, /^Fee Amount/).selectOption("Charges");
	await column(page, /^Fee Asset/).selectOption("Charges Coin");
	await column(page, /^Trade \/ Order ID/).selectOption("");
	await page.getByLabel("Date format").fill("dd/MM/yyyy HH:mm");
	await page.getByRole("button", { name: "Auto-detect from sample" }).click();
	const raws = page.getByRole("textbox", { name: "Raw side value" });
	await expect(raws).toHaveCount(2);
	await expect(raws.nth(0)).toHaveValue("Buy");
	await expect(
		page.getByRole("combobox", { name: "Mapped transaction type" }).nth(1),
	).toHaveValue("sell");

	await page.getByRole("button", { name: "Preview 10 rows" }).click();
	await expect(page.getByText("Dates OK")).toBeVisible();
	await expect(page.getByText("Numbers OK")).toBeVisible();
	await expect(page.getByText("4 in / 4 out")).toBeVisible();

	await page.getByLabel("Save recipe for future imports").uncheck();
	await expect(page.getByLabel("Save as")).toHaveCount(0);
	await page.getByRole("button", { name: "Confirm & import" }).click();
	await expect(
		page.getByRole("heading", {
			name: "generic-ddmmyyyy.csv — Import complete",
		}),
	).toBeVisible();
	await expect(stat(page, "Inserted")).toHaveText("4");

	await page.goto("/transactions?taxYear=2025-26&type=sell");
	await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
	await page.goto("/transactions?taxYear=2026-27&type=sell");
	await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
	await page.goto("/imports");
	await expect(
		page.getByRole("heading", { name: /Saved CSV Recipes/ }),
	).toHaveCount(0);
});

test("the wizard's first guess does not use the Side column as the row ID", async ({
	page,
}) => {
	await uploadGeneric(page, "generic-ddmmyyyy.csv");
	// "Side" contains the substring "id"; using it as the dedupe key collapses every Buy
	// (and every Sell) into one row and silently drops real trades as duplicates.
	await expect(column(page, /^Trade \/ Order ID/)).not.toHaveValue("Side");
});

test("generic-ddmmyyyy.csv with the wizard's ID guess inserts 4 rows; re-import is 4 duplicates", async ({
	page,
}) => {
	for (const [inserted, duplicates] of [
		["4", "0"],
		["0", "4"],
	]) {
		await uploadGeneric(page, "generic-ddmmyyyy.csv");
		const idGuess = await column(page, /^Trade \/ Order ID/).inputValue();
		expect(idGuess).not.toBe("Side");
		await column(page, /^Timestamp/).selectOption("Txn Date");
		await column(page, /^Amount \/ Quantity/).selectOption("Quantity");
		await column(page, /^Side column/).selectOption("Side");
		await column(page, /^Trading Pair/).selectOption("Market");
		await column(page, /^Unit Price/).selectOption("Rate");
		await column(page, /^Total \/ Consideration/).selectOption("Value");
		await column(page, /^Fee Amount/).selectOption("Charges");
		await column(page, /^Fee Asset/).selectOption("Charges Coin");
		await page.getByLabel("Date format").fill("dd/MM/yyyy HH:mm");
		await page.getByRole("button", { name: "Auto-detect from sample" }).click();
		await page.getByRole("button", { name: "Preview 10 rows" }).click();
		await expect(page.getByText("4 in / 4 out")).toBeVisible();
		await page.getByLabel("Save recipe for future imports").uncheck();
		await page.getByRole("button", { name: "Confirm & import" }).click();
		await expect(
			page.getByRole("heading", {
				name: "generic-ddmmyyyy.csv — Import complete",
			}),
		).toBeVisible();
		await expect(stat(page, "Inserted")).toHaveText(inserted);
		await expect(stat(page, "Duplicates skipped")).toHaveText(duplicates);
	}
	await page.goto("/transactions");
	await expect(page.getByText("Showing 1–4 of 4")).toBeVisible();
});
