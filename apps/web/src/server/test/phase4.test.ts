import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { headerFingerprint, readSheets } from "@tax/importers";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { version } from "../../../../../package.json";
import { proxy } from "../../proxy";
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
	vi.useRealTimers();
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

function upload(
	fileName: string,
	bytes: ArrayBuffer,
	timezone: "IST" | "UTC",
	source = "auto",
) {
	const form = new FormData();
	form.set("file", new File([bytes], fileName, { type: "text/csv" }));
	form.set("source", source);
	form.set("timezone", timezone);
	return handle(
		"createImport",
		new Request("http://localhost/api/imports", { method: "POST", body: form }),
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
		settingsSavedAt: null,
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
	expect(await repeated.json()).toMatchObject({
		disclaimerAcceptedAt,
		settingsSavedAt: null,
	});
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

it("stamps each successful settings save without counting a disclaimer-only acknowledgement", async () => {
	vi.setSystemTime(new Date("2026-11-20T08:00:00.000Z"));
	const first = await call("putSettings", "PUT", {
		body: { defaultTaxYear: "2025-26" },
	});
	expect(await first.json()).toMatchObject({
		settingsSavedAt: "2026-11-20T08:00:00.000Z",
	});
	vi.setSystemTime(new Date("2026-11-20T09:00:00.000Z"));
	const accepted = await call("putSettings", "PUT", {
		body: { disclaimerAccepted: true },
	});
	expect(await accepted.json()).toMatchObject({
		disclaimerAcceptedAt: "2026-11-20T09:00:00.000Z",
		settingsSavedAt: "2026-11-20T08:00:00.000Z",
	});
	const second = await call("putSettings", "PUT", {
		body: { defaultTaxYear: "2025-26" },
	});
	expect(await second.json()).toMatchObject({
		settingsSavedAt: "2026-11-20T09:00:00.000Z",
	});
	vi.setSystemTime(new Date("2026-11-20T10:00:00.000Z"));
	expect(
		(await call("putSettings", "PUT", { body: { defaultTaxYear: "2024-25" } }))
			.status,
	).toBe(400);
	await closeDatabases();
	expect(await (await call("getSettings")).json()).toMatchObject({
		settingsSavedAt: "2026-11-20T09:00:00.000Z",
	});
});

it("loads one sample import per source, labels reports and every export, and removes only samples", async () => {
	expect(await (await call("getDemo")).json()).toEqual({
		loaded: false,
		importIds: [],
		taxYears: [],
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
	const { importIds, taxYears } = await loaded.json();
	expect(importIds).toHaveLength(3);
	expect(taxYears).toEqual(["2025-26"]);
	expect(await (await call("getDemo")).json()).toEqual({
		loaded: true,
		importIds,
		taxYears,
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
		tds: {
			checklist: expect.arrayContaining([
				expect.stringMatching(/^Binance: /),
				expect.stringMatching(/^CoinDCX: /),
				expect.stringMatching(/^Ethereum wallet: /),
			]),
		},
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
		taxYears: [],
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

it("does not label carried sample balances as demo activity in a later year", async () => {
	expect((await call("loadDemo", "POST")).status).toBe(201);
	const response = await call("computeReport", "POST", {}, "2026-27");
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		includesDemoData: false,
		scheduleVdaRows: [],
		balances: expect.arrayContaining([
			expect.objectContaining({ asset: "ETH" }),
		]),
	});
	const db = await database();
	const stored = db.reports.latest("2026-27");
	if (!stored) throw new Error("Expected a stored report.");
	vi.setSystemTime(new Date(Date.now() + 1000));
	db.reports.save({ ...stored, includesDemoData: true });
	expect(
		await (await call("getReport", "GET", {}, "2026-27")).json(),
	).toMatchObject({ includesDemoData: false });
});

it("keeps file notes informational and counts tax-related items separately", async () => {
	const fileName = "binance-spot-order-history(UTC+5).csv";
	const bytes = await readFile(
		new URL(
			`../../../../../packages/importers/test/fixtures/${fileName}`,
			import.meta.url,
		),
	);
	const imported = await upload(fileName, new Uint8Array(bytes).buffer, "UTC");
	expect(imported.status).toBe(201);
	const { id } = await imported.json();
	const db = await database();
	const record = db.imports.get(id);
	if (!record) throw new Error("Expected order import.");
	expect(record.skippedRows).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ kind: "cancelled_order" }),
		]),
	);
	expect(record.warnings).toHaveLength(3);
	expect(record.warnings.every(({ severity }) => severity === "info")).toBe(
		true,
	);
	db.imports.save({
		...record,
		warnings: [
			...record.warnings.map(({ severity: _severity, ...legacy }) => legacy),
			{
				code: "parse_warning",
				message: "Fee quantity is uncertain; verify it against the statement.",
			},
		],
	});
	const computed = await call("computeReport", "POST");
	expect(computed.status).toBe(200);
	const response = await call("review", "GET", { query: "?taxYear=2025-26" });
	expect(response.status).toBe(200);
	const { groups, totals } = await response.json();
	expect(groups).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				code: "parse_warning",
				severity: "info",
				count: 3,
				reportItems: expect.arrayContaining([
					expect.objectContaining({ severity: "info" }),
				]),
			}),
			expect.objectContaining({
				code: "parse_warning",
				severity: "action",
				count: 1,
				reportItems: expect.arrayContaining([
					expect.objectContaining({ severity: "action" }),
				]),
			}),
		]),
	);
	expect(totals.info).toBe(4);
	expect(groups).toContainEqual(
		expect.objectContaining({
			code: "ca_verification_pending",
			severity: "info",
			count: 1,
		}),
	);
	expect(totals.action).toBeGreaterThan(0);
	expect(totals.action).toBe(
		groups
			.filter((group: { severity: string }) => group.severity === "action")
			.reduce(
				(count: number, group: { count: number }) => count + group.count,
				0,
			),
	);
});

