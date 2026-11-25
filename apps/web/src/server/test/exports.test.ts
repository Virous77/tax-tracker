import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineSettingsSchema, type LedgerTx, LedgerTxSchema } from "@tax/core";
import { computeVdaReport } from "@tax/engine";
import { csvRecords, readSheets } from "@tax/importers";
import { loadRules } from "@tax/rules";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabases } from "../context";
import { exportReport } from "../exports";
import { type Endpoint, handle } from "../http";

const year = "2025-26";
const sheetNames = [
	"schedule-vda",
	"tds",
	"income",
	"totals",
	"balances",
	"unresolved",
	"warnings",
	"valuations",
	"ledger",
];
const auditColumns = [
	"disposalTxId",
	"lotTxIds",
	"disposalSourceRef",
	"lotSourceRefs",
	"sourceRefs",
	"trail",
];
const itrColumns = [
	"Sl. No.",
	"Date of Acquisition",
	"Date of Transfer",
	"Head under which income to be taxed (Business/Capital Gain)",
	"Cost of Acquisition",
	"Consideration Received",
	"Income from transfer of Virtual Digital Assets (enter nil in case of loss)",
];

function sheetNamed(sheets: ReturnType<typeof readSheets>, name: string) {
	const sheet = sheets.find((sheet) => sheet.name === name);
	if (!sheet) throw new Error(`Missing worksheet ${name}.`);
	return sheet;
}

function csvSection(rows: string[][], name: string, length: number) {
	const index = rows.findIndex((row) => row.length === 1 && row[0] === name);
	expect(index).toBeGreaterThanOrEqual(0);
	return rows.slice(index + 1, index + 1 + length);
}

