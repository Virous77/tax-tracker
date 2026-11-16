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
test("import is an explicit Phase 1 stub", () => {
	expect(
		execFileSync(process.execPath, [cli, "import"], { encoding: "utf8" }),
	).toContain("Phase 1");
});
