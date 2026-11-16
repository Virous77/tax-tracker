import path from "node:path";
import type { Page } from "@playwright/test";
import { FIXTURES, GENERATED } from "./env";
import { type AppApi, expect } from "./fixtures";

export type Screen = { name: string; path: string; heading: string | RegExp };

/** Seeds a ledger that fills every screen and returns the screens to visit. */
export async function seedRichData(api: AppApi): Promise<Screen[]> {
	await api.reset();
	await api.seedWorkedExample();
	await api.importFile(
		path.join(FIXTURES, "binance-trade-history.csv"),
		"binance",
		"UTC",
	);
	await api.importFile(
		path.join(FIXTURES, "coindcx-report.xlsx"),
		"auto",
		"IST",
	);
	await api.importFile(path.join(GENERATED, "malformed.csv"), "binance", "UTC");
	const pending = await api.importFile(
		path.join(GENERATED, "generic-new-layout.csv"),
		"auto",
		"IST",
	);
	await api.compute("2025-26");
	await api.compute("2026-27");
	return [
		{ name: "overview", path: "/?taxYear=2026-27", heading: "Tax Overview" },
		{ name: "import", path: "/import", heading: "Import" },
		{
			name: "wizard",
			path: `/import?importId=${pending.id}`,
			heading: "Import File",
		},
		{ name: "imports", path: "/imports", heading: "Imports" },
		{ name: "transactions", path: "/transactions", heading: "Transactions" },
		{ name: "review", path: "/review", heading: "Review Queue" },
		{
			name: "report",
			path: "/report?taxYear=2026-27",
			heading: "Schedule VDA & Tax Report",
		},
		{ name: "settings", path: "/settings", heading: "Settings" },
	];
}

export async function openScreen(page: Page, screen: Screen) {
	await page.goto(screen.path);
	await expect(
		page.getByRole("heading", { level: 1, name: screen.heading, exact: true }),
	).toBeVisible();
	await expect(page.locator(".animate-pulse")).toHaveCount(0);
}
