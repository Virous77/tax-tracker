import {
	CHAINS,
	card,
	connection,
	expect,
	focusTrapped,
	NEXT_PASS,
	noSecrets,
	PASS,
	reset,
	scenario,
	shot,
	test,
} from "./support/phase2";

test.beforeEach(async ({ api }) => reset(api, false));

test("vault rejects short passphrases inline", async ({ page }) => {
	await page.goto("/connections");
	await expect(
		page.getByRole("heading", { name: "Secrets Vault" }),
	).toBeVisible();
	await page
		.getByLabel("Passphrase (min 12 characters)")
		.pressSequentially("short");
	await page
		.getByLabel("Confirm passphrase", { exact: true })
		.pressSequentially("short");
	await page.getByRole("button", { name: "Set up vault" }).click();
	await shot(page, "vault-short-passphrase");
	await expect(
		page.getByRole("alert").filter({ hasText: /at least 12/ }),
	).toBeVisible();
});

test("vault change-passphrase rejects a short new passphrase inline", async ({
	page,
	api,
}) => {
	await api.json("POST", "/api/vault/setup", { passphrase: PASS });
	await page.goto("/connections");
	await page.getByRole("button", { name: "Change passphrase" }).click();
	await page.getByLabel("Current passphrase", { exact: true }).fill(PASS);
	await page
		.getByLabel("New passphrase (min 12 chars)")
		.pressSequentially("short");
	await page
		.getByLabel("Confirm new passphrase", { exact: true })
		.pressSequentially("short");
	await page.getByRole("button", { name: "Update passphrase" }).click();
	await shot(page, "vault-change-short-passphrase");
	await expect(
		page.getByRole("alert").filter({ hasText: /at least 12/ }),
	).toBeVisible();
});

test("vault mismatch, setup, lock, wrong unlock, rotation, recovery and typed reset", async ({
	page,
	api,
	allowConsole,
}) => {
	allowConsole(/status of 401 .*\/api\/vault\/unlock/);
	await page.goto("/connections");
	await expect(
		page.getByRole("heading", { name: "Secrets Vault" }),
	).toBeVisible();
	await expect(
		page.getByText(/If you forget it, the keys cannot be recovered/),
	).toBeVisible();
	await page.getByLabel("Passphrase (min 12 characters)").fill(PASS);
	await page.getByLabel("Confirm passphrase", { exact: true }).fill(NEXT_PASS);
	await page.getByRole("button", { name: "Set up vault" }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: "Passphrases do not match." }),
	).toBeVisible();
	await page.getByLabel("Confirm passphrase", { exact: true }).fill(PASS);
	await page.getByRole("button", { name: "Set up vault" }).click();
	await expect(page.getByText("Vault set up and unlocked.")).toBeVisible();
	await noSecrets(page);
	await page.getByRole("button", { name: "Lock vault" }).click();
	await page
		.getByLabel("Vault passphrase", { exact: true })
		.fill("incorrect-vault-password");
	await page.getByRole("button", { name: "Unlock vault" }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: /passphrase/i }),
	).toBeVisible();
	await expect(
		page.getByLabel("Vault passphrase", { exact: true }),
	).toHaveValue("");
	await shot(page, "vault-wrong-passphrase");
	await page.getByLabel("Vault passphrase", { exact: true }).fill(PASS);
	await page.getByRole("button", { name: "Unlock vault" }).click();
	await expect(page.getByText("Vault unlocked.")).toBeVisible();
	await page.getByRole("button", { name: "Change passphrase" }).click();
	await page.getByLabel("Current passphrase", { exact: true }).fill(PASS);
	await page.getByLabel("New passphrase (min 12 chars)").fill(NEXT_PASS);
	await page
		.getByLabel("Confirm new passphrase", { exact: true })
		.fill(NEXT_PASS);
	await page.getByRole("button", { name: "Update passphrase" }).click();
	await expect(
		page.getByText("Vault passphrase changed and keys re-encrypted."),
	).toBeVisible();
	await page.getByRole("button", { name: "Lock vault" }).click();
	await page.getByLabel("Vault passphrase", { exact: true }).fill(NEXT_PASS);
	await page.getByRole("button", { name: "Unlock vault" }).click();
	await expect(page.getByText("Vault unlocked.")).toBeVisible();
	await connection(api);
	const opener = page.getByRole("button", { name: "Reset vault", exact: true });
	await opener.focus();
	await page.keyboard.press("Enter");
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByLabel("Type RESET to confirm")).toBeFocused();
	await focusTrapped(page, dialog);
	await page.keyboard.press("Escape");
	await expect(opener).toBeFocused();
	await page.keyboard.press("Enter");
	await dialog.getByLabel("Type RESET to confirm").fill("reset");
	await expect(
		dialog.getByRole("button", { name: "Reset vault", exact: true }),
	).toBeDisabled();
	await dialog.getByLabel("Type RESET to confirm").fill("RESET");
	await shot(page, "vault-reset-confirm");
	await dialog
		.getByRole("button", { name: "Reset vault", exact: true })
		.focus();
	await page.keyboard.press("Enter");
	await expect(
		page.getByText("Vault reset. All encrypted keys were removed."),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Set up vault" }),
	).toBeVisible();
	expect(await api.json("GET", "/api/connections")).toEqual(
		expect.arrayContaining([expect.objectContaining({ keySet: false })]),
	);
	await noSecrets(page);
});

