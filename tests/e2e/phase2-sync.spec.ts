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
import { chooseOption } from "./support/select";

test.beforeEach(async ({ api }) => reset(api));
test.setTimeout(300000);

const FRIENDLY_LIVE =
	/Syncing Binance [^…]+…|Waiting for Binance rate limit — resumes at \d{2}:\d{2}/;
const VENDOR_ERROR = "Binance -1022: Signature for this request is not valid.";

function taxYearOf(ms: number) {
	const ist = new Date(ms + 330 * 60_000);
	const start =
		ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
	return `${start}-${String(start + 1).slice(2)}`;
}

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
	await expect(region).toContainText(FRIENDLY_LIVE, { timeout: 60000 });
	await shot(page, "sync-live-progress");
	// Counts and stream names change while the job runs (polled every second).
	await expect
		.poll(() => new Set(live.filter((t) => FRIENDLY_LIVE.test(t))).size, {
			timeout: 120000,
		})
		.toBeGreaterThan(1);
	expect(
		live.filter((t) => /Syncing stream|binance:/.test(t)),
		"the live region names streams in plain words, never by internal id",
	).toEqual([]);
	expect(
		(await api.json<{ status: string }>("GET", `/api/jobs/${jobId}`)).status,
	).toMatch(/pending|running/);
	await page.reload();
	await expect(
		article.getByRole("button", { name: "Syncing…", exact: true }),
	).toBeDisabled();
	await expect(article.locator("[aria-live]")).toContainText(FRIENDLY_LIVE, {
		timeout: 30000,
	});
	await shot(page, "sync-reload-mid-sync");
	await scenario("bad_signature");
	await expect(article.getByText("Failed", { exact: true })).toBeVisible({
		timeout: 120000,
	});
	// SPEC §9: upstream_auth carries the vendor message (Binance -1022 "Signature … not valid").
	await expect(article).toContainText(
		"Binance -1022: Signature for this request is not valid.",
	);
	const job = await api.json<{
		status: string;
		result?: { streams: Array<{ stream: string }> } | null;
	}>("GET", `/api/jobs/${jobId}`);
	expect(job.status).toBe("failed");
	expect(job.result?.streams.length ?? 0).toBeGreaterThan(0);
	await shot(page, "sync-binance-interrupted-failed");
});

test("binance normal full sync: rate-limit wait line, streams, zero differences, summary after reload", async ({
	page,
	api,
}, info) => {
	// P2-E2E-2: was 80+ minutes; since d9b6170 history scans start at observed activity.
	test.setTimeout(900_000);
	const c = await connection(api);
	await page.goto("/connections");
	const article = card(page, c.label);
	const live = await watchLive(page);
	const started = Date.now();
	await startSync(page, article);
	await expect(
		article.getByRole("heading", { name: "Sync Streams" }),
	).toBeVisible({ timeout: 840_000 });
	const seconds = Math.round((Date.now() - started) / 1000);
	info.annotations.push({
		type: "full-binance-sync-seconds",
		description: String(seconds),
	});
	console.log(`full Binance sync: ${seconds} s`);
	expect(seconds, "a first sync of a small account takes minutes").toBeLessThan(
		600,
	);
	// The client paces the UID-weighted endpoints and says so instead of looking stuck.
	expect(
		live.some((t) =>
			/Waiting for Binance rate limit — resumes at \d{2}:\d{2}/.test(t),
		),
		"live region shows the rate-limit pause with a resume time",
	).toBe(true);
	expect(live.some((t) => /Syncing Binance [^…]+…/.test(t))).toBe(true);
	const streams = article.getByRole("table").first().locator("tbody tr");
	await expect(
		streams.filter({ hasText: "binance:myTrades:ETHUSDT" }),
	).toBeVisible();
	await expect(streams.filter({ hasText: "binance:p2p:BUY" })).toContainText(
		"P2P API only returns the past six months; import older orders from a file",
	);
	// M1 fixed (3506d72): the P2P buy is ~150 days old, inside the six-month window.
	const balanceRows = article.getByRole("table").last().locator("tbody tr");
	for (const asset of ["BNB", "ETH", "USDC", "USDT"])
		await expect(
			balanceRows.filter({
				has: page.getByRole("cell", { name: asset, exact: true }),
			}),
		).toContainText("Matched");
	const differences = await balanceRows
		.locator("td:nth-child(4)")
		.allTextContents();
	expect(differences.length).toBeGreaterThanOrEqual(4);
	expect(
		differences.filter((d) => !/^[-+]?0(?:\.0+)?$/.test(d.trim())),
		"normal fixture balances must reconcile",
	).toEqual([]);
	await expect(
		article.getByRole("link", { name: "Add missing transaction" }),
	).toHaveCount(0);
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
		await chooseOption(
			page.getByLabel("Source", { exact: true }),
			`evm:${chainId}`,
		);
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
			// The spam transfer is 40 days before the mock's start (tools/mock-sync README).
			const year = taxYearOf(Date.now() - 40 * 86_400_000);
			await api.compute(year);
			await page.goto(`/report?taxYear=${year}`);
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
	await expect(card(page, c.label)).toContainText(VENDOR_ERROR);
	await shot(page, "sync-bad-signature");
	await page.reload();
	await expect(card(page, c.label)).toContainText(
		new RegExp(`Last sync error:.*${VENDOR_ERROR.replaceAll(".", "\\.")}`),
	);
	await page.goto("/review?taxYear=all");
	await expect(
		page.getByText("Failed or incomplete connection syncs"),
	).toBeVisible();
	const issue = page.getByRole("row").filter({ hasText: c.label });
	await expect(issue).toContainText("failed");
	await expect(issue).toContainText(VENDOR_ERROR);
	await expect(
		issue.getByRole("link", { name: /Fix in Connections/ }),
	).toHaveAttribute("href", "/connections");
	await shot(page, "review-failed-connection");
});
