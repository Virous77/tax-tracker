import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import {
	APP_PASSWORD,
	MAIN_URL,
	PHASE4_PASSWORD_URL,
	REPO_ROOT,
	SOURCE_URL,
} from "./support/env";
import { expect, setTheme, settled, snap, test } from "./support/fixtures";
import { textContrastFailures } from "./support/phase2-contrast";

// Runs on the Phase 4 stacks, whose disclaimer starts unaccepted, so the tests run in order.
test.describe.configure({ mode: "serial" });

const VERSION = JSON.parse(readFileSync(`${REPO_ROOT}/package.json`, "utf8"))
	.version as string;
const PAGES = [
	"/",
	"/import",
	"/imports",
	"/connections",
	"/transactions",
	"/review",
	"/report",
	"/settings",
];
const DISMISS_CHECKLIST = "Dismiss getting started checklist";

function disclaimer(page: Page) {
	return page.getByRole("dialog", { name: "Before you start" });
}

function checklist(page: Page) {
	return page.getByRole("region", { name: "Getting started" });
}

function banner(page: Page) {
	return page.getByRole("status").filter({ hasText: "Sample data loaded" });
}

async function focusInside(dialog: Locator) {
	return dialog.evaluate((el) => el.contains(document.activeElement));
}

async function noHorizontalScroll(page: Page, width: number) {
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
	).toBeLessThanOrEqual(width);
}

async function unnamedControls(scope: Locator) {
	return scope
		.locator("button, a[href], input:not([type=hidden]), select")
		.evaluateAll((els) =>
			els
				.filter((el) => {
					const name =
						el.getAttribute("aria-label") ??
						el.getAttribute("aria-labelledby") ??
						el.textContent;
					return el.getBoundingClientRect().width > 0 && !(name ?? "").trim();
				})
				.map((el) => el.outerHTML.slice(0, 160)),
		);
}

async function settings(page: Page, base = "") {
	const res = await page.request.get(`${base}/api/settings`);
	expect(res.ok()).toBe(true);
	return (await res.json()) as { disclaimerAcceptedAt: string | null };
}

async function demoStatus(page: Page) {
	return (await (await page.request.get("/api/demo")).json()) as {
		loaded: boolean;
		importIds: string[];
	};
}

test.describe("first-run disclaimer", () => {
	test("blocks every page until accepted", async ({ page }) => {
		for (const path of PAGES) {
			await page.goto(path);
			const dialog = disclaimer(page);
			await expect(dialog, path).toBeVisible();
			await expect(dialog).toContainText("Not tax advice.");
			await expect(dialog).toContainText("Chartered Accountant");
			await expect(dialog).toContainText("Your data stays on this computer");
			await expect(
				dialog.getByRole("button", { name: "I understand" }),
			).toBeVisible();
		}
		await snap(page, "phase4/disclaimer-1440");
	});

	test("is modal: focus stays inside, Escape and the backdrop do nothing", async ({
		page,
	}) => {
		await page.goto("/settings");
		const dialog = disclaimer(page);
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute("aria-describedby", /.+/);
		expect(await dialog.evaluate((el) => (el as HTMLDialogElement).open)).toBe(
			true,
		);
		expect(await focusInside(dialog)).toBe(true);
		for (const key of ["Tab", "Tab", "Shift+Tab", "Tab", "Shift+Tab"]) {
			await page.keyboard.press(key);
			expect(await focusInside(dialog), `after ${key}`).toBe(true);
		}
		await page.keyboard.press("Escape");
		await expect(dialog).toBeVisible();
		await page.mouse.click(5, 5);
		await page.mouse.click(5, 880);
		await expect(dialog).toBeVisible();
		await expect(page).toHaveURL(/\/settings$/);
		const nav = page
			.getByRole("navigation", { name: "Main navigation" })
			.getByRole("link", { name: "Transactions" });
		const box = await nav.boundingBox();
		if (box)
			await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await expect(page).toHaveURL(/\/settings$/);
		await expect(dialog).toBeVisible();
		expect((await settings(page)).disclaimerAcceptedAt).toBeNull();
	});

	test("“I understand” closes it and the acceptance persists across reloads and pages", async ({
		page,
	}) => {
		await page.goto("/");
		await disclaimer(page)
			.getByRole("button", { name: "I understand" })
			.click();
		await expect(disclaimer(page)).toHaveCount(0);
		const stamp = (await settings(page)).disclaimerAcceptedAt;
		expect(stamp).toMatch(/^\d{4}-\d\d-\d\dT/);
		await page.reload();
		await expect(
			page.getByRole("heading", { level: 1, name: "Tax Overview" }),
		).toBeVisible();
		await settled(page);
		await expect(disclaimer(page)).toHaveCount(0);
		for (const path of PAGES.slice(1)) {
			await page.goto(path);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			await expect(disclaimer(page), path).toHaveCount(0);
		}
		expect((await settings(page)).disclaimerAcceptedAt).toBe(stamp);
	});
});

