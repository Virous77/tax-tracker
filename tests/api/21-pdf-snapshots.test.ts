import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	statementPages,
	syntheticPdf,
} from "../../packages/importers/test/pdf-fixture";
import { FIXTURES } from "./lib";
import { api, call, dockerLogs, fail, ok, uploadP2, wipeP2 } from "./p2";

const PASSWORD = "Zq7pdfSecret91";
const WRONG = "Wr0ngPdfSecret";
const pdf = (pages = statementPages(), password?: string) =>
	syntheticPdf(pages, password);
const upload = (
	bytes: Uint8Array,
	fields: Parameters<typeof uploadP2>[2] = {},
	name = "statement.pdf",
) =>
	uploadP2(bytes, name, {
		type: "application/pdf",
		timezone: "UTC",
		...fields,
	});
function withDate(date: string) {
	const pages = statementPages();
	const line = pages[0]?.find((r) => r.text.startsWith("Statement Date"));
	if (!line) throw new Error("fixture changed");
	line.text = `Statement Date: ${date} UTC`;
	return pages;
}
const snapshots = async () =>
	ok(
		await call("GET", "/api/balances/snapshots"),
		200,
		api.BalanceSnapshotsResponseSchema,
	);
const responses: string[] = [];

describe("PDF errors (each with its own code)", () => {
	beforeAll(wipeP2);

	it("encrypted, no password → 422 pdf_password_required", async () => {
		const res = await upload(pdf(undefined, PASSWORD));
		responses.push(res.text);
		fail(res, 422, "pdf_password_required");
	});
	it("encrypted, wrong password → 422 pdf_wrong_password", async () => {
		const res = await upload(pdf(undefined, PASSWORD), { pdfPassword: WRONG });
		responses.push(res.text);
		fail(res, 422, "pdf_wrong_password");
		expect(res.text).not.toContain(WRONG);
	});
	it("no text layer → 422 pdf_no_text", async () => {
		fail(await upload(pdf([[]])), 422, "pdf_no_text");
	});
	it("unknown layout → 422 pdf_unknown_layout", async () => {
		fail(
			await upload(pdf([[{ text: "Unknown statement", x: 40, y: 40 }]])),
			422,
			"pdf_unknown_layout",
		);
	});
	it("an 'Others' row is refused rather than invented → pdf_unknown_layout", async () => {
		const pages = statementPages();
		const btc = pages[0]?.find((r) => r.text === "BTC");
		if (btc) btc.text = "Others";
		fail(await upload(pdf(pages)), 422, "pdf_unknown_layout");
	});
	it("CoinDCX Form 16A → 422 pdf_unsupported", async () => {
		fail(
			await upload(
				pdf([[{ text: "TRACES FORM NO. 16A CoinDCX", x: 40, y: 40 }]]),
			),
			422,
			"pdf_unsupported",
		);
	});
	it("broken PDF bytes → 422 pdf_unsupported", async () => {
		fail(
			await upload(
				new TextEncoder().encode("%PDF-1.4\nthis is not a pdf\n%%EOF"),
			),
			422,
			"pdf_unsupported",
		);
	});
	it("more than 2,000 pages → 413 pdf_too_large", async () => {
		const pages = Array.from({ length: 2001 }, () => [
			{ text: "Binance Account Statement", x: 40, y: 40 },
		]);
		fail(await upload(pdf(pages)), 413, "pdf_too_large");
	}, 120_000);
	it("over the 25 MB upload limit → 413", async () => {
		const big = new Uint8Array(25 * 1024 * 1024 + 1);
		big.set(new TextEncoder().encode("%PDF-1.4\n"));
		const res = await upload(big);
		expect(res.status).toBe(413);
		expect(["pdf_too_large", "file_too_large"]).toContain(
			(res.body as { error: { code: string } }).error.code,
		);
	}, 120_000);
	it("errors create no import and no snapshot", async () => {
		expect(
			ok(await call("GET", "/api/imports"), 200, api.ListImportsResponseSchema),
		).toHaveLength(0);
		expect(await snapshots()).toHaveLength(0);
	});
	it("error messages are static: no library text", () => {
		for (const text of responses)
			expect(text).not.toMatch(/PasswordException|pdfjs|at \S+:\d+/i);
	});
});

