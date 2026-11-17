import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineSettingsSchema, type Recipe } from "@tax/core";
import { headerFingerprint } from "@tax/importers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSession,
	invalidateSessions,
	login,
	validSession,
} from "../auth";
import { closeDatabases, database } from "../context";
import { type Endpoint, handle } from "../http";
import { groupWarnings } from "../reports";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "tax-api-"));
	vi.stubEnv("DATA_DIR", directory);
	vi.stubEnv("APP_PASSWORD", "");
	vi.stubEnv("AI_BASE_URL", "http://ollama:11434/v1");
	vi.stubEnv("AI_MODEL", "test-model");
	vi.stubEnv("AI_API_KEY", "");
});
afterEach(async () => {
	closeDatabases();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await rm(directory, { recursive: true, force: true });
});
async function call(
	name: Endpoint,
	method = "GET",
	body?: unknown,
	params: Record<string, string> = {},
	query = "",
) {
	return handle(
		name,
		new Request(`http://localhost/api/test${query}`, {
			method,
			...(body === undefined
				? {}
				: {
						body: JSON.stringify(body),
						headers: { "Content-Type": "application/json" },
					}),
		}),
		params,
	);
}
async function upload(
	text = "Date,Side,Pair,Quantity,Price,Total,Fee,Fee Asset,ID\n2026-05-01 00:00:00,BUY,ETHINR,1,200000,200000,0,INR,buy\n2026-06-01 00:00:00,SELL,ETHINR,1,250000,250000,0,INR,sell\n",
	source = "auto",
) {
	const form = new FormData();
	form.set("file", new File([text], "synthetic.csv", { type: "text/csv" }));
	form.set("source", source);
	form.set("timezone", "IST");
	return handle(
		"createImport",
		new Request("http://localhost/api/imports", { method: "POST", body: form }),
	);
}
describe("API happy path", () => {
	it("imports, deduplicates, edits, computes with earlier lots, exports and deletes", async () => {
		expect(await (await call("health")).json()).toMatchObject({
			ok: true,
			dbOk: true,
		});
		expect(await (await call("taxYears")).json()).toHaveLength(2);
		const response = await upload();
		expect(response.status).toBe(201);
		const imported = await response.json();
		expect(imported).toMatchObject({
			status: "imported",
			rowsRead: 2,
			rowsInserted: 2,
			rowsError: 0,
		});
		const duplicate = await (await upload()).json();
		expect(duplicate).toMatchObject({ rowsInserted: 0, rowsDuplicate: 2 });
		const transactions = await (
			await call(
				"listTransactions",
				"GET",
				undefined,
				{},
				"?taxYear=2026-27&sort=timestamp:asc&pageSize=1",
			)
		).json();
		expect(transactions).toMatchObject({ total: 2, pageSize: 1 });
		const sell = database()
			.transactions.all()
			.find((tx) => tx.sourceRef === "sell");
		if (!sell) throw new Error("Missing sell");
		expect(
			(await call("deleteTransaction", "DELETE", undefined, { id: sell.id }))
				.status,
		).toBe(409);
		const patched = await call(
			"patchTransaction",
			"PATCH",
			{ inrValue: "260000", userNote: "=sensitive formula" },
			{ id: sell.id },
		);
		expect(patched.status).toBe(200);
		await upload();
		expect(database().transactions.get(sell.id)?.inrValue).toBe("260000");
		const report = await call(
			"computeReport",
			"POST",
			{},
			{ taxYear: "2026-27" },
		);
		expect(report.status).toBe(200);
		const value = await report.json();
		expect(value.totals).toMatchObject({
			taxableIncome: "60000.00",
			totalTax: "18720.00",
		});
		expect(value.generatedFrom.settings).toEqual(
			EngineSettingsSchema.parse({}),
		);
		expect(
			(await call("getReport", "GET", undefined, { taxYear: "2026-27" }))
				.status,
		).toBe(200);
		const csv = await call(
			"exportReport",
			"GET",
			undefined,
			{ taxYear: "2026-27" },
			"?format=csv&kind=full",
		);
		expect(csv.headers.get("content-disposition")).toContain(
			"tax-tracker-2026-27-full.csv",
		);
		const csvText = await csv.text();
		expect(csvText).toContain("Not tax advice");
		expect(csvText).toContain("Setting");
		expect(csvText).toContain("'=sensitive formula");
		const xlsx = await call(
			"exportReport",
			"GET",
			undefined,
			{ taxYear: "2026-27" },
			"?format=xlsx&kind=schedule-vda",
		);
		expect(xlsx.status).toBe(200);
		expect(new Uint8Array(await xlsx.arrayBuffer()).slice(0, 2)).toEqual(
			new Uint8Array([80, 75]),
		);
		const groups = await (await call("review")).json();
		expect(
			groups.groups.some(
				(group: { code: string }) => group.code === "tds_not_deducted",
			),
		).toBe(true);
		expect(
			(await call("deleteImport", "DELETE", undefined, { id: imported.id }))
				.status,
		).toBe(204);
		expect(database().transactions.all()).toEqual([]);
		expect(database().rawRows.list(imported.id)).toEqual([]);
		expect(
			(await call("getReport", "GET", undefined, { taxYear: "2026-27" }))
				.status,
		).toBe(404);
	});
	it("supports pending recipes, first-20 payload preview, checks, confirm, and recipe persistence", async () => {
		const text =
			"When,Action,Coin,Quote,Qty,Value,Ref\n" +
			Array.from(
				{ length: 25 },
				(_, i) => `2026-05-01 00:00:00,BUY,BTC,INR,0.01,100,${i}`,
			).join("\n");
		const imported = await (await upload(text, "generic")).json();
		expect(imported.status).toBe("pending_recipe");
		expect(imported.sheets[0].sampleRows).toHaveLength(20);
		const recipe: Recipe = {
			id: "custom",
			name: "Custom",
			version: 1,
			sheet: "CSV",
			fingerprint: headerFingerprint([
				"When",
				"Action",
				"Coin",
				"Quote",
				"Qty",
				"Value",
				"Ref",
			]),
			columns: {
				timestamp: "When",
				side: "Action",
				baseAsset: "Coin",
				quoteAsset: "Quote",
				amount: "Qty",
				total: "Value",
				id: "Ref",
			},
			dateFormat: "yyyy-MM-dd HH:mm:ss",
			signStyle: "side_column",
		};
		const preview = await call("previewPayload", "POST", {
			importId: imported.id,
		});
		expect(preview.status).toBe(200);
		const payload = await preview.json();
		expect(
			JSON.parse(payload.sentPayload.messages[1].content).rows,
		).toHaveLength(20);
		expect(JSON.stringify(payload)).not.toContain('"Ref":"24"');
		const check = await call("previewRecipe", "POST", {
			importId: imported.id,
			recipe,
		});
		expect(check.status).toBe(200);
		const checked = await check.json();
		expect(checked.rows).toHaveLength(10);
		expect(checked.checks).toMatchObject({
			rowCountIn: 25,
			rowCountOut: 25,
			datesOk: true,
			numbersOk: true,
		});
		expect(
			(
				await call(
					"confirmImport",
					"POST",
					{ recipe, saveRecipe: true },
					{ id: imported.id },
				)
			).status,
		).toBe(200);
		expect(
			(
				await call(
					"confirmImport",
					"POST",
					{ recipe, saveRecipe: false },
					{ id: imported.id },
				)
			).status,
		).toBe(409);
		expect(await (await call("listRecipes")).json()).toHaveLength(1);
		expect(
			(await call("deleteRecipe", "DELETE", undefined, { id: recipe.id }))
				.status,
		).toBe(204);
	});
	it("handles the research workbook with visible row errors", async () => {
		const bytes = readFileSync(
			new URL(
				"../../../../../packages/importers/test/fixtures/coindcx-report.xlsx",
				import.meta.url,
			),
		);
		const form = new FormData();
		form.set("file", new File([bytes], "coindcx.xlsx"));
		form.set("source", "coindcx");
		form.set("timezone", "IST");
		const response = await handle(
			"createImport",
			new Request("http://localhost/api/imports", {
				method: "POST",
				body: form,
			}),
		);
		expect(response.status).toBe(201);
		const imported = await response.json();
		expect(imported).toMatchObject({
			rowsRead: 10,
			rowsInserted: 8,
			rowsError: 2,
		});
		const detail = await (
			await call("getImport", "GET", undefined, { id: imported.id })
		).json();
		expect(detail.rowErrors).toHaveLength(2);
		expect(
			database()
				.transactions.all()
				.some((tx) =>
					tx.reviewFlags.some((flag) => flag.code === "complex_onchain"),
				),
		).toBe(true);
		expect(
			(await call("computeReport", "POST", {}, { taxYear: "2025-26" })).status,
		).toBe(200);
	});
});
describe("validation and security", () => {
	it("returns typed errors for malformed input, missing resources, file types and size", async () => {
		expect(
			(await call("listTransactions", "GET", undefined, {}, "?pageSize=201"))
				.status,
		).toBe(400);
		expect(
			(await call("getImport", "GET", undefined, { id: "missing" })).status,
		).toBe(404);
		const badJson = await handle(
			"putSettings",
			new Request("http://localhost/api/settings", {
				method: "PUT",
				body: "{",
				headers: { "Content-Type": "application/json" },
			}),
		);
		expect(badJson.status).toBe(400);
		expect(await badJson.json()).toMatchObject({
			error: { code: "validation_error" },
		});
		expect(
			(
				await handle(
					"createImport",
					new Request("http://localhost/api/imports", {
						method: "POST",
						body: "fake",
						headers: {
							"Content-Type": "multipart/form-data; boundary=x",
							"Content-Length": String(26 * 1024 * 1024),
						},
					}),
				)
			).status,
		).toBe(413);
		const form = new FormData();
		form.set(
			"file",
			new File(["unsafe"], "unsafe.html", { type: "text/html" }),
		);
		expect(
			(
				await handle(
					"createImport",
					new Request("http://localhost/api/imports", {
						method: "POST",
						body: form,
					}),
				)
			).status,
		).toBe(422);
		expect(
			(
				await handle(
					"putSettings",
					new Request("http://localhost/api/settings", {
						method: "PUT",
						body: "{}",
						headers: {
							"Content-Type": "application/json",
							Origin: "https://other.invalid",
						},
					}),
				)
			).status,
		).toBe(403);
	});
	it("keeps API keys server-side and requires explicit cloud acknowledgement", async () => {
		expect(
			(
				await call("putSettings", "PUT", {
					ai: { baseUrl: "https://cloud.invalid/v1", apiKey: "secret" },
				})
			).status,
		).toBe(400);
		const response = await call("putSettings", "PUT", {
			feeTreatment: "include",
			ai: {
				baseUrl: "https://cloud.invalid/v1",
				apiKey: "secret",
				cloudAcknowledged: true,
				model: "chosen",
			},
		});
		expect(response.status).toBe(200);
		expect(JSON.stringify(await response.json())).not.toContain("secret");
		const settings = await (await call("getSettings")).json();
		expect(settings.ai).toMatchObject({
			apiKeySet: true,
			cloudAcknowledged: true,
		});
		await call("putSettings", "PUT", { specifiedPerson: true });
		expect((await (await call("getSettings")).json()).feeTreatment).toBe(
			"include",
		);
	});
	it("validates balances and manual transaction lifecycle", async () => {
		expect(
			(
				await call(
					"putActualBalances",
					"PUT",
					[{ asset: "BTC", amount: "0.001" }],
					{},
					"?taxYear=2026-27",
				)
			).status,
		).toBe(200);
		expect(
			await (
				await call(
					"getActualBalances",
					"GET",
					undefined,
					{},
					"?taxYear=2026-27",
				)
			).json(),
		).toEqual([{ asset: "BTC", amount: "0.001" }]);
		expect(
			(
				await call(
					"putActualBalances",
					"PUT",
					[
						{ asset: "BTC", amount: "1" },
						{ asset: "BTC", amount: "2" },
					],
					{},
					"?taxYear=2026-27",
				)
			).status,
		).toBe(409);
		const response = await call("createTransaction", "POST", {
			sourceRef: "manual1",
			importId: null,
			timestamp: "2025-05-01T00:00:00.000Z",
			type: "buy",
			assetIn: "BTC",
			amountIn: "0.1",
			inrValue: "10000",
			raw: { note: "opening history" },
			reviewFlags: [],
		});
		expect(response.status).toBe(201);
		const tx = await response.json();
		expect(
			(
				await call("createTransaction", "POST", {
					...tx,
					id: undefined,
					source: undefined,
				})
			).status,
		).toBe(409);
		expect(
			(await call("deleteTransaction", "DELETE", undefined, { id: tx.id }))
				.status,
		).toBe(204);
	});
	it("signs sessions, rejects tampering and expired cookies, and rate limits wrong passwords", () => {
		vi.stubEnv("APP_PASSWORD", "correct");
		const token = createSession();
		expect(validSession(token)).toBe(true);
		expect(validSession(`${token}x`)).toBe(false);
		expect(validSession(token, Date.now() + 13 * 60 * 60 * 1000)).toBe(false);
		for (let i = 0; i < 10; i++)
			expect(() => login("wrong", "api-test")).toThrow("Incorrect");
		expect(() => login("correct", "api-test")).toThrow("Too many");
		expect(validSession(login("correct", "fresh"))).toBe(true);
	});
	it("returns ai_unavailable on endpoint failure and validates model recipes without sending the whole file", async () => {
		const imported = await (
			await upload(
				"When,Action,Coin,Qty,Value\n2026-05-01 00:00:00,BUY,BTC,1,100\n",
				"generic",
			)
		).json();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
		);
		const down = await call("suggestRecipe", "POST", { importId: imported.id });
		expect(down.status).toBe(502);
		expect(await down.json()).toMatchObject({
			error: { code: "ai_unavailable" },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json({
					choices: [{ message: { content: '{"not":"a recipe"}' } }],
				}),
			),
		);
		expect(
			(await call("suggestRecipe", "POST", { importId: imported.id })).status,
		).toBe(422);
	});
});

