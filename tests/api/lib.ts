import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { z } from "zod";
import * as api from "../../packages/core/dist/api/index.js";

export { api };
// Vite sets BASE_URL="/" for its own use; only an absolute URL is ours.
export const BASE_URL = /^https?:/.test(process.env.BASE_URL ?? "")
	? (process.env.BASE_URL as string)
	: "http://localhost:3101";
export const MOCK_PORT = Number(process.env.MOCK_PORT ?? 11501);
export const MOCK_HOST_URL = `http://localhost:${MOCK_PORT}`;
export const MOCK_FROM_APP =
	process.env.MOCK_FROM_APP ?? `http://host.docker.internal:${MOCK_PORT}/v1`;

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const FIXTURES = join(ROOT, "packages/importers/test/fixtures");
export const EDGE = join(ROOT, "tests/data/out");

export interface Res {
	status: number;
	headers: Headers;
	text: string;
	body: unknown;
	bytes: Uint8Array;
}

export async function call(
	method: string,
	path: string,
	options: {
		json?: unknown;
		body?: BodyInit;
		headers?: Record<string, string>;
		base?: string;
	} = {},
): Promise<Res> {
	const headers: Record<string, string> = { ...options.headers };
	let body = options.body;
	if (options.json !== undefined) {
		headers["content-type"] ??= "application/json";
		body = JSON.stringify(options.json);
	}
	const res = await fetch(`${options.base ?? BASE_URL}${path}`, {
		method,
		headers,
		body,
		redirect: "manual",
	});
	const bytes = new Uint8Array(await res.arrayBuffer());
	const text = new TextDecoder().decode(bytes);
	let parsed: unknown;
	if (res.headers.get("content-type")?.includes("application/json") && text)
		parsed = JSON.parse(text);
	return {
		status: res.status,
		headers: res.headers,
		text,
		body: parsed,
		bytes,
	};
}

export function ok<S extends z.ZodType>(
	res: Res,
	status: number,
	schema: S,
): z.infer<S> {
	expect(res.status, res.text.slice(0, 600)).toBe(status);
	const parsed = schema.safeParse(res.body);
	expect(
		parsed.success,
		parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5)),
	).toBe(true);
	return parsed.data as z.infer<S>;
}

export function fail(res: Res, status: number, code?: string) {
	expect(res.status, res.text.slice(0, 600)).toBe(status);
	const env = api.ErrorEnvelopeSchema.safeParse(res.body);
	expect(env.success, `not an error envelope: ${res.text.slice(0, 300)}`).toBe(
		true,
	);
	if (code && env.success) expect(env.data.error.code).toBe(code);
	return env.data?.error;
}

export function fixture(name: string) {
	return readFileSync(join(FIXTURES, name));
}
export function edge(name: string) {
	return readFileSync(join(EDGE, name));
}

export async function upload(
	content: Uint8Array | string,
	fileName: string,
	fields: { source?: string; timezone?: string; type?: string } = {},
	base?: string,
	headers?: Record<string, string>,
) {
	const form = new FormData();
	const bytes =
		typeof content === "string" ? new TextEncoder().encode(content) : content;
	form.set(
		"file",
		new Blob([bytes], { type: fields.type ?? "text/csv" }),
		fileName,
	);
	if (fields.source !== undefined) form.set("source", fields.source);
	form.set("timezone", fields.timezone ?? "UTC");
	return call("POST", "/api/imports", { body: form, base, headers });
}

export async function importOk(
	content: Uint8Array | string,
	fileName: string,
	fields: Parameters<typeof upload>[2] = {},
) {
	return ok(
		await upload(content, fileName, fields),
		201,
		api.CreateImportResponseSchema,
	);
}

export async function listTx(
	query: Record<string, string | number | boolean> = {},
) {
	const qs = new URLSearchParams(
		Object.entries({ pageSize: 200, ...query }).map(([k, v]) => [k, String(v)]),
	);
	return ok(
		await call("GET", `/api/transactions?${qs}`),
		200,
		api.ListTransactionsResponseSchema,
	);
}

