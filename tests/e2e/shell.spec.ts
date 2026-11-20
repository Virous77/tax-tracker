import { DISCLAIMER_TEXT } from "./support/env";
import { expect, settled, test } from "./support/fixtures";

const NAV = [
	{ label: "Overview", path: "/", heading: "Tax Overview" },
	{ label: "Import", path: "/import", heading: "Import" },
	{ label: "Imports", path: "/imports", heading: "Imports" },
	{ label: "Transactions", path: "/transactions", heading: "Transactions" },
	{ label: "Review", path: "/review", heading: "Review Queue" },
	{ label: "Report", path: "/report", heading: "Schedule VDA & Tax Report" },
	{ label: "Settings", path: "/settings", heading: "Settings" },
];

test.beforeEach(async ({ api }) => {
	await api.reset();
	await api.seedWorkedExample();
	await api.compute("2026-27");
});

test("every nav link loads its screen with the disclaimer footer", async ({
	page,
}) => {
	await page.goto("/settings");
	const nav = page.getByRole("navigation", { name: "Main navigation" });
	for (const item of NAV) {
		await nav.getByRole("link", { name: item.label, exact: true }).click();
		await expect(page).toHaveURL(
			new RegExp(
				`${item.path === "/" ? "/(\\?.*)?$" : `${item.path}(\\?.*)?$`}`,
			),
		);
		await expect(
			page.getByRole("heading", { level: 1, name: item.heading, exact: true }),
		).toBeVisible();
		await expect(
			nav.getByRole("link", { name: item.label, exact: true }),
		).toHaveAttribute("aria-current", "page");
		await expect(page.getByRole("contentinfo")).toContainText(DISCLAIMER_TEXT);
		await settled(page);
	}
});

for (const item of NAV) {
	test(`direct load of ${item.path} has no console errors or failed requests`, async ({
		page,
	}) => {
		await page.goto(item.path);
		await expect(
			page.getByRole("heading", { level: 1, name: item.heading, exact: true }),
		).toBeVisible();
		await settled(page);
		await expect(page.getByRole("contentinfo")).toContainText("Not tax advice");
	});
}

test("theme toggle cycles light/dark and persists across reloads", async ({
	page,
}) => {
	await page.goto("/");
	const html = page.locator("html");
	const toggle = page.getByRole("button", { name: /^Theme/ });
	await expect(toggle).toContainText("System");
	await expect(html).not.toHaveAttribute("data-theme", /.+/);

	await toggle.click();
	await expect(toggle).toContainText("Light");
	await expect(html).toHaveAttribute("data-theme", "light");
	await page.reload();
	await expect(html).toHaveAttribute("data-theme", "light");
	await expect(toggle).toContainText("Light");

	await toggle.click();
	await expect(html).toHaveAttribute("data-theme", "dark");
	await page.reload();
	await expect(html).toHaveAttribute("data-theme", "dark");
	await expect(toggle).toContainText("Dark");
	const bg = await page
		.locator("body")
		.evaluate((el) => getComputedStyle(el).backgroundColor);
	const lightBg = await page.evaluate(() => {
		document.documentElement.setAttribute("data-theme", "light");
		return getComputedStyle(document.body).backgroundColor;
	});
	expect(bg).not.toBe(lightBg);
});