it("prices quote-funded swaps once and carries prior-year acquisition history", async () => {
	const imported = await (
		await upload(
			"Date,Side,Pair,Quantity,Price,Total,Fee,Fee Asset,ID\n2025-05-01 00:00:00,BUY,USDTINR,2000,88.5,177000,0,INR,opening\n2026-05-01 00:00:00,BUY,BTCUSDT,0.01,105000,1050,0,USDT,swap\n",
		)
	).json();
	expect(imported.rowsInserted).toBe(2);
	const response = await call(
		"computeReport",
		"POST",
		{},
		{ taxYear: "2026-27" },
	);
	expect(response.status).toBe(200);
	const report = await response.json();
	expect(report.scheduleVdaRows[0]).toMatchObject({
		asset: "USDT",
		quantity: "1050",
		dateOfAcquisition: "2025-05-01",
		considerationReceived: "92925.00",
		costOfAcquisition: "92925.00",
		income: "0.00",
	});
	expect(
		report.valuations.find(
			(row: { valueInr: string }) => row.valueInr === "92925.00",
		),
	).toBeDefined();
});
it("sends exactly the preview payload and accepts only a validated AI recipe", async () => {
	const imported = await (
		await upload(
			"When,Action,Coin,Quote,Qty,Value\n2026-05-01 00:00:00,BUY,BTC,INR,1,100\n",
			"generic",
		)
	).json();
	const recipe: Recipe = {
		id: "ai",
		name: "Suggested",
		version: 1,
		fingerprint: headerFingerprint([
			"When",
			"Action",
			"Coin",
			"Quote",
			"Qty",
			"Value",
		]),
		sheet: "CSV",
		columns: {
			timestamp: "When",
			side: "Action",
			baseAsset: "Coin",
			quoteAsset: "Quote",
			amount: "Qty",
			total: "Value",
		},
		dateFormat: "yyyy-MM-dd HH:mm:ss",
		signStyle: "side_column",
	};
	const preview = await (
		await call("previewPayload", "POST", { importId: imported.id })
	).json();
	const fetcher = vi.fn().mockResolvedValue(
		Response.json({
			choices: [{ message: { content: JSON.stringify(recipe) } }],
		}),
	);
	vi.stubGlobal("fetch", fetcher);
	const response = await call("suggestRecipe", "POST", {
		importId: imported.id,
	});
	expect(response.status).toBe(200);
	const output = await response.json();
	expect(output.recipe).toEqual(recipe);
	expect(output.sentPayload).toEqual(preview.sentPayload);
	expect(fetcher.mock.calls[0]?.[0]).toBe(preview.endpoint);
	expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual(
		preview.sentPayload,
	);
});
it("requires a signed cookie at the API boundary and clears it on logout", async () => {
	vi.stubEnv("APP_PASSWORD", "password");
	expect((await call("getSettings")).status).toBe(401);
	const response = await call("login", "POST", { password: "password" });
	expect(response.status).toBe(200);
	const cookie = response.headers.get("set-cookie") ?? "";
	expect(cookie).toContain("HttpOnly");
	expect(cookie).toContain("SameSite=Strict");
	const authorised = await handle(
		"getSettings",
		new Request("http://localhost/api/settings", {
			headers: { Cookie: cookie.split(";")[0] ?? "" },
		}),
	);
	expect(authorised.status).toBe(200);
	const logout = await call("logout", "POST", {});
	expect(logout.status).toBe(204);
	expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
});

