import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, call, fail, ok, putSettings, wipe } from "./lib";

beforeAll(wipe);
afterAll(wipe);

describe("GET /api/health", () => {
	it("reports ok, version and dbOk", async () => {
		const body = ok(
			await call("GET", "/api/health"),
			200,
			api.HealthResponseSchema,
		);
		expect(body.dbOk).toBe(true);
	});
	it("sends Cache-Control: no-store", async () => {
		expect(
			(await call("GET", "/api/health")).headers.get("cache-control"),
		).toContain("no-store");
	});
});

describe("GET /api/tax-years", () => {
	it("lists 2025-26 (1961 Act) and 2026-27 (2025 Act) with IST year bounds", async () => {
		const years = ok(
			await call("GET", "/api/tax-years"),
			200,
			api.TaxYearsResponseSchema,
		);
		const byId = Object.fromEntries(years.map((y) => [y.id, y]));
		expect(byId["2025-26"]).toMatchObject({
			start: "2025-04-01",
			end: "2026-03-31",
		});
		expect(byId["2025-26"].act).toMatch(/1961/);
		expect(byId["2026-27"]).toMatchObject({
			start: "2026-04-01",
			end: "2027-03-31",
		});
		expect(byId["2026-27"].act).toMatch(/2025/);
	});
});

