import { expect, test } from "vitest";
import {
	createFxLookup,
	lastDayOfPreviousMonth,
	parseSbiCsv,
} from "../src/index.js";

test("SBI CSV and last publication on or before date", () => {
	const text =
		'DATE,PDF FILE,TT BUY,TT SELL\n2026-04-03,"file, two.pdf",84.20,85\n2026-04-01,one.pdf,84.10,85\n';
	const rows = parseSbiCsv(text);
	const lookup = createFxLookup(rows);
	if (rows[0]) rows[0].rate = "999";
	expect(lookup("USD", "2026-04-02")).toEqual({
		rate: "84.10",
		rateDate: "2026-04-01",
		source: "SBI TT buying",
	});
	expect(lookup("USD", "2026-04-03")?.rate).toBe("84.20");
	expect(lookup("USD", "2026-03-31")).toBeNull();
	expect(lookup("EUR", "2026-04-03")).toBeNull();
});
test("previous month handles leap years and January", () => {
	expect(lastDayOfPreviousMonth("2024-03-15")).toBe("2024-02-29");
	expect(lastDayOfPreviousMonth("2026-01-01")).toBe("2025-12-31");
	expect(() => lastDayOfPreviousMonth("2026-02-30")).toThrow();
});
test("malformed CSV is rejected rather than guessed", () => {
	expect(() => parseSbiCsv("DATE,TT SELL\n2026-04-01,85")).toThrow();
	expect(() => parseSbiCsv('DATE,TT BUY\n2026-04-01,"84')).toThrow();
});

test("archive timestamps, unavailable TT quotes and intraday order", () => {
	const rows = parseSbiCsv(
		"DATE,PDF FILE,TT BUY\n2026-04-01 14:00,b.pdf,84.20\n2026-04-01 09:00,a.pdf,84.10\n2026-04-02 09:00,c.pdf,0.00\n",
	);
	expect(createFxLookup(rows)("USD", "2026-04-02")).toEqual({
		rate: "84.20",
		rateDate: "2026-04-01",
		source: "SBI TT buying",
	});
});
