import type { Locator, Page } from "@playwright/test";
import {
	CHAINS,
	card,
	connection,
	expect,
	provider,
	reset,
	scenario,
	shot,
	sync,
	test,
	WALLET_B,
} from "./support/phase2";

test.beforeEach(async ({ api }) => reset(api));
test.setTimeout(300000);

async function watchLive(page: Page) {
	const live: string[] = [];
	await page.exposeFunction("recordSyncLive", (text: string) =>
		live.push(text),
	);
	await page.evaluate(() => {
		const collect = () =>
			document.querySelectorAll("article [aria-live]").forEach((el) => {
				void (
					window as unknown as { recordSyncLive: (t: string) => void }
				).recordSyncLive(el.textContent ?? "");
			});
		new MutationObserver(collect).observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	});
	return live;
}

async function startSync(page: Page, article: Locator) {
	const started = page.waitForResponse(
		(r) => r.url().endsWith("/sync") && r.request().method() === "POST",
	);
	await article.getByRole("button", { name: "Sync now", exact: true }).click();
	const res = await started;
	expect(res.status()).toBe(202);
	return ((await res.json()) as { jobId: string }).jobId;
}

test("binance: live progress updates, reload mid-sync resumes, a failure keeps checkpointed streams", async ({
	page,
	api,
	allowConsole,
}) => {
	allowConsole(/status of 502 .*\/api\/jobs|upstream/i);
	const c = await connection(api);
	await page.goto("/connections");
	const article = card(page, c.label);
	const live = await watchLive(page);
	const jobId = await startSync(page, article);
	const region = article.locator("[aria-live]");
	await expect(region).toHaveAttribute("aria-live", "polite");
	await expect(region).toContainText(/Syncing stream\s*binance:/, {
		timeout: 60000,
	});
	await shot(page, "sync-live-progress");
	// Counts and stream names change while the job runs (polled every second).
	await expect
		.poll(
			() => new Set(live.filter((t) => t.includes("Syncing stream"))).size,
			{
				timeout: 120000,
			},
		)
		.toBeGreaterThan(1);
	expect(
		(await api.json<{ status: string }>("GET", `/api/jobs/${jobId}`)).status,
	).toMatch(/pending|running/);
	await page.reload();
	await expect(
		article.getByRole("button", { name: "Syncing…", exact: true }),
	).toBeDisabled();
	await expect(article.locator("[aria-live]")).toContainText(
		/Syncing stream\s*binance:/,
		{ timeout: 30000 },
	);
	await shot(page, "sync-reload-mid-sync");
	await scenario("bad_signature");
	await expect(article.getByText("Failed", { exact: true })).toBeVisible({
		timeout: 120000,
	});
	// SPEC §9: upstream_auth carries the vendor message (Binance -1022 "Signature … not valid").
	expect.soft(await article.textContent()).toMatch(/signature/i);
	const job = await api.json<{
		status: string;
		result?: { streams: Array<{ stream: string }> } | null;
	}>("GET", `/api/jobs/${jobId}`);
	expect(job.status).toBe("failed");
	expect(job.result?.streams.length ?? 0).toBeGreaterThan(0);
	await shot(page, "sync-binance-interrupted-failed");
});

