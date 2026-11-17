import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { REPORT_KIND_LABELS } from "../../packages/importers/src/labels";
import { allTx, compute, FIXTURES } from "./lib";
import { api, call, fail, ok, uploadP2, wipeP2 } from "./p2";

const KINDS = join(FIXTURES, "report-kinds");
const XLSX =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const read = (dir: string, name: string) =>
	new Uint8Array(readFileSync(join(dir, name)));
const ORDERS = "binance-spot-order-history(UTC+5).csv";

async function importOne(
	dir: string,
	name: string,
	fields: Parameters<typeof uploadP2>[2] = {},
) {
	const res = await uploadP2(read(dir, name), name, {
		type: name.endsWith(".xlsx") ? XLSX : "text/csv",
		...fields,
	});
	return ok(res, 201, api.CreateImportResponseSchema);
}
async function deleteImport(id: string) {
	expect((await call("DELETE", `/api/imports/${id}`)).status).toBe(204);
}

const CASES: [string, string, string, string | null, "file" | "user"][] = [
	[FIXTURES, "binance-deposits.csv", "binance:deposits", "UTC", "file"],
	[
		FIXTURES,
		"binance-deposits-2digit-year.csv",
		"binance:deposits",
		"UTC",
		"file",
	],
	[FIXTURES, ORDERS, "binance:spot-order-history", "+05:00", "file"],
	[
		FIXTURES,
		"binance-spot-order-history(UTC+5).xlsx",
		"binance:spot-order-history",
		"+05:00",
		"file",
	],
	[
		FIXTURES,
		"binance-trade-history-fee-coin-layout.csv",
		"binance:legacy-spot-trade-history",
		"UTC",
		"file",
	],
	[
		FIXTURES,
		"binance-trade-history.csv",
		"binance:spot-trade-history",
		"UTC",
		"file",
	],
	[
		FIXTURES,
		"binance-transaction-statement.csv",
		"binance:transaction-history",
		"UTC",
		"file",
	],
	[FIXTURES, "binance-withdrawals.csv", "binance:withdrawals", "UTC", "file"],
	[
		FIXTURES,
		"coindcx-order-history.csv",
		"coindcx:order-history",
		"UTC",
		"file",
	],
	[FIXTURES, "coindcx-report.xlsx", "coindcx:mixed", null, "user"],
	[KINDS, "binance-convert.csv", "binance:convert", null, "user"],
	[KINDS, "binance-convert.xlsx", "binance:convert", null, "user"],
	[KINDS, "binance-deposits.xlsx", "binance:deposits", "UTC", "file"],
	[KINDS, "binance-fiat-deposit.csv", "binance:fiat", "UTC", "file"],
	[KINDS, "binance-fiat-deposit.xlsx", "binance:fiat", "UTC", "file"],
	[
		KINDS,
		"binance-futures-trades-unverified.csv",
		"binance:futures-trades",
		"UTC",
		"file",
	],
	[
		KINDS,
		"binance-futures-transactions.csv",
		"binance:futures-transactions",
		"UTC",
		"file",
	],
	[
		KINDS,
		"binance-futures-transactions.xlsx",
		"binance:futures-transactions",
		"UTC",
		"file",
	],
	[
		KINDS,
		"binance-order-statuses.csv",
		"binance:spot-order-history",
		null,
		"user",
	],
	[
		KINDS,
		"binance-statement-all-operations.csv",
		"binance:transaction-history",
		"UTC",
		"file",
	],
	[
		KINDS,
		"binance-statement-all-operations.xlsx",
		"binance:transaction-history",
		"UTC",
		"file",
	],
	[
		KINDS,
		"binance-trade-assets-unverified.csv",
		"binance:spot-trade-history-assets",
		"UTC",
		"file",
	],
	[
		KINDS,
		"binance-trade-history-fee-coin-layout.xlsx",
		"binance:legacy-spot-trade-history",
		"UTC",
		"file",
	],
	[
		KINDS,
		"binance-trade-history.xlsx",
		"binance:spot-trade-history",
		"UTC",
		"file",
	],
	[
		KINDS,
		"binance-wallet-legacy-deposit.csv",
		"binance:wallet-history",
		"UTC",
		"file",
	],
	[
		KINDS,
		"binance-wallet-legacy-deposit.xlsx",
		"binance:wallet-history",
		"UTC",
		"file",
	],
	[KINDS, "binance-withdrawals.xlsx", "binance:withdrawals", "UTC", "file"],
	[
		KINDS,
		"coindcx-futures-inr-unverified.csv",
		"coindcx:futures-orders",
		null,
		"user",
	],
	[KINDS, "coindcx-options-unverified.csv", "coindcx:options", null, "user"],
	[KINDS, "coindcx-order-history.xlsx", "coindcx:order-history", "UTC", "file"],
	[KINDS, "coindcx-order-statuses.csv", "coindcx:order-history", "UTC", "file"],
];

