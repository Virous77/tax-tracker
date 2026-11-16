#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	EngineSettingsSchema,
	ImportSourceSchema,
	LedgerTxSchema,
	RecipeSchema,
	TaxYearSchema,
	TimezoneSchema,
} from "@tax/core";
import { computeVdaReport } from "@tax/engine";
import { importFile } from "@tax/importers";
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
		const { values, positionals } = parseArgs({
			args: rest,
			strict: true,
			allowPositionals: true,
			options: {
				source: { type: "string" },
				tz: { type: "string" },
				recipe: { type: "string" },
				out: { type: "string" },
			},
		});
		if (positionals.length !== 1 || !values.source || !values.tz || !values.out)
			throw new Error(
				"tax-tracker import <file> --source binance|coindcx|generic --tz IST|UTC [--recipe r.json] --out ledger.json",
			);
		const path = positionals[0];
		if (!path) throw new Error("An import file is required.");
		const source = ImportSourceSchema.parse(values.source);
		const timezone = TimezoneSchema.parse(values.tz);
		const recipe = values.recipe
			? RecipeSchema.parse(JSON.parse(await readFile(values.recipe, "utf8")))
			: undefined;
		const result = importFile(
			{ name: path, bytes: new Uint8Array(await readFile(path)) },
			{ source, timezone, recipe },
		);
		await writeFile(
			values.out,
			`${JSON.stringify(result.transactions, null, 2)}\n`,
			"utf8",
		);
		process.stderr.write(
			`${result.rowsRead} rows read; ${result.transactions.length} ledger rows; ${result.rowErrors.length} row errors.\n`,
		);
		if (result.rowErrors.length) {
			await writeFile(
				`${values.out}.errors.json`,
				`${JSON.stringify(result.rowErrors, null, 2)}\n`,
				"utf8",
			);
			process.stderr.write(
				`Review row errors in ${values.out}.errors.json before computing tax.\n`,
			);
			process.exitCode = 1;
		}
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
