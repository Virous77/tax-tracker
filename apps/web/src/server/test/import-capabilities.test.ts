import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { D, type LedgerTx } from "@tax/core";
import { GetImportResponseSchema, TimezoneSchema } from "@tax/core/api";
import { importFile, REPORT_KIND_LABELS, writeXlsx } from "@tax/importers";
import { mapBinanceTrade } from "@tax/sync";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	statementPages,
	syntheticPdf,
} from "../../../../../packages/importers/test/pdf-fixture";
import { closeDatabases, database } from "../context";
import { type Endpoint, handle } from "../http";
import { insertReconciled } from "../reconciliation";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "tax-import-capabilities-"));
	vi.stubEnv("DATA_DIR", directory);
	vi.stubEnv("APP_PASSWORD", "");
	vi.stubEnv("SECRETS_PASSPHRASE", "");
});
afterEach(async () => {
	closeDatabases();
	vi.unstubAllEnvs();
	await rm(directory, { recursive: true, force: true });
});
function call(
	name: Endpoint,
	method = "GET",
	body?: unknown,
	params: Record<string, string> = {},
) {
	return handle(
		name,
		new Request("http://localhost/api/test", {
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
	bytes: Uint8Array,
	name = "synthetic.xlsx",
	timezone = "UTC",
	pdfPassword?: string,
) {
	const form = new FormData();
	form.set("file", new File([new Uint8Array(bytes)], name));
	form.set("source", "auto");
	form.set("timezone", timezone);
	if (pdfPassword) form.set("pdfPassword", pdfPassword);
	return handle(
		"createImport",
		new Request("http://localhost/api/imports", { method: "POST", body: form }),
	);
}
function workbook(rows: string[][]) {
	return writeXlsx([{ name: "Synthetic", rows }]);
}
function order(quantity = "1", id = "order-1") {
	return workbook([
		[
			"Time",
			"OrderNo",
			"Pair",
			"Type¹",
			"Side",
			"Order Price",
			"Order Amount",
			"Time",
			"Executed²",
			"Average Price",
			"Trading total³",
			"Status",
		],
		[
			"2026-04-01 10:00:00",
			id,
			"BTCUSDT",
			"Limit",
			"BUY",
			"100",
			`${quantity}BTC`,
			"2026-04-01 10:01:00",
			`${quantity}BTC`,
			"100",
			"100USDT",
			"FILLED",
		],
	]);
}
function fills() {
	return workbook([
		["Date(UTC)", "Pair", "Side", "Price", "Executed", "Amount", "Fee"],
		[
			"2026-04-01 04:30:10",
			"BTCUSDT",
			"BUY",
			"100",
			"0.4BTC",
			"40USDT",
			"0.01BNB",
		],
		[
			"2026-04-01 04:30:50",
			"BTCUSDT",
			"BUY",
			"100",
			"0.6BTC",
			"60USDT",
			"0.02BNB",
		],
	]);
}
it.each([true, false])(
	"links every covered same-second statement leg (fills first: %s)",
	async (fillsFirst) => {
		const fixture = (name: string) =>
			readFileSync(
				new URL(
					`../../../../../packages/importers/test/fixtures/binance-${name}.csv`,
					import.meta.url,
				),
			);
		const uploadFills = () => upload(fixture("trade-history"), "trades.csv");
		const uploadStatement = () =>
			upload(fixture("transaction-statement"), "statement.csv");
		if (fillsFirst) expect((await uploadFills()).status).toBe(201);
		const imported = await (await uploadStatement()).json();
		const timestamps = new Set([
			"2025-06-15T03:12:44.000Z",
			"2026-05-10T09:00:00.000Z",
		]);
		const db = database();
		const atSameSecond = () =>
			db.transactions.active().filter((tx) => timestamps.has(tx.timestamp));
		if (fillsFirst) {
			expect(imported.rowsDuplicate).toBeGreaterThanOrEqual(12);
			expect(
				db.rawRows
					.list(imported.id)
					.filter((row) =>
						timestamps.has(
							`${(row.data as Record<string, string>).UTC_Time?.replace(" ", "T")}.000Z`,
						),
					)
					.every((row) => row.txId !== null),
			).toBe(true);
		} else {
			expect(atSameSecond()).toHaveLength(12);
			for (const tx of atSameSecond())
				expect(tx).toMatchObject({
					type: "transfer",
					reviewFlags: [
						expect.objectContaining({
							code: "unknown_type",
							message: expect.stringContaining("unclassified"),
						}),
					],
				});
			expect((await uploadFills()).status).toBe(201);
		}
		expect(atSameSecond()).toHaveLength(4);
		expect(atSameSecond().every((tx) => tx.type === "swap")).toBe(true);
		const review = await (await call("review")).json();
		const unknown = review.groups.find(
			(group: { code: string }) => group.code === "unknown_type",
		);
		expect(
			unknown.items.every((tx: LedgerTx) => !timestamps.has(tx.timestamp)),
		).toBe(true);
	},
);
const catalogue = [
	["binance-convert", "binance:convert"],
	["binance-fiat-deposit", "binance:fiat"],
	["binance-wallet-legacy-deposit", "binance:wallet-history"],
	["binance-trade-assets-unverified", "binance:spot-trade-history-assets"],
	["binance-futures-trades-unverified", "binance:futures-trades"],
	["binance-futures-transactions", "binance:futures-transactions"],
	["coindcx-futures-inr-unverified", "coindcx:futures-orders"],
	["coindcx-options-unverified", "coindcx:options"],
	["binance-statement-all-operations", "binance:transaction-history"],
	["binance-order-statuses", "binance:spot-order-history"],
	["coindcx-order-statuses", "coindcx:order-history"],
	["binance-trade-history", "binance:spot-trade-history"],
	[
		"binance-trade-history-fee-coin-layout",
		"binance:legacy-spot-trade-history",
	],
	["binance-deposits", "binance:deposits"],
	["binance-withdrawals", "binance:withdrawals"],
	["coindcx-order-history", "coindcx:order-history"],
] as const;
describe("all report kinds through the import service", () => {
	it.each(catalogue)(
		"persists %s, metadata, originals and reimport counts",
		async (name, kind) => {
			const bytes = readFileSync(
				new URL(
					`../../../../../packages/importers/test/fixtures/report-kinds/${name}.xlsx`,
					import.meta.url,
				),
			);
			const response = await upload(bytes, `${name}(UTC+5:30).xlsx`, "+05:30");
			const imported = await response.json();
			expect(response.status, JSON.stringify(imported)).toBe(201);
			expect(imported).toMatchObject({
				status: "imported",
				reportKind: kind,
				reportKindLabel: REPORT_KIND_LABELS[kind],
				rowsError: 0,
			});
			expect(imported.rowsRead).toBe(
				imported.rowsInserted + imported.rowsDuplicate + imported.rowsSkipped,
			);
			expect(database().rawRows.list(imported.id)).toHaveLength(
				imported.rowsRead,
			);
			const detail = await (
				await call("getImport", "GET", undefined, { id: imported.id })
			).json();
			expect(detail).toMatchObject({
				reportKind: kind,
				warnings: imported.warnings,
				coverage: imported.coverage,
			});
			const repeat = await (
				await upload(bytes, `${name}(UTC+5:30).xlsx`, "+05:30")
			).json();
			expect(repeat.rowsInserted).toBe(0);
			expect(repeat.rowsDuplicate).toBe(imported.rowsInserted);
		},
	);
	it("imports the combined CoinDCX workbook's spot, instant and derivative rows while retaining unknown sheets", async () => {
		const bytes = readFileSync(
			new URL(
				"../../../../../packages/importers/test/fixtures/coindcx-report.xlsx",
				import.meta.url,
			),
		);
		const imported = await (await upload(bytes)).json();
		expect(imported).toMatchObject({
			reportKind: "coindcx:mixed",
			rowsInserted: 8,
			rowsError: 2,
		});
		expect(
			imported.coverage.map((row: { reportKind: string }) => row.reportKind),
		).toEqual(
			expect.arrayContaining([
				"coindcx:instant-orders",
				"coindcx:spot-orders",
				"coindcx:futures-orders",
			]),
		);
	});
});
it.each(["IST", "UTC", "+00:00", "-03:30", "+05:45", "+14:00", "-14:00"])(
	"accepts timezone %s",
	(zone) => {
		expect(TimezoneSchema.parse(zone)).toBe(zone);
	},
);
it.each(["+14:01", "-15:00", "+05:60", "+5:30", "Asia/Kolkata"])(
	"rejects timezone %s",
	(zone) => {
		expect(TimezoneSchema.safeParse(zone).success).toBe(false);
	},
);
it("persists filename timezone precedence and both original Time columns", async () => {
	const result = await (
		await upload(order(), "orders(UTC+5:30).xlsx", "-03:30")
	).json();
	expect(result).toMatchObject({
		detectedTimezone: "+05:30",
		timezoneSource: "file",
	});
	expect(result.warnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				message: expect.stringContaining("instead of the selected"),
			}),
			expect.objectContaining({ message: expect.stringContaining("no fees") }),
		]),
	);
	expect(database().transactions.all()[0]?.timestamp).toBe(
		"2026-04-01T04:31:00.000Z",
	);
	expect(database().rawRows.list(result.id)[0]?.data).toMatchObject({
		Time: "2026-04-01 10:00:00",
		"Time#2": "2026-04-01 10:01:00",
	});
});
it("uses a selected fixed offset for a report without a timezone", async () => {
	const result = await (await upload(order(), "orders.xlsx", "-03:30")).json();
	expect(result).toMatchObject({
		timezoneSource: "user",
		detectedTimezone: null,
	});
	expect(database().transactions.all()[0]?.timestamp).toBe(
		"2026-04-01T13:31:00.000Z",
	);
});
it("supersedes an order, excludes it from the report and restores it on deletion", async () => {
	const first = await (await upload(order(), "orders(UTC+5:30).xlsx")).json();
	const original = database().transactions.all()[0];
	const better = await (await upload(fills())).json();
	expect(better).toMatchObject({ rowsInserted: 2, rowsDuplicate: 0 });
	expect(database().transactions.all()).toHaveLength(3);
	expect(database().transactions.active()).toHaveLength(2);
	expect(database().transactions.superseded()).toEqual([
		{ txId: original?.id, importId: better.id },
	]);
	const replaced = await (
		await handle(
			"listTransactions",
			new Request("http://localhost/api/transactions?superseded=true"),
		)
	).json();
	expect(replaced.items).toEqual([
		expect.objectContaining({ id: original?.id, supersededBy: better.id }),
	]);
	const computed = await call(
		"computeReport",
		"POST",
		{},
		{ taxYear: "2026-27" },
	);
	expect(computed.status).toBe(200);
	expect((await computed.json()).excluded).toContainEqual({
		txId: original?.id,
		reason: "superseded",
	});
	expect(
		(await call("deleteImport", "DELETE", undefined, { id: better.id })).status,
	).toBe(204);
	expect(database().transactions.active()).toEqual([original]);
	expect(database().rawRows.list(first.id)).toHaveLength(1);
	expect(database().transactions.superseded()).toEqual([]);
});
it("inserts mismatched fills with possible_duplicate naming the order candidate", async () => {
	await upload(order("2"), "orders(UTC+5:30).xlsx");
	const original = database().transactions.all()[0];
	const incoming = await (await upload(fills())).json();
	expect(incoming.rowsInserted).toBe(2);
	expect(database().transactions.superseded()).toEqual([]);
	for (const tx of database()
		.transactions.all()
		.filter((row) => row.importId === incoming.id))
		expect(tx.reviewFlags).toContainEqual({
			code: "possible_duplicate",
			message: expect.stringContaining(original?.id ?? "missing"),
		});
});
it.each(["file-first", "api-first"])(
	"reconciles API fills and file orders %s without fingerprint double handling",
	async (direction) => {
		const db = database();
		const fileName = "orders(UTC+5:30).xlsx";
		const fileRows = importFile(
			{ name: fileName, bytes: order() },
			{ timezone: "UTC" },
		).transactions;
		const apiId = randomUUID();
		db.imports.save(
			GetImportResponseSchema.parse({
				id: apiId,
				source: "binance-api",
				kind: "api_sync",
				fileName: "API",
				fileSha256: "",
				timezone: "UTC",
				status: "imported",
				rowsRead: 2,
				rowsInserted: 2,
				rowsDuplicate: 0,
				rowsError: 0,
				recipeId: null,
				createdAt: new Date().toISOString(),
				error: null,
				warnings: [],
				rowErrors: [],
			}),
		);
		const apiRows = ["0.4", "0.6"].map((qty, index) => ({
			tx: {
				...mapBinanceTrade(
					{
						id: String(index),
						time: String(
							Date.parse(`2026-04-01T04:30:${index ? "50" : "10"}Z`),
						),
						isBuyer: true,
						qty,
						quoteQty: D(qty).mul("100").toFixed(),
						price: "100",
						commission: "0.01",
						commissionAsset: "BNB",
					},
					{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
				),
				id: randomUUID(),
				importId: apiId,
			} as LedgerTx,
		}));
		if (direction === "file-first") {
			const imported = await (await upload(order(), fileName)).json();
			expect(insertReconciled(db, apiId, apiRows)).toEqual({
				inserted: 2,
				duplicate: 0,
			});
			expect(db.transactions.superseded()).toHaveLength(1);
			expect(db.transactions.active()).toHaveLength(2);
			expect(
				db.transactions.all().find((tx) => tx.importId === imported.id)?.raw,
			).toEqual(fileRows[0]?.raw);
			db.imports.delete(apiId);
			expect(db.transactions.active()).toHaveLength(1);
		} else {
			insertReconciled(db, apiId, apiRows);
			const imported = await (await upload(order(), fileName)).json();
			expect(imported).toMatchObject({ rowsInserted: 0, rowsDuplicate: 1 });
			expect(db.rawRows.list(imported.id)[0]?.txId).toBeTruthy();
		}
	},
);

describe("PDF errors and snapshots", () => {
	it("deduplicates identical PDFs and identical snapshots from different PDFs", async () => {
		const original = syntheticPdf(statementPages());
		const first = await (await upload(original)).json();
		expect(first).toMatchObject({
			rowsRead: 3,
			rowsInserted: 3,
			rowsDuplicate: 0,
		});
		const [same, reencoded] = await Promise.all([
			upload(original, "renamed.pdf"),
			upload(
				syntheticPdf(statementPages(), "12345678"),
				"encrypted.pdf",
				"IST",
				"12345678",
			),
		]);
		const duplicate = await same.json();
		const reencodedDuplicate = await reencoded.json();
		expect(duplicate.fileSha256).toBe(first.fileSha256);
		expect(reencodedDuplicate.fileSha256).not.toBe(first.fileSha256);
		for (const item of [duplicate, reencodedDuplicate]) {
			expect(item).toMatchObject({
				rowsRead: 3,
				rowsInserted: 0,
				rowsDuplicate: 3,
			});
			expect(database().rawRows.list(item.id)).toHaveLength(3);
		}
		expect(reencodedDuplicate.warnings).toContainEqual({
			code: "parse_warning",
			message: expect.stringMatching(/UTC.*instead of.*IST/),
		});
		expect(database().balanceSnapshots.list()).toHaveLength(1);
	});
	it.each([
		[
			"missing password",
			() => syntheticPdf(statementPages(), "12345678"),
			undefined,
			"pdf_password_required",
			422,
		],
		[
			"wrong password",
			() => syntheticPdf(statementPages(), "12345678"),
			"87654321",
			"pdf_wrong_password",
			422,
		],
		["no text", () => syntheticPdf([[]]), undefined, "pdf_no_text", 422],
		[
			"unknown layout",
			() => syntheticPdf([[{ text: "Unknown report", x: 40, y: 40 }]]),
			undefined,
			"pdf_unknown_layout",
			422,
		],
		[
			"Form16A",
			() =>
				syntheticPdf([[{ text: "TRACES FORM NO. 16A CoinDCX", x: 40, y: 40 }]]),
			undefined,
			"pdf_unsupported",
			422,
		],
		[
			"invalid",
			() => new TextEncoder().encode("%PDF-invalid"),
			undefined,
			"pdf_unsupported",
			422,
		],
		[
			"too large",
			() => {
				const bytes = new Uint8Array(25 * 1024 * 1024 + 1);
				bytes.set(new TextEncoder().encode("%PDF-"));
				return bytes;
			},
			undefined,
			"pdf_too_large",
			413,
		],
	] as const)(
		"maps %s without storing or echoing a password",
		async (_name, bytes, password, code, status) => {
			const response = await upload(bytes(), "synthetic.pdf", "UTC", password);
			expect(response.status).toBe(status);
			const text = await response.text();
			expect(JSON.parse(text)).toMatchObject({ error: { code } });
			if (password) expect(text).not.toContain(password);
			expect(database().imports.list()).toHaveLength(0);
		},
	);
	it("detects PDF magic independent of extension, compares exact amounts, applies and cascades deletion", async () => {
		const response = await upload(
			syntheticPdf(statementPages(), "12345678"),
			"statement.bin",
			"IST",
			"12345678",
		);
		const imported = await response.json();
		expect(response.status, JSON.stringify(imported)).toBe(201);
		expect(imported).toMatchObject({
			reportKind: "binance:account-statement-pdf",
			rowsInserted: 3,
			rowsRead: 3,
		});
		expect(database().transactions.all()).toEqual([]);
		const detail = await (
			await call("getImport", "GET", undefined, { id: imported.id })
		).json();
		expect(detail.balanceSnapshot.rows).toHaveLength(3);
		expect(JSON.stringify(detail)).not.toContain('12345678"');
		const ledger: LedgerTx = {
			id: randomUUID(),
			importId: null,
			source: "binance",
			sourceRef: "before-snapshot",
			timestamp: "2026-03-31T22:00:00Z",
			type: "deposit",
			assetIn: "BTC",
			amountIn: "0.01",
			raw: {},
			reviewFlags: [],
		};
		database().transactions.insert([
			{ tx: ledger },
			{
				tx: {
					...ledger,
					id: randomUUID(),
					sourceRef: "after-snapshot",
					timestamp: "2026-04-01T00:00:00Z",
					amountIn: "100",
				},
			},
		]);
		const snapshots = await (await call("listBalanceSnapshots")).json();
		expect(snapshots[0].comparison).toContainEqual({
			asset: "BTC",
			statement: "0.01234567890123456789",
			computed: "0.01",
			difference: "0.00234567890123456789",
		});
		const applied = await call(
			"applyBalanceSnapshot",
			"POST",
			{ taxYear: "2025-26" },
			{ id: snapshots[0].id },
		);
		expect(applied.status).toBe(200);
		expect(await applied.json()).toContainEqual({
			asset: "BTC",
			amount: "0.01234567890123456789",
		});
		const rejected = await call(
			"applyBalanceSnapshot",
			"POST",
			{ taxYear: "2026-27" },
			{ id: snapshots[0].id },
		);
		expect(rejected.status).toBe(409);
		expect(await rejected.json()).toMatchObject({
			error: {
				code: "snapshot_not_year_end",
				details: { reason: "outside_year_end_window" },
			},
		});
		expect(
			(await call("deleteImport", "DELETE", undefined, { id: imported.id }))
				.status,
		).toBe(204);
		expect(await (await call("listBalanceSnapshots")).json()).toEqual([]);
	});
});

it("does not count a fill twice when file/API fingerprints overlap inside an order window", async () => {
	const db = database();
	const imported = await (
		await upload(order(), "orders(UTC+5:30).xlsx")
	).json();
	const parsed = importFile(
		{ name: "fills.xlsx", bytes: fills() },
		{ timezone: "UTC" },
	);
	const first = parsed.transactions[0];
	if (!first) throw new Error("Missing synthetic fill");
	insertReconciled(db, imported.id, [
		{ tx: { ...first, importId: imported.id } },
	]);
	const apiId = randomUUID();
	db.imports.save(
		GetImportResponseSchema.parse({
			...db.imports.get(imported.id),
			id: apiId,
			source: "binance-api",
			kind: "api_sync",
		}),
	);
	const apiRows = ["0.4", "0.6"].map((qty, index) => ({
		tx: {
			...mapBinanceTrade(
				{
					id: String(index),
					time: String(Date.parse(`2026-04-01T04:30:${index ? "50" : "10"}Z`)),
					isBuyer: true,
					qty,
					quoteQty: D(qty).mul("100").toFixed(),
					price: "100",
					commission: "0.01",
					commissionAsset: "BNB",
				},
				{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
			),
			id: randomUUID(),
			importId: apiId,
		} as LedgerTx,
	}));
	expect(insertReconciled(db, apiId, apiRows)).toEqual({
		inserted: 1,
		duplicate: 1,
	});
	expect(db.transactions.superseded()).toHaveLength(1);
	expect(db.transactions.active()).toHaveLength(2);
});

it("aggregates snapshot wallets and preserves other venue balances when applying per-source", async () => {
	const db = database();
	const pages = statementPages();
	for (const page of pages)
		for (const cell of page) if (cell.text === "ETH") cell.text = "BTC";
	const imported = await (await upload(syntheticPdf(pages))).json();
	const snapshot = db.balanceSnapshots.list()[0];
	if (!snapshot) throw new Error("Missing synthetic snapshot");
	db.settings.set("engine", { lotPool: "per_source" });
	db.actualBalances.replace("2025-26", [
		{ asset: "ETH", source: "coindcx", amount: "9" },
		{ asset: "SOL", source: "binance", amount: "3" },
	]);
	const response = await call(
		"applyBalanceSnapshot",
		"POST",
		{ taxYear: "2025-26" },
		{ id: snapshot.id },
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual(
		expect.arrayContaining([
			{ asset: "ETH", source: "coindcx", amount: "9" },
			{ asset: "BTC", source: "binance", amount: "2.01234567890123456789" },
			{ asset: "SOL", source: "binance", amount: "3" },
		]),
	);
	expect(db.imports.get(imported.id)?.balanceSnapshot?.rows).toHaveLength(3);
});
