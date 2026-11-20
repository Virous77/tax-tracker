import { expect, reset, shot, test } from "./support/phase2";

test.beforeEach(async ({ api }) => reset(api));

test("price lookup toggles, basis and exact host explanation persist", async ({
	page,
}) => {
	await page.goto("/settings");
	await expect(
		page.getByLabel("Enable historical market price lookups"),
	).not.toBeChecked();
	await expect(page.getByLabel("Use CoinGecko fallback")).toBeChecked();
	await expect(page.getByLabel("Market price basis")).toHaveValue("close");
	await expect(
		page.locator("p").filter({ hasText: "Hosts contacted when enabled:" }),
	).toHaveText(
		"Hosts contacted when enabled: data-api.binance.vision (daily prices, no key) and api.coingecko.com (only if the fallback is on and a key is set).",
	);
	await page.getByLabel("Enable historical market price lookups").check();
	await page.getByLabel("Use CoinGecko fallback").uncheck();
	await page.getByLabel("Market price basis").selectOption("vwap");
	await page.getByRole("button", { name: "Save settings" }).click();
	await expect(page.getByText(/Settings saved/)).toBeVisible();
	await page.reload();
	await expect(
		page.getByLabel("Enable historical market price lookups"),
	).toBeChecked();
	await expect(page.getByLabel("Use CoinGecko fallback")).not.toBeChecked();
	await expect(page.getByLabel("Market price basis")).toHaveValue("vwap");
	await shot(page, "settings-price-lookups");
});

test("report prices disabled with settings link, fetch job updates counts, trail shows market source", async ({
	page,
	api,
}) => {
	// A unique date avoids the immutable price cache left by previous test runs.
	const day = String(1 + (Math.floor(Date.now() / 1000) % 25)).padStart(2, "0");
	const timestamp = `2025-12-${day}T06:30:00.000Z`;
	await api.addManual({
		sourceRef: "phase2-price-buy",
		timestamp: "2025-04-01T06:30:00.000Z",
		type: "buy",
		assetIn: "ETH",
		amountIn: "1",
		inrValue: "200000",
	});
	await api.addManual({
		sourceRef: "phase2-price-sell",
		timestamp,
		type: "sell",
		assetOut: "ETH",
		amountOut: "0.1",
	});
	await page.goto("/report?taxYear=2025-26");
	await expect(
		page.getByRole("button", { name: "Fetch missing prices" }),
	).toBeDisabled();
	await expect(
		page.getByRole("link", { name: /enable in Settings/i }),
	).toHaveAttribute("href", /settings/);
	await shot(page, "report-prices-disabled");
	await page.getByRole("link", { name: /enable in Settings/i }).click();
	await page.getByLabel("Enable historical market price lookups").check();
	await page.getByRole("button", { name: "Save settings" }).click();
	await expect(page.getByText(/Settings saved/)).toBeVisible();
	await page.goto("/report?taxYear=2025-26");
	const before = await api.json<{
		needed: number;
		cached: number;
		missing: unknown[];
	}>("GET", "/api/prices/status?taxYear=2025-26");
	expect(before.missing.length).toBeGreaterThan(0);
	const missingText = page.getByText(/^Missing:/).first();
	await expect(missingText).toContainText(String(before.missing.length));
	const live: string[] = [];
	await page.exposeFunction("recordPriceLive", (t: string) => live.push(t));
	await page.evaluate(() => {
		new MutationObserver(() =>
			document.querySelectorAll("[aria-live]").forEach((el) => {
				void (
					window as unknown as { recordPriceLive: (t: string) => void }
				).recordPriceLive(el.textContent ?? "");
			}),
		).observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	});
	const started = page.waitForResponse((r) =>
		r.url().endsWith("/api/prices/fill"),
	);
	await page.getByRole("button", { name: "Fetch missing prices" }).click();
	expect((await started).status()).toBe(202);
	await expect(page.getByText(/Price lookup complete:/)).toBeVisible({
		timeout: 90000,
	});
	expect(
		live.some((t) => /Fetching (missing historical )?prices/.test(t)),
		"a running price job is announced in a live region",
	).toBe(true);
	await expect(page.getByText(/Price lookup complete:/)).toContainText(
		/\d+ fetched, \d+ already cached/,
	);
	await shot(page, "report-prices-fetched");
	const after = await api.json<{ cached: number; missing: unknown[] }>(
		"GET",
		"/api/prices/status?taxYear=2025-26",
	);
	expect(after.cached).toBeGreaterThan(before.cached);
	expect(after.missing).toEqual([]);
	await expect(missingText).toHaveText("Missing: 0");
	await expect(page.getByText(/^Cached:/).first()).toHaveText(
		`Cached: ${after.cached}`,
	);
	// Phase 4: reset() leaves a computed (now stale) report, so the header button may say Recompute.
	await page
		.getByRole("button", { name: /^(Compute|Recompute) report$/ })
		.first()
		.click();
	await expect(
		page.getByRole("button", { name: "Recompute report" }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Trail", exact: true })
		.first()
		.click();
	const drawer = page.getByRole("dialog");
	await expect(drawer).toContainText("Market price:");
	await expect(drawer).toContainText(/binance_klines|binance-klines|Binance/i);
	await expect(drawer).toContainText("ETHUSDT");
	await shot(page, "report-price-trail");
});

test("Transactions includes new sources and possible_duplicate chip", async ({
	page,
	api,
}) => {
	await api.addManual({
		sourceRef: "phase2-possible-duplicate",
		timestamp: "2025-06-01T06:30:00.000Z",
		type: "buy",
		assetIn: "ETH",
		amountIn: "1",
		inrValue: "200000",
		reviewFlags: [
			{
				code: "possible_duplicate",
				message: "Synthetic ambiguity for browser chip coverage.",
			},
		],
	});
	await page.goto("/transactions");
	const options = await page
		.getByLabel("Source", { exact: true })
		.locator("option")
		.evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
	for (const source of [
		"binance-api",
		"coindcx-api",
		"evm:1",
		"evm:8453",
		"evm:42161",
		"evm:137",
		"evm:56",
	])
		expect(options).toContain(source);
	await expect(
		page.getByText("possible_duplicate", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("table")
		.locator("tbody tr")
		.first()
		.getByRole("button")
		.first()
		.click();
	await expect(page.getByRole("dialog")).toContainText(
		"Synthetic ambiguity for browser chip coverage.",
	);
	await shot(page, "possible-duplicate-drawer");
});
