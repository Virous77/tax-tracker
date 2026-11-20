import path from "node:path";
import { APP_PASSWORD, FIXTURES } from "./support/env";
import { expect, snap, test } from "./support/fixtures";

// Runs against the APP_PASSWORD stack. The api fixture is unauthenticated here, so these
// tests do not reset data; they only use the login gate.

test("visiting any page redirects to /login", async ({ page }) => {
	for (const path of ["/", "/transactions", "/report?taxYear=2026-27"]) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/login(\?.*)?$/);
		await expect(
			page.getByRole("heading", { name: "Tax Tracker Unlock" }),
		).toBeVisible();
	}
	await expect(page.getByRole("contentinfo")).toContainText("Not tax advice");
	await expect(
		page.getByRole("navigation", { name: "Main navigation" }),
	).toHaveCount(0);
	await snap(page, "login");
});

test("API calls without a session are refused", async ({ request }) => {
	const res = await request.get("/api/transactions");
	expect(res.status()).toBe(401);
	expect((await request.get("/api/health")).status()).toBe(200);
});

test("wrong password shows an error and stays on login", async ({
	page,
	allowConsole,
}) => {
	allowConsole(/status of 401 .*\/api\/auth\/login$/);
	await page.goto("/login");
	await expect(page.getByRole("button", { name: "Unlock" })).toBeDisabled();
	await page.getByLabel("Password").fill("not-the-password");
	await page.getByRole("button", { name: "Unlock" }).click();
	const alert = page.getByRole("alert").filter({ hasText: "Login failed" });
	await expect(alert).toBeVisible();
	await expect(alert).not.toContainText("{");
	await expect(page).toHaveURL(/\/login/);
	await snap(page, "login-wrong-password");
});

test("right password enters; logout returns to login", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveURL(/\/login/);
	await page.getByLabel("Password").fill(APP_PASSWORD);
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("heading", { name: "Tax Overview" }),
	).toBeVisible();
	await expect(page).not.toHaveURL(/\/login/);

	await page
		.getByRole("navigation", { name: "Main navigation" })
		.getByRole("link", { name: "Settings" })
		.click();
	await page.getByRole("button", { name: "Log out" }).click();
	await expect(page).toHaveURL(/\/login/);
	await page.goto("/transactions");
	await expect(page).toHaveURL(/\/login/);
});

test("after login the user lands on the page they asked for", async ({
	page,
}) => {
	await page.goto("/report?taxYear=2026-27");
	await expect(page).toHaveURL(/\/login/);
	await page.getByLabel("Password").fill(APP_PASSWORD);
	await page.getByRole("button", { name: "Unlock" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page).toHaveURL(/\/report\?taxYear=2026-27$/);
});

test("logout revokes the old session cookie on the server", async ({
	page,
	request,
}) => {
	await page.goto("/login");
	await page.getByLabel("Password").fill(APP_PASSWORD);
	await page.getByRole("button", { name: "Unlock" }).click();
	await expect(
		page.getByRole("heading", { name: "Tax Overview" }),
	).toBeVisible();
	const session = (await page.context().cookies()).find(
		(c) => c.name === "tax_tracker_session",
	);
	expect(session?.value).toBeTruthy();
	const cookie = `tax_tracker_session=${session?.value}`;
	expect(
		(await request.get("/api/settings", { headers: { cookie } })).status(),
	).toBe(200);

	await page.goto("/settings");
	await page.getByRole("button", { name: "Log out" }).click();
	await expect(page).toHaveURL(/\/login/);
	expect(
		(await request.get("/api/settings", { headers: { cookie } })).status(),
		"a copied cookie must stop working after logout",
	).toBe(401);
});

for (const next of [
	"//evil.example/x",
	"https://evil.example/x",
	"/\\evil.example",
]) {
	test(`?next=${next} cannot send the user off-site`, async ({ page }) => {
		await page.goto(`/login?next=${encodeURIComponent(next)}`);
		await page.getByLabel("Password").fill(APP_PASSWORD);
		await page.getByRole("button", { name: "Unlock" }).click();
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		expect(new URL(page.url()).host).toBe("localhost:3103");
		await expect(page).not.toHaveURL(/\/login/);
	});
}

test("password mode end to end: import, compute, export, logout", async ({
	page,
}) => {
	await page.goto("/import");
	await page.getByLabel("Password").fill(APP_PASSWORD);
	await page.getByRole("button", { name: "Unlock" }).click();
	await expect(page).toHaveURL(/\/import$/);
	await page
		.getByLabel(/Drop your exchange export here/)
		.setInputFiles(path.join(FIXTURES, "binance-trade-history.csv"));
	await page.getByRole("radio", { name: /^Binance/ }).check();
	await page.getByRole("radio", { name: /^UTC/ }).check();
	await page.getByRole("button", { name: "Upload & import" }).click();
	await expect(
		page.getByRole("heading", {
			name: "binance-trade-history.csv — Import complete",
		}),
	).toBeVisible();
	await page.goto("/report?taxYear=2026-27");
	await page
		.getByRole("button", { name: /^(Compute 2026-27 report|Compute report)$/ })
		.first()
		.click();
	await expect(
		page.getByRole("button", { name: "Recompute report" }),
	).toBeEnabled();
	const download = page.waitForEvent("download");
	await page.locator("a[download]").first().click();
	expect((await download).suggestedFilename()).toMatch(/\.(csv|xlsx)$/);
	await page.goto("/settings");
	await page.getByRole("button", { name: "Log out" }).click();
	await expect(page).toHaveURL(/\/login/);
	expect(
		(
			await page.request.get("/api/reports/2026-27/export?format=csv&kind=full")
		).status(),
	).toBe(401);
});

test.describe("same-origin check in Docker (BUGS.md #1, fixed)", () => {
	test("a real browser can log in", async ({ page }) => {
		await page.goto("/login");
		await page.getByLabel("Password").fill(APP_PASSWORD);
		await page.getByRole("button", { name: "Unlock" }).click();
		await expect(
			page.getByRole("heading", { name: "Tax Overview" }),
		).toBeVisible();
	});
});
