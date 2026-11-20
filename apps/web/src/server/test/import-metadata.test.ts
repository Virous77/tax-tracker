import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreateImportRequestSchema } from "@tax/core/api";
import * as importers from "@tax/importers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeDatabases, database } from "../context";
import { createImport } from "../imports";
import { pdfApiError } from "../pdf-errors";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "tax-metadata-"));
	vi.stubEnv("DATA_DIR", dir);
	vi.stubEnv("SECRETS_PASSPHRASE", "");
});
afterEach(async () => {
	await closeDatabases();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await rm(dir, { recursive: true, force: true });
});
it.each([
	["pdf_password_required", "pdf_password_required", 422],
	["pdf_password_incorrect", "pdf_wrong_password", 422],
	["pdf_no_text", "pdf_no_text", 422],
	["pdf_unknown_layout", "pdf_unknown_layout", 422],
	["pdf_form16a_not_supported", "pdf_unsupported", 422],
	["pdf_invalid", "pdf_unsupported", 422],
	["pdf_requires_async", "pdf_unsupported", 422],
	["pdf_timeout", "pdf_unsupported", 422],
	["pdf_too_large", "pdf_too_large", 413],
] as const)("sanitizes typed PDF error %s", (upstream, code, status) => {
	const error = pdfApiError(
		new importers.PdfImportError(upstream, "password=never-echo-this"),
	);
	expect(error).toMatchObject({ code, status });
	expect(error.message).not.toContain("never-echo-this");
});
it("stores a future TDS-only importer result in details without creating ledger rows", async () => {
	const bytes = new TextEncoder().encode(
		"Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n2026-04-01 00:00:00,BTCUSDT,BUY,100,1BTC,100USDT,0BNB\n",
	);
	const tdsSummary = [
		{
			source: "binance",
			tdsInr: "123.45",
			period: "2025-26",
			raw: { certificate: "synthetic" },
		},
	];
	vi.spyOn(importers, "parseBinance").mockReturnValueOnce({
		transactions: [],
		reportKind: "binance:tds-summary",
		timezoneSource: "user",
		timezoneOrigin: null,
		rowsRead: 1,
		rowErrors: [],
		warnings: [],
		tdsSummary,
	});
	const imported = await createImport(
		await database(),
		CreateImportRequestSchema.parse({
			file: bytes,
			fileName: "tds.csv",
			source: "binance",
			timezone: "UTC",
		}),
	);
	expect(imported.rowsInserted).toBe(1);
	expect((await database()).imports.get(imported.id)?.tdsSummary).toEqual(
		tdsSummary,
	);
	expect((await database()).transactions.all()).toEqual([]);
	await closeDatabases();
	expect((await database()).imports.get(imported.id)?.tdsSummary).toEqual(
		tdsSummary,
	);
});
