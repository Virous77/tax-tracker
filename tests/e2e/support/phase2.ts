import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { SCREENSHOTS } from "./env";
import { type AppApi, test as base, expect, settled } from "./fixtures";

export { expect, settled };
export const PASS = "phase2-vault-passphrase";
export const NEXT_PASS = "phase2-changed-passphrase";
export const WALLET_A = "0x5a17c9e3b4d28f6019ca7b3e5d8f2a4c6b1e9d70";
export const WALLET_B = "0x9c4e2a7d1f83b650e4d9a2c5f7b1e8d3a6c0b459";
export const CHAINS = [
	[1, "Ethereum", "etherscan.io", WALLET_A],
	[8453, "Base", "basescan.org", WALLET_A],
	[42161, "Arbitrum", "arbiscan.io", WALLET_A],
	[137, "Polygon", "polygonscan.com", WALLET_B],
	[56, "BNB", "bscscan.com", WALLET_A],
] as const;
export const SECRETS = [
	PASS,
	NEXT_PASS,
	"83629174",
	"mock-binance-key",
	"mock-binance-secret",
	"mock-dcx-key",
	"mock-dcx-secret",
	...["etherscan", "blockscout", "alchemy", "nodereal", "coingecko"].flatMap(
		(p) => [`mock-${p}-key`, `phase2-replaced-${p}-key`],
	),
	"mock-etherscan-paid-key",
];

export const test = base.extend<{ privacy: undefined }>({
	privacy: [
		async ({ page }, use, info) => {
			const external: string[] = [];
			const leaks: string[] = [];
			const pending: Promise<void>[] = [];
			await page.route("**/*", async (route) => {
				const url = new URL(route.request().url());
				if (url.origin !== "http://localhost:3112") {
					external.push(url.origin + url.pathname);
					await route.abort();
				} else await route.continue();
			});
			page.on("response", (response) => {
				if (
					!/json|text|javascript/.test(response.headers()["content-type"] ?? "")
				)
					return;
				pending.push(
					response
						.text()
						.then((body) => {
							for (const secret of SECRETS)
								if (body.includes(secret))
									leaks.push(`${response.url()}: fixture secret leaked`);
						})
						.catch(() => {}),
				);
			});
			await use(undefined);
			await Promise.all(pending);
			if (info.status !== info.expectedStatus)
				await shot(
					page,
					`failure-${info.title.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 140)}`,
				);
			expect(external, "browser must contact only localhost:3112").toEqual([]);
			expect(
				leaks,
				"browser response bodies must never return fixture secrets",
			).toEqual([]);
		},
		{ auto: true },
	],
});

export async function shot(page: Page, name: string) {
	const dir = path.join(SCREENSHOTS, "phase2");
	mkdirSync(dir, { recursive: true });
	await page.screenshot({
		path: path.join(dir, `${name}.png`),
		fullPage: true,
	});
}
export async function scenario(name: string) {
	const res = await fetch("http://localhost:11602/__control", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ scenario: name }),
	});
	expect(res.ok).toBe(true);
}
export async function reset(api: AppApi, vault = true) {
	const connections = await api.json<
		Array<{ id: string; runningJobId: string | null }>
	>("GET", "/api/connections");
	// A first Binance sync paces fiat/withdrawal history for over an hour; a failing
	// signature ends any leftover run at its next request.
	if (connections.some((c) => c.runningJobId)) await scenario("bad_signature");
	for (const c of connections) {
		if (c.runningJobId)
			await expect
				.poll(
					async () =>
						(
							await api.json<{ status: string }>(
								"GET",
								`/api/jobs/${c.runningJobId}`,
							)
						).status,
					{ timeout: 240000 },
				)
				.not.toMatch(/pending|running/);
		await api.json("DELETE", `/api/connections/${c.id}`);
	}
	await api.reset();
	await api.putSettings({
		prices: { enabled: false, coingeckoFallback: true },
		marketPriceBasis: "close",
		defaultTaxYear: "2025-26",
	});
	await api.json("POST", "/api/vault/reset", { confirm: "RESET" });
	await scenario("normal");
	if (vault) await api.json("POST", "/api/vault/setup", { passphrase: PASS });
}
export async function provider(api: AppApi, name = "etherscan", paid = false) {
	await api.json("PUT", `/api/providers/${name}`, {
		apiKey: paid ? "mock-etherscan-paid-key" : `mock-${name}-key`,
		...(name === "etherscan" ? { tier: paid ? "paid" : "free" } : {}),
	});
}
export async function connection(
	api: AppApi,
	kind = "binance",
	chainId = 1,
	address = WALLET_A,
) {
	return api.json<{ id: string; label: string }>("POST", "/api/connections", {
		kind,
		label: `Phase 2 ${kind} ${kind === "evm" ? chainId : "account"}`,
		...(kind === "evm"
			? { chainId, address }
			: {
					apiKey: kind === "binance" ? "mock-binance-key" : "mock-dcx-key",
					apiSecret:
						kind === "binance" ? "mock-binance-secret" : "mock-dcx-secret",
				}),
	});
}
export function card(page: Page, label: string) {
	return page
		.locator("article")
		.filter({ has: page.getByRole("heading", { name: label, exact: true }) })
		.last();
}
export async function sync(page: Page, label: string) {
	await page.goto("/connections");
	const c = card(page, label);
	await c.getByRole("button", { name: "Sync now", exact: true }).click();
	await expect(c.getByText("Sync Streams", { exact: true })).toBeVisible({
		timeout: 240000,
	});
	await expect(
		c.getByRole("button", { name: "Sync now", exact: true }),
	).toBeEnabled();
	await settled(page);
	return c;
}
export async function noSecrets(page: Page) {
	const state = await page.evaluate(() => ({
		html: document.documentElement.outerHTML,
		inputs: [...document.querySelectorAll("input")].map((i) => i.value),
		local: { ...localStorage },
		session: { ...sessionStorage },
	}));
	for (const secret of SECRETS)
		expect(JSON.stringify(state)).not.toContain(secret);
}
export async function focusTrapped(page: Page, dialog: Locator) {
	const controls = dialog
		.locator(
			"button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
		)
		.filter({ visible: true });
	await controls.last().focus();
	await page.keyboard.press("Tab");
	// Native modal dialogs may tab through browser chrome (activeElement = body).
	if (await page.evaluate(() => document.activeElement === document.body))
		await page.keyboard.press("Tab");
	await expect(controls.first()).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	if (await page.evaluate(() => document.activeElement === document.body))
		await page.keyboard.press("Shift+Tab");
	await expect(controls.last()).toBeFocused();
}
