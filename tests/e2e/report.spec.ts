import { readFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { DISCLAIMER_TEXT, GENERATED } from "./support/env";
import { expect, settled, snap, test } from "./support/fixtures";

function card(scope: Page | Locator, label: string) {
	return scope
		.getByText(label, { exact: true })
		.locator("xpath=following-sibling::p[1]");
}

async function addViaUi(
	page: Page,
	tab: "Missing Buy" | "Sell",
	fields: Record<string, string>,
) {
	await page.getByRole("button", { name: "Add manual entry" }).click();
	const drawer = page.getByRole("dialog", { name: "Add manual transaction" });
	await drawer.getByRole("button", { name: tab, exact: true }).click();
	for (const [label, value] of Object.entries(fields))
		await drawer.getByLabel(label, { exact: true }).fill(value);
	await drawer.getByRole("button", { name: "Add transaction" }).click();
	await expect(drawer).toBeHidden();
}

const exportLink = (page: Page, kind: string, format: "CSV" | "XLSX") =>
	page.locator(
		`xpath=//span[normalize-space()="${kind}"]/parent::div//a[normalize-space()="${format}"]`,
	);

test.describe("golden worked example built through the UI", () => {
	test.beforeEach(async ({ api, page }) => {
		await api.reset();
		await page.goto("/transactions");
		await addViaUi(page, "Missing Buy", {
			"Date & time (IST)": "2026-05-01T12:00",
			"Asset received *": "ETH",
			"Quantity received *": "1",
			"Cost in INR (₹)": "200000",
		});
		await addViaUi(page, "Sell", {
			"Date & time (IST)": "2026-08-01T12:00",
			"Asset sold *": "ETH",
			"Quantity sold *": "1",
			"Consideration in INR (₹)": "250000",
			"TDS deducted (₹, optional)": "2500",
		});
		await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
		await page.goto("/report?taxYear=2026-27");
		await settled(page);
		const compute = page.getByRole("button", {
			name: /^(Compute 2026-27 report|Recompute report|Compute report)$/,
		});
		await compute.first().click();
		await expect(
			page.getByRole("button", { name: "Recompute report" }),
		).toBeEnabled();
	});

	test("totals, Schedule VDA row and CA badge", async ({ page }) => {
		await expect(card(page, "Consideration")).toHaveText("₹2,50,000.00");
		await expect(card(page, "Cost")).toHaveText("₹2,00,000.00");
		await expect(card(page, "Taxable Income")).toHaveText("₹50,000.00");
		await expect(card(page, "Total Tax")).toHaveText("₹15,600.00");
		await expect(card(page, "TDS Credit")).toHaveText("₹2,500.00");
		await expect(card(page, "Net Payable")).toHaveText("₹13,100.00");
		await expect(
			page.getByText("Pending CA verification", { exact: true }),
		).toBeVisible();

		const table = page
			.getByRole("table")
			.filter({ hasText: "Date of Acquisition" });
		await expect(table.getByRole("columnheader")).toHaveText([
			"Date of Acquisition",
			"Date of Transfer",
			"Head of Income",
			"Asset & Qty",
			"Cost of Acquisition",
			"Consideration Received",
			"Income",
			"Loss",
			"Trail",
		]);
		const row = table.locator("tbody tr");
		await expect(row).toHaveCount(1);
		await expect(row.getByRole("cell")).toHaveText([
			"01 May 2026",
			"01 Aug 2026",
			"Capital Gains",
			"ETH 1",
			"₹2,00,000.00",
			"₹2,50,000.00",
			"₹50,000.00",
			"₹0.00",
			"Trail",
		]);
		for (const idx of [4, 5, 6, 7]) {
			const align = await row
				.getByRole("cell")
				.nth(idx)
				.evaluate((el) => getComputedStyle(el).textAlign);
			expect(align, `money column ${idx} must be right-aligned`).toBe("right");
		}
		await expect(
			page.getByText("Engine Settings Used for This Report"),
		).toBeVisible();
		await expect(page.getByText("feeTreatment", { exact: true })).toBeVisible();
		await snap(page, "report-golden");

		await page.goto("/?taxYear=2026-27");
		const summary = page.getByRole("region", { name: "Tax summary" });
		await expect(card(summary, "Taxable VDA Income")).toHaveText("₹50,000.00");
		await expect(
			summary
				.getByText("Total Tax (30% + Surcharge + 4% Cess)", { exact: true })
				.locator("xpath=../following-sibling::p[1]"),
		).toHaveText("₹15,600.00");
		await expect(card(summary, "TDS Credit")).toHaveText("₹2,500.00");
		await expect(card(summary, "Net Tax Payable")).toHaveText("₹13,100.00");
		await expect(
			summary.getByRole("definition").filter({ hasText: "₹600.00" }),
		).toHaveCount(1);
		await expect(
			page.getByText("Section numbers pending CA verification"),
		).toBeVisible();
		await snap(page, "overview-golden");
	});

	test("trail drawer reaches the untouched raw rows", async ({ page }) => {
		await page
			.getByRole("button", { name: "Trail", exact: true })
			.first()
			.click();
		const drawer = page.getByRole("dialog", { name: "Audit Trail · ETH" });
		await expect(drawer).toBeVisible();
		await expect(
			drawer.getByRole("heading", { name: "1. Schedule VDA Output Row" }),
		).toBeVisible();
		await expect(
			drawer.getByRole("heading", { name: "3. Linked Ledger Rows (2)" }),
		).toBeVisible();
		await expect(
			drawer.getByRole("heading", { name: "4. Untouched Raw Source Rows (2)" }),
		).toBeVisible();
		await expect(drawer.locator("pre")).toHaveCount(2);
		await expect(drawer.locator("pre").first()).toContainText(
			'"manualEntry": true',
		);
		await snap(page, "report-trail-drawer");
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
	});

	test("TDS section, 26AS checklist and actual-balance mismatch", async ({
		page,
	}) => {
		const tds = page.locator("#tds");
		await expect(
			tds.getByRole("heading", {
				name: "TDS Summary & Form 26AS / AIS Reconciliation",
			}),
		).toBeVisible();
		const tdsRow = tds.getByRole("table").locator("tbody tr");
		await expect(tdsRow).toHaveCount(1);
		await expect(tdsRow).toContainText("Manual");
		await expect(tdsRow).toContainText("₹2,50,000.00");
		await expect(tdsRow).toContainText("₹2,500.00");
		await expect(
			tds.getByRole("heading", { name: "Form 26AS / AIS Matching Checklist" }),
		).toBeVisible();
		const item = tds.getByRole("checkbox", {
			name: /match ledger TDS 2500\.00 with Form 26AS\/AIS/,
		});
		await item.check();
		await expect(item).toBeChecked();

		const balances = page.locator("#balances");
		const input = balances.getByRole("textbox", {
			name: "Actual balance for ETH",
		});
		await input.fill("0.5");
		const ethRow = balances.locator("tbody tr").filter({ hasText: "ETH" });
		await expect(ethRow.getByRole("cell").last()).toHaveText("0.5");
		await balances
			.getByRole("button", { name: "Save actual balances" })
			.click();
		await expect(
			page.getByText(
				"Actual balances saved and reconciliation checks updated.",
			),
		).toBeVisible();
		await page.reload();
		await expect(
			page
				.locator("#balances")
				.getByRole("textbox", { name: "Actual balance for ETH" }),
		).toHaveValue("0.5");
		await expect(
			page
				.locator("#balances tbody tr")
				.filter({ hasText: "ETH" })
				.getByRole("cell")
				.last(),
		).toHaveText("0.5");
		await expect(page.getByText("balance_mismatch")).toBeVisible();
		await expect(page.getByText(": ETH: computed 0, actual 0.5")).toBeVisible();
		await snap(page, "report-balances-mismatch");
		const exported = await page.request.get(
			"/api/reports/2026-27/export?format=csv&kind=full",
		);
		const sign = (await exported.text()).includes('"-0.5"') ? "-0.5" : "0.5";
		expect
			.soft(
				sign,
				"UI difference (actual − computed) must match the export's sign",
			)
			.toBe("0.5");
		await page.goto("/review?taxYear=2026-27");
		await expect(
			page.getByRole("heading", {
				name: "Computed vs actual balance mismatch",
			}),
		).toBeVisible();
	});

	test("every export button downloads a non-empty file of the right type", async ({
		page,
	}) => {
		for (const kind of ["Schedule VDA", "TDS", "Income", "Full Report"]) {
			for (const format of ["CSV", "XLSX"] as const) {
				const link = exportLink(page, kind, format);
				await expect(link).toHaveCount(1);
				const downloadPromise = page.waitForEvent("download");
				await link.click();
				const download = await downloadPromise;
				const name = download.suggestedFilename();
				expect(name).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
				const file = await download.path();
				const bytes = readFileSync(file);
				expect(bytes.length, `${kind} ${format} is empty`).toBeGreaterThan(0);
				if (format === "CSV")
					expect(bytes.toString("utf8")).toContain(DISCLAIMER_TEXT);
				else expect(bytes.subarray(0, 2).toString()).toBe("PK");
			}
		}
	});

	test("export links have distinguishable accessible names", async ({
		page,
	}) => {
		const names = await page
			.locator("a[download]")
			.evaluateAll((links) =>
				links.map(
					(a) => a.getAttribute("aria-label") ?? a.textContent?.trim() ?? "",
				),
			);
		expect(names.length).toBe(8);
		expect(
			new Set(names).size,
			`screen-reader users hear only: ${[...new Set(names)].join(", ")}`,
		).toBe(8);
	});
});

test("switching tax year shows disposals in the right year (31 Mar / 1 Apr IST)", async ({
	page,
	api,
}) => {
	await api.reset();
	await api.importFile(
		path.join(GENERATED, "year-boundary.csv"),
		"binance",
		"UTC",
	);
	await api.compute("2025-26");
	await api.compute("2026-27");

	await page.goto("/report?taxYear=2025-26");
	const btcRow = () =>
		page
			.getByRole("table")
			.filter({ hasText: "Date of Acquisition" })
			.locator("tbody tr")
			.filter({ hasText: "BTC" });
	await expect(btcRow()).toHaveCount(1);
	await expect(btcRow().getByRole("cell").nth(1)).toHaveText("31 Mar 2026");
	await expect(btcRow()).toContainText("BTC 0.001");

	await page.getByLabel("Tax year").selectOption("2026-27");
	await expect(page).toHaveURL(/taxYear=2026-27/);
	await expect(btcRow()).toHaveCount(1);
	await expect(btcRow().getByRole("cell").nth(1)).toHaveText("01 Apr 2026");
	await expect(btcRow().getByRole("cell").nth(0)).toHaveText("31 Mar 2026");
	await snap(page, "report-year-2026-27");

	await page.getByLabel("Tax year").selectOption("2025-26");
	await expect(btcRow().getByRole("cell").nth(1)).toHaveText("31 Mar 2026");
});
