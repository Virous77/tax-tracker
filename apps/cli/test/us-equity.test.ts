import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { UsEquityReportSchema } from "@tax/core";
import { expect, test } from "vitest";

test("CLI computes equity and exports all worksheets or one selected CSV", () => {
	const dir = mkdtempSync(resolve(tmpdir(), "tax-cli-us-"));
	try {
		const fixture = JSON.parse(
			readFileSync(
				new URL(
					"../../../packages/engine/test/golden-us-equity/10-schedule-fa-calendar-year/input.json",
					import.meta.url,
				),
				"utf8",
			),
		).cases[0];
		const ledger = resolve(dir, "ledger.json");
		const out = resolve(dir, "report.json");
		const csv = resolve(dir, "equity.csv");
		const metadata = resolve(dir, "metadata.json");
		const prices = resolve(dir, "prices.json");
		writeFileSync(ledger, JSON.stringify(fixture.transactions));
		writeFileSync(
			metadata,
			JSON.stringify([{ symbol: "AAPL", entityName: '=HYPERLINK("test")' }]),
		);
		writeFileSync(prices, JSON.stringify(fixture.cyPrices));
		const args = [
			resolve(import.meta.dirname, "../dist/index.js"),
			"compute",
			"--regime",
			"us-equity",
			"--year",
			"2026-27",
			"--ledger",
			ledger,
			"--out",
			out,
			"--csv",
			csv,
			"--metadata",
			metadata,
			"--prices",
			prices,
		];
		execFileSync(process.execPath, args);
		const report = UsEquityReportSchema.parse(
			JSON.parse(readFileSync(out, "utf8")),
		);
		expect(report.calendarYear).toBe(2026);
		expect(report.capitalGains.rows[0]).toMatchObject({
			asset: "AAPL",
			considerationUsd: "299.00",
		});
		expect(report.scheduleFa.rows[0]).toMatchObject({
			closingValueUsd: "480.00",
			entityName: '=HYPERLINK("test")',
		});
		const csvData = readFileSync(csv, "utf8");
		for (const content of [
			'"Capital gains"',
			'"Form 67 worksheet"',
			'"Schedule FA (Table A3)"',
			"Not tax advice",
			"Section numbers pending CA verification",
			"'=HYPERLINK",
		])
			expect(csvData).toContain(content);

		execFileSync(process.execPath, [...args, "--csv-kind", "form67"]);
		const form67Only = readFileSync(csv, "utf8");
		expect(form67Only).toContain('"Form 67 worksheet"');
		expect(form67Only).not.toContain('"Capital gains"');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
