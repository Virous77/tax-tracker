import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headerFingerprint, importFile, readSheets } from "@tax/importers";
import { libraryRecipes } from "@tax/recipes";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/demo/samples/[name]/route";
import LoginPage, { dynamic } from "@/app/login/page";
import { proxy } from "@/proxy";
import { login, validSession } from "@/server/auth";
import { demoPassword, isDemoModeEnabled } from "@/server/demo-mode";

vi.mock("next/navigation", () => ({
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
}));

const origin = "http://localhost";
const samplePath = "/api/demo/samples/";
const binanceFile = "binance-spot-trades.SYNTHETIC.csv";
const coinDcxFile = "coindcx-order-history.SYNTHETIC.csv";
const stocksFile = "us-stocks-trades.SYNTHETIC.csv";

function download(name: string) {
	return GET(new Request(`${origin}${samplePath}${encodeURIComponent(name)}`), {
		params: Promise.resolve({ name }),
	});
}

afterEach(() => vi.unstubAllEnvs());

describe("runtime public demo mode", () => {
	it.each(["true", " TrUe ", "1"])("enables the demo for %s", (mode) => {
		vi.stubEnv("DEMO_MODE", mode);
		expect(isDemoModeEnabled()).toBe(true);
	});

	it.each([undefined, "", "false", "yes", "0"])(
		"hides demo access and samples for %s",
		async (mode) => {
			const password = randomUUID();
			vi.stubEnv("DEMO_MODE", mode);
			vi.stubEnv("DEMO_PASSWORD", password);
			vi.stubEnv("APP_PASSWORD", password);
			expect(isDemoModeEnabled()).toBe(false);
			expect(demoPassword()).toBe("");
			const html = renderToStaticMarkup(createElement(LoginPage));
			expect(html).toContain("Tax Tracker Unlock");
			expect(html).not.toContain("Public Demo Warning");
			expect(html).not.toContain("Demo Access");
			expect(html).not.toContain("Download Sample Data Files");
			expect(html).not.toContain(password);
			expect(html).toContain("max-w-sm");
			expect((await download(binanceFile)).status).toBe(404);
			expect(
				proxy(new NextRequest(`${origin}${samplePath}${binanceFile}`)).status,
			).toBe(404);
		},
	);

	it("renders the public warning, downloads, and runtime passphrase", () => {
		const app = randomUUID();
		const demo = randomUUID();
		vi.stubEnv("DEMO_MODE", "true");
		vi.stubEnv("APP_PASSWORD", ` ${app} `);
		vi.stubEnv("DEMO_PASSWORD", "  ");
		expect(dynamic).toBe("force-dynamic");
		expect(demoPassword()).toBe(app);
		expect(renderToStaticMarkup(createElement(LoginPage))).toContain(app);

		vi.stubEnv("DEMO_PASSWORD", ` ${demo} `);
		expect(demoPassword()).toBe(demo);
		const html = renderToStaticMarkup(createElement(LoginPage));
		expect(html).toContain("Public Demo Warning");
		expect(html).toContain("Demo Access");
		expect(html).toContain(demo);
		expect(html).not.toContain(app);
		expect(html).toContain("Fill demo password");
		expect(html).toContain("Download Sample Data Files");
		expect(html).toContain("max-w-md");
		for (const filename of [binanceFile, coinDcxFile, stocksFile])
			expect(html).toContain(`href="${samplePath}${filename}"`);
	});

	it("omits the access box when there is no configured passphrase", () => {
		vi.stubEnv("DEMO_MODE", "true");
		vi.stubEnv("APP_PASSWORD", undefined);
		vi.stubEnv("DEMO_PASSWORD", undefined);
		const html = renderToStaticMarkup(createElement(LoginPage));
		expect(html).toContain("Public Demo Warning");
		expect(html).not.toContain("Demo Access");
		expect(html).toContain("Download Sample Data Files");
	});

	it("accepts the public passphrase only when demo mode is enabled", async () => {
		const directory = await mkdtemp(join(tmpdir(), "tax-demo-auth-"));
		const app = randomUUID();
		const demo = randomUUID();
		try {
			vi.stubEnv("DATA_DIR", directory);
			vi.stubEnv("APP_PASSWORD", app);
			vi.stubEnv("DEMO_PASSWORD", demo);
			vi.stubEnv("DEMO_MODE", "true");
			expect(validSession(login(demo))).toBe(true);
			expect(validSession(login(app))).toBe(true);

			vi.stubEnv("DEMO_MODE", "false");
			expect(() => login(demo)).toThrow("Incorrect password.");
			expect(validSession(login(app))).toBe(true);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

describe("synthetic demo downloads", () => {
	it.each([
		[binanceFile, ["buy", "swap", "swap", "sell"]],
		[coinDcxFile, ["buy", "sell"]],
		[stocksFile, ["buy", "dividend", "sell"]],
	] as const)("serves and imports %s", async (name, types) => {
		vi.stubEnv("DEMO_MODE", "true");
		vi.stubEnv("APP_PASSWORD", randomUUID());
		expect(proxy(new NextRequest(`${origin}${samplePath}${name}`)).status).toBe(
			200,
		);
		const response = await download(name);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"text/csv; charset=utf-8",
		);
		expect(response.headers.get("content-disposition")).toBe(
			`attachment; filename="${name}"`,
		);
		expect(response.headers.get("cache-control")).toBe("no-store");

		const file = { name, bytes: new Uint8Array(await response.arrayBuffer()) };
		const [sheet] = readSheets(file);
		expect(sheet).toBeDefined();
		const recipe =
			sheet &&
			libraryRecipes.find(
				({ fingerprint }) =>
					fingerprint === headerFingerprint(sheet.headers, sheet.name),
			);
		if (name === stocksFile) expect(recipe?.id).toBe("us-stocks-generic-v1");
		const result = importFile(file, { timezone: "UTC", recipe });
		expect(result.rowErrors).toEqual([]);
		expect(result.rowsRead).toBe(types.length);
		expect(result.transactions.map((tx) => tx.type)).toEqual(types);
		if (name === coinDcxFile)
			expect(result.transactions[1]?.tdsInr).toBe("550");
	});

	it.each([
		"unknown.csv",
		`../${binanceFile}`,
		`%2e%2e%2f${binanceFile}`,
		"__proto__",
	])("rejects disallowed sample name %s", async (name) => {
		vi.stubEnv("DEMO_MODE", "true");
		expect((await download(name)).status).toBe(404);
	});
});