export async function allTx(
	query: Record<string, string | number | boolean> = {},
) {
	const items = [];
	for (let page = 1; ; page++) {
		const res = await listTx({ ...query, page, pageSize: 200 });
		items.push(...res.items);
		if (items.length >= res.total || res.items.length === 0) return items;
	}
}

let refCounter = 0;
export const runId = Date.now().toString(36);
export function manual(tx: Record<string, unknown>) {
	return {
		sourceRef: `t-${runId}-${++refCounter}`,
		importId: null,
		raw: { test: true },
		reviewFlags: [],
		...tx,
	};
}

export async function addManual(tx: Record<string, unknown>) {
	return ok(
		await call("POST", "/api/transactions", { json: manual(tx) }),
		201,
		api.CreateTransactionResponseSchema,
	);
}

export const DEFAULT_SETTINGS = {
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
};

export async function putSettings(patch: Record<string, unknown>) {
	return call("PUT", "/api/settings", { json: patch });
}

export async function useMockAi(model = "mock-recipe") {
	const res = await putSettings({
		ai: {
			baseUrl: MOCK_FROM_APP,
			model,
			apiKey: "mock-key",
			cloudAcknowledged: true,
		},
	});
	ok(res, 200, api.PutSettingsResponseSchema);
}

/** Empties the ledger, recipes, balances and resets settings so a file starts from a known state. */
export async function wipe() {
	const imports = ok(
		await call("GET", "/api/imports"),
		200,
		api.ListImportsResponseSchema,
	);
	for (const i of imports)
		expect((await call("DELETE", `/api/imports/${i.id}`)).status).toBe(204);
	for (const tx of await allTx({ source: "manual" }))
		expect((await call("DELETE", `/api/transactions/${tx.id}`)).status).toBe(
			204,
		);
	const left = await listTx();
	expect(left.total, "ledger not empty after wipe").toBe(0);
	const recipes = ok(
		await call("GET", "/api/recipes"),
		200,
		api.ListRecipesResponseSchema,
	);
	for (const r of recipes)
		await call("DELETE", `/api/recipes/${encodeURIComponent(r.id)}`);
	for (const year of ["2025-26", "2026-27"])
		await call("PUT", `/api/balances/actual?taxYear=${year}`, { json: [] });
	ok(await putSettings(DEFAULT_SETTINGS), 200, api.PutSettingsResponseSchema);
}

export async function compute(year: string) {
	return ok(
		await call("POST", `/api/reports/${year}/compute`),
		200,
		api.ComputeReportResponseSchema,
	);
}

export async function mockLastRequest() {
	const res = await fetch(`${MOCK_HOST_URL}/__last-request`);
	return api.SentPayloadSchema.passthrough()
		.nullable()
		.parse(await res.json());
}

export function csv(rows: string[]) {
	return `${rows.join("\n")}\n`;
}

export async function previewPayload(importId: string, sheet?: string) {
	return ok(
		await call("POST", "/api/recipes/suggest/preview-payload", {
			json: { importId, ...(sheet ? { sheet } : {}) },
		}),
		200,
		api.PreviewPayloadResponseSchema,
	);
}

/** The fingerprint the app computed for this import's sheet, read from the exact payload it would send. */
export async function fingerprintOf(importId: string) {
	const p = await previewPayload(importId);
	const user = p.sentPayload.messages.find((m) => m.role === "user");
	return JSON.parse(user?.content ?? "{}").fingerprint as string;
}

export function injectionRecipe(fingerprint: string, id = `inj-${runId}`) {
	return {
		id,
		name: "Injection layout",
		version: 1 as const,
		fingerprint,
		columns: {
			timestamp: "Date",
			pair: "Pair",
			side: "Side",
			amount: "Qty",
			price: "Price",
			id: "Reference",
		},
		dateFormat: "yyyy-MM-dd HH:mm:ss",
		timezone: "IST" as const,
		sideMap: { Buy: "buy" as const, Sell: "sell" as const },
		signStyle: "side_column" as const,
		pairSplit: { knownQuotes: ["INR"] },
	};
}
