import type { Locator, Page } from "@playwright/test";
import { AppApi, setTheme } from "./support/fixtures";
import {
	card,
	connection,
	expect,
	reset,
	settled,
	shot,
	test,
} from "./support/phase2";
import { textContrastFailures } from "./support/phase2-contrast";
import { chooseOption, SELECT_VALUE } from "./support/select";

// A Binance balance gap from history the API cannot see. Synced rows cannot be deleted, so the
// gap is a withdrawal the user recorded by hand (Counts toward: Binance) from before the API's
// history window ("Some Binance API histories were scanned from … onward"); the buy that funded
// it is the missing event. The sync is incomplete (P2P six-month window, history start), so the
// flagged USDT row offers "Add missing transaction".

test.describe.configure({ mode: "serial" });

const LABEL = "Phase 2 binance account";
const GAP = "50";
const OLD = new Date(Date.now() - 420 * 86_400_000);
const istInput = (d: Date) =>
	new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16);

test.beforeAll(async ({ request }) => {
	test.setTimeout(900_000);
	const api = new AppApi(request);
	await reset(api);
	await api.json("POST", "/api/transactions", {
		importId: null,
		raw: { manualEntry: true, seededBy: "e2e" },
		reviewFlags: [],
		sourceRef: "e2e-venue-old-withdrawal",
		timestamp: new Date(OLD.getTime() + 7 * 86_400_000).toISOString(),
		type: "withdrawal",
		assetOut: "USDT",
		amountOut: GAP,
		venue: "binance",
	});
	const c = await connection(api);
	const job = await api.json<{ jobId: string }>(
		"POST",
		`/api/connections/${c.id}/sync`,
	);
	await expect
		.poll(
			async () =>
				(await api.json<{ status: string }>("GET", `/api/jobs/${job.jobId}`))
					.status,
			{ timeout: 840_000, intervals: [2000] },
		)
		.toBe("completed");
});

async function usdtRow(page: Page) {
	await page.goto("/connections");
	const article = card(page, LABEL);
	await expect(
		article.getByRole("heading", { name: "Sync Streams" }),
	).toBeVisible();
	await settled(page);
	return article
		.getByRole("table")
		.last()
		.getByRole("row")
		.filter({ has: page.getByRole("cell", { name: "USDT", exact: true }) });
}

async function addMissingBuy(drawer: Locator, venue: string) {
	await expect(drawer.getByLabel("Asset received *")).toHaveValue("USDT");
	await chooseOption(drawer.getByLabel("Counts toward"), { label: venue });
	await drawer.getByLabel("Date & time (IST)").fill(istInput(OLD));
	await drawer.getByLabel("Quantity received *").fill(GAP);
	await drawer.getByLabel("Cost in INR (₹)").fill("4425");
	await drawer.getByRole("button", { name: "Add transaction" }).click();
	await expect(drawer).toBeHidden();
}

test("incomplete Binance history: the flagged gap links to a missing transaction pre-filled with asset and venue", async ({
	page,
}) => {
	const row = await usdtRow(page);
	await expect(row.getByRole("cell").nth(3)).toHaveText(GAP);
	const link = row.getByRole("link", { name: "Add missing transaction" });
	await expect(link).toHaveAttribute(
		"href",
		"/transactions?add=buy&asset=USDT&venue=binance",
	);
	await expect(row.getByRole("link", { name: /Review/ })).toBeVisible();
	await shot(page, "venue-gap-add-missing-link");
	// Matched assets get no link.
	await expect(
		card(page, LABEL)
			.getByRole("table")
			.last()
			.getByRole("row")
			.filter({ has: page.getByRole("cell", { name: "ETH", exact: true }) })
			.getByRole("link", { name: "Add missing transaction" }),
	).toHaveCount(0);
	await link.click();
	await expect(page).toHaveURL(/\/transactions\?.*add=buy/);
	const drawer = page.getByRole("dialog", { name: "Add manual transaction" });
	await expect(drawer).toBeVisible();
	await expect(drawer.getByLabel("Asset received *")).toHaveValue("USDT");
	await expect(drawer.getByLabel("Counts toward")).toHaveAttribute(
		SELECT_VALUE,
		"binance",
	);
	await expect(drawer.getByLabel("Counts toward")).toHaveText("Binance");
	await expect(drawer).toContainText(
		"Assigning an exchange lets a missing event (e.g. an old P2P buy) close that exchange's balance gap.",
	);
	await shot(page, "venue-add-missing-prefilled");
	await drawer.getByRole("button", { name: "Cancel" }).click();
	await expect(drawer).toBeHidden();
});

