import path from "node:path";
import {
	type APIRequestContext,
	test as base,
	expect,
	type Page,
} from "@playwright/test";
import { SCREENSHOTS } from "./env";

export { expect };

const DEFAULT_SETTINGS = {
	feeTreatment: "exclude",
	lotPool: "global",
	usdtInrRate: "ledger_usdt_inr",
	incomeCostBasis: "zero",
	headOfIncome: "capital_gains",
	surchargeRate: "0",
	specifiedPerson: false,
	transferMatchWindowHours: 72,
	transferAmountTolerance: "0.01",
	defaultTaxYear: "2026-27",
	ai: {
		baseUrl: "http://ollama:11434/v1",
		model: "",
		apiKey: "",
		cloudAcknowledged: false,
	},
};

export type ManualTx = {
	sourceRef: string;
	timestamp: string;
	type: string;
	assetIn?: string;
	amountIn?: string;
	assetOut?: string;
	amountOut?: string;
	inrValue?: string;
	tdsInr?: string;
	feeAsset?: string;
	feeAmount?: string;
	incomeKind?: string;
	reviewFlags?: Array<{ code: string; message: string }>;
};

export class AppApi {
	constructor(private readonly request: APIRequestContext) {}

	async json<T>(method: string, url: string, data?: unknown): Promise<T> {
		const res = await this.request.fetch(url, {
			method,
			...(data === undefined ? {} : { data }),
		});
		if (!res.ok())
			throw new Error(`${method} ${url} → ${res.status()} ${await res.text()}`);
		return (res.status() === 204 ? undefined : await res.json()) as T;
	}

	async reset() {
		const imports = await this.json<Array<{ id: string }>>(
			"GET",
			"/api/imports",
		);
		for (const imp of imports)
			await this.json("DELETE", `/api/imports/${imp.id}`);
		for (;;) {
			const page = await this.json<{ items: Array<{ id: string }> }>(
				"GET",
				"/api/transactions?source=manual&pageSize=200",
			);
			if (page.items.length === 0) break;
			for (const tx of page.items)
				await this.json("DELETE", `/api/transactions/${tx.id}`);
		}
		const recipes = await this.json<Array<{ id: string }>>(
			"GET",
			"/api/recipes",
		);
		for (const r of recipes) await this.json("DELETE", `/api/recipes/${r.id}`);
		await this.json("PUT", "/api/settings", DEFAULT_SETTINGS);
		for (const year of ["2025-26", "2026-27"])
			await this.json("PUT", `/api/balances/actual?taxYear=${year}`, []);
	}

	addManual(tx: ManualTx) {
		return this.json<{ id: string }>("POST", "/api/transactions", {
			importId: null,
			raw: { manualEntry: true, seededBy: "e2e" },
			reviewFlags: [],
			...(tx.inrValue
				? {
						inrRateSource:
							tx.type === "gift" || tx.type === "income"
								? "fmv_receipt"
								: "manual",
					}
				: {}),
			...tx,
		});
	}

	async importFile(
		filePath: string,
		source: "auto" | "binance" | "coindcx" | "generic",
		timezone: "IST" | "UTC",
	) {
		const { readFileSync } = await import("node:fs");
		const res = await this.request.post("/api/imports", {
			multipart: {
				file: {
					name: path.basename(filePath),
					mimeType: "text/csv",
					buffer: readFileSync(filePath),
				},
				source,
				timezone,
			},
		});
		if (!res.ok()) throw new Error(`import → ${res.status()}`);
		return (await res.json()) as { id: string; status: string };
	}

	compute(taxYear: string) {
		return this.json<Record<string, unknown>>(
			"POST",
			`/api/reports/${taxYear}/compute`,
		);
	}

	putSettings(patch: Record<string, unknown>) {
		return this.json("PUT", "/api/settings", patch);
	}

	async seedWorkedExample() {
		await this.addManual({
			sourceRef: "e2e-golden-buy",
			timestamp: "2026-05-01T06:30:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "1",
			inrValue: "200000",
		});
		await this.addManual({
			sourceRef: "e2e-golden-sell",
			timestamp: "2026-08-01T06:30:00.000Z",
			type: "sell",
			assetOut: "ETH",
			amountOut: "1",
			inrValue: "250000",
			tdsInr: "2500",
		});
	}
}

type Problem = { kind: string; text: string };

type Fixtures = {
	api: AppApi;
	/** Register messages a test expects (e.g. a deliberate 4xx). */
	allowConsole: (pattern: RegExp) => void;
	problems: Problem[];
};

export const test = base.extend<Fixtures>({
	api: async ({ request }, use) => {
		await use(new AppApi(request));
	},
	// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument.
	problems: async ({}, use) => {
		await use([]);
	},
	allowConsole: [
		async ({ page, problems }, use, testInfo) => {
			const allowed: RegExp[] = [];
			const record = (kind: string, text: string) => {
				if (allowed.some((re) => re.test(text))) return;
				problems.push({ kind, text });
			};
			page.on("pageerror", (err) => record("pageerror", err.message));
			page.on("console", (msg) => {
				if (msg.type() !== "error") return;
				const text = msg.text().startsWith("Failed to load resource")
					? `${msg.text()} ${msg.location().url}`
					: msg.text();
				// No stored report yet is answered with 404 by design (SPEC §8). Chromium logs it
				// as a failed resource; the response listener below checks it is report_not_computed.
				if (/status of 404 .*\/api\/reports\/\d{4}-\d{2}$/.test(text)) return;
				record("console.error", text);
			});
			page.on("requestfailed", (req) => {
				const failure = req.failure()?.errorText ?? "";
				// Next aborts in-flight RSC/prefetch fetches on navigation; that is not a defect.
				if (failure.includes("ERR_ABORTED")) return;
				record("requestfailed", `${req.method()} ${req.url()} ${failure}`);
			});
			const pending: Promise<void>[] = [];
			page.on("response", (res) => {
				if (
					res.status() === 404 &&
					res.request().method() === "GET" &&
					/\/api\/reports\/\d{4}-\d{2}$/.test(new URL(res.url()).pathname)
				)
					pending.push(
						res
							.json()
							.then((body: { error?: { code?: string } }) => {
								if (body?.error?.code !== "report_not_computed")
									record("http404", `${res.url()} ${JSON.stringify(body)}`);
							})
							.catch(() => {}),
					);
			});
			page.on("response", (res) => {
				if (res.status() >= 500)
					record(
						"http5xx",
						`${res.status()} ${res.request().method()} ${res.url()}`,
					);
			});
			await use((pattern) => allowed.push(pattern));
			await Promise.all(pending);
			if (problems.length > 0) {
				await testInfo.attach("browser-problems", {
					body: JSON.stringify(problems, null, 2),
					contentType: "application/json",
				});
			}
			expect(
				problems,
				"page errors / console.error / failed requests during the test",
			).toEqual([]);
		},
		{ auto: true },
	],
});

export async function snap(page: Page, name: string) {
	await page.screenshot({
		path: path.join(SCREENSHOTS, `${name}.png`),
		fullPage: true,
	});
}

export async function setTheme(page: Page, theme: "light" | "dark") {
	await page.addInitScript((t) => {
		try {
			localStorage.setItem("tax-tracker-theme", t);
		} catch {}
	}, theme);
}

/** Every page lazy-loads its data; wait until skeletons are gone. */
export async function settled(page: Page) {
	await expect(page.locator(".animate-pulse")).toHaveCount(0);
}
