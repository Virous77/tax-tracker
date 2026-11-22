import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { D, roundInr } from "../../packages/core/dist/decimal.js";
import {
	addManual,
	allTx,
	api,
	BASE_URL,
	call,
	compute,
	csv,
	fail,
	fingerprintOf,
	fixture,
	importOk,
	ok,
	putSettings,
	ROOT,
	upload,
	useMockAi,
	wipe,
} from "./lib";
import { restartStack, stopApp } from "./stack";
import { parseCsv, unzip, xmlText } from "./zip";

const Database = createRequire(join(ROOT, "packages/db/package.json"))(
	"better-sqlite3",
) as typeof BetterSqlite3;

const PASSWORD = "phase4 correct horse";
const SAMPLE_LABEL = "Includes sample data";
const KINDS = ["schedule-vda", "tds", "income", "full"] as const;
const FORMATS = ["csv", "xlsx"] as const;
const DEMO_YEAR = "2025-26";
const ORIGIN = new URL(BASE_URL).origin;
const SQLITE_MAGIC = "SQLite format 3\0";
const BACKUP_NAME =
	/^attachment; filename="tax-tracker-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z\.db"$/;
const PRE_MIGRATION =
	/^tax-tracker-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z-pre-[\w-]+\.db$/;
const journal = JSON.parse(
	readFileSync(join(ROOT, "packages/db/migrations/meta/_journal.json"), "utf8"),
) as { entries: { tag: string; when: number }[] };
const latestMigration = journal.entries.at(-1) as { tag: string; when: number };
const schemaTables = Object.keys(
	JSON.parse(
		readFileSync(
			join(
				ROOT,
				`packages/db/migrations/meta/${latestMigration.tag.slice(0, 4)}_snapshot.json`,
			),
			"utf8",
		),
	).tables,
);
const rootVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
	.version as string;

// The demo's CoinDCX and Binance rows, as a user could export and import them for real.
const COINDCX_ORDERS = csv([
	"Order ID,Market,Pair,Total Quantity,Remaining Quantity,Price Per Unit,Avg Price,Fee Amount,Total Tds INR,Side,Order Type,Status,Exchange Code,Created At,Updated At",
	"sample-buy,BTCINR,I-BTC_INR,0.01,0,8000000,8000000,,,buy,limit_order,filled,I,2025-12-02 09:00:00 UTC,2025-12-02 09:00:01 UTC",
	"sample-sell,BTCINR,I-BTC_INR,0.005,0,9000000,9000000,,450,sell,limit_order,filled,I,2026-01-03 09:00:00 UTC,2026-01-03 09:00:01 UTC",
]);
const BINANCE_SPOT = csv([
	"Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Trade ID",
	"2025-12-01 09:00:00,ETHINR,BUY,200000,1ETH,200000INR,,sample-buy",
	"2026-01-02 09:00:00,ETHINR,SELL,250000,0.5ETH,125000INR,,sample-sell",
]);

let dataDir = "";
const scratch = mkdtempSync("/private/tmp/taxapi-p4-scratch-");

const exportUrl = (format: string, kind: string, year = DEMO_YEAR) =>
	`/api/reports/${year}/export?format=${format}&kind=${kind}`;

async function exportText(format: string, kind: string, year = DEMO_YEAR) {
	const res = await call("GET", exportUrl(format, kind, year));
	expect(res.status, res.text.slice(0, 300)).toBe(200);
	if (format === "csv") return parseCsv(res.text).flat().join("\n");
	const files = unzip(res.bytes);
	return [...files.keys()]
		.filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
		.flatMap((k) => xmlText(files.get(k)?.toString("utf8") ?? ""))
		.join("\n");
}

async function demoStatus() {
	return ok(await call("GET", "/api/demo"), 200, api.DemoStatusSchema);
}

async function imports() {
	return ok(
		await call("GET", "/api/imports"),
		200,
		api.ListImportsResponseSchema,
	);
}

async function getReport(year = DEMO_YEAR) {
	return ok(
		await call("GET", `/api/reports/${year}`),
		200,
		api.GetReportResponseSchema,
	);
}

async function settings() {
	return ok(
		await call("GET", "/api/settings"),
		200,
		api.SettingsResponseSchema,
	);
}

