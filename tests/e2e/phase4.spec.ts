import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import {
	APP_PASSWORD,
	MAIN_URL,
	PHASE4_PASSWORD_URL,
	REPO_ROOT,
	SOURCE_URL,
} from "./support/env";
import {
	AppApi,
	expect,
	setTheme,
	settled,
	snap,
	test,
} from "./support/fixtures";
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
		// Phase 4 (2d31f5f): a fresh install defaults to the latest completed year in IST, FY 2025-26 now.
		const expected = [
			["1. Choose your tax year and settings", "/settings"],
			["2. Import a file or connect an exchange", "/import"],
			["3. Resolve Review items", `/review?taxYear=${YEAR}`],
			["4. Open the report", `/report?taxYear=${YEAR}`],
			["5. Export", `/report?taxYear=${YEAR}`],
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
		await expect(list.getByRole("link").nth(1)).toContainText("— not done");
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
		expect(await demoStatus(page)).toMatchObject({
			loaded: false,
			importIds: [],
		});
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

const YEAR = "2025-26";
const SAMPLES = `${REPO_ROOT}/docs/research/export-samples`;
const ORDER_HISTORY = `${SAMPLES}/Binance-Spot-Order-History-202601021200(UTC+5)-part1-of1.SYNTHETIC.csv`;
const COINDCX_ORDERS = `${SAMPLES}/coindcx-order-history.SYNTHETIC.csv`;
const RESTORE_COMMANDS = [
	"docker compose stop",
	"rm -f data/tax-tracker.db-wal data/tax-tracker.db-shm",
	"cp /path/to/backup.db data/tax-tracker.db",
	"sudo chown 1000:1000 data/tax-tracker.db",
	"docker compose start",
];

type ReviewData = {
	groups: {
		code: string;
		severity: "action" | "info";
		count: number;
		items: { id: string }[];
	}[];
	totals: { action: number; info: number };
};

function reviewData(api: AppApi) {
	return api.json<ReviewData>("GET", `/api/review?taxYear=${YEAR}`);
}

async function resolveActionItems(api: AppApi) {
	await api.compute(YEAR);
	for (let pass = 0; pass < 3; pass++) {
		const open = (await reviewData(api)).groups.flatMap((g) =>
			g.severity === "action"
				? g.items.map((tx) => [tx.id, g.code] as const)
				: [],
		);
		if (!open.length) break;
		for (const [id, code] of open)
			await api.json("PATCH", `/api/transactions/${id}`, {
				resolveFlags: [code],
			});
		await api.compute(YEAR);
	}
	return reviewData(api);
}

const usdtBuy = (api: AppApi) =>
	api.addManual({
		sourceRef: `e2e-usdt-${Date.now()}`,
		timestamp: "2025-12-01T00:00:00.000Z",
		type: "buy",
		assetIn: "USDT",
		amountIn: "1000",
		inrValue: "90000",
	});

function notesSection(page: Page) {
	return page.locator("details").filter({ hasText: "Notes about your files" });
}

function reportNotesSection(page: Page) {
	return page.locator("details").filter({ hasText: "Report notes" });
}

function checklistStep(page: Page, n: number) {
	return checklist(page)
		.getByRole("link")
		.nth(n - 1);
}

/** Action groups outside the Notes section, as [code, badge count]. */
function actionGroupsOnPage(page: Page) {
	return page
		.locator("section")
		.evaluateAll((sections) =>
			sections
				.filter((s) => !s.closest("details") && s.querySelector("h2 + span"))
				.map((s) => [
					s.querySelector("code")?.textContent?.trim() ?? "",
					Number.parseInt(s.querySelector("h2 + span")?.textContent ?? "", 10),
				]),
		);
}

function record404s(page: Page) {
	const seen: string[] = [];
	page.on("response", (res) => {
		if (res.status() === 404)
			seen.push(`${res.request().method()} ${res.url()}`);
	});
	page.on("console", (msg) => {
		if (msg.type() === "error" && /404/.test(msg.text()))
			seen.push(`console: ${msg.text()} ${msg.location().url}`);
	});
	return seen;
}

test.describe("review notes and action counts", () => {
	test("notes are collapsed and counted apart; Overview, Review and the checklist agree", async ({
		page,
		api,
	}) => {
		await api.reset();
		await api.putSettings({ defaultTaxYear: YEAR });
		await api.importFile(ORDER_HISTORY, "auto", "UTC");
		await usdtBuy(api);
		await api.compute(YEAR);
		const data = await reviewData(api);
		expect(data.totals.info).toBe(4);
		expect(data.totals.action).toBeGreaterThan(0);

		await page.goto(`/review?taxYear=${YEAR}`);
		await settled(page);
		const notes = notesSection(page);
		await expect(notes).toBeVisible();
		expect(await notes.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(
			false,
		);
		// The CA notice is a report note, so it is counted under "Report notes", not here.
		await expect(notes.locator("summary")).toContainText(
			`${data.totals.info - 1} notes`,
		);
		const note = page.getByText(/Duplicate columns were renamed/);
		await expect(note).toBeHidden();
		const onPage = await actionGroupsOnPage(page);
		expect(onPage.map(([code]) => code)).not.toContain(
			"ca_verification_pending",
		);
		expect(onPage.reduce((n, [, count]) => n + Number(count), 0)).toBe(
			data.totals.action,
		);
		await notes.locator("summary").click();
		await expect(note).toBeVisible();
		await expect(notes).toContainText("Nothing here needs action");
		await expect(notes).toContainText(
			"Used +05:00 from the file name instead of the selected UTC.",
		);
		await expect(notes).not.toContainText(
			"Section numbers pending CA verification",
		);
		const reportNotes = reportNotesSection(page);
		await expect(reportNotes.locator("summary")).toContainText("1 note");
		await reportNotes.locator("summary").click();
		await expect(reportNotes).toContainText(
			"Section numbers pending CA verification",
		);
		await expect(
			reportNotes.getByRole("link", { name: "View import" }),
		).toHaveCount(0);
		await expect(
			reportNotes.getByRole("link", { name: "Review sections in Report" }),
		).toBeVisible();

		await page.goto("/");
		await settled(page);
		const word = data.totals.action === 1 ? "item needs" : "items need";
		await expect(
			page.getByText(`${data.totals.action} ${word} review before filing.`),
		).toBeVisible();
		await expect(checklistStep(page, 3)).toContainText("— not done");
		await expect(checklistStep(page, 3)).toHaveAttribute(
			"href",
			`/review?taxYear=${YEAR}`,
		);
	});

	test("the checklist completes when only notes remain", async ({
		page,
		api,
	}) => {
		await api.reset();
		await api.putSettings({ defaultTaxYear: YEAR });
		await api.importFile(COINDCX_ORDERS, "auto", "IST");
		await usdtBuy(api);
		const data = await resolveActionItems(api);
		expect(data.totals).toEqual({ action: 0, info: 2 });

		await page.goto("/");
		await settled(page);
		await expect(page.getByText(/need(s)? review before filing/)).toHaveCount(
			0,
		);
		const list = checklist(page);
		await expect(list).toContainText("4 of 5 steps done");
		for (const n of [1, 2, 3, 4])
			await expect(checklistStep(page, n), `step ${n}`).not.toContainText(
				"not done",
			);
		await expect(checklistStep(page, 5)).toContainText("— not done");

		await page.goto(`/review?taxYear=${YEAR}`);
		await settled(page);
		await expect(page.getByText("All items reviewed")).toBeVisible();
		await expect(notesSection(page).locator("summary")).toContainText("1 note");
		await expect(reportNotesSection(page).locator("summary")).toContainText(
			"1 note",
		);
		expect(await actionGroupsOnPage(page)).toEqual([]);
	});

	test("the checklist ignores sample imports and uses the settings save stamp", async ({
		page,
		api,
	}) => {
		await api.reset();
		await page.request.post("/api/demo");
		try {
			await page.goto("/");
			await settled(page);
			await expect(checklistStep(page, 1)).not.toContainText("not done");
			await expect(checklistStep(page, 2)).toContainText("— not done");
		} finally {
			await page.request.delete("/api/demo");
		}
	});
});

test.describe("demo tax year", () => {
	test("P4-E2E-1 (fixed): after loading sample data, Overview shows the year that holds the sample rows", async ({
		page,
		api,
	}) => {
		await api.reset();
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
			await expect(page.getByText("Includes sample data")).toBeVisible();
			await expect(page.getByRole("combobox").first()).toHaveValue(YEAR);
			await expect(checklistStep(page, 4)).toHaveAttribute(
				"href",
				`/report?taxYear=${YEAR}`,
			);
			await page.reload();
			await settled(page);
			await expect(
				page.getByText(/\b[1-9]\d* Schedule VDA rows?\b/),
			).toBeVisible();
		} finally {
			await page.request.delete("/api/demo");
		}
	});
});

test.describe("incomplete report", () => {
	const SOL_SALE = "2025-10-01T00:00:00.000Z";

	test.beforeAll(async ({ request }) => {
		const api = new AppApi(request);
		await api.reset();
		await api.putSettings({ defaultTaxYear: YEAR });
		await api.addManual({
			sourceRef: "e2e-inc-buy",
			timestamp: "2025-06-01T00:00:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "1",
			inrValue: "200000",
		});
		await api.addManual({
			sourceRef: "e2e-inc-sell",
			timestamp: "2025-09-01T00:00:00.000Z",
			type: "sell",
			assetOut: "ETH",
			amountOut: "1",
			inrValue: "250000",
		});
		await api.addManual({
			sourceRef: "e2e-inc-sol",
			timestamp: SOL_SALE,
			type: "sell",
			assetOut: "SOL",
			amountOut: "2",
			inrValue: "30000",
		});
		await api.compute(YEAR);
	});

	test("Report shows Incomplete instead of net payable and keeps the sale out of Schedule VDA", async ({
		page,
	}) => {
		await page.goto(`/report?taxYear=${YEAR}`);
		await settled(page);
		await expect(
			page.getByText("Incomplete — 1 sale has no purchase history").first(),
		).toBeVisible();
		await expect(page.getByText("Incomplete", { exact: true })).toBeVisible();
		await expect(page.getByText(/Schedule VDA \(1\b/)).toBeVisible();
		await expect(
			page.getByText(/left out of\s+Schedule VDA and net payable is not shown/),
		).toBeVisible();
		await snap(page, "phase4/report-incomplete");
	});

	test("Overview shows Incomplete instead of net payable", async ({ page }) => {
		await page.goto("/");
		await settled(page);
		await expect(
			page.getByText("Incomplete — 1 sale has no purchase history"),
		).toBeVisible();
		await expect(
			page.getByText(/Fix the unresolved sales to see what you owe/),
		).toBeVisible();
	});

	test("“Add missing buy” opens the form dated before the sale, and saving it completes the report", async ({
		page,
		api,
	}) => {
		await page.goto(`/review?taxYear=${YEAR}`);
		await settled(page);
		const group = page
			.locator("section")
			.filter({ has: page.locator("code", { hasText: /^missing_history$/ }) });
		await group.getByRole("link", { name: "Add missing buy" }).first().click();
		await expect(page).toHaveURL(/\/transactions\?/);
		const dialog = page.getByRole("dialog", { name: "Add manual transaction" });
		await expect(dialog).toBeVisible();
		const date = dialog.getByLabel("Date & time (IST)");
		const value = await date.inputValue();
		// One day before the sale (2025-10-01 05:30 IST), or the first day of the year without it.
		expect(["2025-09-30T05:30", "2025-04-01T00:00"]).toContain(value);
		expect(value < "2025-10-01T05:30").toBe(true);
		expect(value >= "2025-04-01T00:00").toBe(true);
		await expect(dialog.getByLabel("Asset received *")).toHaveValue("SOL");
		await dialog.getByLabel("Quantity received *").fill("2");
		await dialog.getByLabel(/INR/).first().fill("20000");
		await dialog.getByRole("button", { name: "Add transaction" }).click();
		await expect(dialog).toBeHidden();
		const report = (await api.compute(YEAR)) as {
			incomplete?: boolean;
			unresolved: unknown[];
		};
		expect(report.unresolved).toEqual([]);
		expect(report.incomplete).toBe(false);
		await page.goto(`/report?taxYear=${YEAR}`);
		await settled(page);
		await expect(page.getByText(/Incomplete — /)).toHaveCount(0);
	});
});

test.describe("settings, imports and console", () => {
	test("Settings restore steps mirror install.md, in order", async ({
		page,
	}) => {
		const install = readFileSync(`${REPO_ROOT}/docs/install.md`, "utf8");
		for (const command of RESTORE_COMMANDS)
			expect(install, command).toContain(command);
		await page.goto("/settings");
		await settled(page);
		const shown = await page.locator("pre").allTextContents();
		const steps = shown
			.map((t) => t.trim())
			.filter((t) => RESTORE_COMMANDS.includes(t));
		expect(steps).toEqual(RESTORE_COMMANDS);
		await expect(page.getByText(/\$\{DATA_DIR/)).toHaveCount(0);
	});

	test("the Imports TZ column shows the zone actually used", async ({
		page,
		api,
	}) => {
		await api.reset();
		const binance = await api.importFile(ORDER_HISTORY, "auto", "UTC");
		const coindcx = await api.importFile(COINDCX_ORDERS, "auto", "IST");
		const detail = (id: string) =>
			api.json<{
				timezone: string;
				detectedTimezone: string | null;
				timezoneSource: string;
			}>("GET", `/api/imports/${id}`);
		const b = await detail(binance.id);
		const c = await detail(coindcx.id);
		expect(b).toMatchObject({
			timezone: "UTC",
			detectedTimezone: "+05:00",
			timezoneSource: "file",
		});
		expect(c).toMatchObject({ timezone: "IST", timezoneSource: "file" });

		await page.goto("/imports");
		await settled(page);
		const row = (name: RegExp) =>
			page.locator("tbody tr").filter({ hasText: name }).first();
		const binanceRow = row(/Binance-Spot-Order-History/);
		await expect(binanceRow).toContainText("+05:00");
		await expect(binanceRow).toContainText("from the file name");
		const coindcxRow = row(/coindcx-order-history/);
		// The imported-at column ends in "IST", so only the zone cell is checked.
		const zoneCell = coindcxRow.locator("td").filter({ hasText: /from the/ });
		await expect(zoneCell).toContainText(c.detectedTimezone ?? "UTC");
		await expect(zoneCell).not.toContainText("IST");
		await expect(zoneCell).not.toContainText("your answer");
	});

	test("Overview and Report log no 404 on an empty ledger or before computing", async ({
		page,
		api,
	}) => {
		await api.reset();
		const seen = record404s(page);
		for (const path of ["/", `/report?taxYear=${YEAR}`]) {
			await page.goto(path);
			await settled(page);
			await page.waitForLoadState("networkidle");
		}
		await api.addManual({
			sourceRef: `e2e-404-${Date.now()}`,
			timestamp: "2025-06-01T00:00:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "1",
			inrValue: "200000",
		});
		for (const path of ["/", `/report?taxYear=${YEAR}`, "/report"]) {
			await page.goto(path);
			await settled(page);
			await page.waitForLoadState("networkidle");
		}
		await expect(
			page
				.getByText(
					/No report computed|not computed|Your data changed since this report was computed/,
				)
				.first(),
		).toBeVisible();
		expect(seen).toEqual([]);
	});
});

const EXAMPLES = `${REPO_ROOT}/examples`;
const GENERIC_FILE = "generic-unknown-exchange.SYNTHETIC.csv";
const STALE_TEXT = "Your data changed since this report was computed.";
const RECIPE_NAME = "E2E Example Exchange";

function staleBanner(page: Page) {
	return page.getByRole("status").filter({ hasText: STALE_TEXT });
}

function reviewGroup(page: Page, code: string) {
	return page.locator("section").filter({
		has: page.locator("code", { hasText: new RegExp(`^${code}$`) }),
	});
}

function mainNav(page: Page) {
	return page.getByRole("navigation", { name: "Main navigation" });
}

const wizardColumn = (page: Page, label: RegExp) =>
	page.getByRole("combobox", { name: label });

async function uploadExample(page: Page) {
	await page.goto("/import");
	await settled(page);
	await page
		.getByLabel(/Drop your exchange export here/)
		.setInputFiles(`${EXAMPLES}/${GENERIC_FILE}`);
	await page.getByRole("radio", { name: /^Auto-detect / }).check();
	await page.getByRole("radio", { name: /^IST / }).check();
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(
		page.getByRole("heading", {
			name: `Map Generic CSV / Sheet: ${GENERIC_FILE}`,
		}),
	).toBeVisible();
}

async function pendingImports(api: AppApi) {
	return (
		await api.json<{ fileName: string; status: string }[]>(
			"GET",
			"/api/imports",
		)
	).filter((i) => i.fileName === GENERIC_FILE);
}

function expectedTitle(tx: {
	type: string;
	assetIn?: string;
	assetOut?: string;
}) {
	const label = tx.type.charAt(0).toUpperCase() + tx.type.slice(1);
	if (tx.type === "swap") return `${label} · ${tx.assetOut} → ${tx.assetIn}`;
	return ["sell", "withdrawal", "gift", "fee"].includes(tx.type)
		? `${label} · ${tx.assetOut}`
		: `${label} · ${tx.assetIn}`;
}

test.describe("review checking and stale reports", () => {
	test.beforeAll(async ({ request }) => {
		const api = new AppApi(request);
		await api.reset();
		await api.putSettings({ defaultTaxYear: YEAR });
		await api.importFile(ORDER_HISTORY, "auto", "UTC");
		await api.compute(YEAR);
	});

	test("Inspect titles name the asset disposed of", async ({ page, api }) => {
		const data = await api.json<{
			groups: {
				code: string;
				items: {
					id: string;
					type: string;
					assetIn?: string;
					assetOut?: string;
				}[];
			}[];
		}>("GET", `/api/review?taxYear=${YEAR}`);
		const sale = data.groups.find((g) => g.code === "tds_not_deducted")
			?.items[0];
		expect(sale).toBeTruthy();
		await page.goto(`/review?taxYear=${YEAR}`);
		await settled(page);
		await reviewGroup(page, "tds_not_deducted")
			.getByRole("button", { name: "Inspect" })
			.first()
			.click();
		const title = expectedTitle(sale as NonNullable<typeof sale>);
		await expect(page.getByRole("dialog", { name: title })).toBeVisible();
		expect(title).toMatch(sale?.assetOut ?? "—");
		await page.keyboard.press("Escape");

		const manualSell = await api.addManual({
			sourceRef: `e2e-title-${Date.now()}`,
			timestamp: "2025-12-20T00:00:00.000Z",
			type: "sell",
			assetOut: "BTC",
			amountOut: "0.001",
			assetIn: "INR",
			amountIn: "9000",
			inrValue: "9000",
		});
		await page.goto(`/transactions?taxYear=${YEAR}`);
		await settled(page);
		await page
			.locator("tbody tr")
			.filter({ hasText: "BTC" })
			.filter({ hasText: /Sell/ })
			.first()
			.getByRole("button")
			.first()
			.click();
		await expect(
			page.getByRole("dialog", { name: "Sell · BTC" }),
		).toBeVisible();
		await api.json("DELETE", `/api/transactions/${manualSell.id}`);
		await api.compute(YEAR);
	});

	test("“Mark checked” on one row hides it at once and says the figures are unchanged", async ({
		page,
		api,
	}) => {
		const before = await api.json<{ totals: unknown }>(
			"GET",
			`/api/reports/${YEAR}`,
		);
		await page.goto(`/review?taxYear=${YEAR}`);
		await settled(page);
		for (const code of ["tds_not_deducted", "fee_review_required"]) {
			const group = reviewGroup(page, code);
			await expect(group).toBeVisible();
			await group.getByRole("button", { name: "Mark checked" }).first().click();
			await expect(
				page.getByText(
					"Marked 1 item as checked. Your tax figures are unchanged.",
				),
			).toBeVisible();
			await expect(group).toHaveCount(0);
		}
		const after = await api.json<{ totals: unknown; stale?: boolean }>(
			"GET",
			`/api/reports/${YEAR}`,
		);
		expect(after.totals).toEqual(before.totals);
		expect(after.stale).toBeUndefined();
	});

	test("“Mark all as checked” asks first; Cancel keeps the group, confirming checks every item", async ({
		page,
	}) => {
		await page.goto(`/review?taxYear=${YEAR}`);
		await settled(page);
		const group = reviewGroup(page, "missing_history");
		const markAll = group.getByRole("button", { name: /Mark all as checked/ });
		await expect(markAll).toHaveAccessibleName(/Mark all as checked in .+/);
		await markAll.click();
		const dialog = page.getByRole("dialog", {
			name: "Mark all 2 items as checked?",
		});
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText("It does not change any tax figure");
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeHidden();
		await expect(group).toBeVisible();

		await markAll.click();
		await dialog.getByRole("button", { name: "Mark all as checked" }).click();
		await expect(
			page.getByText(
				"Marked 2 items as checked. Your tax figures are unchanged.",
			),
		).toBeVisible();
		await expect(group).toHaveCount(0);
		await expect(page.getByText("All items reviewed")).toBeVisible();
		await expect(notesSection(page)).toBeVisible();
	});

	test("checks survive a recompute and a reload; checklist step 3 completes", async ({
		page,
		api,
	}) => {
		await api.compute(YEAR);
		expect((await reviewData(api)).totals.action).toBe(0);
		await page.goto(`/review?taxYear=${YEAR}`);
		await settled(page);
		await expect(page.getByText("All items reviewed")).toBeVisible();
		expect(await actionGroupsOnPage(page)).toEqual([]);
		await page.goto("/");
		await settled(page);
		await expect(checklistStep(page, 3)).not.toContainText("not done");
		await expect(page.getByText(/need(s)? review before filing/)).toHaveCount(
			0,
		);
	});

	test("Review shows the stale banner after a data change; Recompute clears it", async ({
		page,
		api,
	}) => {
		await usdtBuy(api);
		await page.goto(`/review?taxYear=${YEAR}`);
		await settled(page);
		const bannerOnReview = staleBanner(page);
		await expect(bannerOnReview).toBeVisible();
		await expect(page.getByText("All items reviewed")).toHaveCount(0);
		await page.goto("/");
		await settled(page);
		await expect(checklistStep(page, 3)).toContainText("— not done");

		await page.goto(`/review?taxYear=${YEAR}`);
		await settled(page);
		await staleBanner(page).getByRole("button", { name: "Recompute" }).click();
		await expect(staleBanner(page)).toHaveCount(0);
		const report = await api.json<{ stale?: boolean }>(
			"GET",
			`/api/reports/${YEAR}`,
		);
		expect(report.stale).toBeUndefined();
		// The USDT buy gives the checked swap an INR value, so its TDS item changed and is shown again.
		const tds = reviewGroup(page, "tds_not_deducted");
		await expect(tds).toContainText("1 item");
		await tds.getByRole("button", { name: "Mark checked" }).click();
		await expect(page.getByText("All items reviewed")).toBeVisible();
	});

	test("Report keeps showing the last figures under a stale banner; Recompute clears it", async ({
		page,
		api,
	}) => {
		await api.addManual({
			sourceRef: `e2e-stale-${Date.now()}`,
			timestamp: "2025-12-02T00:00:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "0.1",
			inrValue: "30000",
		});
		await page.goto(`/report?taxYear=${YEAR}`);
		await settled(page);
		await expect(staleBanner(page)).toBeVisible();
		await expect(page.getByText(/Schedule VDA \(\d+/).first()).toBeVisible();
		await snap(page, "phase4/report-stale");
		await staleBanner(page).getByRole("button", { name: "Recompute" }).click();
		await expect(staleBanner(page)).toHaveCount(0);
		await page.reload();
		await settled(page);
		await expect(staleBanner(page)).toHaveCount(0);
	});

	test("a default-year save does not make the report stale", async ({
		page,
		api,
	}) => {
		await api.putSettings({ defaultTaxYear: "2026-27" });
		await api.putSettings({ defaultTaxYear: YEAR });
		await page.goto(`/report?taxYear=${YEAR}`);
		await settled(page);
		await expect(page.getByText(/Schedule VDA \(\d+/).first()).toBeVisible();
		await expect(staleBanner(page)).toHaveCount(0);
	});
});

test.describe("one tax year for Overview and Report", () => {
	test("picking a year on Overview carries to Report, and back", async ({
		page,
		api,
	}) => {
		await api.putSettings({ defaultTaxYear: YEAR });
		await page.goto("/");
		await settled(page);
		const year = page.getByLabel("Tax year");
		await expect(year).toHaveValue(YEAR);
		await year.selectOption("2026-27");
		await expect(page).toHaveURL(/taxYear=2026-27/);
		await mainNav(page).getByRole("link", { name: "Report" }).click();
		await expect(page).toHaveURL(/\/report/);
		await settled(page);
		await expect(page.getByLabel("Tax year")).toHaveValue("2026-27");
		await page.getByLabel("Tax year").selectOption(YEAR);
		await expect(page).toHaveURL(new RegExp(`taxYear=${YEAR}`));
		await mainNav(page).getByRole("link", { name: "Overview" }).click();
		await settled(page);
		await expect(page.getByLabel("Tax year")).toHaveValue(YEAR);
	});
});

test.describe("recipe wizard on the example file", () => {
	test.beforeEach(async ({ api }) => {
		await api.reset();
	});

	test("defaults: the Buy/Sell column, a name from the file, quotes from the pairs", async ({
		page,
	}) => {
		await uploadExample(page);
		await expect(wizardColumn(page, /^Side column/)).toHaveValue("Trade");
		await expect(wizardColumn(page, /^Type column/)).not.toHaveValue("Trade");
		await expect(page.getByLabel("Buy / Sell sign style")).toHaveValue(
			"side_column",
		);
		await expect(page.getByLabel("Recipe name")).toHaveValue(
			"generic unknown exchange.SYNTHETIC",
		);
		await expect(
			page.getByLabel("Known quote assets (for pair split)"),
		).toHaveValue("INR");
		await snap(page, "phase4/wizard-defaults");
	});

	test("Cancel → Keep for later leaves a waiting row with Map columns / Delete", async ({
		page,
		api,
	}) => {
		await uploadExample(page);
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		const dialog = page.getByRole("dialog", {
			name: "Delete this pending import?",
		});
		await expect(dialog).toContainText(
			`"${GENERIC_FILE}" is still waiting for a column mapping`,
		);
		await dialog.getByRole("button", { name: "Keep for later" }).click();
		await expect(dialog).toBeHidden();
		expect((await pendingImports(api)).map((i) => i.status)).toEqual([
			"pending_recipe",
		]);

		await page.goto("/imports");
		await settled(page);
		const row = page.locator("tr").filter({ hasText: GENERIC_FILE }).first();
		await expect(row).toContainText(
			"Waiting for a column mapping — Map columns / Delete",
		);
		await row.getByRole("link", { name: "Map columns" }).click();
		await expect(page).toHaveURL(/\/import\?importId=/);
		await expect(
			page.getByRole("heading", {
				name: `Map Generic CSV / Sheet: ${GENERIC_FILE}`,
			}),
		).toBeVisible();
	});

	test("Cancel → Delete import removes the pending import", async ({
		page,
		api,
	}) => {
		await uploadExample(page);
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Delete this pending import?" })
			.getByRole("button", { name: "Delete import" })
			.click();
		await expect.poll(async () => (await pendingImports(api)).length).toBe(0);
		await page.goto("/imports");
		await settled(page);
		await expect(page.getByText(GENERIC_FILE)).toHaveCount(0);
	});

	test("the waiting row's Delete removes the pending import after a confirm", async ({
		page,
		api,
	}) => {
		await api.importFile(`${EXAMPLES}/${GENERIC_FILE}`, "auto", "IST");
		await page.goto("/imports");
		await settled(page);
		await page
			.getByRole("button", { name: `Delete pending import ${GENERIC_FILE}` })
			.first()
			.click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Delete import" })
			.click();
		await expect.poll(async () => (await pendingImports(api)).length).toBe(0);
	});

	test("the README mapping imports 3 rows; sources read “Generic CSV · <recipe name>”", async ({
		page,
	}) => {
		await uploadExample(page);
		for (const [label, value] of [
			[/^Timestamp/, "Date"],
			[/^Amount \/ Quantity/, "Volume"],
			[/^Trading Pair/, "Market"],
			[/^Unit Price/, "Price"],
			[/^Total \/ Consideration/, "Total"],
			[/^Fee Amount/, "Fee"],
			[/^Fee Asset/, "Fee Currency"],
			[/^TDS \(INR\)/, "TDS"],
		] as const)
			await wizardColumn(page, label).selectOption(value);
		await page.getByLabel("Date format").fill("yyyy-MM-dd HH:mm:ss");
		await page.getByLabel("Recipe name").fill(RECIPE_NAME);
		await page.getByRole("button", { name: /^Preview \d+ rows$/ }).click();
		await expect(page.getByText("Dates OK")).toBeVisible();
		await page.getByRole("button", { name: "Confirm & import" }).click();
		await expect(
			page.getByRole("heading", {
				name: `${GENERIC_FILE} — Import complete`,
			}),
		).toBeVisible();
		const label = `Generic CSV · ${RECIPE_NAME}`;
		await page.goto("/imports");
		await settled(page);
		await expect(
			page.locator("tr").filter({ hasText: GENERIC_FILE }).first(),
		).toContainText("Generic CSV");
		await expect(page.getByText(/Generic CSV \(/)).toHaveCount(0);
		await page.goto("/transactions");
		await settled(page);
		await expect(page.getByText(label).first()).toBeVisible();
		await expect(page.getByText(/csv:[0-9a-f]{8}/)).toHaveCount(0);
	});
});

// Open bugs are in phase4-bugs.spec.ts (main project, not serial), so one red test skips nothing here.
test.describe("fixed bugs", () => {
	test("N1 (fixed): after every Binance review item is resolved, the checklist marks Review done", async ({
		page,
		api,
	}) => {
		await api.reset();
		await api.putSettings({ defaultTaxYear: YEAR });
		await api.importFile(ORDER_HISTORY, "auto", "UTC");
		await usdtBuy(api);
		await resolveActionItems(api);
		await page.goto("/");
		await settled(page);
		await expect(checklistStep(page, 3)).not.toContainText("not done");
		await expect(page.getByText(/need(s)? review before filing/)).toHaveCount(
			0,
		);
	});
});
