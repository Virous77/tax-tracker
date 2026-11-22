import { expect, test } from "vitest";
import {
	createFxLookup,
	DEFAULT_SBI_MAX_STALE_DAYS,
	lastDayOfPreviousMonth,
	loadSbiCsv,
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

test("FX staleness counts UTC calendar days across leap day", () => {
	const rows = parseSbiCsv("DATE,TT BUY\n2024-02-28,82.50");
	const lookup = createFxLookup(rows, { maxStaleDays: 2 });
	expect(lookup("USD", "2024-03-01")?.rateDate).toBe("2024-02-28");
	expect(lookup("USD", "2024-03-02")).toBeNull();
	expect(createFxLookup(rows)("USD", "2024-03-02")?.rateDate).toBe(
		"2024-02-28",
	);
});

test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
	"rejects invalid maxStaleDays %s",
	(maxStaleDays) => {
		expect(() => createFxLookup([], { maxStaleDays })).toThrow("maxStaleDays");
	},
);

test("the bundled SBI default covers historical month ends and rejects stale future dates", async () => {
	const lookup = await loadSbiCsv();
	for (let year = 2024; year <= 2026; year++) {
		const lastMonth = year === 2026 ? 10 : 12;
		for (let month = 1; month <= lastMonth; month++) {
			const date = new Date(Date.UTC(year, month, 0))
				.toISOString()
				.slice(0, 10);
			expect(lookup("USD", date), date).not.toBeNull();
		}
	}
	// The day before the next usable quote in the archive's longest gap.
	expect(lookup("USD", "2021-08-17")?.rateDate).toBe("2021-07-26");
	const lastPublication = "2026-11-13";
	expect(lookup("USD", lastPublication)?.rateDate).toBe(lastPublication);
	const cutoff = new Date(lastPublication);
	cutoff.setUTCDate(cutoff.getUTCDate() + DEFAULT_SBI_MAX_STALE_DAYS);
	expect(lookup("USD", cutoff.toISOString().slice(0, 10))?.rateDate).toBe(
		lastPublication,
	);
	cutoff.setUTCDate(cutoff.getUTCDate() + 1);
	expect(lookup("USD", cutoff.toISOString().slice(0, 10))).toBeNull();
	expect(lookup("USD", "2027-01-31")).toBeNull();
});

test("loading SBI rates accepts a zero-day age limit", async () => {
	const lookup = await loadSbiCsv(undefined, { maxStaleDays: 0 });
	expect(lookup("USD", "2026-11-13")?.rateDate).toBe("2026-11-13");
	expect(lookup("USD", "2026-11-14")).toBeNull();
});