describe("settings", () => {
	it("GET returns defaults and never an apiKey", async () => {
		const res = await call("GET", "/api/settings");
		const s = ok(res, 200, api.SettingsResponseSchema);
		expect(s).toMatchObject({
			feeTreatment: "exclude",
			lotMethod: "FIFO",
			lotPool: "global",
			surchargeRate: "0",
		});
		expect(res.text).not.toMatch(/apiKey"/);
	});

	it("PUT applies a partial update and leaves other keys unchanged", async () => {
		const before = ok(
			await call("GET", "/api/settings"),
			200,
			api.SettingsResponseSchema,
		);
		const after = ok(
			await putSettings({ surchargeRate: "0.15" }),
			200,
			api.PutSettingsResponseSchema,
		);
		expect(after.surchargeRate).toBe("0.15");
		// Phase 4: every settings save moves settingsSavedAt forward.
		expect({
			...after,
			surchargeRate: before.surchargeRate,
			settingsSavedAt: before.settingsSavedAt,
		}).toEqual(before);
		expect(Date.parse(after.settingsSavedAt ?? "")).toBeGreaterThanOrEqual(
			Date.parse(before.settingsSavedAt ?? "0"),
		);
		const read = ok(
			await call("GET", "/api/settings"),
			200,
			api.SettingsResponseSchema,
		);
		expect(read.surchargeRate).toBe("0.15");
	});

	it("PUT of each engine setting round-trips", async () => {
		const patch = {
			feeTreatment: "include",
			lotPool: "per_source",
			usdtInrRate: "sbi_usd_tt",
			incomeCostBasis: "fmv_at_receipt",
			headOfIncome: "business",
			surchargeRate: "0.37",
			specifiedPerson: true,
			transferMatchWindowHours: 24,
			transferAmountTolerance: "0.05",
			defaultTaxYear: "2025-26",
		};
		const s = ok(await putSettings(patch), 200, api.PutSettingsResponseSchema);
		expect(s).toMatchObject(patch);
	});

	it.each([
		["unknown surcharge", { surchargeRate: "0.2" }],
		["bad fee treatment", { feeTreatment: "sometimes" }],
		["lotMethod other than FIFO", { lotMethod: "LIFO" }],
		["negative window", { transferMatchWindowHours: -1 }],
		["tolerance above 1", { transferAmountTolerance: "1.5" }],
		["tolerance not decimal", { transferAmountTolerance: "abc" }],
		["unknown key", { colour: "blue" }],
		["unknown ai key", { ai: { temperature: 1 } }],
		["ai baseUrl not a URL", { ai: { baseUrl: "not a url" } }],
		["bad tax year", { defaultTaxYear: "2030-31" }],
		["specifiedPerson as string", { specifiedPerson: "yes" }],
	])("PUT rejects %s with 400", async (_name, patch) => {
		const before = (await call("GET", "/api/settings")).text;
		fail(await putSettings(patch), 400, "validation_error");
		expect((await call("GET", "/api/settings")).text).toBe(before);
	});

	it("PUT with a non-JSON content type is 400", async () => {
		fail(
			await call("PUT", "/api/settings", {
				body: "surchargeRate=0",
				headers: { "content-type": "text/plain" },
			}),
			400,
		);
	});

	it("apiKey is write-only: response and GET show only apiKeySet", async () => {
		const secret = "sk-test-SECRET-123456";
		const res = await putSettings({
			ai: { baseUrl: "http://localhost:11434/v1", model: "m", apiKey: secret },
		});
		const s = ok(res, 200, api.PutSettingsResponseSchema);
		expect(s.ai.apiKeySet).toBe(true);
		expect(res.text).not.toContain(secret);
		const get = await call("GET", "/api/settings");
		expect(get.text).not.toContain(secret);
		expect(ok(get, 200, api.SettingsResponseSchema).ai.apiKeySet).toBe(true);
	});

	it("an empty apiKey clears it", async () => {
		await putSettings({ ai: { apiKey: "x" } });
		const s = ok(
			await putSettings({ ai: { apiKey: "" } }),
			200,
			api.PutSettingsResponseSchema,
		);
		expect(s.ai.apiKeySet).toBe(false);
	});

	it.each([
		"http://localhost:11434/v1",
		"http://127.0.0.1:11434/v1",
		"http://ollama:11434/v1",
		"http://[::1]:11434/v1",
		"http://host.docker.internal:11501/v1",
		"http://0.0.0.0:11434/v1",
		"http://ollama.local:11434/v1",
		"http://10.1.2.3:11434/v1",
		"http://172.16.1.2:11434/v1",
		"http://192.168.1.2:11434/v1",
	])(
		"local endpoint %s is accepted without key or acknowledgement",
		async (baseUrl) => {
			await putSettings({ ai: { apiKey: "", cloudAcknowledged: false } });
			const s = ok(
				await putSettings({ ai: { baseUrl, model: "llama" } }),
				200,
				api.PutSettingsResponseSchema,
			);
			expect(s.ai.baseUrl).toBe(baseUrl);
		},
	);

	it("cloud endpoint without key and acknowledgement is rejected", async () => {
		await putSettings({
			ai: {
				baseUrl: "http://localhost:11434/v1",
				apiKey: "",
				cloudAcknowledged: false,
			},
		});
		fail(
			await putSettings({
				ai: { baseUrl: "https://api.example.com/v1", model: "gpt" },
			}),
			400,
		);
		fail(
			await putSettings({
				ai: {
					baseUrl: "https://api.example.com/v1",
					model: "gpt",
					apiKey: "k",
				},
			}),
			400,
		);
		fail(
			await putSettings({
				ai: {
					baseUrl: "https://api.example.com/v1",
					model: "gpt",
					cloudAcknowledged: true,
				},
			}),
			400,
		);
		const s = ok(
			await call("GET", "/api/settings"),
			200,
			api.SettingsResponseSchema,
		);
		expect(s.ai.baseUrl).toBe("http://localhost:11434/v1");
	});

	it("cloud endpoint with key and acknowledgement is accepted", async () => {
		const s = ok(
			await putSettings({
				ai: {
					baseUrl: "https://api.example.com/v1",
					model: "gpt",
					apiKey: "k",
					cloudAcknowledged: true,
				},
			}),
			200,
			api.PutSettingsResponseSchema,
		);
		expect(s.ai).toMatchObject({
			baseUrl: "https://api.example.com/v1",
			apiKeySet: true,
			cloudAcknowledged: true,
		});
	});

	it("host.docker.internal is local without cloud acknowledgement", async () => {
		await putSettings({
			ai: {
				baseUrl: "http://localhost:11434/v1",
				apiKey: "",
				cloudAcknowledged: false,
			},
		});
		ok(
			await putSettings({
				ai: { baseUrl: "http://host.docker.internal:11501/v1" },
			}),
			200,
			api.PutSettingsResponseSchema,
		);
	});

	it("withdrawing acknowledgement while on a cloud endpoint is rejected", async () => {
		ok(
			await putSettings({
				ai: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "k",
					cloudAcknowledged: true,
				},
			}),
			200,
			api.PutSettingsResponseSchema,
		);
		fail(await putSettings({ ai: { cloudAcknowledged: false } }), 400);
	});
});