test.describe("password mode", () => {
	test("no dialog on /login; it appears after signing in", async ({ page }) => {
		await page.goto(`${PHASE4_PASSWORD_URL}/`);
		await expect(page).toHaveURL(/\/login/);
		await expect(
			page.getByRole("heading", { name: "Tax Tracker Unlock" }),
		).toBeVisible();
		await page.waitForLoadState("networkidle");
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.getByRole("contentinfo")).toContainText(`v${VERSION}`);
		await page.getByLabel("Password").fill(APP_PASSWORD);
		await page.getByRole("button", { name: "Unlock" }).click();
		await expect(disclaimer(page)).toBeVisible();
		expect(
			(await settings(page, PHASE4_PASSWORD_URL)).disclaimerAcceptedAt,
		).toBeNull();
	});

	for (const theme of ["light", "dark"] as const)
		for (const width of [375, 1280])
			test(`disclaimer ${width}px ${theme}: fits, readable, labelled`, async ({
				page,
			}) => {
				await setTheme(page, theme);
				await page.setViewportSize({ width, height: 740 });
				await page.goto(`${PHASE4_PASSWORD_URL}/login`);
				await page.getByLabel("Password").fill(APP_PASSWORD);
				await page.getByRole("button", { name: "Unlock" }).click();
				const dialog = disclaimer(page);
				await expect(dialog).toBeVisible();
				const box = await dialog.boundingBox();
				expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
				expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
				const button = dialog.getByRole("button", { name: "I understand" });
				await button.scrollIntoViewIfNeeded();
				await expect(button).toBeInViewport();
				expect(await unnamedControls(dialog)).toEqual([]);
				expect(await textContrastFailures(page, "dialog")).toEqual([]);
				await noHorizontalScroll(page, width);
				await snap(page, `phase4/disclaimer-${width}-${theme}`);
			});
});

test.describe("footer", () => {
	test("shows the version, the licence and the configured source link", async ({
		page,
	}) => {
		await page.goto("/settings");
		const footer = page.getByRole("contentinfo");
		await expect(footer).toContainText(`v${VERSION}`);
		await expect(footer).toContainText("AGPL-3.0");
		await expect(footer).toContainText("Not tax advice");
		const link = footer.getByRole("link", { name: "Source code" });
		await expect(link).toHaveAttribute("href", SOURCE_URL);
		await expect(link).toHaveAttribute("target", "_blank");
		await expect(link).toHaveAttribute("rel", /noopener/);
		await expect(link).toHaveAttribute("rel", /noreferrer/);
	});

	test("hides the source link when SOURCE_URL is not set", async ({ page }) => {
		await page.goto(`${MAIN_URL}/settings`);
		const footer = page.getByRole("contentinfo");
		await expect(footer).toContainText(`v${VERSION}`);
		await expect(footer).toContainText("AGPL-3.0");
		await expect(footer.getByRole("link")).toHaveCount(0);
		await expect(footer).not.toContainText("Source");
	});
});

