import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	allTx,
	api,
	call,
	csv,
	edge,
	fail,
	fingerprintOf,
	importOk,
	MOCK_FROM_APP,
	mockLastRequest,
	ok,
	previewPayload,
	putSettings,
	runId,
	useMockAi,
	wipe,
} from "./lib";

beforeEach(async () => {
	await wipe();
	await useMockAi();
});
afterAll(wipe);

const pending = async (file = "generic-new-layout.csv") => {
	const s = await importOk(edge(file), file, {
		source: "auto",
		timezone: "IST",
	});
	expect(s.status).toBe("pending_recipe");
	return s;
};
const suggest = (importId: string) =>
	call("POST", "/api/recipes/suggest", { json: { importId } });
const userContent = (p: { messages: { role: string; content: string }[] }) =>
	JSON.parse(p.messages.find((m) => m.role === "user")?.content ?? "null");

describe("preview-payload", () => {
	it("returns exactly what would be sent: header + all rows when ≤20, endpoint, model, isLocal", async () => {
		const s = await pending();
		const p = await previewPayload(s.id);
		expect(p).toMatchObject({
			endpoint: `${MOCK_FROM_APP}/chat/completions`,
			model: "mock-recipe",
			isLocal: false,
		});
		expect(p.sentPayload.model).toBe("mock-recipe");
		expect(p.sentPayload.response_format.type).toBe("json_schema");
		const content = userContent(p.sentPayload);
		expect(content.headers).toEqual([
			"Timestamp",
			"Instrument",
			"Amount",
			"Price",
			"Net Amount",
			"Fee",
			"Fee Coin",
			"Order Ref",
		]);
		expect(content.rows).toHaveLength(5);
	});

	it("caps sample rows at 20 for a longer file and never includes the API key", async () => {
		const rows = ["When,Coin,Qty,Px,Ref"];
		for (let i = 0; i < 30; i++)
			rows.push(
				`2026-0${(i % 9) + 1}-1${i % 10} 10:00:00,ZZZ,1.${i},100,R-${runId}-${i}`,
			);
		const s = await importOk(csv(rows), "long.csv", {
			source: "auto",
			timezone: "IST",
		});
		expect(s.status).toBe("pending_recipe");
		const res = await call("POST", "/api/recipes/suggest/preview-payload", {
			json: { importId: s.id },
		});
		expect(res.text).not.toContain("mock-key");
		const p = ok(res, 200, api.PreviewPayloadResponseSchema);
		const content = userContent(p.sentPayload);
		expect(content.rows).toHaveLength(20);
		expect(JSON.stringify(p.sentPayload)).not.toContain(`R-${runId}-20`);
	});

	it("does not call the AI endpoint", async () => {
		const s = await pending();
		const before = JSON.stringify(await mockLastRequest());
		await previewPayload(s.id);
		expect(JSON.stringify(await mockLastRequest())).toBe(before);
	});

	it("unknown import → 404; missing importId → 400", async () => {
		fail(
			await call("POST", "/api/recipes/suggest/preview-payload", {
				json: { importId: "nope" },
			}),
			404,
		);
		fail(
			await call("POST", "/api/recipes/suggest/preview-payload", { json: {} }),
			400,
			"validation_error",
		);
	});
});

