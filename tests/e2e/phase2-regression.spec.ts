import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { FIXTURES } from "./support/env";
import { AppApi, setTheme } from "./support/fixtures";
import {
	card,
	connection,
	expect,
	PASS,
	provider,
	reset,
	scenario,
	settled,
	shot,
	sync,
	test,
	WALLET_B,
} from "./support/phase2";
import { textContrastFailures } from "./support/phase2-contrast";

const SYNCED_GROUP = "normal Binance sync (one sync for the group)";

test.beforeEach(async ({ api }, info) => {
	if (!info.titlePath.includes(SYNCED_GROUP)) await reset(api, false);
});

const rows = (page: Page) => page.getByRole("table").locator("tbody tr");

async function upload(page: Page, file: string, zone: RegExp) {
	await page.goto("/import");
	await page.getByLabel(/Drop your exchange export here/).setInputFiles(file);
	await page.getByRole("radio", { name: /^Binance / }).check();
	await page.getByRole("radio", { name: zone }).check();
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(
		page.getByRole("heading", {
			name: `${path.basename(file)} — Import complete`,
		}),
	).toBeVisible();
}

test("a file whose header names UTC, imported as IST, warns and names both zones", async ({
	page,
}) => {
	// P2-API-6 regression: the conflict must be visible on the import summary.
	await upload(page, path.join(FIXTURES, "binance-trade-history.csv"), /^IST /);
	await expect(page.getByText(/Time zone: UTC/)).toBeVisible();
	await expect(
		page.getByText(
			"Used UTC from the column header instead of the selected IST.",
			{
				exact: true,
			},
		),
	).toHaveCount(1);
	await shot(page, "import-timezone-conflict");
	await page.goto("/imports");
	await page
		.getByRole("button", { name: "Inspect binance-trade-history.csv" })
		.click();
	await expect(page.getByRole("dialog")).toContainText(
		"Used UTC from the column header instead of the selected IST.",
	);
});

test("the zone source label identifies the column header", async ({ page }) => {
	// binance-trade-history.csv has no zone in its name; the zone comes from "Date(UTC)".
	await upload(page, path.join(FIXTURES, "binance-trade-history.csv"), /^IST /);
	await expect(
		page.getByText(/Time zone: UTC \(from the column header\)/),
	).toBeVisible();
});

test("statement + Trade History: covered same-second legs leave no empty rows (P2-E2E-6)", async ({
	page,
	api,
}) => {
	await api.importFile(
		path.join(FIXTURES, "binance-trade-history.csv"),
		"binance",
		"UTC",
	);
	await upload(
		page,
		path.join(FIXTURES, "binance-transaction-statement.csv"),
		/^UTC /,
	);
	await page.goto("/transactions?pageSize=100");
	await settled(page);
	for (const day of ["15 Jun 2025", "10 May 2026"]) {
		const sameDay = rows(page).filter({ hasText: day });
		// The Trade History fills, once each; the statement legs are linked to them.
		await expect(sameDay).toHaveCount(2);
		for (const r of await sameDay.all()) {
			await expect(r).toContainText("Swap");
			await expect(r.getByText("unknown_type")).toHaveCount(0);
		}
	}
	await shot(page, "statement-trade-history-transactions");
	await page.goto("/review");
	await settled(page);
	await expect(
		page.getByText(/non-unique or incomplete trade legs/),
	).toHaveCount(0);
});

test("statement alone: ambiguous same-second groups are unclassified, not fees", async ({
	page,
	api,
}) => {
	await api.importFile(
		path.join(FIXTURES, "binance-transaction-statement.csv"),
		"binance",
		"UTC",
	);
	await page.goto("/transactions?pageSize=100");
	await settled(page);
	const ambiguous = rows(page).filter({ hasText: "15 Jun 2025" });
	await expect(ambiguous).not.toHaveCount(0);
	for (const r of await ambiguous.all()) {
		await expect(r).not.toContainText("Fee");
		await expect(r.getByText("unknown_type")).toBeVisible();
	}
	await shot(page, "statement-alone-unclassified");
});

test("no amount-free Fee rows after importing the statement (unknown operation)", async ({
	page,
	api,
}) => {
	await api.importFile(
		path.join(FIXTURES, "binance-trade-history.csv"),
		"binance",
		"UTC",
	);
	await api.importFile(
		path.join(FIXTURES, "binance-transaction-statement.csv"),
		"binance",
		"UTC",
	);
	await page.goto("/transactions?type=fee");
	await settled(page);
	await shot(page, "statement-fee-rows");
	// A fee row must move an amount; an operation the importer does not know is unclassified.
	const emptyFees: string[] = [];
	for (const r of await rows(page).all()) {
		const cells = r.locator("td");
		if ((await cells.count()) < 5) continue;
		const moved = `${await cells.nth(3).textContent()}${await cells.nth(4).textContent()}`;
		if (!/\d/.test(moved)) emptyFees.push((await r.textContent()) ?? "");
	}
	expect(emptyFees, "amount-free rows typed Fee").toEqual([]);
});