test.describe("getting started", () => {
	test("lists five steps that link to their screens, none done on an empty ledger", async ({
		page,
	}) => {
		await page.goto("/");
		await settled(page);
		const list = checklist(page);
		await expect(list).toBeVisible();
		await expect(list).toContainText("0 of 5 steps done");
		const links = list.getByRole("link");
		await expect(links).toHaveCount(5);
		const expected = [
			["1. Choose your tax year and settings", "/settings"],
			["2. Import a file or connect an exchange", "/import"],
			["3. Resolve Review items", "/review?taxYear=2026-27"],
			["4. Open the report", "/report?taxYear=2026-27"],
			["5. Export", "/report?taxYear=2026-27"],
		];
		for (const [i, [name, href]] of expected.entries()) {
			const link = links.nth(i);
			await expect(link).toContainText(name as string);
			await expect(link).toContainText("— not done");
			await expect(link).toHaveAttribute("href", href as string);
		}
		await links.nth(1).click();
		await expect(page).toHaveURL(/\/import$/);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await page.goto("/");
		await checklist(page).getByRole("link").nth(0).click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Settings" }),
		).toBeVisible();
	});

	test("dismissal hides it and persists across reloads and navigation", async ({
		page,
	}) => {
		await page.goto("/");
		await settled(page);
		await checklist(page)
			.getByRole("button", { name: DISMISS_CHECKLIST })
			.click();
		await expect(checklist(page)).toHaveCount(0);
		await page.reload();
		await settled(page);
		await expect(checklist(page)).toHaveCount(0);
		await page.goto("/settings");
		await page.goto("/");
		await settled(page);
		await expect(checklist(page)).toHaveCount(0);
	});
});