function call(name: Endpoint, method = "GET", query = "", body?: object) {
	return handle(
		name,
		new Request(`http://localhost/api/test${query}`, {
			method,
			headers: body ? { "Content-Type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
		}),
		{ taxYear: year },
	);
}

async function download(
	format: "csv" | "xlsx",
	kind: "full" | "schedule-vda" | "income",
) {
	const response = await call(
		"exportReport",
		"GET",
		`?format=${format}&kind=${kind}`,
	);
	expect(response.status).toBe(200);
	return {
		name: `${kind}.${format}`,
		bytes: new Uint8Array(await response.arrayBuffer()),
	};
}

describe("exports with loaded sample data", () => {
	let directory: string;
	let receipt: LedgerTx;

	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "tax-exports-"));
		vi.stubEnv("DATA_DIR", directory);
		vi.stubEnv("APP_PASSWORD", "");
		expect((await call("loadDemo", "POST")).status).toBe(201);
		const response = await call("createTransaction", "POST", "", {
			importId: null,
			sourceRef: "staking-receipt",
			timestamp: "2025-08-01T00:00:00.000Z",
			type: "income",
			incomeKind: "staking",
			assetIn: "DOT",
			amountIn: "2",
			inrValue: "1000",
			raw: { receipt: "staking-receipt" },
			reviewFlags: [],
		});
		expect(response.status).toBe(201);
		receipt = LedgerTxSchema.parse(await response.json());
		expect((await call("computeReport", "POST")).status).toBe(200);
	});

	afterAll(async () => {
		await closeDatabases();
		vi.unstubAllEnvs();
		await rm(directory, { recursive: true, force: true });
	});

	it("exports lookup columns and retains the original Binance rows in XLSX and CSV", async () => {
		const sheets = readSheets(await download("xlsx", "full"));
		expect(sheets.map(({ name }) => name)).toEqual(sheetNames);
		const schedule = sheetNamed(sheets, "schedule-vda");
		expect(schedule.headers.slice(-7)).toEqual([
			...auditColumns,
			"reviewFlags",
		]);
		const ledger = sheetNamed(sheets, "ledger");
		const valuations = sheetNamed(sheets, "valuations");
		const buy = ledger.rows.find(
			({ source, sourceRef }) =>
				source === "binance" && sourceRef === "demo:sample-buy",
		);
		const sell = ledger.rows.find(
			({ source, sourceRef }) =>
				source === "binance" && sourceRef === "demo:sample-sell",
		);
		const eth = schedule.rows.find(({ asset }) => asset === "ETH");
		if (!buy?.id || !sell?.id || !eth?.trail)
			throw new Error("Missing sample ETH disposal or its ledger rows.");

		expect(eth).toMatchObject({
			disposalTxId: sell.id,
			lotTxIds: buy.id,
			disposalSourceRef: sell.sourceRef,
			lotSourceRefs: buy.sourceRef,
			sourceRefs: "demo:sample-buy, demo:sample-sell",
		});
		expect(valuations.rows.map(({ txId }) => txId)).toEqual(
			expect.arrayContaining([buy.id, sell.id]),
		);
		expect(JSON.parse(eth.trail)).toEqual({
			disposalTxId: sell.id,
			lotTxIds: [buy.id],
			rawRefs: [buy, sell].map(({ id, source, sourceRef, raw }) => ({
				txId: id,
				source,
				sourceRef,
				raw: JSON.parse(raw ?? ""),
			})),
		});
		expect(JSON.parse(buy.raw ?? "")).toMatchObject({
			"Trade ID": "sample-buy",
			Side: "BUY",
		});
		expect(JSON.parse(sell.raw ?? "")).toMatchObject({
			"Trade ID": "sample-sell",
			Side: "SELL",
		});

		const income = sheetNamed(sheets, "income");
		expect(income.headers.slice(-2)).toEqual(["sourceRefs", "trail"]);
		const staking = income.rows.find(({ txId }) => txId === receipt.id);
		expect(staking).toMatchObject({
			txId: receipt.id,
			sourceRefs: receipt.sourceRef,
		});
		expect(ledger.rows.find(({ id }) => id === staking?.txId)).toMatchObject({
			sourceRef: staking?.sourceRefs,
		});
		expect(valuations.rows).toContainEqual(
			expect.objectContaining({ txId: receipt.id }),
		);
		expect(JSON.parse(staking?.trail ?? "")).toEqual([
			{
				txId: receipt.id,
				source: receipt.source,
				sourceRef: receipt.sourceRef,
				raw: receipt.raw,
			},
		]);

		const records = csvRecords(
			new TextDecoder().decode((await download("csv", "full")).bytes),
		);
		expect(
			records
				.filter((row) => row.length === 1 && sheetNames.includes(row[0] ?? ""))
				.flat(),
		).toEqual(sheetNames);
		expect(
			csvSection(records, "schedule-vda", 1 + schedule.rows.length),
		).toEqual([
			schedule.headers,
			...schedule.rows.map((row) =>
				schedule.headers.map((header) => row[header]),
			),
		]);
		expect(csvSection(records, "income", 2)).toEqual([
			income.headers,
			income.headers.map((header) => staking?.[header]),
		]);
	});

	it.each(["csv", "xlsx"] as const)(
		"keeps the standalone %s layouts unchanged",
		async (format) => {
			const [schedule] = readSheets(await download(format, "schedule-vda"));
			const firstColumn = schedule?.headers[0] ?? "";
			// The importer treats the disclaimer as the header for this filing layout.
			const portalHeader = schedule?.rows.find(
				(row) => row[firstColumn] === "Sl. No.",
			);
			expect([
				portalHeader?.[firstColumn],
				...JSON.parse(portalHeader?.__extraColumns ?? "[]"),
			]).toEqual(itrColumns);
			for (const column of auditColumns)
				expect(JSON.stringify(schedule)).not.toContain(column);

			const [income] = readSheets(await download(format, "income"));
			expect(income?.headers).toEqual([
				"txId",
				"type",
				"incomeKind",
				"date",
				"asset",
				"quantity",
				"fmvInr",
				"trail",
			]);
			expect(income?.rows[0]).toMatchObject({ txId: receipt.id });
		},
	);
});

function compute(transactions: LedgerTx[]) {
	return computeVdaReport({
		transactions,
		rules: loadRules("india-vda", year),
		settings: EngineSettingsSchema.parse({}),
		taxYear: year,
		fx: () => null,
	});
}

