import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AssetClass,
	DEFAULT_ENGINE_SETTINGS,
	type LedgerTx,
} from "@tax/core";
import type { ImportDetail } from "@tax/core/api";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase, type TaxDatabase } from "../src/index.js";
import { migrateFixtureThrough } from "./migration-fixtures.js";

let directory: string;
let db: TaxDatabase | undefined;
let path: string;
const taxYear = "2025-26";

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "tax-db-equity-"));
	path = join(directory, "tax-tracker.db");
});

afterEach(() => {
	db?.close();
	db = undefined;
	rmSync(directory, { recursive: true, force: true });
});

function restoreCurrentReports() {
	// Invalidation uses the stored tax year and Schedule FA calendar year.
	const sqlite = new Database(path);
	try {
		sqlite.exec(
			"DELETE FROM report_invalidations; DELETE FROM us_equity_report_invalidations;",
		);
		sqlite
			.prepare(
				"INSERT OR IGNORE INTO reports VALUES ('vda', ?, 'now', '{}', '{}')",
			)
			.run(taxYear);
		const insert = sqlite.prepare(
			"INSERT OR IGNORE INTO us_equity_reports VALUES (?, ?, 'now', '{}', ?)",
		);
		insert.run("equity-2025", taxYear, '{"calendarYear":2025}');
		insert.run("equity-2026", "2026-27", '{"calendarYear":2026}');
	} finally {
		sqlite.close();
	}
}

function row(assetClass: AssetClass, importId: string | null = null): LedgerTx {
	const id = randomUUID();
	return {
		id,
		sourceRef: id,
		source: "manual",
		importId,
		timestamp: "2025-10-01T04:00:00.000Z",
		type: "buy",
		assetClass,
		assetIn: assetClass === "vda" ? "BTC" : "AAPL",
		amountIn: "1.00000000000001",
		assetOut: "USD",
		amountOut: "192.09",
		raw: { original: "preserved" },
		reviewFlags: [],
	};
}

function importRow(): ImportDetail {
	return {
		id: randomUUID(),
		source: "generic",
		fileName: "synthetic.csv",
		fileSha256: "sha",
		timezone: "UTC",
		reportKind: null,
		reportKindLabel: null,
		detectedTimezone: null,
		timezoneSource: "user",
		timezoneOrigin: null,
		coverage: [],
		status: "imported",
		rowsRead: 2,
		rowsInserted: 2,
		rowsDuplicate: 0,
		rowsError: 0,
		rowsSkipped: 0,
		skippedRows: [],
		recipeId: null,
		createdAt: "2025-10-01T04:00:00.000Z",
		error: null,
		warnings: [],
		rowErrors: [],
	};
}

it("opens a real pre-Phase 3 database, preserves ledger data and adds the equity schema", async () => {
	const legacy = row("vda");
	const sqlite = new Database(path);
	try {
		migrateFixtureThrough(sqlite, 9);
		sqlite
			.prepare(`
			INSERT INTO transactions
			(id, source, source_ref, timestamp, type, asset_in, amount_in, asset_out, amount_out, raw, flags)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
		`)
			.run(
				legacy.id,
				legacy.source,
				legacy.sourceRef,
				legacy.timestamp,
				legacy.type,
				legacy.assetIn,
				legacy.amountIn,
				legacy.assetOut,
				legacy.amountOut,
				JSON.stringify(legacy.raw),
			);
	} finally {
		sqlite.close();
	}

	db = await openDatabase(directory);
	expect(db.transactions.list({ assetClass: "vda" })).toEqual([legacy]);
	expect(db.transactions.list({ assetClass: "us_equity" })).toEqual([]);
	expect(db.usEquityReports.snapshot(taxYear)).toEqual({
		status: "missing",
		report: undefined,
	});
	expect(db.usEquityReports.missingDetails(taxYear)).toEqual({
		invalidatedAt: null,
		cause: "never_computed",
	});
	expect(db.equityMetadata.list()).toEqual([]);
	expect(db.equityCyPrices.list(2025)).toEqual([]);
	expect(db.usEquityActualBalances.get(taxYear)).toEqual([]);
	expect(readdirSync(join(directory, "backups"))).toEqual([
		expect.stringMatching(/pre-0010_phase3_us_equity\.db$/),
	]);
	const upgraded = new Database(path, { readonly: true });
	try {
		expect(
			upgraded
				.prepare(
					"SELECT name FROM sqlite_schema WHERE name = 'transactions_asset_class'",
				)
				.get(),
		).toEqual({ name: "transactions_asset_class" });
	} finally {
		upgraded.close();
	}
});