it("uses the browser Host for Docker origins and ignores forwarded headers", async () => {
	for (const [origin, host, status] of [
		["http://localhost:3101", "localhost:3101", 200],
		["http://evil.example", "localhost:3101", 403],
		["https://localhost:3101", "localhost:3101", 403],
	] as const) {
		const result = await handle(
			"putSettings",
			new Request("http://0.0.0.0:3000/api/settings", {
				method: "PUT",
				body: "{}",
				headers: {
					"content-type": "application/json",
					origin,
					host,
					"x-forwarded-host": "evil.example",
					"x-forwarded-proto": "https",
				},
			}),
		);
		expect(result.status).toBe(status);
	}
});

it("revokes sessions persistently even when APP_SECRET is configured", () => {
	vi.stubEnv("APP_SECRET", "fixed-secret");
	const copied = createSession();
	expect(validSession(copied)).toBe(true);
	invalidateSessions();
	expect(validSession(copied)).toBe(false);
	expect(validSession(createSession())).toBe(true);
});

it("groups identical warnings without losing counts or transaction attribution", async () => {
	const grouped = groupWarnings([
		{ code: "parse_warning", message: "Check GST", txId: "a" },
		{ code: "parse_warning", message: "Check GST", txId: "b" },
		{ code: "parse_warning", message: "Check GST", txId: "a" },
		{ code: "parse_warning", message: "Different warning" },
	]);
	expect(grouped).toEqual([
		{
			code: "parse_warning",
			message: "Check GST",
			count: 3,
			txIds: ["a", "b"],
		},
		{
			code: "parse_warning",
			message: "Different warning",
			count: 1,
			txIds: [],
		},
	]);
	const imported = await (await upload()).json();
	const ledger = database().transactions.all();
	await call("computeReport", "POST", {}, { taxYear: "2026-27" });
	const report = database().reports.latest("2026-27");
	if (!report) throw new Error("Missing report");
	report.warnings = groupWarnings(
		ledger.map((tx) => ({
			code: "parse_warning",
			message: "Grouped warning",
			txId: tx.id,
		})),
	);
	database().reports.save(report);
	const reviewed = await (await call("review")).json();
	expect(
		reviewed.groups.find(
			(group: { code: string }) => group.code === "parse_warning",
		).items,
	).toHaveLength(imported.rowsInserted);
});

