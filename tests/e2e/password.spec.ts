import { APP_PASSWORD, PASSWORD_APP_URL } from "./support/env";
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
	await page
		.getByRole("button", { name: "Log out (if password enabled)" })
		.click();
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
	await expect(
		page,
		"redirect to /login drops the requested path (no ?next=)",
	).toHaveURL(/\/report\?taxYear=2026-27$/);
});

test.describe("without the test-only Origin workaround", () => {
	test.use({ baseURL: PASSWORD_APP_URL });

	test("a real browser can log in", async ({ page }) => {
		await page.goto("/login");
		await page.getByLabel("Password").fill(APP_PASSWORD);
		await page.getByRole("button", { name: "Unlock" }).click();
		await expect(
			page.getByRole("heading", { name: "Tax Overview" }),
		).toBeVisible();
	});
});
