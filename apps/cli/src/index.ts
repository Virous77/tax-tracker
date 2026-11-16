#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { EngineSettingsSchema, LedgerTxSchema, TaxYearSchema } from "@tax/core";
import { computeVdaReport } from "@tax/engine";
import { loadSbiCsv } from "@tax/rates";
import { loadRules } from "@tax/rules";
import { scheduleVdaCsv } from "./csv.js";

export { scheduleVdaCsv } from "./csv.js";

const usage =
	"tax-tracker compute --ledger ledger.json --year 2026-27 [--settings s.json] [--out report.json] [--csv vda.csv]";
export async function main(
	args: string[] = process.argv.slice(2),
): Promise<void> {
	const [command, ...rest] = args;
	if (command === "import") {
		process.stdout.write("Importers come in Phase 1.\n");
		return;
	}
	if (command === "--help" || command === "help") {
		process.stdout.write(`${usage}\n`);
		return;
	}
	if (command !== "compute") throw new Error(usage);
	const { values } = parseArgs({
		args: rest,
		strict: true,
		options: {
			ledger: { type: "string" },
			year: { type: "string" },
			settings: { type: "string" },
			out: { type: "string" },
			csv: { type: "string" },
		},
	});
	if (!values.ledger || !values.year) throw new Error(usage);
	const taxYear = TaxYearSchema.parse(values.year);
	const transactions = LedgerTxSchema.array().parse(
		JSON.parse(await readFile(values.ledger, "utf8")),
	);
	const settings = EngineSettingsSchema.parse(
		values.settings ? JSON.parse(await readFile(values.settings, "utf8")) : {},
	);
	// Load bundled data only when a ledger value actually needs FX; INR-only reports work without it.
	const needsFx = transactions.some(
		(tx) =>
			(settings.feeTreatment === "include" &&
				tx.feeAsset !== undefined &&
				tx.feeAsset !== "INR") ||
			(tx.inrValue === undefined &&
				tx.assetIn !== "INR" &&
				tx.assetOut !== "INR" &&
				tx.priceQuote?.asset !== "INR"),
	);
	let fx = (() => null) as Awaited<ReturnType<typeof loadSbiCsv>>;
	if (needsFx) {
		try {
			fx = await loadSbiCsv();
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
			process.stderr.write(
				"Bundled SBI rates unavailable; FX-dependent values will be flagged unresolved.\n",
			);
		}
	}
	const report = computeVdaReport({
		transactions,
		rules: loadRules("india-vda", taxYear),
		settings,
		taxYear,
		fx,
	});
	const json = `${JSON.stringify(report, null, 2)}\n`;
	if (values.out) await writeFile(values.out, json, "utf8");
	else process.stdout.write(json);
	if (values.csv) await writeFile(values.csv, scheduleVdaCsv(report), "utf8");
}
if (
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	main().catch((error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : "Computation failed"}\n`,
		);
		process.exitCode = 1;
	});
}