it("refuses AI requests for imported and failed files before making a network call", async () => {
	const imported = await (await upload()).json();
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	for (const status of ["imported", "failed"] as const) {
		const detail = database().imports.get(imported.id);
		if (!detail) throw new Error("Missing import");
		database().imports.save({ ...detail, status });
		for (const endpoint of ["previewPayload", "suggestRecipe"] as const)
			expect(
				(await call(endpoint, "POST", { importId: imported.id })).status,
			).toBe(409);
	}
	expect(fetcher).not.toHaveBeenCalled();
});

it("persists report invalidation reasons across reopening the database", async () => {
	const params = { taxYear: "2026-27" };
	const fresh = await (
		await call("getReport", "GET", undefined, params)
	).json();
	expect(fresh.error).toMatchObject({
		code: "report_not_computed",
		details: { invalidatedAt: null, cause: "never_computed" },
	});
	await call("computeReport", "POST", {}, params);
	await call("putSettings", "PUT", { feeTreatment: "include" });
	const before = await (
		await call("getReport", "GET", undefined, params)
	).json();
	expect(before.error).toMatchObject({
		code: "report_not_computed",
		details: { invalidatedAt: expect.any(String), cause: "settings_changed" },
	});
	closeDatabases();
	const after = await (
		await call("getReport", "GET", undefined, params)
	).json();
	expect(after).toEqual(before);
	await call("computeReport", "POST", {}, params);
	expect((await call("getReport", "GET", undefined, params)).status).toBe(200);
});
