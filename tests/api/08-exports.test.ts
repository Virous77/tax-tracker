import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	addManual,
	api,
	call,
	compute,
	edge,
	fail,
	fingerprintOf,
	importOk,
	injectionRecipe,
	ok,
	useMockAi,
	wipe,
} from "./lib";
import { parseCsv, unzip, xmlText } from "./zip";

const DISCLAIMER =
	"Not tax advice. Have a Chartered Accountant review before filing.";
const XLSX =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const INJECTED = ["=1+1", "+2+3", "=cmd|calc!A0", "+cmd"];
const exportUrl = (year: string, format: string, kind: string) =>
	`/api/reports/${year}/export?format=${format}&kind=${kind}`;

beforeAll(async () => {
	await wipe();
	await useMockAi();
	const s = await importOk(edge("csv-injection.csv"), "csv-injection.csv", {
		source: "auto",
		timezone: "IST",
	});
	const recipe = injectionRecipe(await fingerprintOf(s.id));
	ok(
		await call("POST", `/api/imports/${s.id}/confirm`, {
			json: { recipe, saveRecipe: false },
		}),
		200,
		api.ConfirmImportResponseSchema,
	);
	await addManual({
		timestamp: "2025-07-01T00:00:00.000Z",
		type: "income",
		incomeKind: "staking",
		assetIn: "DOT",
		amountIn: "2",
		inrValue: "1000",
	});
	await addManual({
		timestamp: "2025-07-02T00:00:00.000Z",
		type: "gift",
		assetIn: "ADA",
		amountIn: "100",
		inrValue: "60000",
		userNote: '=HYPERLINK("http://evil")',
	});
	await compute("2025-26");
});
afterAll(wipe);

describe.each(["schedule-vda", "tds", "income", "full"])("kind=%s", (kind) => {
	it("csv: 200, text/csv, attachment filename, disclaimer + settings + section status", async () => {
		const res = await call("GET", exportUrl("2025-26", "csv", kind));
		expect(res.status, res.text.slice(0, 300)).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
		expect(res.headers.get("content-disposition")).toBe(
			`attachment; filename="tax-tracker-2025-26-${kind}.csv"`,
		);
		expect(res.headers.get("cache-control")).toContain("no-store");
		const rows = parseCsv(res.text);
		expect(rows[0][0]).toBe(DISCLAIMER);
		expect(rows).toContainEqual(["Setting", "Value"]);
		expect(rows).toContainEqual(["Fee & GST treatment", "Exclude fees"]);
		expect(rows).toContainEqual(["Surcharge rate", "0%"]);
		expect(rows).toContainEqual(["Section", "Reference"]);
		expect(rows).toContainEqual(["VDA Tax", "Section 115BBH"]);
		expect(
			rows.some((row) => row[0] === "Settings" || row[0] === "Sections"),
		).toBe(false);
		expect(res.text).toMatch(/pending CA verification/);
	});

	it("xlsx: 200, valid zip workbook with sheets, disclaimer and settings", async () => {
		const res = await call("GET", exportUrl("2025-26", "xlsx", kind));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe(XLSX);
		expect(res.headers.get("content-disposition")).toBe(
			`attachment; filename="tax-tracker-2025-26-${kind}.xlsx"`,
		);
		expect([...res.bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		const files = unzip(res.bytes);
		expect(files.has("[Content_Types].xml")).toBe(true);
		const workbook = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
		const sheetNames = [
			...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g),
		].map((m) => m[1]);
		expect(sheetNames.length).toBeGreaterThan(0);
		const sheets = [...files.keys()].filter((k) =>
			/^xl\/worksheets\/sheet\d+\.xml$/.test(k),
		);
		expect(sheets.length).toBe(sheetNames.length);
		const allText = sheets
			.flatMap((k) => xmlText(files.get(k)?.toString("utf8") ?? ""))
			.join("\n");
		expect(allText).toContain(DISCLAIMER);
		expect(allText).toContain("Fee & GST treatment");
		expect(allText).toContain("Exclude fees");
		expect(allText).toContain("VDA Tax");
		expect(allText).toContain("Section 115BBH");
		expect(allText).not.toContain("feeTreatment");
		for (const k of sheets)
			expect(files.get(k)?.toString("utf8"), `${k} has a formula`).not.toMatch(
				/<f[ >]/,
			);
	});
});

describe("formula injection", () => {
	it("full CSV prefixes every formula-leading text cell with a quote", async () => {
		const res = await call("GET", exportUrl("2025-26", "csv", "full"));
		const cells = parseCsv(res.text).flat();
		for (const v of INJECTED) {
			expect(cells, `${v} should be escaped`).toContain(`'${v}`);
			expect(cells, `${v} must not appear raw`).not.toContain(v);
		}
		const dangerous = cells.filter(
			(c) =>
				/^[=+@\t\r]/.test(c) || (/^-/.test(c) && !/^-\d+(\.\d+)?$/.test(c)),
		);
		expect(dangerous).toEqual([]);
	});

	it("XLSX stores the same values as literal inline strings, never formulas", async () => {
		const res = await call("GET", exportUrl("2025-26", "xlsx", "full"));
		const files = unzip(res.bytes);
		const xml = [...files.entries()]
			.filter(([k]) => k.startsWith("xl/worksheets/"))
			.map(([, v]) => v.toString("utf8"))
			.join("");
		expect(xml).not.toMatch(/<f[ >]/);
		const text = xmlText(xml);
		for (const v of INJECTED)
			expect(
				text.some((t) => t === v || t === `'${v}`),
				v,
			).toBe(true);
	});
});

describe("content", () => {
	it("schedule-vda CSV has one data row per Schedule VDA row of the report", async () => {
		const report = ok(
			await call("GET", "/api/reports/2025-26"),
			200,
			api.GetReportResponseSchema,
		);
		const res = await call("GET", exportUrl("2025-26", "csv", "schedule-vda"));
		for (const row of report.scheduleVdaRows) {
			if (row.considerationReceived)
				expect(res.text).toContain(row.considerationReceived);
		}
		expect(report.scheduleVdaRows.length).toBeGreaterThan(0);
	});

	it("income CSV lists the staking receipt and the gift", async () => {
		const res = await call("GET", exportUrl("2025-26", "csv", "income"));
		expect(res.text).toContain("DOT");
		expect(res.text).toContain("ADA");
	});
});

describe("errors", () => {
	it.each([
		["format=pdf&kind=full"],
		["format=csv&kind=everything"],
		["format=csv"],
		["kind=full"],
		[""],
	])("bad query '%s' → 400", async (q) => {
		fail(
			await call("GET", `/api/reports/2025-26/export?${q}`),
			400,
			"validation_error",
		);
	});

	it("bad tax year → 400", async () => {
		fail(
			await call("GET", exportUrl("20xx", "csv", "full")),
			400,
			"validation_error",
		);
	});

	it("no stored report → 404", async () => {
		fail(
			await call("GET", exportUrl("2026-27", "csv", "full")),
			404,
			"report_not_computed",
		);
	});
});