test("Counts toward: a Manual entry leaves the Binance gap open, a Binance entry closes it", async ({
	page,
}) => {
	await page.goto("/transactions");
	await page.getByRole("button", { name: "Add manual entry" }).click();
	let drawer = page.getByRole("dialog", { name: "Add manual transaction" });
	await drawer
		.getByRole("button", { name: "Missing Buy", exact: true })
		.click();
	await expect(drawer.getByLabel("Counts toward")).toHaveAttribute(
		SELECT_VALUE,
		"manual",
	);
	await drawer.getByLabel("Asset received *").fill("USDT");
	await addMissingBuy(drawer, "Manual (no exchange)");
	let row = await usdtRow(page);
	await expect(row.getByRole("cell").nth(3)).toHaveText(GAP);

	await page.goto("/transactions");
	await page.getByRole("button", { name: "Add manual entry" }).click();
	drawer = page.getByRole("dialog", { name: "Add manual transaction" });
	await drawer
		.getByRole("button", { name: "Missing Buy", exact: true })
		.click();
	await drawer.getByLabel("Asset received *").fill("USDT");
	await addMissingBuy(drawer, "Binance");
	const added = page
		.getByRole("table")
		.locator("tbody tr")
		.filter({ hasText: "USDT" })
		.filter({ hasText: "₹4,425.00" });
	await expect(added).toHaveCount(2);
	await added.first().getByRole("button").first().click();
	await expect(page.getByRole("dialog")).toContainText("Counts toward");
	await page.keyboard.press("Escape");

	row = await usdtRow(page);
	await expect(row.getByRole("cell").nth(3)).toHaveText(/^0(\.0+)?$/);
	await expect(row).toContainText("Matched");
	await expect(
		row.getByRole("link", { name: "Add missing transaction" }),
	).toHaveCount(0);
	await shot(page, "venue-gap-closed");
});

for (const theme of ["light", "dark"] as const)
	for (const width of [375, 1280])
		test(`add-manual drawer with Counts toward ${width}px ${theme}: labelled, fits, readable`, async ({
			page,
		}) => {
			await setTheme(page, theme);
			await page.setViewportSize({ width, height: 812 });
			await page.goto("/transactions?add=buy&asset=USDT&venue=binance");
			const drawer = page.getByRole("dialog", {
				name: "Add manual transaction",
			});
			await expect(drawer.getByLabel("Counts toward")).toHaveAttribute(
				SELECT_VALUE,
				"binance",
			);
			const unlabelled = await drawer
				.locator("input:not([type=hidden]),[role=combobox],textarea")
				.evaluateAll((els) =>
					els
						.filter((el) => {
							const e = el as HTMLInputElement;
							return (
								e.getBoundingClientRect().width > 0 &&
								!e.labels?.length &&
								!e.getAttribute("aria-label") &&
								!e.getAttribute("aria-labelledby")
							);
						})
						.map((el) => el.outerHTML.slice(0, 160)),
				);
			expect(unlabelled).toEqual([]);
			const box = await drawer.boundingBox();
			expect(box?.width ?? 0).toBeLessThanOrEqual(width);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(width);
			await drawer
				.getByRole("button", { name: "Add transaction" })
				.scrollIntoViewIfNeeded();
			await expect(
				drawer.getByRole("button", { name: "Add transaction" }),
			).toBeInViewport();
			expect(await textContrastFailures(page), "drawer text contrast").toEqual(
				[],
			);
			await shot(page, `venue-drawer-${width}-${theme}`);
		});
