import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	binanceReportKinds,
	coindcxReportKinds,
	importFile,
	parseBinance,
	parseCoinDcx,
	REPORT_KIND_LABELS,
	readSheets,
	writeXlsx,
} from "../src/index.js";

function fixture(name: string) {
	return {
		name,
		bytes: new Uint8Array(
			readFileSync(new URL(`./fixtures/${name}`, import.meta.url)),
		),
	};
}
const cases = [
	["binance-convert", "binance:convert", false],
	["binance-fiat-deposit", "binance:fiat", false],
	["binance-wallet-legacy-deposit", "binance:wallet-history", false],
	[
		"binance-trade-assets-unverified",
		"binance:spot-trade-history-assets",
		true,
	],
	["binance-futures-trades-unverified", "binance:futures-trades", true],
	["binance-futures-transactions", "binance:futures-transactions", false],
	["coindcx-futures-inr-unverified", "coindcx:futures-orders", true],
	["coindcx-options-unverified", "coindcx:options", true],
	["binance-statement-all-operations", "binance:transaction-history", false],
] as const;
describe("catalogue report kinds", () => {
	it.each(cases)(
		"imports %s as CSV and XLSX with stable identities and raw provenance",
		(name, kind, unverified) => {
			const csv = importFile(fixture(`report-kinds/${name}.csv`), {
				timezone: "+05:30",
			});
			const xlsx = importFile(fixture(`report-kinds/${name}.xlsx`), {
				timezone: "+05:30",
			});
			for (const result of [csv, xlsx]) {
				expect(result.reportKind).toBe(kind);
				expect(REPORT_KIND_LABELS[kind]).toBeTruthy();
				expect(result.rowErrors).toEqual([]);
				expect(
					result.transactions.length + (result.skippedRows?.length ?? 0),
				).toBe(result.rowsRead);
				expect(result.transactions.every((tx) => tx.raw !== undefined)).toBe(
					true,
				);
				if (unverified)
					expect(result.warnings).toContainEqual({
						code: "parse_warning",
						message: expect.stringContaining("unverified"),
					});
			}
			expect(xlsx.transactions.map((tx) => tx.sourceRef)).toEqual(
				csv.transactions.map((tx) => tx.sourceRef),
			);
			const repeat = importFile(fixture(`report-kinds/${name}.csv`), {
				timezone: "+05:30",
			});
			expect(
				repeat.transactions.map((tx) => [tx.source, tx.sourceRef]),
			).toEqual(csv.transactions.map((tx) => [tx.source, tx.sourceRef]));
			expect(new Set(csv.transactions.map((tx) => tx.sourceRef)).size).toBe(
				csv.transactions.length,
			);
			if (kind.includes("futures") || kind.includes("options"))
				for (const tx of csv.transactions) {
					expect(tx).toMatchObject({
						type: "fee",
						reviewFlags: expect.arrayContaining([
							expect.objectContaining({
								code: "complex_onchain",
								message: expect.stringContaining("CA question"),
							}),
						]),
					});
					expect([
						tx.assetIn,
						tx.amountIn,
						tx.assetOut,
						tx.amountOut,
						tx.feeAmount,
						tx.tdsInr,
					]).toEqual([
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
					]);
				}
		},
	);
	it.each([
		"binance-trade-history",
		"binance-trade-history-fee-coin-layout",
		"binance-deposits",
		"binance-withdrawals",
		"coindcx-order-history",
	])("keeps %s CSV and XLSX effects identical", (name) => {
		const csv = importFile(fixture(`${name}.csv`), { timezone: "IST" });
		const xlsx = importFile(fixture(`report-kinds/${name}.xlsx`), {
			timezone: "IST",
		});
		expect(xlsx.rowErrors).toEqual([]);
		expect(xlsx.transactions.map(({ id: _, ...tx }) => tx)).toEqual(
			csv.transactions.map(({ id: _, ...tx }) => tx),
		);
	});
	it("maps every documented statement operation and preserves unknown and negative distributions for review", () => {
		const result = importFile(
			fixture("report-kinds/binance-statement-all-operations.csv"),
			{ timezone: "IST" },
		);
		expect(result.detectedTimezone).toBe("UTC");
		for (const incomeKind of [
			"interest",
			"staking",
			"airdrop",
			"referral",
			"mining",
		])
			expect(
				result.transactions.some((tx) => tx.incomeKind === incomeKind),
			).toBe(true);
		expect(
			result.transactions.filter((tx) => tx.type === "deposit"),
		).toHaveLength(3);
		expect(
			result.transactions.filter((tx) => tx.type === "withdrawal"),
		).toHaveLength(4);
		expect(
			result.transactions.filter(
				(tx) =>
					tx.type === "transfer" &&
					!tx.reviewFlags.some((flag) => flag.code === "unknown_type"),
			),
		).toHaveLength(17);
		for (const tx of result.transactions.filter(
			(tx) =>
				!Array.isArray(tx.raw) &&
				[
					"New Operation Not In Catalogue",
					"Unknown Without Change",
					"Distribution",
				].includes((tx.raw as Record<string, string>).Operation ?? ""),
		)) {
			if (tx.type === "income") continue;
			expect(tx.reviewFlags).toContainEqual(
				expect.objectContaining({ code: "unknown_type" }),
			);
			expect(tx.assetIn).toBeUndefined();
		}
	});
	it("flags uncompleted wallet records without a balance effect and retains hashes on completed moves", () => {
		const sheets = readSheets(fixture("binance-withdrawals.csv"));
		const raw = sheets[0]?.rows[0];
		if (!raw) throw new Error("Missing fixture");
		const hash = raw.TXID;
		expect(
			parseBinance(sheets, { timezone: "IST" }).transactions[0]?.txHash,
		).toBe(hash);
		raw.Status = "Unverified new status";
		expect(
			parseBinance(sheets, { timezone: "IST" }).transactions[0],
		).toMatchObject({
			type: "fee",
			reviewFlags: [expect.objectContaining({ code: "unknown_type" })],
			raw,
		});
	});
	it("handles every documented order status without dropping zero-execution raw rows", () => {
		for (const status of [
			"FILLED",
			"PARTIALLY_FILLED",
			"CANCELED",
			"NEW",
			"PENDING_CANCEL",
			"REJECTED",
			"EXPIRED",
			"EXPIRED_IN_MATCH",
		]) {
			const sheets = readSheets(
				fixture("binance-spot-order-history(UTC+5).csv"),
				{ allowDuplicateHeaders: true },
			);
			const row = sheets[0]?.rows[0];
			if (!row || !sheets[0]) throw new Error("Missing fixture");
			row.Status = status;
			row["Executed²"] = "01INCH";
			sheets[0].rows = [row];
			const result = parseBinance(sheets, { timezone: "+05:30" });
			expect(result.rowErrors).toEqual([]);
			expect(result.transactions).toEqual([]);
			expect(result.skippedRows?.[0]?.raw).toEqual(row);
		}
		for (const status of [
			"init",
			"open",
			"partially_filled",
			"filled",
			"partially_cancelled",
			"cancelled",
			"rejected",
		]) {
			const sheets = readSheets(fixture("coindcx-order-history.csv"));
			const row = sheets[0]?.rows[0];
			if (!row || !sheets[0]) throw new Error("Missing fixture");
			row.Status = status;
			row["Remaining Quantity"] = row["Total Quantity"] ?? "";
			sheets[0].rows = [row];
			expect(
				parseCoinDcx(sheets, { timezone: "IST" }).skippedRows?.[0]?.raw,
			).toEqual(row);
		}
	});
	it("splits GST only when explicitly supplied and retains float-noise prices", () => {
		const sheets = readSheets(fixture("coindcx-order-history.csv"));
		const row = sheets[0]?.rows[0];
		if (!row) throw new Error("Missing fixture");
		row["Avg Price"] = "80.99999999999999";
		const tx = parseCoinDcx(sheets, { timezone: "IST" }).transactions[0];
		expect(tx?.priceQuote?.price).toBe("80.99999999999999");
		expect(tx?.gstInr).toBeUndefined();
		expect(tx?.reviewFlags.map((f) => f.message).join(" ")).toContain(
			"float noise",
		);
		expect(tx?.reviewFlags.map((f) => f.message).join(" ")).toContain("GST");
		const reportSheets = readSheets(fixture("coindcx-report.xlsx"));
		const sheet = reportSheets[0];
		const reportRow = sheet?.rows[0];
		if (!sheet || !reportRow) throw new Error("Missing fixture");
		sheet.headers.push("GST(in INR)");
		reportRow["GST(in INR)"] = "1.8";
		expect(
			parseCoinDcx([sheet], { timezone: "IST" }).transactions[0]?.gstInr,
		).toBe("1.8");
	});
	it("leaves unknown wallet and TDS layouts to recipes instead of guessing columns", () => {
		for (const headers of [
			["Mystery", "Wallet"],
			["TDS", "Financial Year"],
		]) {
			const bytes = writeXlsx([
				{ name: "TDS Summary", rows: [headers, ["unknown", "unknown"]] },
			]);
			expect(() =>
				importFile({ name: "coindcx.xlsx", bytes }, { timezone: "IST" }),
			).toThrow("Unknown layout");
		}
	});
	it("sets a label for every registered kind and marks tolerant kinds explicitly", () => {
		for (const kind of [...binanceReportKinds, ...coindcxReportKinds])
			expect(REPORT_KIND_LABELS[kind.id]).toBeTruthy();
		expect(
			coindcxReportKinds.find((k) => k.id === "coindcx:options")?.verified,
		).toBe(false);
	});
});