test("binance normal full sync: streams with P2P window notice, balance table, summary after reload", async ({
	page,
	api,
}) => {
	// fiat/orders is paced at one call a minute back to 2017 (BUGS.md P2-E2E-2): opt in.
	test.skip(
		process.env.PHASE2_BINANCE_FULL !== "1",
		"set PHASE2_BINANCE_FULL=1; a first Binance sync can take over an hour",
	);
	test.setTimeout(6_000_000);
	const c = await connection(api);
	await page.goto("/connections");
	const article = card(page, c.label);
	await startSync(page, article);
	await expect(
		article.getByRole("heading", { name: "Sync Streams" }),
	).toBeVisible({ timeout: 5_900_000 });
	const streams = article.getByRole("table").first().locator("tbody tr");
	await expect(
		streams.filter({ hasText: "binance:myTrades:ETHUSDT" }),
	).toBeVisible();
	await expect(streams.filter({ hasText: "binance:p2p:BUY" })).toContainText(
		"P2P API only returns the past six months; import older orders from a file",
	);
	const balances = article.getByRole("table").last();
	for (const asset of ["BNB", "ETH", "USDC"])
		await expect(
			balances.getByRole("row").filter({
				has: page.getByRole("cell", { name: asset, exact: true }),
			}),
		).toContainText("Matched");
	// Mock clock: the fixture's 2025-04-08 P2P buy of 5,000 USDT is older than six months
	// before the app's real clock, so the API cannot return it (tests/e2e/BUGS.md, mock M1).
	const usdt = balances.getByRole("row").filter({
		has: page.getByRole("cell", { name: "USDT", exact: true }),
	});
	await expect(usdt.getByRole("cell").nth(3)).toHaveText("5000");
	await expect(usdt.getByRole("link", { name: /Review/ })).toHaveAttribute(
		"href",
		"/review",
	);
	await shot(page, "sync-binance-complete");
	await page.reload();
	// The last completed job's summary re-opens by itself after a reload.
	await expect(
		article.getByRole("heading", { name: "Sync Streams" }),
	).toBeVisible();
	await expect(
		article.getByRole("button", { name: "Summary & balances", exact: true }),
	).toHaveAttribute("aria-expanded", "true");
	await expect(streams.filter({ hasText: "binance:p2p:BUY" })).toBeVisible();
	await shot(page, "sync-binance-reloaded");
});