test("repeated flags of one code merge into one chip without a count and list their reasons", async ({
	page,
	api,
}) => {
	await api.addManual({
		sourceRef: "e2e-grouped-flags",
		timestamp: "2026-06-01T06:30:00.000Z",
		type: "buy",
		assetIn: "BTC",
		amountIn: "0.01",
		inrValue: "60000",
		reviewFlags: [
			{ code: "parse_warning", message: "first note about this row" },
			{ code: "parse_warning", message: "second note about this row" },
			{ code: "tds_not_deducted", message: "no TDS on this row" },
		],
	});
	await page.goto("/transactions?flagged=true");
	const row = rows(page).filter({ hasText: "BTC" });
	await expect(row.getByText("parse_warning", { exact: true })).toHaveCount(1);
	await expect(row.getByText("tds_not_deducted", { exact: true })).toHaveCount(
		1,
	);
	await expect(row.getByText(/×\d+/)).toHaveCount(0);
	await shot(page, "grouped-flag-chips");
	await row.getByRole("button").first().click();
	const drawer = page.getByRole("dialog");
	await expect(drawer.getByText("2 reasons")).toBeVisible();
	const drawerItems = drawer.getByRole("listitem");
	await expect(drawerItems).toHaveCount(2);
	await expect(drawerItems.nth(0)).toContainText("first note about this row");
	await expect(drawerItems.nth(1)).toContainText("second note about this row");
	await page.keyboard.press("Escape");

	await page.goto("/review");
	const parseRow = page
		.locator("section")
		.filter({
			has: page.getByRole("heading", {
				level: 2,
				name: "Import parse warning",
				exact: true,
			}),
		})
		.locator("tbody tr")
		.filter({ hasText: "BTC" });
	const reviewItems = parseRow.getByRole("listitem");
	await expect(reviewItems).toHaveCount(2);
	await expect(reviewItems.nth(0)).toContainText("first note about this row");
	await expect(reviewItems.nth(1)).toContainText("second note about this row");
});

test("Review groups repeated report warnings into one row with a ×N count", async ({
	page,
	api,
}) => {
	for (const [i, day] of ["2025-10-01", "2025-10-02"].entries())
		await api.addManual({
			sourceRef: `e2e-grouped-income-${i}`,
			timestamp: `${day}T06:30:00.000Z`,
			type: "income",
			assetIn: "FIXT",
			amountIn: "5",
			incomeKind: "airdrop",
		});
	// Rows outside the selected year are not ledger items there; the 2026-27 report (full
	// history) carries their warning once, with a count.
	await api.compute("2026-27");
	await page.goto("/review?taxYear=2026-27");
	const group = page.locator("section").filter({
		has: page.getByRole("heading", {
			level: 2,
			name: "Missing INR valuation",
			exact: true,
		}),
	});
	const warning = group
		.locator("tbody tr")
		.filter({ hasText: "Report warning" });
	await expect(warning).toHaveCount(1);
	await expect(warning).toContainText("(×2)");
	await shot(page, "review-grouped-report-warning");
});

test("the zone source label identifies the file name", async ({ page }) => {
	await upload(
		page,
		path.join(FIXTURES, "binance-spot-order-history(UTC+5).csv"),
		/^IST /,
	);
	await expect(
		page.getByText(/Time zone: \+05:00 \(from the file name\)/),
	).toBeVisible();
	await expect(
		page.getByText(
			"Used +05:00 from the file name instead of the selected IST.",
			{
				exact: true,
			},
		),
	).toHaveCount(1);
	await shot(page, "import-timezone-file-name");
	await page.goto("/imports");
	await page
		.getByRole("button", {
			name: "Inspect binance-spot-order-history(UTC+5).csv",
		})
		.click();
	const drawer = page.getByRole("dialog");
	await expect(drawer).toContainText("+05:00 (from the file name)");
	await expect(drawer).toContainText(
		"Used +05:00 from the file name instead of the selected IST.",
	);
});

test("a file without a zone says the zone is the user's answer and warns about nothing", async ({
	page,
}) => {
	await upload(
		page,
		path.join(FIXTURES, "report-kinds", "binance-convert.csv"),
		/^IST /,
	);
	await expect(page.getByText(/Time zone: IST \(your answer\)/)).toBeVisible();
	await expect(page.getByText(/instead of the selected/)).toHaveCount(0);
	await expect(
		page.getByText(/from the (column header|file name)/),
	).toHaveCount(0);
});

