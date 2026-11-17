import { describe, expect, it } from "vitest";
import {
	importFile,
	importFileAsync,
	importPdf,
	PdfImportError,
	positionedLines,
} from "../src/index.js";
import { statementPages, syntheticPdf } from "./pdf-fixture.js";

const file = (bytes: Uint8Array) => ({ name: "synthetic.pdf", bytes });
describe("PDF balance snapshots", () => {
	it("extracts multipage text balances with exact decimals, wallets and position provenance, without transactions", async () => {
		const input = file(syntheticPdf(statementPages()));
		const result = await importFileAsync(input, { timezone: "IST" });
		expect(result).toMatchObject({
			reportKind: "binance:account-statement-pdf",
			transactions: [],
			rowErrors: [],
			rowsRead: 3,
			timezoneSource: "file",
			balanceSnapshot: {
				asOf: "2026-03-31",
				timezone: "UTC",
				rows: [
					{
						asset: "BTC",
						amount: "0.01234567890123456789",
						wallet: "Spot",
						raw: { page: 1, bbox: expect.any(Array) },
					},
					{ asset: "USDT", amount: "1200.5", wallet: "Spot" },
					{ asset: "ETH", amount: "2", wallet: "Funding", raw: { page: 2 } },
				],
			},
		});
		expect(
			(await importPdf(input, { timezone: "UTC" })).balanceSnapshot,
		).toEqual(result.balanceSnapshot);
		expect(() => importFile(input, { timezone: "UTC" })).toThrow(
			expect.objectContaining({ code: "pdf_requires_async" }),
		);
	});
	it("distinguishes missing and incorrect passwords and opens an encrypted synthetic PDF", async () => {
		const input = file(syntheticPdf(statementPages(), "12345678"));
		await expect(importPdf(input, { timezone: "UTC" })).rejects.toMatchObject({
			code: "pdf_password_required",
		});
		await expect(
			importPdf(input, { timezone: "UTC", pdfPassword: "87654321" }),
		).rejects.toMatchObject({ code: "pdf_password_incorrect" });
		const result = await importPdf(input, {
			timezone: "UTC",
			pdfPassword: "12345678",
		});
		expect(result.balanceSnapshot?.rows).toHaveLength(3);
		expect(JSON.stringify(result)).not.toContain('12345678"');
	});
	it("distinguishes no text, unknown layout, malformed PDF, oversized input and unsupported Form 16A", async () => {
		await expect(
			importPdf(file(syntheticPdf([[]])), { timezone: "UTC" }),
		).rejects.toMatchObject({ code: "pdf_no_text" });
		await expect(
			importPdf(
				file(syntheticPdf([[{ text: "Unknown statement", x: 40, y: 40 }]])),
				{ timezone: "UTC" },
			),
		).rejects.toMatchObject({ code: "pdf_unknown_layout" });
		await expect(
			importPdf(file(new Uint8Array([1, 2])), { timezone: "UTC" }),
		).rejects.toBeInstanceOf(PdfImportError);
		await expect(
			importPdf(file(new Uint8Array(25 * 1024 * 1024 + 1)), {
				timezone: "UTC",
			}),
		).rejects.toMatchObject({ code: "pdf_too_large" });
		await expect(
			importPdf(
				file(
					syntheticPdf([
						[{ text: "TRACES FORM NO. 16A CoinDCX", x: 40, y: 40 }],
					]),
				),
				{ timezone: "UTC" },
			),
		).rejects.toMatchObject({
			code: "pdf_form16a_not_supported",
			reportKind: "coindcx:form16a-pdf",
		});
	});
	it("rejects Others, unknown columns and conflicting dates instead of fabricating balances", async () => {
		const pages = statementPages();
		const asset = pages[0]?.find((r) => r.text === "BTC");
		if (!asset) throw new Error("Missing synthetic row");
		asset.text = "Others";
		await expect(
			importPdf(file(syntheticPdf(pages)), { timezone: "UTC" }),
		).rejects.toMatchObject({ code: "pdf_unknown_layout" });
	});
	it("clusters positioned split words and sorts lines independently of content stream order", () => {
		expect(
			positionedLines([
				{
					page: 1,
					height: 792,
					items: [
						{ str: "TC", x: 47, y: 50, height: 10, width: 12 },
						{ str: "Amount", x: 200, y: 30, height: 10, width: 30 },
						{ str: "B", x: 40, y: 50, height: 10, width: 6 },
					],
				},
			]).map((l) => l.cells.map((c) => c.str)),
		).toEqual([["Amount"], ["BTC"]]);
	});
});

it("uses the selected timezone only when the PDF has none, and preserves wrapped row provenance", async () => {
	const pages = statementPages();
	const date = pages[0]?.find((r) => r.text.includes("Statement Date"));
	if (!date || !pages[0]) throw new Error("Missing synthetic header");
	date.text = "Statement Date: 2026-03-31";
	pages[0].push({ text: "Wrapped asset name", x: 40, y: 185 });
	const result = await importPdf(file(syntheticPdf(pages)), {
		timezone: "-03:30",
	});
	expect(result.balanceSnapshot?.timezone).toBe("-03:30");
	expect(result.timezoneSource).toBe("user");
	expect(result.warnings).toContainEqual(
		expect.objectContaining({ code: "ambiguous_timezone" }),
	);
	expect(result.balanceSnapshot?.rows[1]?.raw).toMatchObject({
		wrappedLines: [{ page: 1 }],
	});
});

it("assigns right-aligned amount text using its right edge", async () => {
	const pages = statementPages();
	const amount = pages[0]?.find((r) => r.text === "1,200.5");
	if (!amount) throw new Error("Missing synthetic amount");
	amount.x = 285;
	const result = await importPdf(file(syntheticPdf(pages)), {
		timezone: "UTC",
	});
	expect(result.balanceSnapshot?.rows[1]?.amount).toBe("1200.5");
});