describe("report kinds", () => {
	beforeAll(wipeP2);

	it.each(CASES)("%#: %s → %s", async (dir, name, kind, detected, tzSource) => {
		const imp = await importOne(dir, name);
		expect(imp).toMatchObject({
			status: "imported",
			kind: "file",
			reportKind: kind,
			reportKindLabel: REPORT_KIND_LABELS[kind],
			detectedTimezone: detected,
			timezoneSource: tzSource,
			timezone: "UTC",
		});
		expect(imp.rowsRead).toBe(
			imp.rowsInserted + imp.rowsDuplicate + imp.rowsError + imp.rowsSkipped,
		);
		const listed = ok(
			await call("GET", `/api/imports/${imp.id}`),
			200,
			api.GetImportResponseSchema,
		);
		expect(listed.reportKind).toBe(kind);
		expect(listed.reportKindLabel).toBe(REPORT_KIND_LABELS[kind]);
		if (imp.rowsInserted > 0 && kind !== "coindcx:mixed")
			expect(listed.coverage.map((c) => c.reportKind)).toContain(kind);
		await deleteImport(imp.id);
	});

	it("an unknown layout stays on the recipe path with reportKind null", async () => {
		const res = await uploadP2(
			read(FIXTURES, "generic-unknown-exchange.csv"),
			"generic-unknown-exchange.csv",
		);
		expect([200, 201, 202]).toContain(res.status);
		const imp = api.CreateImportResponseSchema.parse(res.body);
		expect(imp).toMatchObject({
			status: "pending_recipe",
			reportKind: null,
			reportKindLabel: null,
		});
		await deleteImport(imp.id);
	});
});

describe("order history: missing fees and time zones", () => {
	beforeAll(wipeP2);

	it("Order History warns that it has no fees and points at Trade History", async () => {
		const imp = await importOne(FIXTURES, ORDERS);
		const fee = imp.warnings.filter((w) => /no fees/i.test(w.message));
		expect(fee).toHaveLength(1);
		expect(fee[0]?.message).toMatch(/Trade History/);
		await deleteImport(imp.id);
	});

	it("file-name offset (UTC+5) wins over the user's IST and the conflict is warned", async () => {
		const imp = await importOne(FIXTURES, ORDERS, { timezone: "IST" });
		expect(imp).toMatchObject({
			timezone: "IST",
			detectedTimezone: "+05:00",
			timezoneSource: "file",
		});
		expect(
			imp.warnings.some(
				(w) => /\+05:00/.test(w.message) && /instead of/.test(w.message),
			),
		).toBe(true);
		const tx = await allTx({ source: "binance" });
		expect(tx.map((t) => t.timestamp)).toContain("2025-08-02T05:01:00.000Z");
		await deleteImport(imp.id);
	});

	it("the same offset chosen by the user gives no conflict warning", async () => {
		const imp = await importOne(FIXTURES, ORDERS, { timezone: "+05:00" });
		expect(imp.timezone).toBe("+05:00");
		expect(imp.warnings.some((w) => /instead of/.test(w.message))).toBe(false);
		await deleteImport(imp.id);
	});

	it("a fixed user offset (+04:00) applies when the file names none", async () => {
		const bytes = read(FIXTURES, ORDERS);
		const res = await uploadP2(bytes, "orders.csv", { timezone: "+04:00" });
		const imp = ok(res, 201, api.CreateImportResponseSchema);
		expect(imp).toMatchObject({
			timezone: "+04:00",
			timezoneSource: "user",
			detectedTimezone: null,
		});
		const tx = await allTx({ source: "binance" });
		expect(tx.map((t) => t.timestamp)).toContain("2025-08-02T06:01:00.000Z");
		await deleteImport(imp.id);
	});

	it.each(["-03:30", "+14:00", "-12:00", "+05:45"])(
		"offset %s is accepted",
		async (tz) => {
			const imp = ok(
				await uploadP2(read(FIXTURES, ORDERS), "orders.csv", { timezone: tz }),
				201,
				api.CreateImportResponseSchema,
			);
			expect(imp.timezone).toBe(tz);
			await deleteImport(imp.id);
		},
	);

	it.each([
		"+15:00",
		"+14:30",
		"-14:01",
		"+5:00",
		"05:00",
		"GMT",
		"+05:60",
		"Asia/Kolkata",
	])("time zone %s → 400", async (tz) => {
		fail(
			await uploadP2(read(FIXTURES, ORDERS), "orders.csv", { timezone: tz }),
			400,
		);
		const imports = ok(
			await call("GET", "/api/imports"),
			200,
			api.ListImportsResponseSchema,
		);
		expect(imports).toHaveLength(0);
	});
});

describe("futures and derivatives are flagged and never taxed", () => {
	let before: Awaited<ReturnType<typeof compute>>;
	beforeAll(async () => {
		await wipeP2();
		await importOne(FIXTURES, "binance-trade-history.csv");
		before = await compute("2025-26");
	});

	it.each([
		[KINDS, "binance-futures-transactions.csv"],
		[KINDS, "binance-futures-trades-unverified.csv"],
		[KINDS, "coindcx-futures-inr-unverified.csv"],
		[KINDS, "coindcx-options-unverified.csv"],
	])(
		"%#: %s rows are review-only with complex_onchain + unknown_type and no money legs",
		async (dir, name) => {
			const imp = await importOne(dir, name);
			expect(imp.rowsInserted).toBeGreaterThan(0);
			const tx = (await allTx()).filter((t) => t.importId === imp.id);
			for (const t of tx) {
				const codes = t.reviewFlags.map((f) => f.code);
				expect(codes, name).toEqual(
					expect.arrayContaining(["complex_onchain", "unknown_type"]),
				);
				expect(t.amountIn ?? null).toBeNull();
				expect(t.amountOut ?? null).toBeNull();
				expect(t.raw).toBeTruthy();
			}
		},
	);

	it("VDA totals, schedule rows and balances are unchanged by the derivative rows", async () => {
		const after = await compute("2025-26");
		expect(after.totals).toEqual(before.totals);
		expect(after.scheduleVdaRows).toEqual(before.scheduleVdaRows);
		expect(after.balances).toEqual(before.balances);
	});

	it("re-importing the same derivative file inserts nothing", async () => {
		const imp = await importOne(KINDS, "binance-futures-transactions.csv");
		expect(imp.rowsInserted).toBe(0);
		expect(imp.rowsDuplicate).toBeGreaterThan(0);
	});
});