it("publishes only resolved Schedule VDA slices and labels incomplete exports", async () => {
	const base = { importId: null, raw: {}, reviewFlags: [] };
	const buy = {
		...base,
		sourceRef: "test-buy",
		timestamp: "2025-06-01T12:00:00.000Z",
		type: "buy",
		assetIn: "ETH",
		amountIn: "1",
		inrValue: "100",
	};
	const sell = {
		...base,
		sourceRef: "test-sell",
		timestamp: "2025-07-01T12:00:00.000Z",
		type: "sell",
		assetOut: "ETH",
		amountOut: "2",
		inrValue: "400",
		tdsInr: "100",
	};
	for (const body of [buy, sell])
		expect((await call("createTransaction", "POST", { body })).status).toBe(
			201,
		);
	const reportResponse = await call("computeReport", "POST");
	expect(reportResponse.status).toBe(200);
	const report = await reportResponse.json();
	expect(report).toMatchObject({
		incomplete: true,
		scheduleVdaRows: [
			{ asset: "ETH", quantity: "1", costOfAcquisition: "100.00" },
		],
		unresolved: [{ asset: "ETH", quantity: "1", reason: "missing_history" }],
		totals: { netPayable: "-68.80" },
		tds: { checklist: [expect.stringMatching(/^Manual: /)] },
	});
	expect(await (await call("getReport")).json()).toEqual(report);
	const db = await database();
	expect(db.reports.latest("2025-26")?.scheduleVdaRows).toHaveLength(2);
	for (const format of ["csv", "xlsx"]) {
		const response = await call("exportReport", "GET", {
			query: `?format=${format}&kind=schedule-vda`,
		});
		expect(response.status).toBe(200);
		const [sheet] = readSheets({
			name: `schedule.${format}`,
			bytes: new Uint8Array(await response.arrayBuffer()),
		});
		const contents = JSON.stringify(sheet);
		expect(contents).toContain("Date of Acquisition");
		expect(contents).toContain("Consideration Received");
		expect(contents).toContain("Incomplete report");
		expect(contents).not.toContain("disposalTxId");
	}
	const full = await (
		await call("exportReport", "GET", { query: "?format=csv&kind=full" })
	).text();
	expect(full).toContain('"trail"');
	expect(full).toContain("disposalTxId");
	expect(full).not.toContain("-68.80");
});

