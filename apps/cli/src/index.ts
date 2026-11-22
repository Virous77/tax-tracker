#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	EngineSettingsSchema,
	EquityCyPriceSchema,
	EquityMetadataSchema,
	ImportSourceSchema,
	LedgerTxSchema,
	RecipeSchema,
	TaxYearSchema,
	TimezoneSchema,
	UsEquityExportKindSchema,
} from "@tax/core";
import { computeUsEquityReport, computeVdaReport } from "@tax/engine";
import { importFileAsync } from "@tax/importers";
import { loadSbiCsv } from "@tax/rates";
import { loadRules } from "@tax/rules";
import { scheduleVdaCsv } from "./csv.js";
import { usEquityCsv } from "./us-equity-csv.js";

export { scheduleVdaCsv } from "./csv.js";
export { usEquityCsv } from "./us-equity-csv.js";

const usage =
	"tax-tracker compute --ledger ledger.json --year 2026-27 [--regime vda|us-equity] [--settings s.json] [--out report.json] [--csv report.csv] [--metadata metadata.json] [--prices prices.json] [--csv-kind capital-gains|dividends|form67|schedule-fa|full]";
const importUsage =
	"tax-tracker import <file> --source auto|binance|coindcx|vested|generic --tz IST|UTC [--recipe r.json] --out ledger.json";
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
			throw new Error(importUsage);
		const path = positionals[0];
		if (!path) throw new Error("An import file is required.");
		const source = ImportSourceSchema.parse(values.source);
		const timezone = TimezoneSchema.parse(values.tz);
		const recipe = values.recipe
			? RecipeSchema.parse(JSON.parse(await readFile(values.recipe, "utf8")))
			: undefined;
		const result = await importFileAsync(
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
		process.stdout.write(`${usage}\n${importUsage}\n`);
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
			regime: { type: "string", default: "vda" },
			metadata: { type: "string" },
			prices: { type: "string" },
			"csv-kind": { type: "string" },
		},
	});
	if (!values.ledger || !values.year) throw new Error(usage);
	if (values.regime !== "vda" && values.regime !== "us-equity")
		throw new Error("--regime must be vda or us-equity.");
	const equity = values.regime === "us-equity";
	if (!equity && (values.metadata || values.prices || values["csv-kind"]))
		throw new Error(
			"--metadata, --prices and --csv-kind require --regime us-equity.",
		);
	if (values["csv-kind"] && !values.csv)
		throw new Error("--csv-kind requires --csv.");
	const csvKind = UsEquityExportKindSchema.parse(values["csv-kind"] ?? "full");
	const taxYear = TaxYearSchema.parse(values.year);
	const transactions = LedgerTxSchema.array().parse(
		JSON.parse(await readFile(values.ledger, "utf8")),
	);
	const settings = EngineSettingsSchema.parse(
		values.settings ? JSON.parse(await readFile(values.settings, "utf8")) : {},
	);
	// Load bundled data only when a ledger value actually needs FX; INR-only reports work without it.
	const needsFx = transactions.some((tx) => {
		if (equity) return tx.assetClass === "us_equity";
		if (tx.assetClass === "us_equity") return false;
		return (
			(settings.feeTreatment === "include" &&
				tx.feeAsset !== undefined &&
				tx.feeAsset !== "INR") ||
			(tx.inrValue === undefined &&
				tx.assetIn !== "INR" &&
				tx.assetOut !== "INR" &&
				tx.priceQuote?.asset !== "INR")
		);
	});
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
	const common = { transactions, settings, taxYear, fx };
	const report = equity
		? computeUsEquityReport({
				...common,
				rules: loadRules("india-us-equity", taxYear),
				metadata: values.metadata
					? EquityMetadataSchema.array().parse(
							JSON.parse(await readFile(values.metadata, "utf8")),
						)
					: undefined,
				cyPrices: values.prices
					? EquityCyPriceSchema.array().parse(
							JSON.parse(await readFile(values.prices, "utf8")),
						)
					: undefined,
			})
		: computeVdaReport({ ...common, rules: loadRules("india-vda", taxYear) });
	const json = `${JSON.stringify(report, null, 2)}\n`;
	if (values.out) await writeFile(values.out, json, "utf8");
	else process.stdout.write(json);
	if (values.csv) {
		const csv =
			"capitalGains" in report
				? usEquityCsv(report, csvKind)
				: scheduleVdaCsv(report);
		await writeFile(values.csv, csv, "utf8");
	}
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