it("uses the Binance quantity suffixes to split a previously unknown quote symbol", () => {
	const sheets = readSheets(fixture("binance-spot-order-history(UTC+5).csv"), {
		allowDuplicateHeaders: true,
	});
	const sheet = sheets[0];
	const row = sheet?.rows[0];
	if (!sheet || !row) throw new Error("Missing synthetic order");
	row.Pair = "1INCHNEWQUOTE";
	row["Trading total³"] = "24NEWQUOTE";
	sheet.rows = [row];
	expect(
		parseBinance(sheets, { timezone: "UTC" }).transactions[0],
	).toMatchObject({
		assetIn: "1INCH",
		assetOut: "NEWQUOTE",
		amountIn: "12",
		amountOut: "24",
	});
});

it.each(["binance", "coindcx"])(
	"imports the complete %s status fixtures as CSV and XLSX",
	(venue) => {
		for (const format of ["csv", "xlsx"]) {
			const result = importFile(
				fixture(`report-kinds/${venue}-order-statuses.${format}`),
				{ timezone: "UTC" },
			);
			expect(result.rowErrors).toEqual([]);
			expect(result.rowsRead).toBe(venue === "binance" ? 8 : 7);
			expect(result.skippedRows).toHaveLength(result.rowsRead);
		}
	},
);