for (const name of [
	"etherscan",
	"blockscout",
	"alchemy",
	"nodereal",
	"coingecko",
]) {
	test(`provider ${name}: set, replace, remove and secret privacy`, async ({
		page,
		api,
	}) => {
		await api.json("POST", "/api/vault/setup", { passphrase: PASS });
		await page.goto("/connections");
		await expect(
			page.getByRole("heading", { name: "Secrets Vault" }),
		).toBeVisible();
		const row = page.locator(`#provider-${name}`);
		await row.getByRole("button", { name: "Set key" }).click();
		await row.locator("input[type=password]").fill(`mock-${name}-key`);
		if (name === "etherscan")
			await row.getByLabel("Plan tier").selectOption("free");
		await row.getByRole("button", { name: "Save key" }).click();
		await expect(row.getByText("Key set", { exact: true })).toBeVisible();
		await noSecrets(page);
		if (name === "etherscan")
			await expect(row.getByText("Free plan", { exact: true })).toBeVisible();
		await row.getByRole("button", { name: "Replace" }).click();
		await expect(row.locator("input[type=password]")).toHaveValue("");
		await row
			.locator("input[type=password]")
			.fill(
				name === "etherscan"
					? "mock-etherscan-paid-key"
					: `phase2-replaced-${name}-key`,
			);
		if (name === "etherscan")
			await row.getByLabel("Plan tier").selectOption("paid");
		await row.getByRole("button", { name: "Save key" }).click();
		await expect(row.getByRole("button", { name: "Replace" })).toBeVisible();
		if (name === "etherscan")
			await expect(row.getByText("Paid plan", { exact: true })).toBeVisible();
		await page.reload();
		await noSecrets(page);
		await row.getByRole("button", { name: "Replace" }).click();
		await expect(row.locator("input[type=password]")).toHaveValue("");
		await row.getByRole("button", { name: "Cancel" }).click();
		const remove = row.getByRole("button", { name: /Remove .* key/ });
		await remove.focus();
		await page.keyboard.press("Enter");
		await focusTrapped(page, page.getByRole("dialog"));
		await page.keyboard.press("Escape");
		await expect(remove).toBeFocused();
		await page.keyboard.press("Enter");
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Remove key", exact: true })
			.click();
		await expect(row.getByText("Not set", { exact: true })).toBeVisible();
		await shot(page, `provider-${name}`);
	});
}