it("imports all public examples without errors and computes a FY 2025-26 report", async () => {
	const examples = [
		["binance-spot-trade-history", "UTC", 5],
		["binance-deposit-history", "UTC", 1],
		["binance-withdrawal-history", "UTC", 1],
		["coindcx-trade-report", "IST", 2],
		["generic-unknown-exchange", "IST", 3],
	] as const;
	for (const [name, zone, count] of examples) {
		const fileName = `${name}.SYNTHETIC.csv`;
		const bytes = await readFile(
			new URL(`../../../../../examples/${fileName}`, import.meta.url),
		);
		const response = await upload(
			fileName,
			new Uint8Array(bytes).buffer,
			zone,
			name === "generic-unknown-exchange" ? "generic" : "auto",
		);
		expect(response.status).toBe(201);
		const summary = await response.json();
		if (name !== "generic-unknown-exchange") {
			expect(summary).toMatchObject({
				rowsRead: count,
				rowsInserted: count,
				rowsError: 0,
				status: "imported",
			});
			continue;
		}
		expect(summary).toMatchObject({ status: "pending_recipe" });
		const confirmed = await handle(
			"confirmImport",
			new Request("http://localhost/api/imports/confirm", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					saveRecipe: false,
					recipe: {
						id: "examples-trades",
						name: "Examples trades",
						version: 1,
						sheet: "CSV",
						fingerprint: headerFingerprint(
							[
								"Date",
								"Market",
								"Price",
								"Volume",
								"Total",
								"Trade",
								"Fee Currency",
								"Fee",
								"TDS",
							],
							"CSV",
						),
						columns: {
							timestamp: "Date",
							side: "Trade",
							pair: "Market",
							amount: "Volume",
							price: "Price",
							total: "Total",
							feeAsset: "Fee Currency",
							feeAmount: "Fee",
							tds: "TDS",
						},
						dateFormat: "yyyy-MM-dd HH:mm:ss",
						signStyle: "side_column",
						pairSplit: { knownQuotes: ["INR"] },
					},
				}),
			}),
			{ id: summary.id },
		);
		expect(confirmed.status).toBe(200);
		expect(await confirmed.json()).toMatchObject({
			rowsRead: count,
			rowsInserted: count,
			rowsError: 0,
			status: "imported",
		});
	}
	const response = await call("computeReport", "POST");
	expect(response.status).toBe(200);
	const report = await response.json();
	expect(report).toMatchObject({
		taxYear: "2025-26",
		includesDemoData: false,
		incomplete: false,
		unresolved: [],
		generatedFrom: { txCount: 12 },
	});
	expect(report.scheduleVdaRows.length).toBeGreaterThan(0);
});

it("rolls back a demo reload when stale sample ledger references exist", async () => {
	expect((await call("loadDemo", "POST")).status).toBe(201);
	await closeDatabases();
	const sqlite = new DatabaseSync(join(directory, "tax-tracker.db"));
	try {
		sqlite.exec("UPDATE imports SET demo = 0");
	} finally {
		sqlite.close();
	}
	const db = await database();
	const before = db.transactions.active();
	const response = await call("loadDemo", "POST");
	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({
		error: { code: "demo_already_loaded" },
	});
	expect(db.imports.list()).toHaveLength(3);
	expect(db.transactions.active()).toEqual(before);
});

it("serves the opted-in missing report state with its cause and keeps legacy API status codes", async () => {
	const options = { query: "?allowMissing=true" };
	const missing = await call("getReport", "GET", options);
	expect(missing.status).toBe(200);
	expect(await missing.json()).toEqual({
		status: "missing",
		cause: "never_computed",
		invalidatedAt: null,
	});
	expect((await call("getReport")).status).toBe(404);
	expect((await call("getReport", "GET", options, "2024-25")).status).toBe(404);
	expect((await call("computeReport", "POST")).status).toBe(200);
	expect(
		await (await call("review", "GET", { query: "?taxYear=2025-26" })).json(),
	).toMatchObject({ totals: { action: 0, info: 1 } });
	expect(await (await call("getReport", "GET", options)).json()).toMatchObject({
		taxYear: "2025-26",
	});
	expect((await call("loadDemo", "POST")).status).toBe(201);
	expect(await (await call("getReport", "GET", options)).json()).toMatchObject({
		status: "missing",
		cause: "ledger_changed",
		invalidatedAt: expect.any(String),
	});
});

it("ends logged-out prefetches without redirecting and redirects document requests to login", () => {
	vi.stubEnv("APP_PASSWORD", "test password only");
	const url = "http://localhost/report?taxYear=2025-26";
	for (const headers of [
		{ "next-router-prefetch": "1" },
		{ "next-router-segment-prefetch": "/_tree" },
		{ purpose: "prefetch" },
	] as HeadersInit[]) {
		const response = proxy(new NextRequest(`${url}&_rsc=sample`, { headers }));
		expect(response.status).toBe(204);
		expect(response.headers.has("Location")).toBe(false);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
	}
	expect(
		proxy(new NextRequest(`${url}&_rsc=sample`, { headers: { rsc: "1" } }))
			.status,
	).toBe(401);
	const doc = proxy(new NextRequest(url));
	expect(doc.status).toBe(307);
	const login = new URL(doc.headers.get("Location") ?? "");
	expect(login.pathname).toBe("/login");
	expect(login.searchParams.get("next")).toBe("/report?taxYear=2025-26");
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
	expect(String(bytes.length)).toBe(backup.headers.get("X-Backup-Size"));
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
