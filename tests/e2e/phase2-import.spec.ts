import path from "node:path";
import {
	statementPages,
	syntheticPdf,
} from "../../packages/importers/test/pdf-fixture";
import { FIXTURES } from "./support/env";
import { expect, noSecrets, reset, shot, test } from "./support/phase2";

test.beforeEach(async ({ api }) => reset(api));
const order = path.join(FIXTURES, "binance-spot-order-history(UTC+5).csv");

for (const zone of ["IST", "UTC", "Other offset"])
	test(`timezone picker ${zone} and inline offset validation`, async ({
		page,
	}) => {
		await page.goto("/import");
		await page.getByLabel(/Drop your exchange export/).setInputFiles(order);
		await page.getByRole("radio", { name: new RegExp(`^${zone}`) }).check();
		if (zone === "Other offset") {
			await page.getByLabel("Fixed UTC offset (±HH:MM)").fill("+15:00");
			await page.getByRole("button", { name: "Upload & import" }).click();
			await expect(
				page.getByLabel("Fixed UTC offset (±HH:MM)"),
			).toHaveAttribute("aria-invalid", "true");
			await expect(page.getByText(/Enter a fixed offset as/)).toBeVisible();
			await shot(page, "import-invalid-offset");
			await page.getByLabel("Fixed UTC offset (±HH:MM)").fill("-04:00");
		}
		await page.getByRole("button", { name: "Upload & import" }).click();
		await expect(
			page.getByText("Detected: Binance Spot Order History", { exact: true }),
		).toBeVisible();
		await expect(page.getByText(/Source: Binance · Time zone:/)).toContainText(
			"+05:00 (from the file name)",
		);
		await expect(
			page
				.getByText(
					/order history.*fee|fees.*Trade History|does not include fees/i,
				)
				.first(),
		).toBeVisible();
		await shot(page, `import-order-${zone.replaceAll(" ", "-")}`);
		await page.goto("/imports");
		await expect(
			page
				.getByText("Binance Spot Order History", { exact: true })
				.filter({ visible: true })
				.first(),
		).toBeVisible();
	});

test("Trade History supersedes matching orders with Replaced badge and drawer note", async ({
	page,
	api,
}) => {
	await api.importFile(order, "binance", "UTC");
	await page.goto("/import");
	await page.getByLabel(/Drop your exchange export/).setInputFiles({
		name: "matching-trade-history.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			"Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n2025-08-02 05:00:30,1INCHUSDT,BUY,2,12.01INCH,24USDT,0.01BNB\n",
		),
	});
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(
		page.getByRole("heading", {
			name: /matching-trade-history.csv — Import complete/,
		}),
	).toBeVisible();
	await page.goto("/transactions");
	const row = page.getByRole("row").filter({ hasText: "Replaced" });
	await expect(row).toHaveCount(1);
	await row.getByRole("button").first().click();
	await expect(page.getByRole("dialog")).toContainText(
		"A more detailed export (e.g. Trade History) replaced this row.",
	);
	await shot(page, "transactions-replaced-drawer");
	await api.compute("2025-26");
	await page.goto("/report?taxYear=2025-26");
	await expect(page.locator("#excluded")).toContainText(
		"Replaced by a more detailed export (kept for records, excluded from tax calculation)",
	);
	await shot(page, "report-superseded-exclusion");
});

test("fills that do not match the order quantity get the possible_duplicate chip", async ({
	page,
	api,
}) => {
	await api.importFile(order, "binance", "UTC");
	await page.goto("/import");
	await page.getByLabel(/Drop your exchange export/).setInputFiles({
		name: "mismatched-trade-history.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			"Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n2025-08-02 05:00:30,1INCHUSDT,BUY,2,11.51INCH,23USDT,0.01BNB\n",
		),
	});
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(
		page.getByRole("heading", { name: /Import complete/ }),
	).toBeVisible();
	await page.goto("/transactions");
	const row = page
		.getByRole("row")
		.filter({ has: page.getByText("possible_duplicate", { exact: true }) });
	await expect(row).toHaveCount(1);
	await expect(
		page.getByRole("row").filter({ hasText: "Replaced" }),
	).toHaveCount(0);
	await row.getByRole("button").first().click();
	await expect(page.getByRole("dialog")).toContainText(
		/possible_duplicate|duplicate/i,
	);
	await shot(page, "transactions-possible-duplicate");
});