it("preserves FIFO lot order and deduplicates source refs, including transfers", async () => {
	const base = { source: "binance", importId: null, raw: {}, reviewFlags: [] };
	const firstBuy = {
		...base,
		id: randomUUID(),
		sourceRef: "first-buy",
		timestamp: "2025-05-01T00:00:00.000Z",
		type: "buy",
		assetIn: "ETH",
		amountIn: "1",
		inrValue: "200000",
	} satisfies LedgerTx;
	const secondBuy = {
		...firstBuy,
		id: randomUUID(),
		sourceRef: "second-buy",
		timestamp: "2025-06-01T00:00:00.000Z",
	};
	const withdrawal = {
		...base,
		id: randomUUID(),
		sourceRef: "withdrawal",
		timestamp: "2025-07-01T00:00:00.000Z",
		type: "withdrawal",
		assetOut: "ETH",
		amountOut: "2",
	} satisfies LedgerTx;
	const deposit = {
		...base,
		id: randomUUID(),
		source: "coindcx",
		sourceRef: "deposit",
		timestamp: "2025-07-01T01:00:00.000Z",
		type: "deposit",
		assetIn: "ETH",
		amountIn: "2",
	} satisfies LedgerTx;
	const sell = {
		...base,
		id: randomUUID(),
		source: "coindcx",
		sourceRef: "sell",
		timestamp: "2025-08-01T00:00:00.000Z",
		type: "sell",
		assetOut: "ETH",
		amountOut: "2",
		inrValue: "500000",
	} satisfies LedgerTx;
	const report = compute([firstBuy, secondBuy, withdrawal, deposit, sell]);
	expect(report.scheduleVdaRows).toHaveLength(2);
	const [first, second] = report.scheduleVdaRows;
	if (!first || !second) throw new Error("Missing FIFO slices.");

	const fifoWorkbook = await exportReport(report, {
		kind: "full",
		format: "xlsx",
	});
	const fifoSchedule = sheetNamed(
		readSheets({ name: fifoWorkbook.fileName, bytes: fifoWorkbook.bytes }),
		"schedule-vda",
	);
	expect(
		fifoSchedule.rows.map(({ disposalTxId, lotTxIds, lotSourceRefs }) => [
			disposalTxId,
			lotTxIds,
			lotSourceRefs,
		]),
	).toEqual([
		[sell.id, firstBuy.id, firstBuy.sourceRef],
		[sell.id, secondBuy.id, secondBuy.sourceRef],
	]);

	// The engine emits separate FIFO rows. A report trail can also name both lots on one row.
	const rawRefs = [...second.trail.rawRefs, ...first.trail.rawRefs];
	const trail = {
		disposalTxId: sell.id,
		lotTxIds: [...first.trail.lotTxIds, ...second.trail.lotTxIds],
		rawRefs,
	};
	report.scheduleVdaRows = [{ ...first, trail }];
	const workbook = await exportReport(report, { kind: "full", format: "xlsx" });
	const sheets = readSheets({ name: workbook.fileName, bytes: workbook.bytes });
	const [row] = sheetNamed(sheets, "schedule-vda").rows;
	expect(row).toMatchObject({
		disposalTxId: sell.id,
		lotTxIds: `${firstBuy.id}, ${secondBuy.id}`,
		disposalSourceRef: "sell",
		lotSourceRefs: "first-buy, second-buy",
		sourceRefs: "second-buy, withdrawal, deposit, sell, first-buy",
		trail: JSON.stringify(trail),
	});
	const ledger = sheetNamed(sheets, "ledger").rows;
	const valuations = sheetNamed(sheets, "valuations").rows;
	for (const id of [row?.disposalTxId, ...(row?.lotTxIds?.split(", ") ?? [])]) {
		expect(ledger).toContainEqual(expect.objectContaining({ id }));
		expect(valuations).toContainEqual(expect.objectContaining({ txId: id }));
	}
	for (const sourceRef of row?.sourceRefs?.split(", ") ?? []) {
		expect(ledger).toContainEqual(expect.objectContaining({ sourceRef }));
	}
});

it("keeps the full Schedule VDA section empty when there are no rows", async () => {
	const report = compute([]);
	const result = await exportReport(report, { kind: "full", format: "csv" });
	expect(new TextDecoder().decode(result.bytes)).toContain(
		'"schedule-vda"\r\n\r\n\r\n"tds"',
	);
});