describe("suggest with the mock LLM", () => {
	it("returns a valid recipe and the sentPayload equals what the mock received", async () => {
		const s = await pending();
		const preview = await previewPayload(s.id);
		const body = ok(await suggest(s.id), 200, api.SuggestRecipeResponseSchema);
		expect(body.recipe.columns).toMatchObject({
			timestamp: "Timestamp",
			pair: "Instrument",
			amount: "Amount",
			price: "Price",
			total: "Net Amount",
			feeAmount: "Fee",
			feeAsset: "Fee Coin",
			id: "Order Ref",
		});
		expect(body.recipe).toMatchObject({
			dateFormat: "yyyy-MM-dd HH:mm:ss",
			signStyle: "negative_is_sell",
		});
		expect(body.recipe.pairSplit?.knownQuotes).toContain("INR");
		const last = await mockLastRequest();
		if (!last) throw new Error("the mock received no request");
		expect(last.model).toBe(body.sentPayload.model);
		expect(last.messages).toEqual(body.sentPayload.messages);
		expect(last.response_format).toEqual(body.sentPayload.response_format);
		expect(body.sentPayload).toEqual(preview.sentPayload);
		expect(userContent(last).rows.length).toBeLessThanOrEqual(20);
	});

	it.each([
		["mock-500", 502, "ai_unavailable"],
		["mock-invalid", 422, "invalid_ai_recipe"],
		["mock-garbage", 422, "invalid_ai_recipe"],
	])("%s → clean %i %s, nothing applied", async (model, status, code) => {
		const s = await pending();
		await useMockAi(model);
		const err = fail(await suggest(s.id), status, code);
		expect(err?.message).not.toMatch(/stack|at .*\.js/);
		const d = ok(
			await call("GET", `/api/imports/${s.id}`),
			200,
			api.GetImportResponseSchema,
		);
		expect(d.status).toBe("pending_recipe");
		expect((await allTx()).length).toBe(0);
		expect(
			ok(await call("GET", "/api/recipes"), 200, api.ListRecipesResponseSchema),
		).toEqual([]);
	});

	it("AI endpoint down → 502 ai_unavailable", async () => {
		const s = await pending();
		ok(
			await putSettings({
				ai: {
					baseUrl: "http://host.docker.internal:11599/v1",
					model: "x",
					apiKey: "k",
					cloudAcknowledged: true,
				},
			}),
			200,
			api.PutSettingsResponseSchema,
		);
		fail(await suggest(s.id), 502, "ai_unavailable");
	});

	it("a hanging AI endpoint (mock-slow) times out with 502 ai_unavailable", async () => {
		const s = await pending();
		await useMockAi("mock-slow");
		const started = Date.now();
		fail(await suggest(s.id), 502, "ai_unavailable");
		expect(Date.now() - started).toBeLessThan(60_000);
	}, 90_000);

	it("suggest for an unknown import → 404", async () => {
		fail(await suggest("00000000-0000-4000-8000-000000000000"), 404);
	});
});