function tableCounts(db: BetterSqlite3.Database) {
	const tables = db
		.prepare(
			"SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		.pluck()
		.all() as string[];
	return Object.fromEntries(
		tables.map((t) => [
			t,
			db.prepare(`SELECT COUNT(*) FROM "${t}"`).pluck().get() as number,
		]),
	);
}

// Next.js drops the handler's Content-Length and streams the body chunked; when present it must match.
function expectLength(res: { headers: Headers; bytes: Uint8Array }) {
	const length = res.headers.get("content-length");
	if (length !== null) expect(Number(length)).toBe(res.bytes.length);
	expect(res.bytes.length).toBeGreaterThan(4096);
}

function backupLeftovers() {
	return readdirSync(dataDir).filter((name) => name.startsWith(".backup-"));
}

async function login() {
	const res = await call("POST", "/api/auth/login", {
		json: { password: PASSWORD },
	});
	expect(res.status).toBe(200);
	return (res.headers.get("set-cookie") ?? "").split(";")[0] as string;
}

beforeAll(async () => {
	dataDir = await restartStack({});
}, 180_000);

afterAll(async () => {
	await restartStack({});
	rmSync(scratch, { recursive: true, force: true });
}, 180_000);

describe("disclaimer acknowledgement", () => {
	it("is null on a fresh install", async () => {
		expect((await settings()).disclaimerAcceptedAt).toBeNull();
	});

	it("saving other settings or a full settings form does not accept it", async () => {
		ok(
			await putSettings({ surchargeRate: "0" }),
			200,
			api.PutSettingsResponseSchema,
		);
		await wipe();
		expect((await settings()).disclaimerAcceptedAt).toBeNull();
	});

	it.each([
		["false", { disclaimerAccepted: false }],
		["null", { disclaimerAccepted: null }],
		['the string "true"', { disclaimerAccepted: "true" }],
		["1", { disclaimerAccepted: 1 }],
		[
			"a client-sent stamp",
			{ disclaimerAcceptedAt: "2026-01-01T00:00:00.000Z" },
		],
	])("rejects %s with 400 before it is accepted", async (_, body) => {
		fail(await putSettings(body), 400, "validation_error");
		expect((await settings()).disclaimerAcceptedAt).toBeNull();
	});

	it("accepting keeps a stored report", async () => {
		await compute(DEMO_YEAR);
		ok(
			await putSettings({ disclaimerAccepted: true }),
			200,
			api.PutSettingsResponseSchema,
		);
		expect((await call("GET", `/api/reports/${DEMO_YEAR}`)).status).toBe(200);
	});

	let stamp = "";
	it("PUT true stamps the server's current time as ISO", async () => {
		stamp = (await settings()).disclaimerAcceptedAt as string;
		expect(stamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
		expect(Math.abs(Date.parse(stamp) - Date.now())).toBeLessThan(120_000);
	});

	it("a second PUT true keeps the first stamp", async () => {
		await new Promise((r) => setTimeout(r, 20));
		const res = ok(
			await putSettings({ disclaimerAccepted: true, surchargeRate: "0" }),
			200,
			api.PutSettingsResponseSchema,
		);
		expect(res.disclaimerAcceptedAt).toBe(stamp);
	});

	it.each([
		["cleared with false", { disclaimerAccepted: false }],
		["cleared with null stamp", { disclaimerAcceptedAt: null }],
		["backdated", { disclaimerAcceptedAt: "2000-01-01T00:00:00.000Z" }],
		["moved forward", { disclaimerAcceptedAt: "2099-01-01T00:00:00.000Z" }],
		[
			"mixed with a valid field",
			{ surchargeRate: "0", disclaimerAcceptedAt: null },
		],
	])("cannot be %s", async (_, body) => {
		fail(await putSettings(body), 400, "validation_error");
		expect((await settings()).disclaimerAcceptedAt).toBe(stamp);
	});

	it("survives a settings reset and other settings changes", async () => {
		await wipe();
		ok(
			await putSettings({ ai: { model: "x" }, defaultTaxYear: "2025-26" }),
			200,
			api.PutSettingsResponseSchema,
		);
		expect((await settings()).disclaimerAcceptedAt).toBe(stamp);
		await wipe();
	});
});

describe("sample data", () => {
	let realIds: string[] = [];
	let manualId = "";
	let demoIds: string[] = [];
	let realBefore: unknown[] = [];

	beforeAll(async () => {
		await wipe();
		const real = await importOk(
			fixture("coindcx-order-history.csv"),
			"coindcx-order-history.csv",
			{ source: "auto", timezone: "IST" },
		);
		realIds = [real.id];
		manualId = (
			await addManual({
				timestamp: "2025-12-15T00:00:00.000Z",
				type: "buy",
				assetIn: "ETH",
				amountIn: "0.1",
				inrValue: "20000",
				inrRateSource: "manual",
			})
		).id;
	});

	async function realRows() {
		const keep = new Set([...realIds, manualId]);
		return (await allTx())
			.filter((tx) => (tx.importId && keep.has(tx.importId)) || keep.has(tx.id))
			.sort((a, b) => a.id.localeCompare(b.id))
			.map(({ reviewFlags: _, ...tx }) => tx);
	}
	// reviewFlags are left out: a stale report keeps merging its warnings into rows until the next compute.

	it("GET reports nothing loaded on a ledger with only real data", async () => {
		expect(await demoStatus()).toEqual({
			loaded: false,
			importIds: [],
			taxYears: [],
		});
		realBefore = await realRows();
		expect(realBefore.length).toBeGreaterThan(1);
	});

	it("POST loads three demo imports and answers 201 with their ids", async () => {
		const res = ok(
			await call("POST", "/api/demo"),
			201,
			api.DemoLoadResponseSchema,
		);
		demoIds = res.importIds;
		expect(demoIds).toHaveLength(3);
		expect([...demoIds].sort()).toEqual(demoIds);
		expect(await demoStatus()).toEqual({
			loaded: true,
			importIds: demoIds,
			taxYears: [DEMO_YEAR],
		});
	});

	it("demo imports are flagged demo:true, real ones are not", async () => {
		const list = await imports();
		const demo = list.filter((i) => i.demo === true);
		expect(demo.map((i) => i.id).sort()).toEqual(demoIds);
		expect(demo.map((i) => i.source).sort()).toEqual([
			"binance",
			"coindcx",
			"evm:1",
		]);
		for (const i of demo) expect(i.status).toBe("imported");
		for (const id of realIds)
			expect(list.find((i) => i.id === id)?.demo).not.toBe(true);
		for (const id of demoIds) {
			const one = ok(
				await call("GET", `/api/imports/${id}`),
				200,
				api.GetImportResponseSchema,
			);
			expect(one.demo).toBe(true);
		}
	});

	it("every demo row keeps its raw source row and a demo-prefixed reference", async () => {
		const ids = new Set(demoIds);
		const rows = (await allTx()).filter(
			(tx) => tx.importId && ids.has(tx.importId),
		);
		expect(rows.length).toBeGreaterThanOrEqual(6);
		for (const tx of rows) {
			expect(tx.sourceRef.startsWith("demo:"), tx.sourceRef).toBe(true);
			expect(tx.raw && Object.keys(tx.raw).length, tx.id).toBeTruthy();
		}
	});

	it("loading the demo did not change any real row", async () => {
		expect(await realRows()).toEqual(realBefore);
	});

	it("a second POST → 409 demo_already_loaded and nothing is added", async () => {
		const before = (await imports()).length;
		fail(await call("POST", "/api/demo"), 409, "demo_already_loaded");
		expect((await imports()).length).toBe(before);
	});

	it("POST refuses a JSON body with unknown fields", async () => {
		fail(await call("POST", "/api/demo", { json: { force: true } }), 400);
	});

	it("the real export of the demo's own rows imports in full, not as duplicates of the demo", async () => {
		const coindcx = await importOk(COINDCX_ORDERS, "coindcx-orders.csv", {
			source: "coindcx",
			timezone: "UTC",
		});
		const binance = await importOk(BINANCE_SPOT, "binance-spot.csv", {
			source: "binance",
			timezone: "UTC",
		});
		for (const imp of [coindcx, binance]) {
			const detail = ok(
				await call("GET", `/api/imports/${imp.id}`),
				200,
				api.GetImportResponseSchema,
			);
			expect(detail.demo, imp.id).not.toBe(true);
			expect(detail.rowsInserted, JSON.stringify(detail)).toBe(2);
			expect(detail.rowsDuplicate).toBe(0);
		}
		realIds.push(coindcx.id, binance.id);
		realBefore = await realRows();
	});

	it("the report says it includes sample data", async () => {
		const report = await compute(DEMO_YEAR);
		expect(report.includesDemoData).toBe(true);
		expect(report.scheduleVdaRows.length).toBeGreaterThan(0);
		expect((await getReport()).includesDemoData).toBe(true);
	});

	describe.each(FORMATS)("%s exports", (format) => {
		it.each(KINDS)(`%s says "${SAMPLE_LABEL}"`, async (kind) => {
			expect(await exportText(format, kind)).toContain(SAMPLE_LABEL);
		});
	});

	it("two concurrent POSTs after DELETE load the demo exactly once", async () => {
		expect((await call("DELETE", "/api/demo")).status).toBe(204);
		const results = await Promise.all([
			call("POST", "/api/demo"),
			call("POST", "/api/demo"),
		]);
		expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
		demoIds = (await demoStatus()).importIds;
		expect(demoIds).toHaveLength(3);
		expect((await imports()).filter((i) => i.demo).length).toBe(3);
	});

	it("DELETE → 204 and removes only the demo imports and their rows", async () => {
		await compute(DEMO_YEAR);
		expect((await call("DELETE", "/api/demo")).status).toBe(204);
		expect(await demoStatus()).toEqual({
			loaded: false,
			importIds: [],
			taxYears: [],
		});
		for (const id of demoIds)
			fail(await call("GET", `/api/imports/${id}`), 404);
		const ids = new Set(demoIds);
		const rows = await allTx();
		expect(rows.filter((tx) => tx.importId && ids.has(tx.importId))).toEqual(
			[],
		);
		expect(rows.filter((tx) => tx.sourceRef.startsWith("demo:"))).toEqual([]);
		expect((await imports()).map((i) => i.id).sort()).toEqual(
			[...realIds].sort(),
		);
	});

	it("every real import and manual row survives untouched", async () => {
		expect(await realRows()).toEqual(realBefore);
	});

	it("the stored report is cleared, and the recomputed report has no sample label", async () => {
		const stale = await call("GET", `/api/reports/${DEMO_YEAR}`);
		fail(stale, 404, "report_not_computed");
		expect((await compute(DEMO_YEAR)).includesDemoData).toBe(false);
		for (const format of FORMATS)
			for (const kind of KINDS)
				expect(
					await exportText(format, kind),
					`${format} ${kind}`,
				).not.toContain(SAMPLE_LABEL);
	});

	it("DELETE without sample data is a harmless 204", async () => {
		const before = await realRows();
		expect((await call("DELETE", "/api/demo")).status).toBe(204);
		expect(await realRows()).toEqual(before);
	});

	it("DELETE /api/imports/:id of a demo import also ends the demo", async () => {
		const { importIds } = ok(
			await call("POST", "/api/demo"),
			201,
			api.DemoLoadResponseSchema,
		);
		for (const id of importIds)
			expect((await call("DELETE", `/api/imports/${id}`)).status).toBe(204);
		expect(await demoStatus()).toEqual({
			loaded: false,
			importIds: [],
			taxYears: [],
		});
	});
});

describe("health", () => {
	it("version is the root package.json version and sourceUrl is absent by default", async () => {
		const h = ok(
			await call("GET", "/api/health"),
			200,
			api.HealthResponseSchema,
		);
		expect(h.version).toBe(rootVersion);
		expect(h).not.toHaveProperty("sourceUrl");
	});

	it("SOURCE_URL appears as sourceUrl", async () => {
		await restartStack({ SOURCE_URL: "https://example.org/tax-tracker" });
		const h = ok(
			await call("GET", "/api/health"),
			200,
			api.HealthResponseSchema,
		);
		expect(h.sourceUrl).toBe("https://example.org/tax-tracker");
		expect(h.version).toBe(rootVersion);
	}, 180_000);

	it.each([
		"javascript:alert(1)",
		"ftp://example.org/src",
		"https://user:secret@example.org/src",
		"not a url",
	])(
		"an unsafe or invalid SOURCE_URL %s is hidden",
		async (value) => {
			await restartStack({ SOURCE_URL: value });
			const h = ok(
				await call("GET", "/api/health"),
				200,
				api.HealthResponseSchema,
			);
			expect(h).not.toHaveProperty("sourceUrl");
			expect(JSON.stringify(h)).not.toContain("secret");
		},
		180_000,
	);
});

describe("password mode", () => {
	let cookie = "";
	beforeAll(async () => {
		await restartStack({ APP_PASSWORD: PASSWORD });
	}, 180_000);

	it("health stays public and still reports the version", async () => {
		const h = ok(
			await call("GET", "/api/health"),
			200,
			api.HealthResponseSchema,
		);
		expect(h.version).toBe(rootVersion);
	});

	it.each([
		["GET", "/api/demo"],
		["POST", "/api/demo"],
		["DELETE", "/api/demo"],
		["GET", "/api/backup"],
		["PUT", "/api/settings"],
	])("%s %s → 401 without a session", async (method, path) => {
		const res = await call(
			method,
			path,
			method === "PUT" ? { json: { disclaimerAccepted: true } } : {},
		);
		fail(res, 401, "unauthorized");
		expect(res.text).not.toContain("SQLite format");
	});

	it("a forged cookie cannot download the backup", async () => {
		const res = await call("GET", "/api/backup", {
			headers: { cookie: "tax_tracker_session=9999999999.forged.AAAA" },
		});
		fail(res, 401);
		expect(res.headers.get("content-disposition")).toBeNull();
	});

	it("the unauthenticated attempts changed nothing", async () => {
		cookie = await login();
		const s = ok(
			await call("GET", "/api/settings", { headers: { cookie } }),
			200,
			api.SettingsResponseSchema,
		);
		expect(s.disclaimerAcceptedAt).toBeNull();
		expect(
			ok(
				await call("GET", "/api/demo", { headers: { cookie } }),
				200,
				api.DemoStatusSchema,
			).loaded,
		).toBe(false);
	});

	it.each([
		["POST", "/api/demo"],
		["DELETE", "/api/demo"],
		["PUT", "/api/settings"],
	])(
		"%s %s from another origin → 403 even with a session",
		async (method, path) => {
			fail(
				await call(method, path, {
					headers: { cookie, origin: "http://evil.example" },
					...(method === "PUT" ? { json: { disclaimerAccepted: true } } : {}),
				}),
				403,
				"forbidden",
			);
		},
	);

	it("the cross-origin attempts changed nothing", async () => {
		const s = ok(
			await call("GET", "/api/settings", { headers: { cookie } }),
			200,
			api.SettingsResponseSchema,
		);
		expect(s.disclaimerAcceptedAt).toBeNull();
		expect(
			ok(
				await call("GET", "/api/demo", { headers: { cookie } }),
				200,
				api.DemoStatusSchema,
			).loaded,
		).toBe(false);
	});

	it("same-origin requests with a session work for every new route", async () => {
		const headers = { cookie, origin: ORIGIN };
		ok(
			await call("PUT", "/api/settings", {
				headers,
				json: { disclaimerAccepted: true },
			}),
			200,
			api.PutSettingsResponseSchema,
		);
		ok(
			await call("POST", "/api/demo", { headers }),
			201,
			api.DemoLoadResponseSchema,
		);
		const backup = await call("GET", "/api/backup", { headers });
		expect(backup.status).toBe(200);
		expect(new TextDecoder().decode(backup.bytes.slice(0, 16))).toBe(
			SQLITE_MAGIC,
		);
		expect((await call("DELETE", "/api/demo", { headers })).status).toBe(204);
	});

	it("the backup is not readable cross-origin (no CORS headers)", async () => {
		const res = await call("GET", "/api/backup", {
			headers: { cookie, origin: "http://evil.example" },
		});
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
		expect(res.headers.get("access-control-allow-credentials")).toBeNull();
	});

	it("a logged-out cookie cannot download the backup", async () => {
		const own = await login();
		await call("POST", "/api/auth/logout", {
			headers: { cookie: own, origin: ORIGIN },
		});
		fail(await call("GET", "/api/backup", { headers: { cookie: own } }), 401);
	});
});

describe("backup download and pre-migration backups", () => {
	let backupFile = "";
	let downloaded: Uint8Array = new Uint8Array();

	beforeAll(async () => {
		dataDir = await restartStack({});
		ok(
			await putSettings({ disclaimerAccepted: true }),
			200,
			api.PutSettingsResponseSchema,
		);
		ok(await call("POST", "/api/demo"), 201, api.DemoLoadResponseSchema);
		await importOk(
			fixture("coindcx-order-history.csv"),
			"coindcx-order-history.csv",
			{ source: "auto", timezone: "IST" },
		);
		await addManual({
			timestamp: "2026-05-01T00:00:00.000Z",
			type: "buy",
			assetIn: "SOL",
			amountIn: "3",
			inrValue: "30000",
			inrRateSource: "manual",
		});
		await compute(DEMO_YEAR);
	}, 180_000);

	it("GET /api/backup streams a SQLite file with download headers", async () => {
		const res = await call("GET", "/api/backup");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/vnd.sqlite3");
		expect(res.headers.get("content-disposition")).toMatch(BACKUP_NAME);
		expect(res.headers.get("cache-control")).toContain("no-store");
		expectLength(res);
		expect(new TextDecoder().decode(res.bytes.slice(0, 16))).toBe(SQLITE_MAGIC);
		downloaded = res.bytes;
		backupFile = join(scratch, "download.db");
		writeFileSync(backupFile, downloaded);
	});

	it("the snapshot opens, passes integrity_check and has every table of the schema", () => {
		const db = new Database(backupFile, { readonly: true });
		try {
			expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
			const tables = Object.keys(tableCounts(db));
			for (const t of schemaTables) expect(tables, t).toContain(t);
			expect(
				db.prepare("SELECT COUNT(*) FROM __drizzle_migrations").pluck().get(),
			).toBe(journal.entries.length);
		} finally {
			db.close();
		}
	});

	it("the snapshot's rows match what the API reports", async () => {
		const db = new Database(backupFile, { readonly: true });
		try {
			const importCount = db
				.prepare("SELECT COUNT(*) FROM imports")
				.pluck()
				.get();
			expect(importCount).toBe((await imports()).length);
			const demoCount = db
				.prepare("SELECT COUNT(*) FROM imports WHERE demo=1")
				.pluck()
				.get();
			expect(demoCount).toBe(3);
			const active = db
				.prepare(
					"SELECT COUNT(*) FROM transactions WHERE superseded_by IS NULL",
				)
				.pluck()
				.get();
			expect(active).toBe((await allTx()).length);
			const stamp = db
				.prepare("SELECT value FROM settings WHERE key='disclaimerAcceptedAt'")
				.pluck()
				.get() as string;
			expect(JSON.parse(stamp)).toBe((await settings()).disclaimerAcceptedAt);
			expect(
				db.prepare("SELECT COUNT(*) FROM reports").pluck().get(),
			).toBeGreaterThan(0);
		} finally {
			db.close();
		}
	});

	it("no temporary files are left in the data dir after a download", async () => {
		await new Promise((r) => setTimeout(r, 500));
		expect(backupLeftovers()).toEqual([]);
	});

	it("an aborted download leaves no temporary files", async () => {
		const res = await fetch(`${BASE_URL}/api/backup`);
		const reader = res.body?.getReader();
		await reader?.read();
		await reader?.cancel();
		const deadline = Date.now() + 5_000;
		while (backupLeftovers().length && Date.now() < deadline)
			await new Promise((r) => setTimeout(r, 200));
		expect(backupLeftovers()).toEqual([]);
	});

	it("parallel downloads are each complete SQLite files", async () => {
		const all = await Promise.all(
			[1, 2, 3].map(() => call("GET", "/api/backup")),
		);
		for (const res of all) {
			expect(res.status).toBe(200);
			expect(new TextDecoder().decode(res.bytes.slice(0, 16))).toBe(
				SQLITE_MAGIC,
			);
			expectLength(res);
		}
		await new Promise((r) => setTimeout(r, 500));
		expect(backupLeftovers()).toEqual([]);
	});

	it("the snapshot's table row counts equal the live database's", async () => {
		stopApp();
		const live = new Database(join(dataDir, "tax-tracker.db"), {
			readonly: true,
		});
		const snap = new Database(backupFile, { readonly: true });
		try {
			const liveCounts = tableCounts(live);
			const snapCounts = tableCounts(snap);
			expect(snapCounts).toEqual(liveCounts);
		} finally {
			live.close();
			snap.close();
		}
	}, 60_000);

	it("a boot with a pending migration backs up the old database first, keeping the newest 5", async () => {
		const backups = join(dataDir, "backups");
		expect(
			existsSync(backups)
				? readdirSync(backups).filter((n) => PRE_MIGRATION.test(n))
				: [],
			"a fresh install made a pre-migration backup",
		).toEqual([]);
		const live = new Database(join(dataDir, "tax-tracker.db"));
		try {
			// Simulates a database from before the latest migration (0009 adds review_resolutions).
			live.exec("DROP TABLE review_resolutions");
			live
				.prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?")
				.run(latestMigration.when);
			live.pragma("wal_checkpoint(TRUNCATE)");
		} finally {
			live.close();
		}
		mkdirSync(backups, { recursive: true });
		const seeded = [1, 2, 3, 4, 5, 6].map(
			(d) => `tax-tracker-2020-01-0${d}T00-00-00.000Z-pre-0000_old.db`,
		);
		for (const name of [...seeded, "keep-me.db", "notes.txt"])
			writeFileSync(join(backups, name), "seed");

		await restartStack({}, dataDir);

		const names = readdirSync(backups).sort();
		const kept = names.filter((n) => PRE_MIGRATION.test(n));
		const fresh = kept.filter((n) => !seeded.includes(n));
		expect(fresh).toHaveLength(1);
		expect(fresh[0]).toMatch(new RegExp(`-pre-${latestMigration.tag}\\.db$`));
		expect(kept.sort()).toEqual([...seeded.slice(2), fresh[0]].sort());
		expect(names).toContain("keep-me.db");
		expect(names).toContain("notes.txt");
		expect(names.filter((n) => n.startsWith("."))).toEqual([]);

		const old = new Database(join(backups, fresh[0] as string), {
			readonly: true,
		});
		try {
			expect(old.pragma("integrity_check", { simple: true })).toBe("ok");
			expect(
				old
					.prepare(
						"SELECT COUNT(*) FROM sqlite_master WHERE name = 'review_resolutions'",
					)
					.pluck()
					.get(),
			).toBe(0);
			expect(
				old.prepare("SELECT COUNT(*) FROM __drizzle_migrations").pluck().get(),
			).toBe(journal.entries.length - 1);
			expect(old.prepare("SELECT COUNT(*) FROM imports").pluck().get()).toBe(
				(await imports()).length,
			);
		} finally {
			old.close();
		}
	}, 180_000);

	it("after the migration the app answers with every import intact", async () => {
		const list = await imports();
		expect(list.length).toBe(4);
		expect(list.filter((i) => i.demo).length).toBe(3);
		expect((await demoStatus()).loaded).toBe(true);
		expect((await review()).totals.info).toBeGreaterThan(0);
	});

	it("a boot with no pending migration makes no new backup", async () => {
		const backups = join(dataDir, "backups");
		const before = readdirSync(backups).sort();
		await restartStack({}, dataDir);
		expect(readdirSync(backups).sort()).toEqual(before);
	}, 180_000);
});

// Final Phase 4 round: review severity, settings stamp, demo years, incomplete reports, exports, examples, proxy.
const ORDER_HISTORY_SAMPLE =
	"Binance-Spot-Order-History-202601021200(UTC+5)-part1-of1.SYNTHETIC.csv";
const INFO_NOTES = [
	/^Used \+05:00 from the file name instead of the selected UTC\.$/,
	/^Duplicate columns were renamed \(Time#2\)/,
	/^Binance Spot Order History has no fees/,
];
const ITR_HEADER = [
	"Sl. No.",
	"Date of Acquisition",
	"Date of Transfer",
	"Head under which income to be taxed (Business/Capital Gain)",
	"Cost of Acquisition",
	"Consideration Received",
	"Income from transfer of Virtual Digital Assets (enter nil in case of loss)",
];
const INCOMPLETE_LABEL = "Incomplete report — unresolved disposals excluded";

async function review(year = DEMO_YEAR) {
	return ok(
		await call("GET", `/api/review?taxYear=${year}`),
		200,
		api.ReviewResponseSchema,
	);
}

async function importSample(name: string, timezone = "UTC") {
	return importOk(
		readFileSync(join(ROOT, "docs/research/export-samples", name)),
		name,
		{ source: "auto", timezone },
	);
}

describe("final: review severity and totals", () => {
	beforeAll(async () => {
		dataDir = await restartStack({});
		await wipe();
	}, 180_000);

	it("file-interpretation notes are info, on the import and in the report", async () => {
		const imp = await importSample(ORDER_HISTORY_SAMPLE);
		expect(imp.warnings).toHaveLength(3);
		for (const [i, w] of imp.warnings.entries()) {
			expect(w.code).toBe("parse_warning");
			expect(w.message).toMatch(INFO_NOTES[i] as RegExp);
			expect(w.severity).toBe("info");
		}
		const report = await compute(DEMO_YEAR);
		const info = report.warnings.filter((w) => w.severity === "info");
		expect(info.map((w) => w.code).sort()).toEqual([
			"ca_verification_pending",
			"parse_warning",
			"parse_warning",
			"parse_warning",
		]);
		for (const w of report.warnings)
			expect(["action", "info"], w.message).toContain(w.severity);
	});

	it("review groups split by severity, and totals add up", async () => {
		const r = await review();
		const info = r.groups.filter((g) => g.severity === "info");
		expect(info.map((g) => g.code).sort()).toEqual([
			"ca_verification_pending",
			"parse_warning",
		]);
		const notes = info.find((g) => g.code === "parse_warning");
		expect(notes?.reportItems.map((i) => i.message)).toEqual(
			INFO_NOTES.map((re) => expect.stringMatching(re)),
		);
		const action = r.groups.filter((g) => g.severity === "action");
		expect(action.map((g) => g.code)).toContain("missing_history");
		for (const g of r.groups) {
			expect(g.count, g.code).toBe(g.items.length + g.reportItems.length);
			for (const item of g.reportItems)
				expect(item.severity, `${g.code} ${item.message}`).toBe(g.severity);
		}
		const sum = (gs: typeof r.groups) => gs.reduce((n, g) => n + g.count, 0);
		expect(r.totals).toEqual({ action: sum(action), info: sum(info) });
		expect(r.totals.info).toBe(4);
		expect(r.totals.action).toBeGreaterThan(0);
	});

	async function resolveEveryActionItem() {
		await compute(DEMO_YEAR);
		for (let pass = 0; pass < 3; pass++) {
			const actionTx = (await review()).groups.flatMap((g) =>
				g.severity === "action" ? g.items.map((tx) => [tx.id, g.code]) : [],
			);
			if (!actionTx.length) break;
			for (const [id, code] of actionTx)
				ok(
					await call("PATCH", `/api/transactions/${id}`, {
						json: { resolveFlags: [code] },
					}),
					200,
					api.PatchTransactionResponseSchema,
				);
			await compute(DEMO_YEAR);
		}
		return review();
	}

	const usdtBuy = () =>
		addManual({
			timestamp: "2025-12-01T00:00:00.000Z",
			type: "buy",
			assetIn: "USDT",
			amountIn: "1000",
			inrValue: "90000",
			inrRateSource: "manual",
		});

	it("only info items remain once every action item is fixed or resolved (CoinDCX)", async () => {
		await wipe();
		const imp = await importSample(
			"coindcx-order-history.SYNTHETIC.csv",
			"IST",
		);
		expect(imp.warnings).toEqual([
			{
				code: "parse_warning",
				severity: "info",
				message: "Used UTC from the export format instead of the selected IST.",
			},
		]);
		await usdtBuy();
		const r = await resolveEveryActionItem();
		expect(
			r.groups.filter((g) => g.severity === "action"),
			JSON.stringify(r.groups.map((g) => [g.code, g.severity, g.count])),
		).toEqual([]);
		expect(r.totals).toEqual({ action: 0, info: 2 });
	});

	it("a resolved Binance tds_not_deducted stays resolved after the next compute", async () => {
		await wipe();
		await importSample(ORDER_HISTORY_SAMPLE);
		await usdtBuy();
		const r = await resolveEveryActionItem();
		expect(
			r.groups
				.filter((g) => g.severity === "action")
				.map((g) => [g.code, g.count]),
		).toEqual([]);
		expect(r.totals).toEqual({ action: 0, info: 4 });
	});

	it("the CA verification notice is info even with no imports", async () => {
		await wipe();
		await compute(DEMO_YEAR);
		const r = await review();
		expect(r.groups.map((g) => [g.code, g.severity, g.count])).toEqual([
			["ca_verification_pending", "info", 1],
		]);
		expect(r.totals).toEqual({ action: 0, info: 1 });
	});
});

describe("final: settingsSavedAt", () => {
	beforeAll(async () => {
		dataDir = await restartStack({});
	}, 180_000);

	it("is null on a fresh install", async () => {
		expect((await settings()).settingsSavedAt).toBeNull();
	});

	it("disclaimer-only acceptance does not stamp it", async () => {
		const s = ok(
			await putSettings({ disclaimerAccepted: true }),
			200,
			api.PutSettingsResponseSchema,
		);
		expect(s.disclaimerAcceptedAt).not.toBeNull();
		expect(s.settingsSavedAt).toBeNull();
		expect((await settings()).settingsSavedAt).toBeNull();
	});

	it("saving settings stamps the server time, and each save moves it", async () => {
		const before = Date.now();
		const s = ok(
			await putSettings({ defaultTaxYear: "2025-26" }),
			200,
			api.PutSettingsResponseSchema,
		);
		const first = s.settingsSavedAt as string;
		expect(first).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
		expect(Math.abs(Date.parse(first) - before)).toBeLessThan(60_000);
		expect((await settings()).settingsSavedAt).toBe(first);
		await new Promise((r) => setTimeout(r, 20));
		const second = ok(
			await putSettings({ surchargeRate: "0" }),
			200,
			api.PutSettingsResponseSchema,
		).settingsSavedAt as string;
		expect(Date.parse(second)).toBeGreaterThan(Date.parse(first));
	});

	it("a repeated disclaimer acceptance leaves it alone", async () => {
		const stamp = (await settings()).settingsSavedAt;
		await new Promise((r) => setTimeout(r, 20));
		ok(
			await putSettings({ disclaimerAccepted: true }),
			200,
			api.PutSettingsResponseSchema,
		);
		expect((await settings()).settingsSavedAt).toBe(stamp);
	});

	it("a client-sent settingsSavedAt is rejected and changes nothing", async () => {
		const stamp = (await settings()).settingsSavedAt;
		fail(
			await putSettings({ settingsSavedAt: "2020-01-01T00:00:00.000Z" }),
			400,
			"validation_error",
		);
		expect((await settings()).settingsSavedAt).toBe(stamp);
	});
});

describe("final: demo tax years and includesDemoData", () => {
	beforeAll(async () => {
		await wipe();
	});

	it("POST and GET both name the year that holds the sample rows", async () => {
		const loaded = ok(
			await call("POST", "/api/demo"),
			201,
			api.DemoLoadResponseSchema,
		);
		expect(loaded.taxYears).toEqual([DEMO_YEAR]);
		const status = await demoStatus();
		expect(status.taxYears).toEqual([DEMO_YEAR]);
		expect(status.importIds).toEqual(loaded.importIds);
	});

	it("the year holding the sample is labelled; a carry-over-only year is not", async () => {
		expect((await compute(DEMO_YEAR)).includesDemoData).toBe(true);
		const next = await compute("2026-27");
		expect(next.scheduleVdaRows).toEqual([]);
		expect(next.includesDemoData).toBe(false);
		expect((await getReport("2026-27")).includesDemoData).toBe(false);
		for (const format of FORMATS)
			expect(await exportText(format, "full", "2026-27")).not.toContain(
				SAMPLE_LABEL,
			);
	});

	it("taxYears follows the active sample rows only", async () => {
		expect((await call("DELETE", "/api/demo")).status).toBe(204);
		expect((await demoStatus()).taxYears).toEqual([]);
	});
});

describe("final: stale reports and ?allowMissing", () => {
	const reportState = async () =>
		ok(
			await call("GET", `/api/reports/${DEMO_YEAR}?allowMissing=true`),
			200,
			api.GetReportStateResponseSchema,
		);
	const ethBuy = (timestamp: string) =>
		addManual({
			timestamp,
			type: "buy",
			assetIn: "ETH",
			amountIn: "1",
			inrValue: "200000",
			inrRateSource: "manual",
		});
	const expectCurrent = async () => {
		const plain = await getReport();
		expect(plain).not.toHaveProperty("stale");
		expect(await reportState()).not.toHaveProperty("stale");
		expect((await review()).reportStatus).toBe("current");
		return plain;
	};
	const expectStale = async (cause: string) => {
		const missing = fail(
			await call("GET", `/api/reports/${DEMO_YEAR}`),
			404,
			"report_not_computed",
		);
		expect(missing.details).toMatchObject({ cause });
		fail(
			await call("GET", exportUrl("csv", "full")),
			404,
			"report_not_computed",
		);
		const state = await reportState();
		expect(state).toMatchObject({ taxYear: DEMO_YEAR, stale: true });
		const r = await review();
		expect(r.reportStatus).toBe("stale");
		expect(r.reportStatuses).toEqual([{ taxYear: DEMO_YEAR, status: "stale" }]);
		expect(r.computeTaxYears).toEqual([DEMO_YEAR]);
		return { details: missing.details, state };
	};

	beforeAll(async () => {
		dataDir = await restartStack({});
	}, 180_000);

	it("the default tax year on a fresh database is the latest completed year in IST", async () => {
		// Today (IST) is after 31 March 2026, so FY 2025-26 is the latest year that has ended.
		expect(new Date().toISOString() > "2026-03-31T18:30:00.000Z").toBe(true);
		const s = await settings();
		expect(s.defaultTaxYear).toBe("2025-26");
		expect(s.settingsSavedAt).toBeNull();
		const r = await review();
		expect(r.reportStatuses.map((x) => x.taxYear)).toEqual([DEMO_YEAR]);
	});

	it("a never-computed year: plain GET → 404 never_computed, allowMissing → {status:missing}", async () => {
		const missing = fail(
			await call("GET", `/api/reports/${DEMO_YEAR}`),
			404,
			"report_not_computed",
		);
		expect(missing.details).toEqual({
			cause: "never_computed",
			invalidatedAt: null,
		});
		const body = await reportState();
		expect(body).toEqual({
			status: "missing",
			cause: "never_computed",
			invalidatedAt: null,
		});
		expect((await review()).reportStatus).toBe("missing");
	});

	it("with allowMissing=true a current report is returned in full, without stale", async () => {
		await ethBuy("2025-06-01T00:00:00.000Z");
		const computed = await compute(DEMO_YEAR);
		const body = await reportState();
		expect(body).not.toHaveProperty("status");
		expect(body).not.toHaveProperty("stale");
		expect(body).toEqual(await getReport());
		expect((body as typeof computed).totals).toEqual(computed.totals);
	});

	it("a ledger change keeps the last report as stale: allowMissing returns it, GET and exports still 404", async () => {
		const before = await getReport();
		await ethBuy("2025-07-01T00:00:00.000Z");
		const { details, state } = await expectStale("ledger_changed");
		expect(Date.parse(String(details?.invalidatedAt))).not.toBeNaN();
		const { stale: _, ...rest } = state as typeof before & { stale: true };
		expect(rest).toEqual(before);
	});

	it("a second change keeps the first invalidation time", async () => {
		const first = fail(
			await call("GET", `/api/reports/${DEMO_YEAR}`),
			404,
			"report_not_computed",
		).details?.invalidatedAt;
		await new Promise((r) => setTimeout(r, 20));
		await ethBuy("2025-08-01T00:00:00.000Z");
		const { details } = await expectStale("ledger_changed");
		expect(details?.invalidatedAt).toBe(first);
	});

	it("recomputing makes it current again", async () => {
		await compute(DEMO_YEAR);
		await expectCurrent();
	});

	it.each([
		["defaultTaxYear", { defaultTaxYear: "2026-27" }],
		["defaultTaxYear back", { defaultTaxYear: DEMO_YEAR }],
		["ai", { ai: { model: "some-model" } }],
		["prices", { prices: { enabled: true } }],
		["prices off", { prices: { enabled: false } }],
		["an unchanged engine setting", { surchargeRate: "0" }],
	])("saving %s does not make the report stale", async (_, patch) => {
		const before = (await settings()).settingsSavedAt;
		ok(await putSettings(patch), 200, api.PutSettingsResponseSchema);
		expect((await settings()).settingsSavedAt).not.toBe(before);
		await expectCurrent();
	});

	it("a tax-input setting change makes it stale with settings_changed", async () => {
		ok(
			await putSettings({ surchargeRate: "0.10" }),
			200,
			api.PutSettingsResponseSchema,
		);
		await expectStale("settings_changed");
		await compute(DEMO_YEAR);
		await expectCurrent();
	});

	it("an actual-balance change makes it stale with balances_changed", async () => {
		ok(
			await call("PUT", `/api/balances/actual?taxYear=${DEMO_YEAR}`, {
				json: [{ asset: "ETH", amount: "3" }],
			}),
			200,
			api.PutActualBalancesResponseSchema,
		);
		await expectStale("balances_changed");
		await compute(DEMO_YEAR);
		await expectCurrent();
	});

	it("a stale report survives a restart", async () => {
		await ethBuy("2025-09-01T00:00:00.000Z");
		await expectStale("ledger_changed");
		await restartStack({}, dataDir);
		await expectStale("ledger_changed");
	}, 180_000);

	it.each(["false", "1", "yes", ""])(
		"allowMissing=%s → 400 validation_error",
		async (value) => {
			fail(
				await call("GET", `/api/reports/${DEMO_YEAR}?allowMissing=${value}`),
				400,
				"validation_error",
			);
		},
	);
});

describe("final: review resolutions", () => {
	type Review = Awaited<ReturnType<typeof review>>;
	let saleId = "";
	let reportBefore: Awaited<ReturnType<typeof compute>>;

	const resolve = async (body: Record<string, unknown>) =>
		ok(
			await call("POST", "/api/review/resolve", {
				json: { taxYear: DEMO_YEAR, ...body },
			}),
			200,
			api.ResolveReviewResponseSchema,
		).resolved;
	const shape = (r: Review) =>
		r.groups.map((g) => [
			g.code,
			g.severity,
			g.count,
			g.items.map((tx) => tx.id).sort(),
			g.reportItems.map((i) => i.message).sort(),
		]);
	const group = (r: Review, code: string) =>
		r.groups.find((g) => g.code === code && g.severity === "action");
	const taxFigures = (r: Awaited<ReturnType<typeof compute>>) => ({
		totals: r.totals,
		rows: r.scheduleVdaRows,
		tds: r.tds,
		unresolved: r.unresolved,
		incomplete: r.incomplete,
		warnings: r.warnings.map((w) => [w.code, w.message]).sort(),
	});

	beforeAll(async () => {
		await wipe();
		await importSample(ORDER_HISTORY_SAMPLE);
		reportBefore = await compute(DEMO_YEAR);
		const r = await review();
		saleId = group(r, "tds_not_deducted")?.items[0]?.id ?? "";
		expect(saleId).not.toBe("");
	});

	it("starts with 4 action and 4 info items", async () => {
		const r = await review();
		expect(r.totals).toEqual({ action: 4, info: 4 });
		expect(r.groups.map((g) => [g.code, g.severity, g.count]).sort()).toEqual([
			["ca_verification_pending", "info", 1],
			["fee_review_required", "action", 1],
			["missing_history", "action", 2],
			["parse_warning", "info", 3],
			["tds_not_deducted", "action", 1],
		]);
	});

	it("resolving one transaction drops it from Review and from totals at once", async () => {
		expect(
			await resolve({
				code: "tds_not_deducted",
				txIds: [saleId],
				note: "Paid via exchange",
			}),
		).toBe(1);
		const r = await review();
		expect(group(r, "tds_not_deducted")).toBeUndefined();
		expect(r.totals).toEqual({ action: 3, info: 4 });
	});

	it("checking items changes neither the tax figures nor the report's freshness", async () => {
		const plain = await getReport();
		expect(plain).not.toHaveProperty("stale");
		expect(taxFigures(plain)).toEqual(taxFigures(reportBefore));
		expect((await review()).reportStatus).toBe("current");
		expect(
			plain.warnings.some((w) => w.code === "tds_not_deducted"),
			"the computed warning stays in the report",
		).toBe(true);
	});

	it("resolving a whole group covers report items without a transaction", async () => {
		expect(await resolve({ code: "missing_history" })).toBe(2);
		expect(await resolve({ code: "parse_warning" })).toBe(3);
		const r = await review();
		expect(group(r, "missing_history")).toBeUndefined();
		expect(r.groups.map((g) => g.code)).not.toContain("parse_warning");
		expect(r.totals).toEqual({ action: 1, info: 1 });
	});

	it("PATCH resolveFlags records the same durable acknowledgement", async () => {
		ok(
			await call("PATCH", `/api/transactions/${saleId}`, {
				json: { resolveFlags: ["fee_review_required"] },
			}),
			200,
			api.PatchTransactionResponseSchema,
		);
		const r = await review();
		expect(r.totals).toEqual({ action: 0, info: 1 });
		expect(r.groups.map((g) => g.code)).toEqual(["ca_verification_pending"]);
	});

	it("every acknowledgement survives an unchanged recompute and a restart", async () => {
		const before = shape(await review());
		const again = await compute(DEMO_YEAR);
		expect(taxFigures(again)).toEqual(taxFigures(reportBefore));
		expect(shape(await review())).toEqual(before);
		await compute(DEMO_YEAR);
		await restartStack({}, dataDir);
		expect(shape(await review())).toEqual(before);
		expect((await review()).totals).toEqual({ action: 0, info: 1 });
	}, 180_000);

	it("resolving again, or resolving rows that are not in the group, resolves 0", async () => {
		expect(await resolve({ code: "missing_history" })).toBe(0);
		expect(
			await resolve({ code: "tds_not_deducted", txIds: ["no-such-tx"] }),
		).toBe(0);
		expect(await resolve({ code: "suspected_spam" })).toBe(0);
		expect((await review()).totals).toEqual({ action: 0, info: 1 });
	});

	it("a new item in a checked group reappears; the checked ones stay checked", async () => {
		await addManual({
			timestamp: "2025-11-01T00:00:00.000Z",
			type: "sell",
			assetOut: "SOL",
			amountOut: "2",
			inrValue: "30000",
			inrRateSource: "manual",
		});
		await compute(DEMO_YEAR);
		const r = await review();
		const missing = group(r, "missing_history");
		expect(missing?.reportItems.map((i) => i.message).sort()).toEqual([
			"Negative SOL holding: -2",
			"Unresolved 2 SOL: missing_history.",
		]);
		expect(r.totals.action).toBeGreaterThanOrEqual(2);
		expect(
			missing?.reportItems.some((i) => i.message.includes("USDT")),
			"the checked USDT items stay checked",
		).toBe(false);
		expect(
			group(r, "tds_not_deducted")?.items.map((tx) => tx.id),
		).not.toContain(saleId);
	});

	it("a changed item reappears: editing the checked sale's value brings its flags back", async () => {
		const sale = (await allTx()).find((tx) => tx.id === saleId);
		ok(
			await call("PATCH", `/api/transactions/${saleId}`, {
				json: { inrValue: "91000" },
			}),
			200,
			api.PatchTransactionResponseSchema,
		);
		await compute(DEMO_YEAR);
		const r = await review();
		expect(
			group(r, "tds_not_deducted")?.items.map((tx) => tx.id),
			JSON.stringify(sale?.inrValue),
		).toContain(saleId);
	});

	it("an item that disappears on a recompute needs a fresh check when it returns", async () => {
		await resolve({ code: "missing_history" });
		expect(group(await review(), "missing_history")).toBeUndefined();
		const cover = await addManual({
			timestamp: "2025-05-01T00:00:00.000Z",
			type: "buy",
			assetIn: "SOL",
			amountIn: "2",
			inrValue: "20000",
			inrRateSource: "manual",
		});
		await compute(DEMO_YEAR);
		expect((await call("DELETE", `/api/transactions/${cover.id}`)).status).toBe(
			204,
		);
		await compute(DEMO_YEAR);
		expect(
			group(await review(), "missing_history")?.reportItems.map(
				(i) => i.message,
			),
		).toContain("Unresolved 2 SOL: missing_history.");
	});

	// P4-API-1: the acknowledgement is fingerprinted against the row before the edit, so the edit
	// itself makes the flag "changed" and it comes straight back. The Inspect drawer sends both at once.
	it("P4-API-1: PATCH that edits the value and resolves a flag in one request keeps it resolved", async () => {
		const sale = await addManual({
			timestamp: "2025-12-15T00:00:00.000Z",
			type: "sell",
			assetOut: "SOL",
			amountOut: "1",
			inrValue: "15000",
			inrRateSource: "manual",
			reviewFlags: [{ code: "parse_warning", message: "Check this value." }],
		});
		const flagged = (await review()).groups.find(
			(g) => g.code === "parse_warning" && g.severity === "action",
		);
		expect(flagged?.items.map((tx) => tx.id)).toContain(sale.id);
		const up = ok(
			await call("PATCH", `/api/transactions/${sale.id}`, {
				json: { inrValue: "16000", resolveFlags: ["parse_warning"] },
			}),
			200,
			api.PatchTransactionResponseSchema,
		);
		const after = (await review()).groups.find(
			(g) => g.code === "parse_warning" && g.severity === "action",
		);
		expect(
			after?.items.map((tx) => tx.id) ?? [],
			"still listed in Review",
		).not.toContain(sale.id);
		expect(up.reviewFlags.map((f) => f.code)).not.toContain("parse_warning");
	});

	it.each([
		["an unknown code", { code: "nope" }],
		["a bad tax year", { code: "missing_history", taxYear: "2025" }],
		["an unknown key", { code: "missing_history", force: true }],
		[
			"a note over 500 characters",
			{ code: "missing_history", note: "x".repeat(501) },
		],
		["txIds that is not an array", { code: "missing_history", txIds: "a" }],
	])("%s → 400 validation_error", async (_, body) => {
		fail(
			await call("POST", "/api/review/resolve", {
				json: { taxYear: DEMO_YEAR, ...body },
			}),
			400,
			"validation_error",
		);
	});

	// Like GET /api/review, resolve accepts any well-formed year; one without rules has nothing to check.
	it("a year without rules resolves 0 and changes nothing", async () => {
		const before = (await review()).totals;
		expect(await resolve({ taxYear: "2019-20", code: "missing_history" })).toBe(
			0,
		);
		expect((await review()).totals).toEqual(before);
	});

	it("resolutions are kept per tax year", async () => {
		const other = await call("GET", "/api/review?taxYear=2026-27");
		expect(other.status).toBe(200);
		expect(
			await resolve({ code: "missing_history", taxYear: "2026-27" }),
		).toBeGreaterThanOrEqual(0);
		expect(
			group(await review(), "missing_history")?.reportItems.length,
		).toBeGreaterThan(0);
	});
});

describe("final: source labels and the pending-recipe note", () => {
	const RECIPE_NAME = "Examples generic exchange";
	const GENERIC = "generic-unknown-exchange.SYNTHETIC.csv";
	let pendingId = "";

	beforeAll(async () => {
		await wipe();
		await importSample(ORDER_HISTORY_SAMPLE);
		await importOk(
			readFileSync(join(ROOT, "examples/coindcx-trade-report.SYNTHETIC.csv")),
			"coindcx-trade-report.SYNTHETIC.csv",
			{ source: "auto", timezone: "IST" },
		);
		pendingId = ok(
			await upload(readFileSync(join(ROOT, "examples", GENERIC)), GENERIC, {
				source: "auto",
				timezone: "IST",
			}),
			201,
			api.CreateImportResponseSchema,
		).id;
		await compute(DEMO_YEAR);
	});

	it("a file waiting for a mapping is reported in plain words", async () => {
		const r = await review();
		const pending = r.groups.find((g) => g.code === "import_incomplete");
		expect(pending?.severity).toBe("action");
		expect(pending?.reportItems.map((i) => i.message)).toEqual([
			`${GENERIC} is still waiting for a column mapping — open Imports → Map columns, or delete it.`,
		]);
		const text = JSON.stringify(r);
		expect(text).not.toContain("pending_recipe");
		expect(text).not.toMatch(/excluded rows/);
		const report = await getReport();
		expect(report.warnings.map((w) => w.message)).toContain(
			`${GENERIC} is still waiting for a column mapping — open Imports → Map columns, or delete it.`,
		);
	});

	it("review and transaction rows carry a readable sourceLabel", async () => {
		const r = await review();
		const labels = new Set(
			r.groups.flatMap((g) => g.items.map((tx) => [tx.source, tx.sourceLabel])),
		);
		for (const [source, label] of labels)
			expect(label, String(source)).toBe(
				{ binance: "Binance", coindcx: "CoinDCX" }[String(source)],
			);
		const tx = await listTxLabels();
		expect(tx.get("binance")).toBe("Binance");
		expect(tx.get("coindcx")).toBe("CoinDCX");
	});

	it("TDS rows carry sourceLabel next to the source id", async () => {
		const report = await getReport();
		const bySource = Object.fromEntries(
			report.tds.bySource.map((s) => [s.source, s.sourceLabel]),
		);
		expect(bySource).toMatchObject({ binance: "Binance", coindcx: "CoinDCX" });
	});

	it("a generic CSV with a saved recipe is labelled 'Generic CSV · <recipe name>'", async () => {
		await useMockAi();
		const recipe = {
			id: `examples-generic-label-${Date.now()}`,
			name: RECIPE_NAME,
			version: 1,
			fingerprint: await fingerprintOf(pendingId),
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
			timezone: "IST",
			sideMap: { Buy: "buy", Sell: "sell" },
			signStyle: "side_column",
			pairSplit: { knownQuotes: ["INR"] },
		};
		ok(
			await call("POST", `/api/imports/${pendingId}/confirm`, {
				json: { recipe, saveRecipe: true },
			}),
			200,
			api.ConfirmImportResponseSchema,
		);
		const report = await compute(DEMO_YEAR);
		const generic = report.tds.bySource.find((s) =>
			s.source.startsWith("csv:"),
		);
		expect(generic?.sourceLabel).toBe(`Generic CSV · ${RECIPE_NAME}`);
		expect((await listTxLabels()).get(generic?.source ?? "")).toBe(
			`Generic CSV · ${RECIPE_NAME}`,
		);
		expect(
			(await review()).groups.some((g) => g.code === "import_incomplete"),
		).toBe(false);
		const tds = await exportText("csv", "tds");
		expect(tds).toContain(`Generic CSV · ${RECIPE_NAME}`);
		expect(tds).not.toMatch(/csv:[0-9a-f]{64}/);
	});

	it("without the saved recipe the label falls back to 'Generic CSV'", async () => {
		const recipes = ok(
			await call("GET", "/api/recipes"),
			200,
			api.ListRecipesResponseSchema,
		);
		for (const r of recipes)
			await call("DELETE", `/api/recipes/${encodeURIComponent(r.id)}`);
		const labels = await listTxLabels();
		const generic = [...labels].find(([source]) => source.startsWith("csv:"));
		expect(generic?.[1]).toBe("Generic CSV");
	});
});

async function listTxLabels() {
	const rows = ok(
		await call("GET", "/api/transactions?pageSize=200"),
		200,
		api.ListTransactionsResponseSchema,
	).items;
	return new Map(rows.map((tx) => [tx.source, tx.sourceLabel ?? ""]));
}

describe("final: incomplete reports and exports", () => {
	beforeAll(async () => {
		await wipe();
		await addManual({
			timestamp: "2025-06-01T00:00:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "1",
			inrValue: "200000",
			inrRateSource: "manual",
		});
		await addManual({
			timestamp: "2025-09-01T00:00:00.000Z",
			type: "sell",
			assetOut: "ETH",
			amountOut: "1",
			inrValue: "250000",
			inrRateSource: "manual",
		});
		await addManual({
			timestamp: "2025-10-01T00:00:00.000Z",
			type: "sell",
			assetOut: "SOL",
			amountOut: "2",
			inrValue: "30000",
			inrRateSource: "manual",
		});
	});

	it("an unresolved sale is kept out of scheduleVdaRows and marks the report incomplete", async () => {
		const report = await compute(DEMO_YEAR);
		expect(report.incomplete).toBe(true);
		expect(report.unresolved.map((u) => u.asset)).toEqual(["SOL"]);
		expect(report.scheduleVdaRows.map((r) => r.asset)).toEqual(["ETH"]);
		for (const row of report.scheduleVdaRows) expect(row.income).not.toBeNull();
		expect(report.totals.consideration).toBe("250000.00");
		expect((await getReport()).scheduleVdaRows).toEqual(report.scheduleVdaRows);
	});

	it.each(FORMATS)(
		"%s full export says Incomplete and prints Incomplete for net payable",
		async (format) => {
			const text = await exportText(format, "full");
			expect(text).toContain(INCOMPLETE_LABEL);
			if (format === "csv") {
				const rows = parseCsv(
					(await call("GET", exportUrl("csv", "full"))).text,
				);
				const header = rows.findIndex((r) => r.includes("netPayable"));
				expect(header).toBeGreaterThan(-1);
				const col = (rows[header] as string[]).indexOf("netPayable");
				expect(rows[header + 1]?.[col]).toBe("Incomplete");
			}
		},
	);

	it.each(["schedule-vda", "tds", "income"])(
		"csv %s export carries the Incomplete label",
		async (kind) => {
			expect(await exportText("csv", kind)).toContain(INCOMPLETE_LABEL);
		},
	);

	it("schedule-vda CSV uses the ITR column titles, numbers rows and has no trail", async () => {
		const rows = parseCsv(
			(await call("GET", exportUrl("csv", "schedule-vda"))).text,
		);
		const header = rows.findIndex((r) => r[0] === "Sl. No.");
		expect(rows[header]).toEqual(ITR_HEADER);
		const body = rows.slice(header + 1).filter((r) => r.some((c) => c !== ""));
		expect(body).toEqual([
			[
				"1",
				"2025-06-01",
				"2025-09-01",
				"Capital Gain",
				"200000.00",
				"250000.00",
				"50000.00",
			],
		]);
		const flat = rows.flat().join("\n");
		expect(flat).not.toMatch(/\btrail\b|dateOfAcquisition|costOfAcquisition/);
		expect(flat).not.toContain("SOL");
	});

	it("schedule-vda XLSX uses the ITR column titles and has no trail", async () => {
		const text = await exportText("xlsx", "schedule-vda");
		for (const title of ITR_HEADER) expect(text).toContain(title);
		expect(text).not.toMatch(/\btrail\b|dateOfAcquisition/);
	});

	it("the full export keeps the trail column", async () => {
		for (const format of FORMATS)
			expect(await exportText(format, "full"), format).toContain("trail");
	});

	it("a complete report has no incomplete flag or label", async () => {
		await addManual({
			timestamp: "2025-05-01T00:00:00.000Z",
			type: "buy",
			assetIn: "SOL",
			amountIn: "2",
			inrValue: "20000",
			inrRateSource: "manual",
		});
		const report = await compute(DEMO_YEAR);
		expect(report.incomplete).toBe(false);
		expect(report.unresolved).toEqual([]);
		expect(report.scheduleVdaRows).toHaveLength(2);
		for (const format of FORMATS)
			expect(await exportText(format, "full"), format).not.toContain(
				"Incomplete",
			);
	});
});

describe("final: TDS venue names", () => {
	beforeAll(async () => {
		await wipe();
		await call("POST", "/api/demo");
		await addManual({
			timestamp: "2025-06-01T00:00:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "1",
			inrValue: "200000",
			inrRateSource: "manual",
		});
	});
	afterAll(async () => {
		await call("DELETE", "/api/demo");
	});

	it("the checklist names each venue for people, while bySource keeps the ids", async () => {
		const report = await compute(DEMO_YEAR);
		const sources = report.tds.bySource.map((s) => s.source).sort();
		expect(sources).toEqual(["binance", "coindcx"]);
		const prefixes = report.tds.checklist.map((line) => line.split(":")[0]);
		expect(prefixes).toEqual(["Binance", "CoinDCX"]);
		for (const line of report.tds.checklist)
			expect(line, line).not.toMatch(/^(binance|coindcx|evm:\d+|manual):/);
		for (const format of FORMATS) {
			const text = await exportText(format, "tds");
			expect(text).toContain("Binance: match ledger TDS");
			expect(text).toContain("CoinDCX: match ledger TDS");
			expect(text).not.toMatch(/^(binance|coindcx|evm:\d+|manual): /m);
		}
	});
});

describe("final: examples/ files", () => {
	const EXAMPLES = join(ROOT, "examples");
	const native = [
		["binance-spot-trade-history.SYNTHETIC.csv", "UTC", "binance"],
		["binance-deposit-history.SYNTHETIC.csv", "UTC", "binance"],
		["binance-withdrawal-history.SYNTHETIC.csv", "UTC", "binance"],
		["coindcx-trade-report.SYNTHETIC.csv", "IST", "coindcx"],
	] as const;

	beforeAll(async () => {
		await wipe();
	});

	it.each(native)(
		"%s imports with 0 errors as %s",
		async (name, timezone, source) => {
			const imp = await importOk(readFileSync(join(EXAMPLES, name)), name, {
				source: "auto",
				timezone,
			});
			expect(imp.status, JSON.stringify(imp)).toBe("imported");
			expect(imp.source).toBe(source);
			expect(imp.rowsError).toBe(0);
			expect(imp.rowsInserted).toBe(imp.rowsRead);
			expect(imp.rowsInserted).toBeGreaterThan(0);
		},
	);

	it("the generic file imports with the README's recipe and 0 errors", async () => {
		const name = "generic-unknown-exchange.SYNTHETIC.csv";
		const pending = ok(
			await upload(readFileSync(join(EXAMPLES, name)), name, {
				source: "auto",
				timezone: "IST",
			}),
			201,
			api.CreateImportResponseSchema,
		);
		expect(pending.status).toBe("pending_recipe");
		await useMockAi();
		const recipe = {
			id: `examples-generic-${Date.now()}`,
			name: "Examples generic exchange",
			version: 1,
			fingerprint: await fingerprintOf(pending.id),
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
			timezone: "IST",
			sideMap: { Buy: "buy", Sell: "sell" },
			signStyle: "side_column",
			pairSplit: { knownQuotes: ["INR"] },
		};
		const done = ok(
			await call("POST", `/api/imports/${pending.id}/confirm`, {
				json: { recipe, saveRecipe: false },
			}),
			200,
			api.ConfirmImportResponseSchema,
		);
		expect(done.rowsError).toBe(0);
		expect(done.rowsInserted).toBe(3);
	});

	it("re-importing an example is idempotent", async () => {
		const [name, timezone] = native[3];
		const again = await importOk(readFileSync(join(EXAMPLES, name)), name, {
			source: "auto",
			timezone,
		});
		expect(again.rowsInserted).toBe(0);
		expect(again.rowsDuplicate).toBe(again.rowsRead);
	});

	it("together they give a FY 2025-26 report", async () => {
		const report = await compute(DEMO_YEAR);
		expect(report.taxYear).toBe(DEMO_YEAR);
		expect(report.scheduleVdaRows.length).toBeGreaterThan(0);
		expect(report.includesDemoData).toBe(false);
		expect(Number(report.totals.tdsCredit)).toBeGreaterThan(0);
		const csvRows = parseCsv(
			(await call("GET", exportUrl("csv", "schedule-vda"))).text,
		);
		expect(csvRows.find((r) => r[0] === "Sl. No.")).toEqual(ITR_HEADER);
	});
});

// Release candidate (f61fc10): import labels, duplicate pending uploads, deleted rows, TDS still due.
const GENERIC_EXAMPLE = "generic-unknown-exchange.SYNTHETIC.csv";
const genericBytes = () =>
	readFileSync(join(ROOT, "examples", GENERIC_EXAMPLE));

async function uploadGeneric(fileName = GENERIC_EXAMPLE) {
	return ok(
		await upload(genericBytes(), fileName, { source: "auto", timezone: "IST" }),
		201,
		api.CreateImportResponseSchema,
	);
}

async function genericRecipe(importId: string, name: string) {
	return {
		id: `rc-${name.toLowerCase().replaceAll(" ", "-")}-${Date.now()}`,
		name,
		version: 1,
		fingerprint: await fingerprintOf(importId),
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
		timezone: "IST",
		sideMap: { Buy: "buy", Sell: "sell" },
		signStyle: "side_column",
		pairSplit: { knownQuotes: ["INR"] },
	};
}

async function confirmGeneric(
	importId: string,
	name: string,
	saveRecipe: boolean,
) {
	return ok(
		await call("POST", `/api/imports/${importId}/confirm`, {
			json: { recipe: await genericRecipe(importId, name), saveRecipe },
		}),
		200,
		api.ConfirmImportResponseSchema,
	);
}

async function importDetail(id: string) {
	return ok(
		await call("GET", `/api/imports/${id}`),
		200,
		api.GetImportResponseSchema,
	);
}

describe("rc: sourceLabel on import summaries and details", () => {
	const RECIPE = "RC Example Exchange";
	let binanceId = "";
	let coindcxId = "";
	let genericId = "";

	beforeAll(async () => {
		await wipe();
		binanceId = (await importSample(ORDER_HISTORY_SAMPLE)).id;
		coindcxId = (
			await importOk(
				readFileSync(join(ROOT, "examples/coindcx-trade-report.SYNTHETIC.csv")),
				"coindcx-trade-report.SYNTHETIC.csv",
				{ source: "auto", timezone: "IST" },
			)
		).id;
	});

	it("native imports are labelled by venue in the list and the detail", async () => {
		const list = new Map((await imports()).map((i) => [i.id, i.sourceLabel]));
		expect(list.get(binanceId)).toBe("Binance");
		expect(list.get(coindcxId)).toBe("CoinDCX");
		expect((await importDetail(binanceId)).sourceLabel).toBe("Binance");
		expect((await importDetail(coindcxId)).sourceLabel).toBe("CoinDCX");
	});

	it("a generic file waiting for a mapping is 'Generic CSV' on create, list and detail", async () => {
		const created = await uploadGeneric();
		genericId = created.id;
		expect(created.status).toBe("pending_recipe");
		expect(created.sourceLabel).toBe("Generic CSV");
		expect((await imports()).find((i) => i.id === genericId)?.sourceLabel).toBe(
			"Generic CSV",
		);
		expect((await importDetail(genericId)).sourceLabel).toBe("Generic CSV");
	});

	it("confirming with a saved recipe names it on confirm, list and detail, never as csv:<hash>", async () => {
		const confirmed = await confirmGeneric(genericId, RECIPE, true);
		const label = `Generic CSV · ${RECIPE}`;
		expect(confirmed.sourceLabel).toBe(label);
		expect((await imports()).find((i) => i.id === genericId)?.sourceLabel).toBe(
			label,
		);
		const detail = await importDetail(genericId);
		expect(detail.sourceLabel).toBe(label);
		expect(JSON.stringify(await imports())).not.toMatch(/"sourceLabel":"csv:/);
	});

	it("confirming without saving the recipe still names the recipe used", async () => {
		await wipe();
		const pending = await uploadGeneric();
		const confirmed = await confirmGeneric(pending.id, "RC Unsaved", false);
		expect(confirmed.status).toBe("imported");
		expect(confirmed.sourceLabel).toBe("Generic CSV · RC Unsaved");
		expect((await importDetail(pending.id)).sourceLabel).toBe(
			"Generic CSV · RC Unsaved",
		);
	});

	it("every sample-data import has a readable label", async () => {
		await wipe();
		ok(await call("POST", "/api/demo"), 201, api.DemoLoadResponseSchema);
		const labels = (await imports()).map((i) => i.sourceLabel);
		expect(labels.length).toBeGreaterThan(0);
		for (const label of labels) {
			expect(label, String(label)).toBeTruthy();
			expect(label, String(label)).not.toMatch(/^(csv|evm):/);
		}
		await call("DELETE", "/api/demo");
	});
});

describe("rc: R9 identical unmapped uploads reuse the pending import", () => {
	beforeAll(async () => {
		await wipe();
	});

	it("the same bytes uploaded again, even under another name, return the pending import", async () => {
		const first = await uploadGeneric();
		const again = await uploadGeneric();
		const renamed = await uploadGeneric("renamed-copy.csv");
		expect(again.id).toBe(first.id);
		expect(renamed.id).toBe(first.id);
		expect(renamed.fileName).toBe(GENERIC_EXAMPLE);
		expect(await imports()).toHaveLength(1);
	});

	it("concurrent identical uploads create one import", async () => {
		await wipe();
		const results = await Promise.all(
			[1, 2, 3].map(() =>
				upload(genericBytes(), GENERIC_EXAMPLE, {
					source: "auto",
					timezone: "IST",
				}),
			),
		);
		const ids = results.map(
			(res) => ok(res, 201, api.CreateImportResponseSchema).id,
		);
		expect(new Set(ids).size).toBe(1);
		expect(await imports()).toHaveLength(1);
		expect((await imports())[0]?.status).toBe("pending_recipe");
	});

	it("different bytes still make a new pending import", async () => {
		const changed = Buffer.concat([genericBytes(), Buffer.from("\n")]);
		const other = ok(
			await upload(changed, "changed.csv", { source: "auto", timezone: "IST" }),
			201,
			api.CreateImportResponseSchema,
		);
		expect(other.status).toBe("pending_recipe");
		expect(await imports()).toHaveLength(2);
		await call("DELETE", `/api/imports/${other.id}`);
	});

	it("once mapped, the same file uploaded again is a new import whose rows are all duplicates", async () => {
		const [pending] = await imports();
		const confirmed = await confirmGeneric(
			pending?.id ?? "",
			"RC Reuse",
			false,
		);
		expect(confirmed.rowsInserted).toBeGreaterThan(0);
		const next = await uploadGeneric();
		expect(next.id).not.toBe(confirmed.id);
		expect(next.status).toBe("pending_recipe");
		const second = await confirmGeneric(next.id, "RC Reuse", false);
		expect(second.rowsInserted).toBe(0);
		expect(second.rowsDuplicate).toBe(confirmed.rowsInserted);
	});

	it("a native file uploaded twice is not merged: the second import is all duplicates", async () => {
		await wipe();
		const first = await importSample(ORDER_HISTORY_SAMPLE);
		const second = await importSample(ORDER_HISTORY_SAMPLE);
		expect(second.id).not.toBe(first.id);
		expect(second.rowsInserted).toBe(0);
		expect(second.rowsDuplicate).toBe(first.rowsInserted);
	});
});

describe("rc: Review items of deleted rows in a stale report", () => {
	let saleId = "";
	let keptId = "";
	const reportItems = (r: Awaited<ReturnType<typeof review>>) =>
		r.groups.flatMap((g) =>
			g.reportItems.map((item) => ({ ...item, code: g.code })),
		);

	beforeAll(async () => {
		await wipe();
		saleId = (
			await addManual({
				timestamp: "2025-09-01T00:00:00.000Z",
				type: "sell",
				assetOut: "SOL",
				amountOut: "2",
				inrValue: "30000",
				inrRateSource: "manual",
				reviewFlags: [
					{ code: "parse_warning", message: "RC check the value." },
				],
			})
		).id;
		keptId = (
			await addManual({
				timestamp: "2025-10-01T00:00:00.000Z",
				type: "sell",
				assetOut: "ADA",
				amountOut: "5",
				inrValue: "1000",
				inrRateSource: "manual",
				reviewFlags: [{ code: "parse_warning", message: "RC kept row." }],
			})
		).id;
		await compute(DEMO_YEAR);
	});

	it("a current report never marks rowDeleted", async () => {
		const r = await review();
		expect(r.reportStatus).toBe("current");
		expect(JSON.stringify(r)).not.toContain('"rowDeleted"');
	});

	it("after deleting a row, its warning and unresolved items say so and link nowhere", async () => {
		expect((await call("DELETE", `/api/transactions/${saleId}`)).status).toBe(
			204,
		);
		const r = await review();
		expect(r.reportStatus).toBe("stale");
		const deleted = reportItems(r).filter((item) => item.rowDeleted);
		expect(deleted.map((item) => [item.kind, item.code]).sort()).toEqual(
			expect.arrayContaining([
				["unresolved", "missing_history"],
				["warning", "parse_warning"],
			]),
		);
		for (const item of deleted) {
			expect(item.message, item.message).toMatch(/\(rows? deleted\)$/);
			if (item.kind === "warning") {
				expect(item.warning.txId).toBeUndefined();
				expect(item.warning.txIds).toBeUndefined();
			}
		}
		const parse = deleted.find(
			(item) => item.kind === "warning" && item.code === "parse_warning",
		);
		expect(parse?.message).toBe("RC check the value. (row deleted)");
		for (const g of r.groups)
			expect(g.items.map((tx) => tx.id)).not.toContain(saleId);
	});

	it("items of rows that still exist are not marked", async () => {
		const r = await review();
		const kept = reportItems(r).filter(
			(item) =>
				(item.kind === "warning" && item.warning.txIds?.includes(keptId)) ||
				(item.kind === "unresolved" && item.unresolved.txId === keptId),
		);
		expect(kept.length).toBeGreaterThan(0);
		for (const item of kept) {
			expect(item.rowDeleted).toBeUndefined();
			expect(item.message).not.toContain("deleted)");
		}
	});

	it("a recompute drops the deleted row's items", async () => {
		await compute(DEMO_YEAR);
		const r = await review();
		expect(r.reportStatus).toBe("current");
		expect(JSON.stringify(r)).not.toContain('"rowDeleted"');
		expect(JSON.stringify(r)).not.toContain(saleId);
	});
});

describe("rc: TDS remainingDueInr and the TDS export", () => {
	type Report = Awaited<ReturnType<typeof compute>>;
	let report: Report;

	beforeAll(async () => {
		await wipe();
		await importSample(ORDER_HISTORY_SAMPLE);
		await importOk(
			readFileSync(join(ROOT, "examples/coindcx-trade-report.SYNTHETIC.csv")),
			"coindcx-trade-report.SYNTHETIC.csv",
			{ source: "auto", timezone: "IST" },
		);
		await addManual({
			timestamp: "2025-06-01T00:00:00.000Z",
			type: "buy",
			assetIn: "ETH",
			amountIn: "2",
			inrValue: "200000",
			inrRateSource: "manual",
		});
		await addManual({
			timestamp: "2025-09-01T00:00:00.000Z",
			type: "sell",
			assetOut: "ETH",
			amountOut: "1",
			inrValue: "200000",
			tdsInr: "500",
			inrRateSource: "manual",
		});
		report = await compute(DEMO_YEAR);
	});

	it("every source carries remainingDueInr = max(0, possiblyDueInr − tdsInr), to the paisa", () => {
		expect(report.tds.bySource.length).toBeGreaterThanOrEqual(3);
		for (const row of report.tds.bySource) {
			const shortfall = D(row.possiblyDueInr).minus(row.tdsInr);
			expect(row.remainingDueInr, row.source).toBe(
				roundInr(shortfall.gt(0) ? shortfall : 0),
			);
		}
	});

	it("a partly deducted manual sale owes the rest; a venue that deducted owes nothing", () => {
		const by = new Map(report.tds.bySource.map((row) => [row.source, row]));
		expect(by.get("manual")).toMatchObject({
			tdsInr: "500.00",
			transferValueInr: "200000.00",
			possiblyDueInr: "2000.00",
			remainingDueInr: "1500.00",
		});
		expect(by.get("coindcx")?.remainingDueInr).toBe("0.00");
		const binance = by.get("binance");
		expect(binance?.tdsInr).toBe("0.00");
		expect(binance?.remainingDueInr).toBe(binance?.possiblyDueInr);
	});

	it("a manual sale with TDS deducted gets no tds_not_deducted flag", async () => {
		const r = await review();
		const tds = r.groups.find((g) => g.code === "tds_not_deducted");
		expect(tds?.items.some((tx) => tx.source === "binance")).toBe(true);
		const manualFlagged = tds?.items.filter((tx) => tx.source === "manual");
		expect(manualFlagged ?? []).toEqual([]);
	});

	it("the CSV TDS export carries the gross possiblyDueInr and the remainingDueInr after credit", async () => {
		const res = await call("GET", exportUrl("csv", "tds"));
		expect(res.status).toBe(200);
		const rows = parseCsv(res.text);
		const header = rows.find((row) => row.includes("possiblyDueInr")) ?? [];
		const gross = header.indexOf("possiblyDueInr");
		const remaining = header.indexOf("remainingDueInr");
		const src = header.indexOf("source");
		expect(remaining).toBeGreaterThan(-1);
		for (const row of report.tds.bySource) {
			const line = rows.find((r) => r[src] === row.sourceLabel);
			expect(line?.[gross], row.source).toBe(row.possiblyDueInr);
			expect(line?.[remaining], row.source).toBe(row.remainingDueInr);
		}
	});

	it("the XLSX TDS export holds both the gross and the remaining amount", async () => {
		const cells = (await exportText("xlsx", "tds")).split("\n");
		expect(cells).toContain("possiblyDueInr");
		expect(cells).toContain("remainingDueInr");
		expect(cells).toContain("1500.00");
		expect(cells).toContain("2000.00");
	});

	it("the full export's TDS section agrees", async () => {
		const res = await call("GET", exportUrl("csv", "full"));
		expect(res.status).toBe(200);
		const rows = parseCsv(res.text);
		const header = rows.find((row) => row.includes("remainingDueInr")) ?? [];
		const manualRow = rows.find((r) => r[0] === "Manual");
		expect(manualRow?.[header.indexOf("possiblyDueInr")]).toBe("2000.00");
		expect(manualRow?.[header.indexOf("remainingDueInr")]).toBe("1500.00");
	});
});

describe("final: logged-out page requests (proxy)", () => {
	beforeAll(async () => {
		await restartStack({ APP_PASSWORD: PASSWORD });
	}, 180_000);

	const page = (headers: Record<string, string>, path = "/report") =>
		call("GET", path, { headers });

	it.each([
		["Next-Router-Prefetch: 1", { "Next-Router-Prefetch": "1" }],
		[
			"Next-Router-Segment-Prefetch",
			{ "Next-Router-Segment-Prefetch": "/_tree", RSC: "1" },
		],
		["Purpose: prefetch", { Purpose: "prefetch" }],
		["RSC + Next-Router-Prefetch", { RSC: "1", "Next-Router-Prefetch": "1" }],
	])("a prefetch (%s) → 204 with no body", async (_, headers) => {
		const res = await page(headers);
		expect(res.status).toBe(204);
		expect(res.bytes.length).toBe(0);
		expect(res.headers.get("location")).toBeNull();
		expect(res.headers.get("cache-control")).toContain("no-store");
	});

	it.each([
		["an RSC header", { RSC: "1" }, "/report"],
		["an _rsc query", {}, "/report?_rsc=abc12"],
		["RSC on the root page", { RSC: "1" }, "/"],
	])(
		"an RSC request with %s → 401, not a redirect",
		async (_, headers, path) => {
			const res = await page(headers, path);
			expect(res.status).toBe(401);
			expect(res.headers.get("location")).toBeNull();
			expect(res.headers.get("cache-control")).toContain("no-store");
			expect(res.text).not.toContain("<html");
		},
	);

	it("a document request is redirected to /login with next", async () => {
		const res = await page({ Accept: "text/html" }, "/report?taxYear=2025-26");
		expect([302, 303, 307, 308]).toContain(res.status);
		const location = new URL(res.headers.get("location") ?? "", BASE_URL);
		expect(location.pathname).toBe("/login");
		expect(location.searchParams.get("next")).toBe("/report?taxYear=2025-26");
		expect(res.headers.get("cache-control")).toContain("no-store");
	});

	it("the API still answers 401 JSON without a session", async () => {
		fail(await call("GET", "/api/settings"), 401, "unauthorized");
		fail(
			await call("POST", "/api/review/resolve", {
				json: { code: "missing_history", taxYear: DEMO_YEAR },
			}),
			401,
			"unauthorized",
		);
	});

	it("a cross-origin review resolve is refused even with a session", async () => {
		const cookie = await login();
		const res = await call("POST", "/api/review/resolve", {
			json: { code: "missing_history", taxYear: DEMO_YEAR },
			headers: { cookie, origin: "https://evil.example" },
		});
		expect(res.status).toBe(403);
		const same = await call("POST", "/api/review/resolve", {
			json: { code: "missing_history", taxYear: DEMO_YEAR },
			headers: { cookie },
		});
		expect(same.status).toBe(200);
	});

	// Next itself answers an RSC request whose _rsc hash it did not issue with a 307 to the right one.
	function passedProxy(res: Awaited<ReturnType<typeof page>>) {
		expect([200, 307]).toContain(res.status);
		const location = res.headers.get("location") ?? "";
		expect(location, "auth redirect").not.toMatch(/[?&]next=/);
	}

	it("with a session, RSC, prefetch and document requests pass the proxy", async () => {
		const cookie = await login();
		passedProxy(await page({ RSC: "1", cookie }));
		passedProxy(await page({ RSC: "1", cookie }, "/report?_rsc=abc12"));
		passedProxy(await page({ "Next-Router-Prefetch": "1", RSC: "1", cookie }));
		const doc = await page({ Accept: "text/html", cookie });
		expect(doc.status).toBe(200);
		expect(doc.text).toContain("<html");
	});

	it("/login itself is never redirected to itself or blocked", async () => {
		expect((await page({}, "/login")).status).toBe(200);
		passedProxy(await page({ RSC: "1" }, "/login"));
		passedProxy(await page({ "Next-Router-Prefetch": "1" }, "/login"));
	});
});
