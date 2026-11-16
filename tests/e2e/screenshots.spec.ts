import { AppApi, setTheme, snap, test } from "./support/fixtures";
import { openScreen, type Screen, seedRichData } from "./support/screens";

// Full-page captures of every screen for visual review; written to tests/e2e/screenshots/.

let screens: Screen[] = [];

test.beforeAll(async ({ request }) => {
	screens = await seedRichData(new AppApi(request));
});

const VARIANTS = [
	{ name: "light", theme: "light", viewport: { width: 1440, height: 900 } },
	{ name: "dark", theme: "dark", viewport: { width: 1440, height: 900 } },
	{ name: "mobile", theme: "light", viewport: { width: 375, height: 812 } },
	{ name: "mobile-dark", theme: "dark", viewport: { width: 375, height: 812 } },
] as const;

for (const variant of VARIANTS) {
	test(`capture every screen (${variant.name})`, async ({ page }) => {
		await setTheme(page, variant.theme);
		await page.setViewportSize(variant.viewport);
		for (const screen of screens) {
			await openScreen(page, screen);
			await snap(page, `screen-${screen.name}-${variant.name}`);
		}
		await openScreen(page, screens.find((s) => s.name === "report") as Screen);
		await page
			.getByRole("button", { name: "Trail", exact: true })
			.first()
			.click();
		await snap(page, `drawer-trail-${variant.name}`);
		await page.keyboard.press("Escape");
		await openScreen(
			page,
			screens.find((s) => s.name === "transactions") as Screen,
		);
		await page.getByRole("button", { name: "Add manual entry" }).click();
		await snap(page, `drawer-add-manual-${variant.name}`);
		if (variant.viewport.width < 400) {
			await page.keyboard.press("Escape");
			await page.getByRole("button", { name: "Open navigation menu" }).click();
			await snap(page, `mobile-nav-open-${variant.name}`);
		}
	});
}