for (const kind of ["binance", "coindcx"])
	test(`add ${kind}: instructions, automatic permission check and replace keys`, async ({
		page,
		api,
	}) => {
		await api.json("POST", "/api/vault/setup", { passphrase: PASS });
		await page.goto("/connections");
		await expect(
			page.getByRole("heading", { name: "Secrets Vault" }),
		).toBeVisible();
		const opener = page
			.getByRole("button", { name: "Add connection", exact: true })
			.first();
		await opener.focus();
		await page.keyboard.press("Enter");
		let d = page.getByRole("dialog");
		await focusTrapped(page, d);
		await page.keyboard.press("Escape");
		await expect(opener).toBeFocused();
		await page.keyboard.press("Enter");
		d = page.getByRole("dialog");
		await d
			.getByRole("button", {
				name: kind === "binance" ? "Binance" : "CoinDCX",
				exact: true,
			})
			.click();
		await expect(d.getByText(/Create a read-only key/)).toBeVisible();
		if (kind === "binance")
			await expect(
				d.getByText(/Leave trading and withdrawals off/),
			).toBeVisible();
		else
			await expect(
				d.getByText(
					/CoinDCX keys cannot be limited to read-only. Turn on IP binding/,
				),
			).toBeVisible();
		const venue = d.getByRole("link", {
			name:
				kind === "binance"
					? "Open Binance API Management"
					: "Open CoinDCX API Dashboard",
		});
		await expect(venue).toHaveAttribute(
			"href",
			kind === "binance"
				? "https://www.binance.com/en/my/settings/api-management"
				: "https://coindcx.com/api-dashboard",
		);
		await expect(venue).toHaveAttribute("target", "_blank");
		await expect(venue).toHaveAttribute("rel", "noopener noreferrer");
		await d.getByLabel("Label", { exact: true }).fill(`Browser ${kind}`);
		await d
			.getByLabel("API key", { exact: true })
			.fill(kind === "binance" ? "mock-binance-key" : "mock-dcx-key");
		await d
			.getByLabel("API secret", { exact: true })
			.fill(kind === "binance" ? "mock-binance-secret" : "mock-dcx-secret");
		const check = page.waitForResponse((r) => r.url().endsWith("/check"));
		await d.getByRole("button", { name: "Save connection" }).click();
		expect((await (await check).json()).readOnly).toBe(
			kind === "binance" ? true : null,
		);
		await expect(
			d
				.getByText(
					kind === "binance" ? "Read-only key verified" : "Key check note",
					{ exact: true },
				)
				.first(),
		).toBeVisible();
		if (kind === "coindcx")
			await expect(d).toContainText(
				"CoinDCX keys cannot be restricted or verified as read-only; use IP binding.",
			);
		await noSecrets(page);
		await shot(page, `${kind}-key-check`);
		await d.getByRole("button", { name: "Done" }).click();
		const c = card(page, `Browser ${kind}`);
		await c.getByRole("button", { name: "Replace keys" }).click();
		await expect(c.getByLabel("New API key", { exact: true })).toHaveValue("");
		await c
			.getByLabel("New API key", { exact: true })
			.fill(kind === "binance" ? "mock-binance-key" : "mock-dcx-key");
		await c
			.getByLabel("New API secret", { exact: true })
			.fill(kind === "binance" ? "mock-binance-secret" : "mock-dcx-secret");
		if (kind === "binance") await scenario("trading_key");
		await c.getByRole("button", { name: "Save new keys" }).click();
		if (kind === "binance") {
			await expect(c.getByRole("alert")).toContainText(
				"This key can trade or withdraw. Replace it with a read-only key.",
			);
			await expect(c.getByRole("alert")).toHaveClass(/loss/);
			await shot(page, "binance-trading-key-warning");
		} else
			await expect(
				c.getByText("Key check note", { exact: true }),
			).toBeVisible();
		await noSecrets(page);
	});

for (const [chainId, name, , address] of CHAINS)
	test(`add ${name} EVM address with validation`, async ({ page }) => {
		await page.goto("/connections");
		await expect(
			page.getByRole("heading", { name: "Secrets Vault" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Add connection", exact: true })
			.first()
			.click();
		const d = page.getByRole("dialog");
		await d.getByRole("button", { name: "EVM address" }).click();
		await d.getByLabel("Label", { exact: true }).fill(`${name} wallet`);
		await d.getByLabel("Chain", { exact: true }).selectOption(String(chainId));
		await d.getByLabel("Wallet address").fill("0xinvalid");
		await d.getByRole("button", { name: "Save connection" }).click();
		await expect(d.getByRole("alert")).toContainText(
			"Enter a valid EVM address",
		);
		await d.getByLabel("Wallet address").fill(address);
		await d.getByRole("button", { name: "Save connection" }).click();
		await expect(d).not.toBeVisible();
		await expect(
			card(page, `${name} wallet`).getByRole("button", {
				name: `Copy address ${address}`,
			}),
		).toBeVisible();
		await shot(page, `connection-${chainId}`);
	});

test("Base missing Alchemy key uses correct grammar and focuses key input", async ({
	page,
	api,
	allowConsole,
}) => {
	allowConsole(/status of 409 .*\/sync/);
	await api.json("POST", "/api/vault/setup", { passphrase: PASS });
	const c = await connection(api, "evm", 8453);
	await page.goto("/connections");
	await expect(
		page.getByRole("heading", { name: "Secrets Vault" }),
	).toBeVisible();
	await card(page, c.label)
		.getByRole("button", { name: "Sync now", exact: true })
		.click();
	await expect(card(page, c.label)).toContainText(
		/This chain needs an Alchemy/,
	);
	await card(page, c.label)
		.getByRole("button", { name: "Add Alchemy key" })
		.click();
	await expect(page.getByLabel("Alchemy API key")).toBeFocused();
	await expect(page.getByLabel("Alchemy API key")).toBeInViewport();
	await shot(page, "base-needs-alchemy");
});
