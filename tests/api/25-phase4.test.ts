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
import {
	addManual,
	allTx,
	api,
	BASE_URL,
	call,
	compute,
	csv,
	fail,
	fixture,
	importOk,
	ok,
	putSettings,
	ROOT,
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
			.sort((a, b) => a.id.localeCompare(b.id));
	}

	it("GET reports nothing loaded on a ledger with only real data", async () => {
		expect(await demoStatus()).toEqual({ loaded: false, importIds: [] });
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
		expect(await demoStatus()).toEqual({ loaded: true, importIds: demoIds });
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
		expect(await demoStatus()).toEqual({ loaded: false, importIds: [] });
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
		expect(await demoStatus()).toEqual({ loaded: false, importIds: [] });
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
			live.exec("ALTER TABLE imports DROP COLUMN demo");
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
			const columns = (
				old.prepare("PRAGMA table_info(imports)").all() as { name: string }[]
			).map((c) => c.name);
			expect(columns).not.toContain("demo");
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
		// The simulation dropped the column, so the re-added one starts false for every import.
		expect(list.filter((i) => i.demo).length).toBe(0);
		expect((await demoStatus()).loaded).toBe(false);
	});

	it("a boot with no pending migration makes no new backup", async () => {
		const backups = join(dataDir, "backups");
		const before = readdirSync(backups).sort();
		await restartStack({}, dataDir);
		expect(readdirSync(backups).sort()).toEqual(before);
	}, 180_000);
});
