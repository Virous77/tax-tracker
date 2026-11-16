import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const cli = resolve(import.meta.dirname, "../dist/index.js");
test("CLI computes an INR report and exports traceable CSV", () => {
	const dir = mkdtempSync(resolve(tmpdir(), "tax-cli-"));
	try {
		const fixture = JSON.parse(
			readFileSync(
				resolve(
					import.meta.dirname,
					"../../../packages/engine/test/golden/01-worked-example/input.json",
				),
				"utf8",
			),
		);
		const ledger = resolve(dir, "ledger.json");
		const out = resolve(dir, "report.json");
		const csv = resolve(dir, "vda.csv");
		writeFileSync(ledger, JSON.stringify(fixture.cases[0].transactions));
		execFileSync(process.execPath, [
			cli,
			"compute",
			"--ledger",
			ledger,
			"--year",
			"2026-27",
			"--out",
			out,
			"--csv",
			csv,
		]);
		expect(JSON.parse(readFileSync(out, "utf8")).totals.netPayable).toBe(
			"13100.00",
		);
		const exported = readFileSync(csv, "utf8");
		expect(exported).toContain("Not tax advice");
		expect(exported).toContain("feeTreatment");
		expect(exported).toContain('"200000.00"');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
test("CLI imports verified Binance history with precise decimal strings", () => {
	const dir = mkdtempSync(resolve(tmpdir(), "tax-cli-import-"));
	try {
		const out = resolve(dir, "ledger.json");
		const fixture = resolve(
			import.meta.dirname,
			"../../../packages/importers/test/fixtures/binance-trade-history.csv",
		);
		execFileSync(process.execPath, [
			cli,
			"import",
			fixture,
			"--source",
			"binance",
			"--tz",
			"UTC",
			"--out",
			out,
		]);
		const rows = JSON.parse(readFileSync(out, "utf8"));
		expect(rows).toHaveLength(8);
		expect(rows.at(-1)).toMatchObject({
			assetIn: "BTC",
			amountIn: "0.01",
			amountOut: "1050",
			raw: { Amount: "1,050.00000000USDT" },
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
