import { readdir, readFile } from "node:fs/promises";
import { D } from "@tax/core";
import { importFile, readSheets } from "../dist/index.js";

const directory = new URL("../../../data/real-exports/", import.meta.url);
const counts = (values) =>
	Object.fromEntries(
		[...new Set(values)]
			.sort()
			.map((value) => [
				value,
				values.filter((entry) => entry === value).length,
			]),
	);
let failed = false;
for (const name of (await readdir(directory))
	.filter((name) => /\.(csv|xlsx)$/i.test(name))
	.sort()) {
	const file = {
		name,
		bytes: new Uint8Array(await readFile(new URL(name, directory))),
	};
	try {
		const result = importFile(file, { timezone: "UTC" });
		const repeat = importFile(file, { timezone: "UTC" });
		const references = result.transactions.map(
			(tx) => `${tx.source}:${tx.sourceRef}`,
		);
		const stable = references.every(
			(ref, index) =>
				ref ===
				`${repeat.transactions[index]?.source}:${repeat.transactions[index]?.sourceRef}`,
		);
		const sheets = readSheets(file, { allowDuplicateHeaders: true });
		const pairs = [
			...new Set(
				sheets.flatMap((sheet) =>
					sheet.rows.flatMap((row) => (row.Pair ? [row.Pair] : [])),
				),
			),
		].sort();
		const skips = result.skippedRows ?? [];
		const accounted =
			result.transactions.length + result.rowErrors.length + skips.length ===
			result.rowsRead;
		failed ||=
			result.rowErrors.length > 0 ||
			!accounted ||
			!stable ||
			new Set(references).size !== references.length ||
			skips.some((row) => !row.reason);
		console.log(
			JSON.stringify({
				reportKind: result.reportKind,
				rowsRead: result.rowsRead,
				transactions: counts(result.transactions.map((tx) => tx.type)),
				skipped: counts(skips.map((row) => row.reason)),
				errors: counts(
					result.rowErrors.map((row) =>
						row.message.startsWith("[")
							? "Ledger validation failed; inspect locally."
							: row.message,
					),
				),
				timezoneUsed: result.detectedTimezone ?? "UTC",
				timezoneSource: result.timezoneSource,
				pairsSeen: pairs,
				uniqueReferences: new Set(references).size,
				stableReferences: stable ? references.length : 0,
				accountedRows: accounted ? result.rowsRead : 0,
				...(result.reportKind === "coindcx:order-history"
					? {
							feesNearHalfPercent: result.transactions.filter(
								(tx) =>
									tx.inrValue &&
									tx.feeAsset === "INR" &&
									tx.feeAmount &&
									D(tx.feeAmount)
										.div(tx.inrValue)
										.minus("0.005")
										.abs()
										.lte("0.001"),
							).length,
						}
					: {}),
			}),
		);
	} catch {
		failed = true;
		console.log(
			JSON.stringify({
				errors: { "File could not be parsed; inspect locally.": 1 },
			}),
		);
	}
}
if (failed) process.exitCode = 1;