test("coindcx normal sync: streams, zero-difference balances, summary after reload, Synced import", async ({
	page,
	api,
}) => {
	const c = await connection(api, "coindcx");
	await page.goto("/connections");
	const article = card(page, c.label);
	const live = await watchLive(page);
	await startSync(page, article);
	await expect(
		article.getByRole("heading", { name: "Sync Streams" }),
	).toBeVisible({ timeout: 120000 });
	expect(live.some((t) => /Sync/.test(t))).toBe(true);
	await expect(
		article.getByRole("button", { name: "Sync now", exact: true }),
	).toBeEnabled();
	const streams = article.getByRole("table").first().locator("tbody tr");
	await expect(streams).not.toHaveCount(0);
	await expect(streams.first()).toContainText("coindcx:");
	const balanceRows = article.getByRole("table").last().locator("tbody tr");
	await expect(balanceRows.first()).toContainText("Matched");
	const differences = await balanceRows
		.locator("td:nth-child(4)")
		.allTextContents();
	expect(differences.length).toBeGreaterThan(0);
	expect(
		differences.filter((d) => !/^[-+]?0(?:\.0+)?$/.test(d.trim())),
		"normal fixture balances must reconcile",
	).toEqual([]);
	await shot(page, "sync-coindcx-complete");
	await page.reload();
	await expect(article).toContainText(/Last sync: (?!Never)/);
	// The last completed job's summary re-opens by itself after a reload.
	await expect(
		article.getByRole("heading", { name: "Sync Streams" }),
	).toBeVisible();
	await expect(
		article.getByRole("button", { name: "Summary & balances", exact: true }),
	).toHaveAttribute("aria-expanded", "true");
	await expect(
		article.getByRole("table").first().locator("tbody tr"),
	).toHaveCount(await streams.count());
	await shot(page, "sync-coindcx-reloaded");
	await page.goto("/imports");
	const row = page
		.getByRole("row")
		.filter({ hasText: `${c.label} API sync` })
		.filter({ visible: true });
	await expect(row.getByText("Synced", { exact: true })).toBeVisible();
	await expect(row).toContainText(c.label);
	await row.getByRole("button", { name: /^Delete / }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText("Delete sync import?");
	await expect(dialog).toContainText(
		"Sync cursors will be reset, so the next sync for this connection will fetch those rows again.",
	);
	await shot(page, "delete-sync-import-confirm");
	await dialog.getByRole("button", { name: "Cancel" }).click();
});

for (const [chainId, name, host, address] of CHAINS)
	test(`${name} sync and transaction source, explorer link and spam exclusion`, async ({
		page,
		api,
	}) => {
		await provider(api, "etherscan", true);
		const c = await connection(api, "evm", chainId, address);
		const article = await sync(page, c.label);
		const balanceRows = article.getByRole("table").last().locator("tbody tr");
		await expect(balanceRows.first()).toBeVisible();
		await shot(page, `sync-chain-${chainId}`);
		const differences = await balanceRows
			.locator("td:nth-child(4)")
			.allTextContents();
		expect
			.soft(
				differences.filter((d) => !/^[-+]?0(?:\.0+)?$/.test(d)),
				"normal chain fixture balance differences",
			)
			.toEqual([]);
		await page.goto("/transactions");
		await page
			.getByLabel("Source", { exact: true })
			.selectOption(`evm:${chainId}`);
		await expect(page).toHaveURL(new RegExp(`source=evm(%3A|:)${chainId}`));
		const rows = page.getByRole("table").locator("tbody tr");
		await expect(rows.first()).toBeVisible();
		await rows.first().getByRole("button").first().click();
		const link = page
			.getByRole("dialog")
			.getByRole("link", { name: /View on/ });
		await expect(link).toHaveAttribute(
			"href",
			new RegExp(`^https://${host.replaceAll(".", "\\.")}/tx/0x[0-9a-f]+$`),
		);
		await expect(link).toHaveAttribute("target", "_blank");
		await expect(link).toHaveAttribute("rel", /noopener/);
		await expect(link).toHaveAttribute("rel", /noreferrer/);
		await shot(page, `transaction-explorer-${chainId}`);
		await page.keyboard.press("Escape");
		if (chainId === 1) {
			await expect(
				page.getByText("suspected_spam", { exact: true }),
			).toBeVisible();
			await api.compute("2025-26");
			await page.goto("/report?taxYear=2025-26");
			await expect(page.locator("#excluded")).toContainText(/Suspected spam/i);
			await shot(page, "report-spam-excluded");
		}
	});

test("drift highlights the 0.5 USDC difference and links to Review", async ({
	page,
	api,
}) => {
	await provider(api);
	const c = await connection(api, "evm", 1, WALLET_B);
	await scenario("drift");
	const article = await sync(page, c.label);
	const row = article
		.getByRole("table")
		.last()
		.getByRole("row")
		.filter({ has: page.getByRole("cell", { name: "USDC", exact: true }) });
	await expect(row.getByRole("cell").nth(3)).toHaveText("0.5");
	await expect(row).toHaveClass(/warning/);
	await expect(row.getByRole("link", { name: /Review/ })).toHaveAttribute(
		"href",
		"/review",
	);
	await shot(page, "sync-drift");
	await row.getByRole("link", { name: /Review/ }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Review/);
});

test("bad_signature persists failed status and error on the connection and Review", async ({
	page,
	api,
}) => {
	const c = await connection(api);
	await scenario("bad_signature");
	await page.goto("/connections");
	await card(page, c.label)
		.getByRole("button", { name: "Sync now", exact: true })
		.click();
	await expect(
		card(page, c.label).getByText("Failed", { exact: true }),
	).toBeVisible({ timeout: 90000 });
	await expect(card(page, c.label)).toContainText("Last sync error:");
	expect.soft(await card(page, c.label).textContent()).toMatch(/signature/i);
	await shot(page, "sync-bad-signature");
	await page.reload();
	expect
		.soft(await card(page, c.label).textContent())
		.toMatch(/Last sync error:.*signature/i);
	await page.goto("/review");
	await expect(
		page.getByText("Failed or incomplete connection syncs"),
	).toBeVisible();
	const issue = page.getByRole("row").filter({ hasText: c.label });
	await expect(issue).toContainText("failed");
	expect.soft(await issue.textContent()).toMatch(/signature/i);
	await expect(
		issue.getByRole("link", { name: /Fix in Connections/ }),
	).toHaveAttribute("href", "/connections");
	await shot(page, "review-failed-connection");
});