test.describe("sample data", () => {
	test("“Try with sample data” opens a report that includes sample data", async ({
		page,
	}) => {
		await page.goto("/");
		await settled(page);
		await page
			.getByRole("button", { name: "Try with sample data" })
			.first()
			.click();
		await expect(page).toHaveURL(/\/report\?taxYear=2025-26$/, {
			timeout: 30_000,
		});
		await expect(
			page.getByRole("heading", {
				level: 1,
				name: "Schedule VDA & Tax Report",
			}),
		).toBeVisible();
		await settled(page);
		await expect(page.getByText("Includes sample data")).toBeVisible();
		await expect(page.getByText(/Schedule VDA \(\d+/)).toBeVisible();
		const rows = page.locator("table tbody tr");
		expect(await rows.count()).toBeGreaterThan(0);
		expect((await demoStatus(page)).loaded).toBe(true);
		await snap(page, "phase4/sample-report");
	});

	test("the banner shows on every page", async ({ page }) => {
		for (const path of PAGES) {
			await page.goto(path);
			await expect(banner(page), path).toBeVisible();
			await expect(
				banner(page).getByRole("button", { name: "Remove sample data" }),
			).toBeVisible();
		}
	});

	test("Imports marks every sample import with a Sample badge", async ({
		page,
	}) => {
		await page.goto("/imports");
		await settled(page);
		const badges = page.getByText("Sample", { exact: true }).filter({
			visible: true,
		});
		await expect(badges).toHaveCount(3);
		await snap(page, "phase4/sample-imports");
	});

	test("the checklist reflects the loaded data", async ({ page }) => {
		await page.goto("/");
		await settled(page);
		const list = checklist(page);
		await expect(list).toBeVisible();
		await expect(list.getByRole("link").nth(1)).toContainText("— done");
		await expect(list.getByRole("link").nth(4)).toContainText("— not done");
	});

	for (const theme of ["light", "dark"] as const)
		for (const width of [375, 1280])
			test(`new UI ${width}px ${theme}: labels, no horizontal scroll, contrast`, async ({
				page,
			}) => {
				await setTheme(page, theme);
				await page.setViewportSize({ width, height: 900 });
				const scopes =
					"[role=status], section[aria-labelledby=getting-started-title], footer";
				for (const path of [
					"/",
					"/imports",
					"/report?taxYear=2025-26",
					"/settings",
				]) {
					await page.goto(path);
					await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
					await settled(page);
					await expect(banner(page)).toBeVisible();
					if (path === "/") await expect(checklist(page)).toBeVisible();
					for (const scope of [
						banner(page),
						page.getByRole("contentinfo"),
						...(path === "/" ? [checklist(page)] : []),
					])
						expect(await unnamedControls(scope), path).toEqual([]);
					const badgeScope =
						path === "/imports" || path.startsWith("/report")
							? ", span.rounded.border"
							: "";
					expect
						.soft(
							await textContrastFailures(page, `${scopes}${badgeScope}`),
							`${path} ${width} ${theme}`,
						)
						.toEqual([]);
					await noHorizontalScroll(page, width);
					await snap(
						page,
						`phase4/${path.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "overview"}-${width}-${theme}`,
					);
				}
			});

	test("Cancel and Escape in the confirm dialog keep the sample data", async ({
		page,
	}) => {
		await page.goto("/transactions");
		await banner(page)
			.getByRole("button", { name: "Remove sample data" })
			.click();
		const confirm = page.getByRole("dialog", { name: "Remove sample data?" });
		await expect(confirm).toBeVisible();
		await expect(confirm).toContainText("Your own imports and manual entries");
		await confirm.getByRole("button", { name: "Cancel" }).click();
		await expect(confirm).toHaveCount(0);
		await banner(page)
			.getByRole("button", { name: "Remove sample data" })
			.click();
		await expect(confirm).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(confirm).toBeHidden();
		await expect(banner(page)).toBeVisible();
		expect((await demoStatus(page)).loaded).toBe(true);
	});

	test("Remove sample data deletes it and the banner goes away", async ({
		page,
	}) => {
		await page.goto("/imports");
		await banner(page)
			.getByRole("button", { name: "Remove sample data" })
			.click();
		const confirm = page.getByRole("dialog", { name: "Remove sample data?" });
		await confirm.getByRole("button", { name: "Remove sample data" }).click();
		await expect(page).toHaveURL(/\/$/);
		await expect(
			page.getByRole("heading", { level: 1, name: "Tax Overview" }),
		).toBeVisible();
		await settled(page);
		await expect(banner(page)).toHaveCount(0);
		expect(await demoStatus(page)).toEqual({ loaded: false, importIds: [] });
		const tx = (await (
			await page.request.get("/api/transactions?pageSize=1")
		).json()) as { total: number };
		expect(tx.total).toBe(0);
		await page.goto("/imports");
		await settled(page);
		await expect(page.getByText("Sample", { exact: true })).toHaveCount(0);
		for (const path of PAGES.slice(1)) {
			await page.goto(path);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			await expect(banner(page), path).toHaveCount(0);
		}
		await page.goto("/report?taxYear=2025-26");
		await settled(page);
		await expect(page.getByText("Includes sample data")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Try with sample data" }),
		).toBeVisible();
	});
});

test.describe("backup", () => {
	test("Settings → Download backup saves a SQLite .db file", async ({
		page,
	}, testInfo) => {
		await page.goto("/settings");
		await settled(page);
		const button = page.getByRole("button", { name: "Download backup" });
		await button.scrollIntoViewIfNeeded();
		const [download] = await Promise.all([
			page.waitForEvent("download"),
			button.click(),
		]);
		expect(download.suggestedFilename()).toMatch(
			/^tax-tracker-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z\.db$/,
		);
		expect(await download.failure()).toBeNull();
		const file = testInfo.outputPath("backup.db");
		await download.saveAs(file);
		expect(readFileSync(file).subarray(0, 16).toString("latin1")).toBe(
			"SQLite format 3\0",
		);
		await expect(
			page.getByRole("button", { name: "Download backup" }),
		).toBeEnabled();
		await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
			0,
		);
		await expect(page.getByText("data/backups/")).toBeVisible();
	});
});

// Kept last: serial mode skips everything after a failure, and this bug test stays red until fixed.
test.describe("bugs", () => {
	test("P4-E2E-1: after loading sample data, Overview shows the year that holds the sample rows", async ({
		page,
	}) => {
		try {
			await page.goto("/");
			await settled(page);
			await page
				.getByRole("button", { name: "Try with sample data" })
				.first()
				.click();
			await expect(page).toHaveURL(/\/report\?taxYear=2025-26$/, {
				timeout: 30_000,
			});
			await page
				.getByRole("navigation", { name: "Main navigation" })
				.getByRole("link", { name: "Overview" })
				.click();
			await expect(
				page.getByRole("heading", { level: 1, name: "Tax Overview" }),
			).toBeVisible();
			await settled(page);
			await expect(
				page.getByText(/\b[1-9]\d* Schedule VDA rows?\b/),
			).toBeVisible();
		} finally {
			await page.request.delete("/api/demo");
		}
	});
});