test("encrypted synthetic PDF: focused password prompt, wrong password cleared, snapshot", async ({
	page,
	allowConsole,
}) => {
	allowConsole(/status of 422 .*\/api\/imports/);
	await page.goto("/import");
	await page.getByLabel(/Drop your exchange export/).setInputFiles({
		name: "encrypted-synthetic.pdf",
		mimeType: "application/pdf",
		buffer: Buffer.from(syntheticPdf(statementPages(), "83629174")),
	});
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(page.getByLabel("PDF password", { exact: true })).toBeFocused();
	await page.getByLabel("PDF password", { exact: true }).fill("wrong-password");
	await page.getByRole("button", { name: "Unlock & import PDF" }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: /didn't open the file/ }),
	).toBeVisible();
	await expect(page.getByLabel("PDF password", { exact: true })).toHaveValue(
		"",
	);
	await shot(page, "pdf-wrong-password");
	await page.getByLabel("PDF password", { exact: true }).fill("83629174");
	await page.getByRole("button", { name: "Unlock & import PDF" }).click();
	await expect(
		page.getByRole("heading", { name: /Balance Snapshot/ }),
	).toBeVisible();
	await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
	await expect(
		page.getByText(/stored as a balance statement, not ledger transactions/),
	).toBeVisible();
	await noSecrets(page);
	await shot(page, "pdf-snapshot");
	await page
		.getByRole("link", { name: "Compare with computed balances" })
		.click();
	await expect(page.locator("#statements")).toContainText("Statements (1)");
	await expect(
		page.locator("#statements").getByRole("columnheader"),
	).toHaveText(["Asset", "Statement", "Computed", "Difference"]);
	await page
		.getByRole("button", { name: "Use as actual balances for 2025-26" })
		.click();
	await expect(
		page.locator("#statements").locator("[aria-live]"),
	).toContainText(
		/Saved Binance statement balances|Applied Binance statement balances/,
	);
	await shot(page, "statement-applied");
});

test("Form 16A gives the friendly unsupported message", async ({
	page,
	allowConsole,
}) => {
	allowConsole(/status of 422 .*\/api\/imports/);
	await page.goto("/import");
	await page.getByLabel(/Drop your exchange export/).setInputFiles({
		name: "synthetic-form16a.pdf",
		mimeType: "application/pdf",
		buffer: Buffer.from(
			syntheticPdf([[{ text: "TRACES FORM NO. 16A CoinDCX", x: 40, y: 40 }]]),
		),
	});
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "TDS certificates can't be imported yet." }),
	).toBeVisible();
	await shot(page, "form16a-unsupported");
});

test("mid-year PDF comparison works and apply explains the 409", async ({
	page,
	allowConsole,
}) => {
	allowConsole(/status of 409 .*\/apply/);
	const pages = statementPages();
	const date = pages[0]?.find((r) => r.text.includes("Statement Date"));
	if (!date) throw new Error("fixture missing date");
	date.text = "Statement Date: 2025-09-30 UTC";
	await page.goto("/import");
	await page.getByLabel(/Drop your exchange export/).setInputFiles({
		name: "midyear-synthetic.pdf",
		mimeType: "application/pdf",
		buffer: Buffer.from(syntheticPdf(pages)),
	});
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(
		page.getByRole("heading", { name: /Balance Snapshot/ }),
	).toBeVisible();
	await page
		.getByRole("link", { name: "Compare with computed balances" })
		.click();
	await expect(
		page.locator("#statements").getByRole("table").locator("tbody tr"),
	).toHaveCount(3);
	const response = page.waitForResponse((r) => r.url().endsWith("/apply"));
	await page
		.getByRole("button", { name: "Use as actual balances for 2025-26" })
		.click();
	expect((await response).status()).toBe(409);
	await expect(page.locator("#statements")).toContainText(
		"the statement must be dated at the tax year end (31 March).",
	);
	await shot(page, "statement-midyear-409");
});

test("order-history flag messages shown to the user carry no internal catalogue references", async ({
	page,
	api,
}) => {
	await api.importFile(order, "binance", "UTC");
	await page.goto("/transactions");
	const row = page.getByRole("table").locator("tbody tr").first();
	await row.getByRole("button").first().click();
	const drawer = page.getByRole("dialog");
	await expect(drawer).toContainText("Order History contains no fee");
	await shot(page, "order-history-fee-flag-drawer");
	await expect(drawer).not.toContainText(/catalogue §/);
});