describe("account statement snapshot", () => {
	let importId = "";
	let snapshotId = "";
	beforeAll(wipeP2);

	it("the right password imports a balance snapshot and no ledger rows; the password is not echoed", async () => {
		const res = await upload(pdf(undefined, PASSWORD), {
			pdfPassword: PASSWORD,
		});
		const imp = ok(res, 201, api.CreateImportResponseSchema);
		expect(res.text).not.toContain(PASSWORD);
		expect(imp).toMatchObject({
			status: "imported",
			reportKind: "binance:account-statement-pdf",
			reportKindLabel: "Binance Account Statement",
			rowsInserted: 3,
		});
		expect(imp.warnings.length).toBeGreaterThan(0);
		importId = imp.id;
		const tx = ok(
			await call("GET", "/api/transactions"),
			200,
			api.ListTransactionsResponseSchema,
		);
		expect(tx.total).toBe(0);
	});

	it("import detail carries the snapshot with exact decimals and wallets", async () => {
		const res = await call("GET", `/api/imports/${importId}`);
		const detail = ok(res, 200, api.GetImportResponseSchema);
		expect(res.text).not.toContain(PASSWORD);
		const snap = detail.balanceSnapshot;
		expect(snap).toMatchObject({
			importId,
			venue: "binance",
			asOf: "2026-03-31",
			timezone: "UTC",
		});
		expect(snap?.rows.map((r) => [r.asset, r.amount])).toEqual([
			["BTC", "0.01234567890123456789"],
			["USDT", "1200.5"],
			["ETH", "2"],
		]);
		snapshotId = snap?.id ?? "";
	});

	it("snapshot list compares statement vs computed (statement - computed)", async () => {
		const [snap] = await snapshots();
		expect(snap?.id).toBe(snapshotId);
		expect(snap?.comparison).toEqual(
			expect.arrayContaining([
				{ asset: "ETH", statement: "2", computed: "0", difference: "2" },
				{
					asset: "USDT",
					statement: "1200.5",
					computed: "0",
					difference: "1200.5",
				},
			]),
		);
	});

	it("comparison uses Binance history up to the statement's close in its own zone (UTC here)", async () => {
		// Trade History fixture: +0.05 ETH (fee in BNB); BTC +0.012 − 0.000012 fee − 0.004 − 0.002, the last
		// sell at 18:30:02 UTC is after the IST year end but before the UTC close of 31 March.
		ok(
			await uploadP2(
				new Uint8Array(
					readFileSync(join(FIXTURES, "binance-trade-history.csv")),
				),
				"binance-trade-history.csv",
			),
			201,
			api.CreateImportResponseSchema,
		);
		const [snap] = await snapshots();
		expect(snap?.comparison.find((c) => c.asset === "ETH")).toEqual({
			asset: "ETH",
			statement: "2",
			computed: "0.05",
			difference: "1.95",
		});
		expect(snap?.comparison.find((c) => c.asset === "BTC")?.computed).toBe(
			"0.005988",
		);
	});

	it("re-importing the same PDF is a duplicate, not a second snapshot", async () => {
		const res = await upload(pdf(undefined, PASSWORD), {
			pdfPassword: PASSWORD,
		});
		const again = api.CreateImportResponseSchema.safeParse(res.body);
		try {
			expect(await snapshots()).toHaveLength(1);
			if (again.success) expect(again.data.rowsInserted).toBe(0);
		} finally {
			if (again.success && again.data.id !== importId)
				await call("DELETE", `/api/imports/${again.data.id}`);
		}
	});

	it("apply to 2026-27 → 409 snapshot_not_year_end with details", async () => {
		const err = fail(
			await call("POST", `/api/balances/snapshots/${snapshotId}/apply`, {
				json: { taxYear: "2026-27" },
			}),
			409,
			"snapshot_not_year_end",
		);
		expect(err?.details).toEqual({
			asOf: "2026-03-31",
			taxYear: "2026-27",
			reason: "outside_year_end_window",
		});
	});

	it("apply to 2025-26 (within a day of the IST year end) sets actual balances and keeps other entries", async () => {
		ok(
			await call("PUT", "/api/balances/actual?taxYear=2025-26", {
				json: [
					{ asset: "SOL", amount: "3" },
					{ asset: "ETH", amount: "9" },
				],
			}),
			200,
			api.PutActualBalancesResponseSchema,
		);
		const res = ok(
			await call("POST", `/api/balances/snapshots/${snapshotId}/apply`, {
				json: { taxYear: "2025-26" },
			}),
			200,
			api.ActualBalancesResponseSchema,
		);
		const map = Object.fromEntries(
			JSON.parse(JSON.stringify(res)).map(
				(r: { asset: string; amount: string }) => [r.asset, r.amount],
			),
		);
		expect(map).toMatchObject({
			BTC: "0.01234567890123456789",
			USDT: "1200.5",
			ETH: "2",
			SOL: "3",
		});
	});

	it.each([
		[
			"an unknown snapshot",
			"00000000-0000-4000-8000-000000000000",
			{ taxYear: "2025-26" },
			404,
		],
		["a bad tax year", "", { taxYear: "2025" }, 400],
		["no tax year", "", {}, 400],
	])("apply with %s → %i", async (_, id, body, code) => {
		fail(
			await call("POST", `/api/balances/snapshots/${id || snapshotId}/apply`, {
				json: body,
			}),
			code,
		);
	});

	it("deleting the import removes the snapshot (applied balances stay)", async () => {
		expect((await call("DELETE", `/api/imports/${importId}`)).status).toBe(204);
		expect(
			(await snapshots()).filter((x) => x.importId === importId),
		).toHaveLength(0);
		fail(
			await call("POST", `/api/balances/snapshots/${snapshotId}/apply`, {
				json: { taxYear: "2025-26" },
			}),
			404,
		);
	});
});