it("persists the new transaction fields and isolates insert, update, delete and supersession", async () => {
	db = await openDatabase(directory);
	const importRecord = importRow();
	db.imports.save(importRecord, "us_equity");
	const equity: LedgerTx = {
		...row("us_equity"),
		type: "dividend",
		assetIn: "USD",
		amountIn: "2.10",
		assetOut: undefined,
		amountOut: undefined,
		dividendAsset: "AAPL",
		withholdingTaxAmount: "0.525",
		withholdingTaxAsset: "USD",
		entityName: "Apple Inc.",
		venue: "us_broker",
	};
	const vda = row("vda");
	restoreCurrentReports();
	expect(db.transactions.insert([{ tx: equity }])).toEqual({
		inserted: 1,
		duplicate: 0,
	});
	expect(db.transactions.get(equity.id)).toEqual(equity);
	expect(db.reports.missingDetails(taxYear).cause).toBe("never_computed");
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"ledger_changed",
	);

	restoreCurrentReports();
	expect(db.transactions.insert([{ tx: equity }])).toEqual({
		inserted: 0,
		duplicate: 1,
	});
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"never_computed",
	);
	db.transactions.insert([{ tx: vda }]);
	expect(db.transactions.list({ assetClass: "all" })).toHaveLength(2);
	expect(db.transactions.list({ assetClass: "vda" })).toEqual([vda]);
	expect(db.transactions.list({ assetClass: "us_equity" })).toEqual([equity]);
	expect(db.reports.missingDetails(taxYear).cause).toBe("ledger_changed");
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"never_computed",
	);

	restoreCurrentReports();
	db.transactions.update({ ...equity, withholdingTaxAmount: "0.10" });
	expect(db.transactions.get(equity.id)?.withholdingTaxAmount).toBe("0.10");
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"ledger_changed",
	);
	expect(db.reports.missingDetails(taxYear).cause).toBe("never_computed");

	restoreCurrentReports();
	db.transactions.supersede(equity.id, importRecord.id);
	expect(db.transactions.active("us_equity")).toEqual([]);
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"ledger_changed",
	);
	expect(db.reports.missingDetails(taxYear).cause).toBe("never_computed");
	restoreCurrentReports();
	db.imports.delete(importRecord.id);
	expect(db.transactions.active("us_equity")).toHaveLength(1);
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"ledger_changed",
	);
	expect(db.reports.missingDetails(taxYear).cause).toBe("never_computed");

	restoreCurrentReports();
	expect(db.transactions.deleteManual(equity.id)).toBe(true);
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"ledger_changed",
	);
	expect(db.reports.missingDetails(taxYear).cause).toBe("never_computed");
});

it("invalidates both regimes when a mixed import is removed or a row changes class", async () => {
	db = await openDatabase(directory);
	const imported = importRow();
	db.imports.save(imported);
	const equity = row("us_equity", imported.id);
	db.transactions.insert([{ tx: equity }, { tx: row("vda", imported.id) }]);

	restoreCurrentReports();
	expect(db.imports.delete(imported.id)).toBe(true);
	expect(db.reports.missingDetails(taxYear).cause).toBe("ledger_changed");
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"ledger_changed",
	);
	expect(db.transactions.list()).toEqual([]);

	db.transactions.insert([{ tx: row("us_equity") }]);
	const [standalone] = db.transactions.list();
	if (!standalone) throw new Error("Fixture transaction missing");
	restoreCurrentReports();
	db.transactions.update({ ...standalone, assetClass: "vda" });
	expect(db.reports.missingDetails(taxYear).cause).toBe("ledger_changed");
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"ledger_changed",
	);
});

it("isolates settings, metadata, calendar prices and balance invalidations", async () => {
	db = await openDatabase(directory);
	const equitySettings = {
		...DEFAULT_ENGINE_SETTINGS,
		usEquityFeeTreatment: "exclude",
	} as const;
	restoreCurrentReports();
	db.settings.set("engine", equitySettings);
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"settings_changed",
	);
	expect(db.reports.missingDetails(taxYear).cause).toBe("never_computed");

	restoreCurrentReports();
	const vdaSettings = { ...equitySettings, feeTreatment: "include" } as const;
	db.settings.set("engine", vdaSettings);
	expect(db.reports.missingDetails(taxYear).cause).toBe("settings_changed");
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"never_computed",
	);

	restoreCurrentReports();
	db.settings.set("engine", {
		...vdaSettings,
		lotPool: "per_source",
		surchargeRate: "0.10",
	});
	expect(db.reports.missingDetails(taxYear).cause).toBe("settings_changed");
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"settings_changed",
	);

	restoreCurrentReports();
	const metadata = [
		{ symbol: "AAPL", entityName: "Apple Inc.", zipCode: "00001" },
	];
	expect(db.equityMetadata.replace(metadata)).toEqual(metadata);
	expect(db.equityMetadata.list()).toEqual(metadata);
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"metadata_changed",
	);
	expect(db.reports.missingDetails(taxYear).cause).toBe("never_computed");

	restoreCurrentReports();
	const prices = [
		{ symbol: "AAPL", calendarYear: 2025, closingPriceUsd: "175.120001" },
	];
	expect(db.equityCyPrices.replace(2025, prices)).toEqual(prices);
	expect(db.equityCyPrices.list(2025)).toEqual(prices);
	expect(db.equityCyPrices.list(2026)).toEqual([]);
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"prices_changed",
	);
	expect(db.usEquityReports.missingDetails("2026-27").cause).toBe(
		"never_computed",
	);
	expect(db.reports.missingDetails(taxYear).cause).toBe("never_computed");

	restoreCurrentReports();
	const balances = [
		{ asset: "AAPL", amount: "0.00000000000001", source: "us_broker" },
	];
	expect(db.usEquityActualBalances.replace(taxYear, balances)).toEqual(
		balances,
	);
	expect(db.usEquityActualBalances.get(taxYear)).toEqual(balances);
	expect(db.actualBalances.get(taxYear)).toEqual([]);
	expect(db.usEquityReports.missingDetails(taxYear).cause).toBe(
		"balances_changed",
	);
	expect(db.usEquityReports.missingDetails("2026-27").cause).toBe(
		"never_computed",
	);
	expect(db.reports.missingDetails(taxYear).cause).toBe("never_computed");
});