describe("preview, confirm, saved recipe reuse", () => {
	it("preview returns ≤10 rows beside originals and passing checks", async () => {
		const s = await pending();
		const { recipe } = ok(
			await suggest(s.id),
			200,
			api.SuggestRecipeResponseSchema,
		);
		const p = ok(
			await call("POST", "/api/recipes/preview", {
				json: { importId: s.id, recipe },
			}),
			200,
			api.PreviewRecipeResponseSchema,
		);
		expect(p.rows).toHaveLength(5);
		for (const r of p.rows) {
			expect(r.original).toBeTypeOf("object");
			expect(r.converted).not.toBeNull();
		}
		expect(p.checks).toEqual({
			datesOk: true,
			numbersOk: true,
			rowCountIn: 5,
			rowCountOut: 5,
			negativeBalances: [],
		});
	});

	it("preview of a long file shows only 10 rows but counts all", async () => {
		const rows = ["When,Coin,Side,Qty,Px,Ref"];
		for (let i = 0; i < 25; i++)
			rows.push(
				`2026-05-${String(i + 1).padStart(2, "0")} 10:00:00,BTCINR,Buy,0.001,8000000,P-${runId}-${i}`,
			);
		const s = await importOk(csv(rows), "p.csv", {
			source: "auto",
			timezone: "IST",
		});
		const recipe = {
			id: `p-${runId}`,
			name: "p",
			version: 1,
			fingerprint: await fingerprintOf(s.id),
			columns: {
				timestamp: "When",
				pair: "Coin",
				side: "Side",
				amount: "Qty",
				price: "Px",
				id: "Ref",
			},
			dateFormat: "yyyy-MM-dd HH:mm:ss",
			sideMap: { Buy: "buy" },
			signStyle: "side_column",
			pairSplit: { knownQuotes: ["INR"] },
		};
		const p = ok(
			await call("POST", "/api/recipes/preview", {
				json: { importId: s.id, recipe },
			}),
			200,
			api.PreviewRecipeResponseSchema,
		);
		expect(p.rows).toHaveLength(10);
		expect(p.checks).toMatchObject({
			rowCountIn: 25,
			rowCountOut: 25,
			datesOk: true,
			numbersOk: true,
		});
	});

	it("preview with a wrong dateFormat reports datesOk false (not a crash)", async () => {
		const s = await pending();
		const { recipe } = ok(
			await suggest(s.id),
			200,
			api.SuggestRecipeResponseSchema,
		);
		const p = ok(
			await call("POST", "/api/recipes/preview", {
				json: {
					importId: s.id,
					recipe: { ...recipe, dateFormat: "dd/MM/yyyy" },
				},
			}),
			200,
			api.PreviewRecipeResponseSchema,
		);
		expect(p.checks.datesOk).toBe(false);
	});

	it("preview with an invalid recipe body → 400", async () => {
		const s = await pending();
		fail(
			await call("POST", "/api/recipes/preview", {
				json: { importId: s.id, recipe: { id: "x" } },
			}),
			400,
			"validation_error",
		);
	});

	it("confirm with saveRecipe imports 5 rows across the IST year boundary and stores the recipe", async () => {
		const s = await pending();
		const { recipe } = ok(
			await suggest(s.id),
			200,
			api.SuggestRecipeResponseSchema,
		);
		const c = ok(
			await call("POST", `/api/imports/${s.id}/confirm`, {
				json: { recipe, saveRecipe: true, recipeName: "New layout" },
			}),
			200,
			api.ConfirmImportResponseSchema,
		);
		expect(c).toMatchObject({
			status: "imported",
			rowsRead: 5,
			rowsInserted: 5,
			rowsError: 0,
		});
		expect(c.recipeId).not.toBeNull();
		const recipes = ok(
			await call("GET", "/api/recipes"),
			200,
			api.ListRecipesResponseSchema,
		);
		expect(recipes).toHaveLength(1);
		expect(recipes[0]).toMatchObject({
			id: c.recipeId,
			name: "New layout",
			fingerprint: recipe.fingerprint,
		});
		const txs = await allTx();
		const ref = (r: string) => txs.find((t) => t.sourceRef === r);
		expect(ref("OD-9004")?.timestamp).toBe("2026-03-31T18:29:45.000Z");
		expect(ref("OD-9005")?.timestamp).toBe("2026-03-31T18:30:15.000Z");
		expect(
			(await allTx({ taxYear: "2025-26" })).map((t) => t.sourceRef),
		).toContain("OD-9004");
		expect(
			(await allTx({ taxYear: "2026-27" })).map((t) => t.sourceRef),
		).toEqual(["OD-9005"]);
		expect(ref("OD-9002")).toMatchObject({
			type: "sell",
			assetOut: "ETH",
			amountOut: "0.02",
		});
		expect(txs[0].source).toMatch(/^csv:/);
	});

	it("confirm twice → second is rejected (409) and inserts nothing", async () => {
		const s = await pending();
		const { recipe } = ok(
			await suggest(s.id),
			200,
			api.SuggestRecipeResponseSchema,
		);
		ok(
			await call("POST", `/api/imports/${s.id}/confirm`, {
				json: { recipe, saveRecipe: false },
			}),
			200,
			api.ConfirmImportResponseSchema,
		);
		fail(
			await call("POST", `/api/imports/${s.id}/confirm`, {
				json: { recipe, saveRecipe: false },
			}),
			409,
		);
		expect((await allTx()).length).toBe(5);
	});

	it("confirm with a recipe whose fingerprint does not match the file is rejected", async () => {
		const s = await pending();
		const { recipe } = ok(
			await suggest(s.id),
			200,
			api.SuggestRecipeResponseSchema,
		);
		const res = await call("POST", `/api/imports/${s.id}/confirm`, {
			json: {
				recipe: { ...recipe, fingerprint: "deadbeef" },
				saveRecipe: false,
			},
		});
		expect([400, 409, 422]).toContain(res.status);
		fail(res, res.status);
		expect((await allTx()).length).toBe(0);
	});

	it("re-upload of the same layout uses the saved recipe without calling the AI", async () => {
		const s = await pending();
		const { recipe } = ok(
			await suggest(s.id),
			200,
			api.SuggestRecipeResponseSchema,
		);
		const c = ok(
			await call("POST", `/api/imports/${s.id}/confirm`, {
				json: { recipe, saveRecipe: true, recipeName: "Saved" },
			}),
			200,
			api.ConfirmImportResponseSchema,
		);
		const before = JSON.stringify(await mockLastRequest());
		const more = csv([
			"Timestamp,Instrument,Amount,Price,Net Amount,Fee,Fee Coin,Order Ref",
			`2026-05-01 10:00:00,ETH-INR,0.010,250000,"2,500.00",2.5,INR,OD-${runId}-A`,
		]);
		const s2 = await importOk(more, "more.csv", {
			source: "auto",
			timezone: "IST",
		});
		expect(s2).toMatchObject({
			status: "imported",
			rowsInserted: 1,
			recipeId: c.recipeId,
		});
		expect(JSON.stringify(await mockLastRequest())).toBe(before);
	});

	it("the same generic file confirmed twice with differently-named recipes does not double the ledger", async () => {
		for (const id of ["layout-a", "layout-b"]) {
			const s = await pending("generic-ddmmyyyy.csv");
			const { recipe } = ok(
				await suggest(s.id),
				200,
				api.SuggestRecipeResponseSchema,
			);
			ok(
				await call("POST", `/api/imports/${s.id}/confirm`, {
					json: { recipe: { ...recipe, id }, saveRecipe: false },
				}),
				200,
				api.ConfirmImportResponseSchema,
			);
		}
		expect(
			(await allTx()).length,
			"idempotent import: same file → same ledger",
		).toBe(4);
	});

	it("DELETE recipe → 204, then the layout asks for a recipe again; unknown recipe → 404", async () => {
		const s = await pending();
		const { recipe } = ok(
			await suggest(s.id),
			200,
			api.SuggestRecipeResponseSchema,
		);
		const c = ok(
			await call("POST", `/api/imports/${s.id}/confirm`, {
				json: { recipe, saveRecipe: true },
			}),
			200,
			api.ConfirmImportResponseSchema,
		);
		expect((await call("DELETE", `/api/recipes/${c.recipeId}`)).status).toBe(
			204,
		);
		expect(
			ok(await call("GET", "/api/recipes"), 200, api.ListRecipesResponseSchema),
		).toEqual([]);
		fail(await call("DELETE", `/api/recipes/${c.recipeId}`), 404);
		const again = await importOk(edge("generic-new-layout.csv"), "again.csv", {
			source: "auto",
			timezone: "IST",
		});
		expect(again.status).toBe("pending_recipe");
		expect(
			(await allTx()).length,
			"deleting a recipe keeps its imported rows",
		).toBe(5);
	});

	it("generic-ddmmyyyy.csv: mock recipe matches README, confirm → 4 rows split across years", async () => {
		const s = await pending("generic-ddmmyyyy.csv");
		const { recipe } = ok(
			await suggest(s.id),
			200,
			api.SuggestRecipeResponseSchema,
		);
		expect(recipe.columns).toMatchObject({
			timestamp: "Txn Date",
			side: "Side",
			pair: "Market",
			baseAsset: "Coin",
			amount: "Quantity",
			price: "Rate",
			total: "Value",
			feeAmount: "Charges",
			feeAsset: "Charges Coin",
		});
		expect(recipe).toMatchObject({
			dateFormat: "dd/MM/yyyy HH:mm",
			sideMap: { Buy: "buy", Sell: "sell" },
		});
		const p = ok(
			await call("POST", "/api/recipes/preview", {
				json: { importId: s.id, recipe },
			}),
			200,
			api.PreviewRecipeResponseSchema,
		);
		expect(p.checks).toMatchObject({
			datesOk: true,
			numbersOk: true,
			rowCountIn: 4,
			rowCountOut: 4,
			negativeBalances: [],
		});
		const c = ok(
			await call("POST", `/api/imports/${s.id}/confirm`, {
				json: { recipe, saveRecipe: false },
			}),
			200,
			api.ConfirmImportResponseSchema,
		);
		expect(c).toMatchObject({ rowsInserted: 4, rowsError: 0 });
		const ts = (await allTx()).map((t) => t.timestamp).sort();
		expect(ts).toContain("2026-03-31T18:29:00.000Z");
		expect(ts).toContain("2026-03-31T18:31:00.000Z");
		expect((await allTx({ taxYear: "2026-27" })).length).toBe(1);
	});

	it("a recipe can be written by hand with no AI configured at all", async () => {
		ok(
			await putSettings({
				ai: {
					baseUrl: "http://ollama:11434/v1",
					model: "",
					apiKey: "",
					cloudAcknowledged: false,
				},
			}),
			200,
			api.PutSettingsResponseSchema,
		);
		const s = await importOk(edge("csv-injection.csv"), "inj.csv", {
			source: "auto",
			timezone: "IST",
		});
		const user = JSON.parse(
			ok(
				await call("POST", "/api/recipes/suggest/preview-payload", {
					json: { importId: s.id },
				}),
				200,
				api.PreviewPayloadResponseSchema,
			).sentPayload.messages.find((m) => m.role === "user")?.content ?? "{}",
		);
		const recipe = {
			id: `hand-${runId}`,
			name: "hand",
			version: 1,
			fingerprint: user.fingerprint,
			columns: {
				timestamp: "Date",
				pair: "Pair",
				side: "Side",
				amount: "Qty",
				price: "Price",
				id: "Reference",
			},
			dateFormat: "yyyy-MM-dd HH:mm:ss",
			sideMap: { Buy: "buy", Sell: "sell" },
			signStyle: "side_column",
			pairSplit: { knownQuotes: ["INR"] },
		};
		ok(
			await call("POST", `/api/imports/${s.id}/confirm`, {
				json: { recipe, saveRecipe: false },
			}),
			200,
			api.ConfirmImportResponseSchema,
		);
		expect((await allTx()).length).toBe(4);
	});
});