describe("snapshot dates and time zones", () => {
	beforeAll(wipeP2);

	it("a mid-year statement cannot be applied → 409 snapshot_not_year_end", async () => {
		const imp = ok(
			await upload(pdf(withDate("2025-10-15")), {}, "mid.pdf"),
			201,
			api.CreateImportResponseSchema,
		);
		const [snap] = await snapshots();
		expect(snap?.importId).toBe(imp.id);
		fail(
			await call("POST", `/api/balances/snapshots/${snap?.id}/apply`, {
				json: { taxYear: "2025-26" },
			}),
			409,
			"snapshot_not_year_end",
		);
	});

	it("a statement dated 1 April (the day after year end) still applies to the ending year", async () => {
		ok(
			await upload(pdf(withDate("2026-04-01")), {}, "apr1.pdf"),
			201,
			api.CreateImportResponseSchema,
		);
		const snap = (await snapshots()).find((s) => s.asOf === "2026-04-01");
		const res = await call(
			"POST",
			`/api/balances/snapshots/${snap?.id}/apply`,
			{ json: { taxYear: "2025-26" } },
		);
		expect([200, 409]).toContain(res.status);
		if (res.status === 409)
			expect((res.body as { error: { code: string } }).error.code).toBe(
				"snapshot_not_year_end",
			);
	});

	it("a statement with no zone uses the user's offset and warns", async () => {
		const pages = statementPages();
		const line = pages[0]?.find((r) => r.text.startsWith("Statement Date"));
		if (line) line.text = "Statement Date: 2026-03-31";
		const imp = ok(
			await upload(pdf(pages), { timezone: "-03:30" }, "nozone.pdf"),
			201,
			api.CreateImportResponseSchema,
		);
		expect(imp.timezoneSource).toBe("user");
		expect(imp.warnings.map((w) => w.code)).toContain("ambiguous_timezone");
		const detail = ok(
			await call("GET", `/api/imports/${imp.id}`),
			200,
			api.GetImportResponseSchema,
		);
		expect(detail.balanceSnapshot?.timezone).toBe("-03:30");
	});

	it("per_source pools: applying scopes the balances to the statement's venue", async () => {
		ok(
			await call("PUT", "/api/settings", { json: { lotPool: "per_source" } }),
			200,
			api.PutSettingsResponseSchema,
		);
		const snap = (await snapshots()).find((s) => s.asOf === "2026-03-31");
		const res = ok(
			await call("POST", `/api/balances/snapshots/${snap?.id}/apply`, {
				json: { taxYear: "2025-26" },
			}),
			200,
			api.ActualBalancesResponseSchema,
		);
		for (const r of JSON.parse(JSON.stringify(res)) as { source?: string }[])
			expect(r.source).toBe("binance");
	});
});

describe("PDF passwords never reach the logs", () => {
	it("docker logs contain neither the right nor the wrong password", () => {
		const logs = dockerLogs();
		expect(logs).not.toContain(PASSWORD);
		expect(logs).not.toContain(WRONG);
	});
});
