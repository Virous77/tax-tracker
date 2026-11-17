import path from "node:path";
import {
	statementPages,
	syntheticPdf,
} from "../../packages/importers/test/pdf-fixture";
import { FIXTURES } from "./support/env";
import { AppApi, setTheme } from "./support/fixtures";
import {
	connection,
	expect,
	provider,
	reset,
	settled,
	shot,
	test,
} from "./support/phase2";
import { textContrastFailures } from "./support/phase2-contrast";

test.beforeAll(async ({ request }) => {
	test.setTimeout(300000);
	const api = new AppApi(request);
	await reset(api);
	await provider(api, "etherscan", true);
	const c = await connection(api, "evm");
	const job = await api.json<{ jobId: string }>(
		"POST",
		`/api/connections/${c.id}/sync`,
	);
	await expect
		.poll(
			async () =>
				(await api.json<{ status: string }>("GET", `/api/jobs/${job.jobId}`))
					.status,
			{ timeout: 240000 },
		)
		.not.toMatch(/pending|running/);
	await api.importFile(
		path.join(FIXTURES, "binance-spot-order-history(UTC+5).csv"),
		"binance",
		"UTC",
	);
	const res = await request.post("/api/imports", {
		multipart: {
			file: {
				name: "responsive-statement.pdf",
				mimeType: "application/pdf",
				buffer: Buffer.from(syntheticPdf(statementPages())),
			},
			source: "auto",
			timezone: "UTC",
		},
	});
	expect(res.ok()).toBe(true);
	await api.compute("2025-26");
});

for (const theme of ["light", "dark"] as const)
	for (const width of [375, 1280]) {
		for (const screen of [
			"connections",
			"settings",
			"report",
			"import",
			"imports",
			"transactions",
			"review",
		])
			test(`${screen} ${width}px ${theme}: landmarks, labels, no horizontal page scroll`, async ({
				page,
			}) => {
				await setTheme(page, theme);
				await page.setViewportSize({ width, height: 900 });
				await page.goto(
					`/${screen}${screen === "report" ? "?taxYear=2025-26" : ""}`,
				);
				await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
				await settled(page);
				await expect(page.getByRole("main")).toHaveCount(1);
				await expect(page.getByRole("contentinfo")).toContainText(
					"Not tax advice.",
				);
				const unlabelled = await page
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
				expect.soft(unlabelled).toEqual([]);
				await shot(page, `${screen}-${width}-${theme}`);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
			});
		test(`connection dialogs ${width}px ${theme}: usable layout`, async ({
			page,
		}) => {
			await setTheme(page, theme);
			await page.setViewportSize({ width, height: 812 });
			await page.goto("/connections");
			await page
				.getByRole("button", { name: "Add connection", exact: true })
				.first()
				.click();
			const dialog = page.getByRole("dialog");
			for (const kind of ["Binance", "CoinDCX", "EVM address"]) {
				await dialog.getByRole("button", { name: kind, exact: true }).click();
				await shot(
					page,
					`dialog-${kind.replaceAll(" ", "-")}-${width}-${theme}`,
				);
				const bounds = await dialog.evaluate((el) => ({
					width: el.getBoundingClientRect().width,
					height: el.getBoundingClientRect().height,
					scrollWidth: el.scrollWidth,
					clientWidth: el.clientWidth,
				}));
				expect.soft(bounds.width).toBeLessThanOrEqual(width);
				expect.soft(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
				await dialog
					.getByRole("button", { name: "Save connection" })
					.scrollIntoViewIfNeeded();
				await expect(
					dialog.getByRole("button", { name: "Save connection" }),
				).toBeInViewport();
			}
		});
	}
for (const theme of ["light", "dark"] as const)
	test(`Phase 2 visible text contrast ${theme}`, async ({ page }) => {
		await setTheme(page, theme);
		const failures: string[] = [];
		for (const screen of [
			"connections",
			"settings",
			"report",
			"imports",
			"transactions",
			"review",
			"import",
		]) {
			await page.goto(
				`/${screen}${screen === "report" ? "?taxYear=2025-26" : ""}`,
			);
			await settled(page);
			failures.push(
				...(await textContrastFailures(page)).map((f) => `${screen}: ${f}`),
			);
		}
		expect([...new Set(failures)], "visible text below WCAG AA").toEqual([]);
	});