test("an unknown statement operation is an unclassified transfer, not an empty Fee row", async ({
	page,
	api,
}) => {
	await api.importFile(
		path.join(FIXTURES, "binance-transaction-statement.csv"),
		"binance",
		"UTC",
	);
	await api.importFile(
		path.join(FIXTURES, "report-kinds", "binance-statement-all-operations.csv"),
		"binance",
		"UTC",
	);
	await page.goto("/transactions?type=fee&pageSize=100");
	await settled(page);
	await expect(rows(page).getByText("unknown_type")).toHaveCount(0);
	await page.goto("/transactions?taxYear=2025-26&type=transfer&flagged=true");
	await settled(page);
	const future = rows(page).filter({ hasText: "02 Feb 2026" });
	await expect(future).toHaveCount(1);
	await expect(future).toContainText("Transfer");
	await expect(future).not.toContainText("Fee");
	await expect(future.getByText("unknown_type")).toBeVisible();
	await shot(page, "statement-unknown-operation-transfer");
});

const statusBadge = (article: Locator) =>
	article
		.locator("span")
		.filter({ hasText: /^(Synced|Synced with notes|Incomplete|Failed)$/ });

async function tone(locator: Locator) {
	return locator.evaluate((el) => {
		const resolve = (name: string) => {
			const probe = document.createElement("span");
			probe.style.color = `var(${name})`;
			el.append(probe);
			const color = getComputedStyle(probe).color;
			probe.remove();
			return color;
		};
		const color = getComputedStyle(el).color;
		for (const name of ["loss", "warning", "positive"])
			if (color === resolve(`--${name}`)) return name;
		return color;
	});
}

test("bad_signature: the Failed badge and the last sync error stay red", async ({
	page,
	api,
}) => {
	await api.json("POST", "/api/vault/setup", { passphrase: PASS });
	const c = await connection(api);
	await scenario("bad_signature");
	await page.goto("/connections");
	const article = card(page, c.label);
	await article.getByRole("button", { name: "Sync now", exact: true }).click();
	const badge = article.getByText("Failed", { exact: true });
	await expect(badge).toBeVisible({ timeout: 90_000 });
	await page.reload();
	await expect(badge).toBeVisible();
	expect(await tone(badge)).toBe("loss");
	const error = article.getByText(/^Last sync error:/);
	await expect(error).toContainText("Binance -1022");
	expect(await tone(error)).toBe("loss");
	await expect(article.getByText("Synced with notes")).toHaveCount(0);
	await shot(page, "sync-failed-red");
});

test("drift: a real balance difference is not shown as a clean or noted sync", async ({
	page,
	api,
}) => {
	await api.json("POST", "/api/vault/setup", { passphrase: PASS });
	await provider(api);
	const c = await connection(api, "evm", 1, WALLET_B);
	await scenario("drift");
	const article = await sync(page, c.label);
	const usdc = article
		.getByRole("table")
		.last()
		.getByRole("row")
		.filter({ has: page.getByRole("cell", { name: "USDC", exact: true }) });
	await expect(usdc.getByRole("cell").nth(3)).toHaveText("0.5");
	await expect(article.getByText("Synced with notes")).toHaveCount(0);
	await shot(page, "sync-drift-status");
	// A 0.5 USDC mismatch must read as a problem (loss colour), never as a green "Synced".
	const badge = statusBadge(article);
	await expect(badge).toHaveCount(1);
	expect(await tone(badge)).toBe("loss");
});

