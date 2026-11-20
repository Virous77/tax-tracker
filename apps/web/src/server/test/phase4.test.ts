import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { version } from "../../../../../package.json";
import { createSession, SESSION_COOKIE } from "../auth";
import { closeDatabases, database } from "../context";
import { type Endpoint, handle } from "../http";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "tax-phase4-"));
	vi.stubEnv("DATA_DIR", directory);
	vi.stubEnv("APP_PASSWORD", "");
	vi.stubEnv("APP_SECRET", "");
	vi.stubEnv("SOURCE_URL", "");
});

afterEach(async () => {
	await closeDatabases();
	vi.unstubAllEnvs();
	await rm(directory, { recursive: true, force: true });
});

function call(
	name: Endpoint,
	method = "GET",
	{
		body,
		query = "",
		headers,
	}: { body?: unknown; query?: string; headers?: HeadersInit } = {},
	year = "2025-26",
) {
	const requestHeaders = new Headers(headers);
	if (body !== undefined)
		requestHeaders.set("Content-Type", "application/json");
	return handle(
		name,
		new Request(`http://localhost/api/test${query}`, {
			method,
			headers: requestHeaders,
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
		{ taxYear: year },
	);
}

it("reports the root package version and an optional public source URL", async () => {
	expect(await (await call("health")).json()).toEqual({
		ok: true,
		dbOk: true,
		version,
	});
	vi.stubEnv("SOURCE_URL", "https://example.test/tax-tracker");
	expect(await (await call("health")).json()).toMatchObject({
		sourceUrl: "https://example.test/tax-tracker",
	});
	vi.stubEnv("SOURCE_URL", "javascript:void(0)");
	expect(await (await call("health")).json()).not.toHaveProperty("sourceUrl");
});

it("stores the first acknowledgement and keeps previously computed reports", async () => {
	expect(await (await call("getSettings")).json()).toMatchObject({
		disclaimerAcceptedAt: null,
	});
	expect((await call("computeReport", "POST")).status).toBe(200);

	const accepted = await call("putSettings", "PUT", {
		body: { disclaimerAccepted: true },
	});
	expect(accepted.status).toBe(200);
	const { disclaimerAcceptedAt } = await accepted.json();
	expect(new Date(disclaimerAcceptedAt).toISOString()).toBe(
		disclaimerAcceptedAt,
	);
	await closeDatabases();
	const repeated = await call("putSettings", "PUT", {
		body: { disclaimerAccepted: true },
	});
	expect(await repeated.json()).toMatchObject({ disclaimerAcceptedAt });
	for (const body of [
		{ disclaimerAccepted: false },
		{ disclaimerAcceptedAt: null },
	]) {
		expect((await call("putSettings", "PUT", { body })).status).toBe(400);
	}
	expect(await (await call("getSettings")).json()).toMatchObject({
		disclaimerAcceptedAt,
	});
	expect((await call("getReport")).status).toBe(200);
});

it("loads one sample import per source, labels reports and every export, and removes only samples", async () => {
	expect(await (await call("getDemo")).json()).toEqual({
		loaded: false,
		importIds: [],
	});
	const uploads = await Promise.all([
		call("loadDemo", "POST"),
		call("loadDemo", "POST"),
	]);
	const [loaded, conflict] = uploads.sort((a, b) => a.status - b.status);
	expect(loaded?.status).toBe(201);
	expect(conflict?.status).toBe(409);
	expect(await conflict?.json()).toMatchObject({
		error: { code: "demo_already_loaded" },
	});
	if (!loaded) throw new Error("Expected a sample load response.");
	const { importIds } = await loaded.json();
	expect(importIds).toHaveLength(3);
	expect(await (await call("getDemo")).json()).toEqual({
		loaded: true,
		importIds,
	});

	const db = await database();
	const imports = db.imports.list();
	expect(imports.map(({ source }) => source).sort()).toEqual([
		"binance",
		"coindcx",
		"evm:1",
	]);
	for (const item of imports) {
		expect(item).toMatchObject({
			demo: true,
			rowsError: 0,
			status: "imported",
		});
		expect(db.rawRows.list(item.id)).toHaveLength(item.rowsInserted);
	}
	const form = new FormData();
	form.set(
		"file",
		new File(
			[
				"Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Trade ID\n2025-12-01 09:00:00,ETHINR,BUY,200000,1ETH,200000INR,,sample-buy\n",
			],
			"ordinary.csv",
		),
	);
	form.set("timezone", "UTC");
	const ordinary = await handle(
		"createImport",
		new Request("http://localhost/api/imports", { method: "POST", body: form }),
	);
	expect(ordinary.status).toBe(201);
	const { id: ordinaryId } = await ordinary.json();
	const before = db.transactions
		.active()
		.filter((tx) => tx.importId === ordinaryId);
	expect(before).toHaveLength(1);

	const compute = await call("computeReport", "POST");
	expect(compute.status).toBe(200);
	expect(await compute.json()).toMatchObject({
		includesDemoData: true,
		totals: { taxableIncome: "30000.00", tdsCredit: "450.00" },
		unresolved: [],
	});
	expect(await (await call("getReport")).json()).toMatchObject({
		includesDemoData: true,
	});
	const zipHelper = new URL("../../../../../tests/api/zip.ts", import.meta.url)
		.href;
	const { unzip } = (await import(/* @vite-ignore */ zipHelper)) as {
		unzip: (bytes: Uint8Array) => Map<string, Buffer>;
	};
	for (const kind of ["schedule-vda", "tds", "income", "full"]) {
		const csv = await call("exportReport", "GET", {
			query: `?format=csv&kind=${kind}`,
		});
		expect(await csv.text()).toContain("Includes sample data");
		const xlsx = await call("exportReport", "GET", {
			query: `?format=xlsx&kind=${kind}`,
		});
		const workbook = unzip(new Uint8Array(await xlsx.arrayBuffer()));
		const worksheets = [...workbook.entries()].filter(([name]) =>
			name.startsWith("xl/worksheets/"),
		);
		expect(worksheets).toHaveLength(kind === "full" ? 9 : 1);
		for (const [, xml] of worksheets)
			expect(xml.toString("utf8")).toContain("Includes sample data");
	}

	expect((await call("removeDemo", "DELETE")).status).toBe(204);
	expect((await call("removeDemo", "DELETE")).status).toBe(204);
	expect(await (await call("getDemo")).json()).toEqual({
		loaded: false,
		importIds: [],
	});
	expect(db.imports.list().map(({ id, demo }) => ({ id, demo }))).toEqual([
		{ id: ordinaryId, demo: false },
	]);
	for (const id of importIds) expect(db.rawRows.list(id)).toEqual([]);
	expect(db.transactions.active()).toEqual(before);
	expect((await call("getReport")).status).toBe(404);
	expect(await (await call("computeReport", "POST")).json()).toMatchObject({
		includesDemoData: false,
	});
	expect(
		await (
			await call("exportReport", "GET", { query: "?format=csv&kind=full" })
		).text(),
	).not.toContain("Includes sample data");
	expect((await call("loadDemo", "POST")).status).toBe(201);
});

it("applies password and same-origin rules to Phase 4 routes", async () => {
	vi.stubEnv("APP_PASSWORD", "test password only");
	vi.stubEnv("APP_SECRET", "test signing secret only");

	for (const [name, method] of [
		["getDemo", "GET"],
		["loadDemo", "POST"],
		["removeDemo", "DELETE"],
		["downloadBackup", "GET"],
	] as const) {
		const response = await call(name, method);
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({
			error: { code: "unauthorized" },
		});
	}
	const cookie = `${SESSION_COOKIE}=${createSession()}`;
	for (const [name, method] of [
		["loadDemo", "POST"],
		["removeDemo", "DELETE"],
	] as const) {
		const response = await call(name, method, {
			headers: { cookie, origin: "https://example.test" },
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			error: { code: "forbidden" },
		});
	}
	expect(
		(
			await call("loadDemo", "POST", {
				headers: { cookie, origin: "http://localhost" },
			})
		).status,
	).toBe(201);
	const backup = await call("downloadBackup", "GET", { headers: { cookie } });
	expect(backup.status).toBe(200);
	await backup.body?.cancel();
});

it("streams a consistent SQLite snapshot and cleans up after completion or cancellation", async () => {
	expect((await call("loadDemo", "POST")).status).toBe(201);
	const backup = await call("downloadBackup");
	expect(backup.status).toBe(200);
	expect(backup.headers.get("Content-Type")).toBe("application/vnd.sqlite3");
	expect(backup.headers.get("Cache-Control")).toBe("no-store");
	expect(backup.headers.get("Content-Disposition")).toMatch(
		/^attachment; filename="tax-tracker-.*\.db"$/,
	);
	expect((await call("removeDemo", "DELETE")).status).toBe(204);

	const bytes = new Uint8Array(await backup.arrayBuffer());
	expect(String(bytes.length)).toBe(backup.headers.get("Content-Length"));
	const snapshot = join(directory, "restored.db");
	await writeFile(snapshot, bytes);
	const restored = new DatabaseSync(snapshot, { readOnly: true });
	try {
		expect(restored.prepare("PRAGMA integrity_check").get()).toMatchObject({
			integrity_check: "ok",
		});
		expect(
			restored
				.prepare("SELECT COUNT(*) AS count FROM imports WHERE demo=1")
				.get(),
		).toMatchObject({ count: 3 });
	} finally {
		restored.close();
	}
	expect(
		(await readdir(directory)).filter((name) => name.startsWith(".backup-")),
	).toEqual([]);

	const interrupted = await call("downloadBackup");
	await interrupted.body?.cancel();
	expect(
		(await readdir(directory)).filter((name) => name.startsWith(".backup-")),
	).toEqual([]);
});
