import type { Page } from "@playwright/test";
import { AppApi, expect, setTheme, test } from "./support/fixtures";
import { openScreen, type Screen, seedRichData } from "./support/screens";

let screens: Screen[] = [];

test.beforeAll(async ({ request }) => {
	screens = await seedRichData(new AppApi(request));
});

const VIEWPORTS = [
	{ name: "mobile", width: 375, height: 812 },
	{ name: "desktop", width: 1440, height: 900 },
] as const;

const SCREEN_NAMES = [
	"overview",
	"import",
	"wizard",
	"imports",
	"transactions",
	"review",
	"report",
	"settings",
];

const byName = (name: string) => {
	const s = screens.find((x) => x.name === name);
	if (!s) throw new Error(`unknown screen ${name}`);
	return s;
};

for (const vp of VIEWPORTS) {
	for (const name of SCREEN_NAMES) {
		test(`${name} has no horizontal page scroll at ${vp.width}×${vp.height}`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await openScreen(page, byName(name));
			const { scrollWidth, innerWidth, widest } = await page.evaluate(() => {
				const root = document.scrollingElement as HTMLElement;
				let widest = "";
				let max = window.innerWidth;
				for (const el of document.querySelectorAll<HTMLElement>("body *")) {
					const r = el.getBoundingClientRect();
					if (r.right > max + 1 && r.width > 0) {
						max = r.right;
						widest = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`;
					}
				}
				return {
					scrollWidth: root.scrollWidth,
					innerWidth: window.innerWidth,
					widest,
				};
			});
			expect(
				scrollWidth,
				`page scrolls sideways; widest element: ${widest}`,
			).toBeLessThanOrEqual(innerWidth);
		});
	}
}

test.describe("mobile navigation", () => {
	test.use({ viewport: { width: 375, height: 812 } });

	test("opens and closes with the keyboard and navigates", async ({ page }) => {
		await openScreen(page, byName("overview"));
		const open = page.getByRole("button", { name: "Open navigation menu" });
		await expect(open).toHaveAttribute("aria-expanded", "false");
		await open.focus();
		await page.keyboard.press("Enter");
		const nav = page.getByRole("navigation", { name: "Main navigation" });
		await expect(nav).toBeVisible();
		await expect(open).toHaveAttribute("aria-expanded", "true");

		await page.keyboard.press("Escape");
		await expect(nav, "Escape should close the mobile menu").toBeHidden();
	});

	test("moves focus into the open menu and back to the toggle when closed", async ({
		page,
	}) => {
		await openScreen(page, byName("overview"));
		const open = page.getByRole("button", { name: "Open navigation menu" });
		await open.focus();
		await page.keyboard.press("Enter");
		const nav = page.getByRole("navigation", { name: "Main navigation" });
		await expect(nav).toBeVisible();
		await page.keyboard.press("Tab");
		const insideMenu = await page.evaluate(
			() => !!document.activeElement?.closest(".fixed.inset-0"),
		);
		expect(
			insideMenu,
			"first Tab after opening must land inside the menu",
		).toBe(true);
	});

	test("Escape returns focus to the toggle and Tab stays inside the open menu", async ({
		page,
	}) => {
		await openScreen(page, byName("overview"));
		const open = page.getByRole("button", { name: "Open navigation menu" });
		await open.focus();
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("navigation", { name: "Main navigation" }),
		).toBeVisible();
		const escaped: string[] = [];
		for (let i = 0; i < 15; i++) {
			await page.keyboard.press("Tab");
			const where = await page.evaluate(() => {
				const a = document.activeElement;
				return {
					inside: !!a?.closest('[role="dialog"]'),
					what: `${a?.tagName.toLowerCase()} ${a?.textContent?.trim().slice(0, 20)}`,
				};
			});
			if (!where.inside) escaped.push(where.what);
		}
		expect(escaped, "Tab left the open mobile menu").toEqual([]);
		await page.keyboard.press("Shift+Tab");
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("navigation", { name: "Main navigation" }),
		).toBeHidden();
		await expect(open).toBeFocused();
		await expect(open).toHaveAttribute("aria-expanded", "false");
	});

	test("a menu link can be activated by keyboard and closes the menu", async ({
		page,
	}) => {
		await openScreen(page, byName("overview"));
		await page.getByRole("button", { name: "Open navigation menu" }).click();
		const nav = page.getByRole("navigation", { name: "Main navigation" });
		await nav.getByRole("link", { name: "Transactions" }).focus();
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/\/transactions/);
		await expect(nav).toBeHidden();
	});
});

async function tabStaysInside(
	page: Page,
	dialogName: string | RegExp,
	presses = 25,
) {
	const escaped: string[] = [];
	for (let i = 0; i < presses; i++) {
		await page.keyboard.press("Tab");
		const where = await page.evaluate(() => {
			const a = document.activeElement;
			return {
				// Native modal <dialog> lets Tab reach the browser chrome (activeElement = body);
				// that is fine. Only focus on page content behind the dialog is an escape.
				inside: !a || a === document.body || !!a.closest("dialog[open]"),
				what: a
					? `${a.tagName.toLowerCase()} ${a.textContent?.trim().slice(0, 30) ?? ""}`
					: "none",
			};
		});
		if (!where.inside) escaped.push(where.what);
	}
	expect(escaped, `focus left the "${dialogName}" dialog`).toEqual([]);
}

test("add-transaction drawer traps focus, closes on Escape and returns focus", async ({
	page,
}) => {
	await openScreen(page, byName("transactions"));
	const trigger = page.getByRole("button", { name: "Add manual entry" });
	await trigger.click();
	const drawer = page.getByRole("dialog", { name: "Add manual transaction" });
	await expect(drawer).toBeVisible();
	await tabStaysInside(page, "Add manual transaction");
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();
	await expect(
		trigger,
		"focus should return to the button that opened the drawer",
	).toBeFocused();
});

test("transaction drawer traps focus and closes on Escape", async ({
	page,
}) => {
	await openScreen(page, byName("transactions"));
	await page
		.getByRole("table")
		.locator("tbody tr")
		.first()
		.getByRole("button")
		.first()
		.click();
	const drawer = page.getByRole("dialog").first();
	await expect(drawer).toBeVisible();
	await tabStaysInside(page, "transaction");
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();
});

test("delete confirm dialog traps focus and closes on Escape", async ({
	page,
}) => {
	await openScreen(page, byName("imports"));
	await page.getByRole("button", { name: "Delete malformed.csv" }).click();
	const dialog = page.getByRole("dialog", { name: "Delete import?" });
	await expect(dialog).toBeVisible();
	await tabStaysInside(page, "Delete import?", 8);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("cell", { name: /^malformed\.csv( |$)/ }),
	).toBeVisible();
});

test("report trail drawer traps focus and closes on Escape", async ({
	page,
}) => {
	await openScreen(page, byName("report"));
	await page
		.getByRole("button", { name: "Trail", exact: true })
		.first()
		.click();
	const drawer = page.getByRole("dialog", { name: /^Audit Trail/ });
	await expect(drawer).toBeVisible();
	await tabStaysInside(page, "Audit Trail", 6);
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();
});

async function expectNamedControls(page: Page, where: string) {
	const controls = page.locator("input:not([type=hidden]), select, textarea");
	const count = await controls.count();
	expect(count, `${where} has form controls`).toBeGreaterThan(0);
	for (let i = 0; i < count; i++) {
		await expect(
			controls.nth(i),
			`${where}: control #${i} needs an accessible name`,
		).toHaveAccessibleName(/\S/);
	}
}

test("every form control has an accessible name", async ({ page }) => {
	for (const name of [
		"import",
		"wizard",
		"transactions",
		"review",
		"report",
		"settings",
	]) {
		await openScreen(page, byName(name));
		if (name === "review") continue;
		await expectNamedControls(page, name);
	}
	await openScreen(page, byName("transactions"));
	await page.getByRole("button", { name: "Add manual entry" }).click();
	await expectNamedControls(page, "add-transaction drawer");
	await page.keyboard.press("Escape");
	await page
		.getByRole("table")
		.locator("tbody tr")
		.first()
		.getByRole("button")
		.first()
		.click();
	await expectNamedControls(page, "transaction drawer");
});

async function focusOffenders(page: Page, presses: number) {
	const offenders = new Set<string>();
	for (let i = 0; i < presses; i++) {
		await page.keyboard.press("Tab");
		const res = await page.evaluate(() => {
			const el = document.activeElement as HTMLElement | null;
			if (!el || el === document.body) return null;
			const s = getComputedStyle(el);
			const r = el.getBoundingClientRect();
			const ring =
				(s.outlineStyle !== "none" && Number.parseFloat(s.outlineWidth) > 0) ||
				s.boxShadow !== "none";
			const visibleBox = r.width > 2 && r.height > 2;
			if (ring && visibleBox) return null;
			return `${el.tagName.toLowerCase()}${el.getAttribute("type") ? `[type=${el.getAttribute("type")}]` : ""} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`;
		});
		if (res) offenders.add(res);
	}
	return [...offenders];
}

for (const name of [
	"overview",
	"import",
	"transactions",
	"report",
	"settings",
]) {
	test(`keyboard focus is visible on ${name}`, async ({ page }) => {
		await openScreen(page, byName(name));
		const offenders = await focusOffenders(page, 30);
		expect(
			offenders,
			"elements that receive focus without a visible focus ring",
		).toEqual([]);
	});
}

for (const theme of ["light", "dark"] as const) {
	test(`text meets WCAG AA contrast (${theme})`, async ({ page }) => {
		const failures = new Set<string>();
		await setTheme(page, theme);
		for (const name of [
			"overview",
			"report",
			"settings",
			"transactions",
			"review",
		]) {
			await openScreen(page, byName(name));
			const found = await page.evaluate(() => {
				const canvas = document.createElement("canvas").getContext("2d");
				if (!canvas) return [];
				const rgba = (c: string) => {
					canvas.clearRect(0, 0, 1, 1);
					canvas.fillStyle = "#000";
					canvas.fillStyle = c;
					canvas.fillRect(0, 0, 1, 1);
					return Array.from(canvas.getImageData(0, 0, 1, 1).data);
				};
				const lum = ([r, g, b]: number[]) => {
					const f = (v: number) => {
						const x = v / 255;
						return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
					};
					return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(b ?? 0);
				};
				const bgOf = (el: Element | null): string => {
					for (let e = el; e; e = e.parentElement) {
						const bg = getComputedStyle(e).backgroundColor;
						if (rgba(bg)[3] === 255) return bg;
					}
					return getComputedStyle(document.body).backgroundColor;
				};
				const out: string[] = [];
				for (const el of document.querySelectorAll<HTMLElement>(
					"p, span, dt, dd, th, td, label, code, h3, a, button",
				)) {
					const text = [...el.childNodes]
						.filter((n) => n.nodeType === 3)
						.map((n) => n.textContent ?? "")
						.join("")
						.trim();
					if (!text || el.offsetParent === null) continue;
					const fg = rgba(getComputedStyle(el).color);
					const bg = rgba(bgOf(el));
					const a = (fg[3] ?? 255) / 255;
					const blended = [0, 1, 2].map(
						(i) => (fg[i] ?? 0) * a + (bg[i] ?? 0) * (1 - a),
					);
					const l1 = lum(blended);
					const l2 = lum(bg);
					const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
					const size = Number.parseFloat(getComputedStyle(el).fontSize);
					const bold = Number(getComputedStyle(el).fontWeight) >= 700;
					const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
					if (ratio < need)
						out.push(`${ratio.toFixed(2)}:1 "${text.slice(0, 40)}"`);
				}
				return out;
			});
			for (const f of found) failures.add(`${name}: ${f}`);
		}
		expect([...failures], "text below WCAG AA contrast").toEqual([]);
	});
}