test.describe(SYNCED_GROUP, () => {
	test.describe.configure({ mode: "serial" });
	const LABEL = "Phase 2 binance account";
	const REF = "e2e-counts-toward-withdrawal";
	const GAP = "50";

	test.beforeAll(async ({ request }) => {
		test.setTimeout(900_000);
		const api = new AppApi(request);
		await reset(api);
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
		await api.json("POST", "/api/transactions", {
			importId: null,
			raw: { manualEntry: true, seededBy: "e2e" },
			reviewFlags: [],
			sourceRef: REF,
			timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString(),
			type: "withdrawal",
			assetOut: "USDT",
			amountOut: GAP,
		});
	});

	async function binanceCard(page: Page) {
		await page.goto("/connections");
		const article = card(page, LABEL);
		await expect(
			article.getByRole("heading", { name: "Sync Streams" }),
		).toBeVisible();
		await settled(page);
		return article;
	}
	const usdtRow = (article: Locator) =>
		article
			.getByRole("table")
			.last()
			.getByRole("row")
			.filter({
				has: article.page().getByRole("cell", { name: "USDT", exact: true }),
			});
	async function expectNotes(article: Locator) {
		const badge = statusBadge(article);
		await expect(badge).toHaveText("Synced with notes");
		expect(await tone(badge)).toBe("warning");
		await expect(article.getByText(/^Last sync error/)).toHaveCount(0);
		await expect(
			article.getByRole("heading", { name: /^Notes( \(\d+\))?$/ }),
		).toBeVisible();
		await expect(article.getByRole("listitem").first()).toBeVisible();
	}
	async function setCountsToward(page: Page, label: string) {
		await page.goto("/transactions?source=manual");
		await settled(page);
		await rows(page)
			.filter({ hasText: "USDT" })
			.getByRole("button")
			.first()
			.click();
		const drawer = page.getByRole("dialog");
		const select = drawer.getByLabel("Counts toward");
		await expect(select).toBeEnabled();
		await select.selectOption({ label });
		const saved = page.waitForResponse(
			(r) => r.request().method() === "PATCH" && r.ok(),
		);
		await drawer.getByRole("button", { name: "Save changes" }).click();
		await saved;
		await expect(
			rows(page).filter({ hasText: "USDT" }).getByText(`Manual (${label})`),
		).toHaveCount(label === "Binance" ? 1 : 0);
	}

	test("all differences zero: an amber 'Synced with notes' badge and a Notes list, no red error", async ({
		page,
	}) => {
		const article = await binanceCard(page);
		for (const r of await article
			.getByRole("table")
			.last()
			.locator("tbody tr")
			.all())
			await expect(r.getByRole("cell").nth(3)).toHaveText(/^0(\.0+)?$/);
		await expectNotes(article);
		await shot(page, "sync-binance-notes");
		await page.reload();
		await expectNotes(card(page, LABEL));
	});

	test("Counts toward in the drawer: Binance opens a red gap, Manual closes it", async ({
		page,
	}) => {
		await setCountsToward(page, "Binance");
		let article = await binanceCard(page);
		await expect(usdtRow(article).getByRole("cell").nth(3)).toHaveText(GAP);
		await expect(
			usdtRow(article).getByRole("link", { name: "Add missing transaction" }),
		).toBeVisible();
		const badge = statusBadge(article);
		await expect(badge).toHaveText("Incomplete");
		expect(await tone(badge)).toBe("loss");
		const error = article.getByText(/^Last sync error:/);
		await expect(error).toBeVisible();
		expect(await tone(error)).toBe("loss");
		await expect(article.getByText("Synced with notes")).toHaveCount(0);
		await shot(page, "counts-toward-gap-open");

		await setCountsToward(page, "Manual (no exchange)");
		article = await binanceCard(page);
		await expect(usdtRow(article).getByRole("cell").nth(3)).toHaveText(
			/^0(\.0+)?$/,
		);
		await expect(usdtRow(article)).toContainText("Matched");
		await expectNotes(article);
		await shot(page, "counts-toward-gap-closed");
	});

	test("an imported (synced) row has no Counts toward control", async ({
		page,
	}) => {
		await page.goto("/transactions?source=binance-api");
		await settled(page);
		await rows(page).first().getByRole("button").first().click();
		const drawer = page.getByRole("dialog");
		await expect(drawer.getByLabel("Counts toward")).toHaveCount(0);
	});

	for (const theme of ["light", "dark"] as const)
		for (const width of [375, 1280])
			test(`notes card and venue drawer ${width}px ${theme}: labelled, fit, readable`, async ({
				page,
			}) => {
				await setTheme(page, theme);
				await page.setViewportSize({ width, height: 812 });
				const article = await binanceCard(page);
				await expect(article.getByText("Synced with notes")).toBeVisible();
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				expect(
					await textContrastFailures(page),
					"connections contrast",
				).toEqual([]);
				await shot(page, `sync-notes-${width}-${theme}`);

				await page.goto("/transactions?source=manual");
				await settled(page);
				await rows(page)
					.filter({ hasText: "USDT" })
					.getByRole("button")
					.first()
					.click();
				const drawer = page.getByRole("dialog");
				await expect(drawer.getByLabel("Counts toward")).toHaveValue("manual");
				const unlabelled = await drawer
					.locator("input:not([type=hidden]),select,textarea")
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
				expect((await drawer.boundingBox())?.width ?? 0).toBeLessThanOrEqual(
					width,
				);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				const save = drawer.getByRole("button", { name: "Save changes" });
				await save.scrollIntoViewIfNeeded();
				await expect(save).toBeInViewport();
				expect(await textContrastFailures(page), "drawer contrast").toEqual([]);
				await shot(page, `edit-venue-drawer-${width}-${theme}`);
			});
});
