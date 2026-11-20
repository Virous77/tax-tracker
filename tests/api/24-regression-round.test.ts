import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { taxYearOf } from "../../packages/core/dist/time.js";
import {
	addManual,
	allTx,
	compute,
	FIXTURES,
	fixture,
	importOk,
	manual,
	upload,
} from "./lib";
import {
	addBinance,
	addCoindcx,
	addEvm,
	api,
	balances,
	call,
	connections,
	fail,
	KEYS,
	mockDay,
	ok,
	putProvider,
	SYNC_TIMEOUT,
	syncOk,
	WALLET_A,
	wipeP2,
} from "./p2";

type Tx = Awaited<ReturnType<typeof allTx>>[number];
const codes = (t: Tx) => t.reviewFlags.map((f) => f.code);
const amountFree = (t: Tx) =>
	t.amountIn === undefined &&
	t.amountOut === undefined &&
	t.feeAmount === undefined;
/** Every user-facing string in a body; `raw` holds the user's own source rows and is skipped. */
function messages(value: unknown, key = ""): string[] {
	if (key === "raw") return [];
	if (typeof value === "string")
		return /message|error|notice|incomplete|warning|reason|hint|detail/i.test(
			key,
		)
			? [value]
			: [];
	if (Array.isArray(value)) return value.flatMap((v) => messages(v, key));
	if (value && typeof value === "object")
		return Object.entries(value).flatMap(([k, v]) => messages(v, k));
	return [];
}
const XLSX =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("manual transaction venue (contract 8bedb99)", () => {
	beforeAll(wipeP2);

	it("defaults to venue manual and keeps source manual", async () => {
		const tx = await addManual({
			timestamp: "2026-06-01T10:00:00.000Z",
			type: "deposit",
			assetIn: "ETH",
			amountIn: "1",
		});
		expect(tx).toMatchObject({ source: "manual", venue: "manual" });
	});
	it.each(["binance", "coindcx"])(
		"venue %s is stored and returned by the list",
		async (venue) => {
			const tx = await addManual({
				timestamp: "2026-06-02T10:00:00.000Z",
				type: "deposit",
				venue,
				assetIn: "ETH",
				amountIn: "2",
			});
			expect(tx).toMatchObject({ source: "manual", venue });
			expect((await allTx()).find((t) => t.id === tx.id)).toMatchObject({
				source: "manual",
				venue,
			});
		},
	);
	it.each(["evm:1", "kraken", ""])(
		"venue %j → 400 validation_error",
		async (venue) => {
			fail(
				await call("POST", "/api/transactions", {
					json: manual({
						timestamp: "2026-06-03T10:00:00.000Z",
						type: "deposit",
						venue,
						assetIn: "ETH",
						amountIn: "1",
					}),
				}),
				400,
				"validation_error",
			);
		},
	);
	it("a PATCH keeps the venue", async () => {
		const tx = await addManual({
			timestamp: "2026-06-04T10:00:00.000Z",
			type: "deposit",
			venue: "coindcx",
			assetIn: "ETH",
			amountIn: "3",
		});
		const patched = ok(
			await call("PATCH", `/api/transactions/${tx.id}`, {
				json: { userNote: "checked" },
			}),
			200,
			api.PatchTransactionResponseSchema,
		);
		expect(patched).toMatchObject({ venue: "coindcx", userNote: "checked" });
	});
});

describe("Binance statement legs next to Trade History (P2-E2E-6)", () => {
	let statementId = "";
	let rows: Tx[] = [];
	beforeAll(async () => {
		await wipeP2();
		await importOk(fixture("binance-trade-history.csv"), "t.csv", {
			source: "binance",
			timezone: "UTC",
		});
		statementId = (
			await importOk(fixture("binance-transaction-statement.csv"), "s.csv", {
				source: "binance",
				timezone: "UTC",
			})
		).id;
		rows = (await allTx()).filter((t) => t.importId === statementId);
	});

	it("no statement row is an amount-free fee row", () => {
		const empty = rows.filter((t) => t.type === "fee" && amountFree(t));
		expect(empty.map((t) => t.timestamp)).toEqual([]);
	});
	it("every amount-free statement row is a transfer flagged unknown_type", () => {
		for (const t of rows.filter(amountFree)) {
			expect(t.type, t.timestamp).toBe("transfer");
			expect(codes(t), t.timestamp).toContain("unknown_type");
		}
	});
	it("fills covered by Trade History are not duplicated by the statement (only the statement-only dust swap trades)", () => {
		const trades = rows.filter((t) => ["buy", "sell", "swap"].includes(t.type));
		expect(trades.map((t) => [t.type, t.timestamp, t.assetIn])).toEqual([
			["swap", "2025-11-18T12:30:45.000Z", "BNB"],
		]);
	});
	it("no fee row anywhere in the ledger lacks a fee amount", async () => {
		const fees = (await allTx()).filter((t) => t.type === "fee");
		for (const t of fees) expect(t.feeAmount, t.sourceRef).toBeDefined();
	});
});

describe("no 'catalogue' or '§' reaches any API message", () => {
	const bodies: [string, string][] = [];
	beforeAll(async () => {
		await wipeP2();
		await putProvider("alchemy", KEYS.alchemy);
		const dir = join(FIXTURES, "report-kinds");
		for (const name of readdirSync(dir).filter((n) => /\.(csv|xlsx)$/.test(n)))
			bodies.push([
				`upload ${name}`,
				(
					await upload(new Uint8Array(readFileSync(join(dir, name))), name, {
						source: "auto",
						timezone: "UTC",
						...(name.endsWith(".xlsx") ? { type: XLSX } : {}),
					})
				).text,
			]);
		await importOk(
			fixture("binance-transaction-statement.csv"),
			"statement.csv",
			{ source: "binance", timezone: "UTC" },
		);
		await importOk(fixture("binance-deposits.csv"), "deposits.csv", {
			source: "binance",
			timezone: "IST",
		});
		await importOk(
			[
				"Date(UTC),Pair,Side,Price,Executed,Amount,Fee",
				"bad,ETHINR,BUY,100,1ETH,100INR,0INR",
			].join("\n"),
			"broken.csv",
			{ source: "binance" },
		);
		await syncOk((await addCoindcx()).id);
		const arb = await addEvm(WALLET_A, 42161);
		await syncOk(arb.id);
		const years = new Set((await allTx()).map((t) => taxYearOf(t.timestamp)));
		for (const year of years) {
			const report = await compute(year);
			bodies.push([`report ${year}`, JSON.stringify(report)]);
			bodies.push([
				`review ${year}`,
				(await call("GET", `/api/review?taxYear=${year}`)).text,
			]);
		}
		for (const path of ["/api/imports", "/api/review", "/api/connections"])
			bodies.push([path, (await call("GET", path)).text]);
		const imports = ok(
			await call("GET", "/api/imports"),
			200,
			api.ListImportsResponseSchema,
		);
		for (const i of imports)
			bodies.push([
				`import ${i.fileName}`,
				(await call("GET", `/api/imports/${i.id}`)).text,
			]);
		for (const c of await connections())
			bodies.push([
				`job of ${c.label}`,
				(await call("GET", `/api/jobs/${c.lastSyncJobId}`)).text,
			]);
		bodies.push(["transactions", JSON.stringify(await allTx())]);
	}, 600_000);

	it("the scan covered imports, syncs, reports and the ledger", () => {
		expect(bodies.length).toBeGreaterThan(30);
	});
	it("no message, error, notice or warning mentions the research catalogue or a § mark", () => {
		const hits: string[] = [];
		for (const [where, text] of bodies) {
			let body: unknown;
			try {
				body = JSON.parse(text);
			} catch {
				body = text;
			}
			for (const message of messages(body)) {
				const appText = message.replace(
					/^Statement operation "(?:[^"\\]|\\.)*"/,
					"Statement operation",
				);
				if (/catalogu?e|research|§/i.test(appText))
					hits.push(`${where}: ${message}`);
			}
		}
		expect(hits).toEqual([]);
	});
});

describe("import timezoneOrigin (contract 2b7d028)", () => {
	type Summary = Awaited<ReturnType<typeof importOk>>;
	const persisted = async (summary: Summary) => {
		const detail = ok(
			await call("GET", `/api/imports/${summary.id}`),
			200,
			api.GetImportResponseSchema,
		);
		const listed = ok(
			await call("GET", "/api/imports"),
			200,
			api.ListImportsResponseSchema,
		).find((i) => i.id === summary.id);
		return [detail, listed];
	};
	const conflicts = (summary: Summary) =>
		summary.warnings
			.map((w) => w.message)
			.filter((m) => m.includes("instead of the selected"));
	beforeAll(wipeP2);

	it("a zone read from the Date(UTC) column header is origin header, and the warning names the column header", async () => {
		const summary = await importOk(
			fixture("binance-trade-history.csv"),
			"binance-trade-history.csv",
			{ source: "binance", timezone: "IST" },
		);
		expect(summary).toMatchObject({
			detectedTimezone: "UTC",
			timezoneSource: "file",
			timezoneOrigin: "header",
		});
		expect(conflicts(summary)).toEqual([
			"Used UTC from the column header instead of the selected IST.",
		]);
		for (const stored of await persisted(summary))
			expect(stored).toMatchObject({
				timezoneSource: "file",
				timezoneOrigin: "header",
			});
	});
	it("a zone read from the file name is origin file_name, and the warning names the file name", async () => {
		const summary = await importOk(
			fixture("binance-spot-order-history(UTC+5).csv"),
			"binance-spot-order-history(UTC+5).csv",
			{ source: "binance", timezone: "IST" },
		);
		expect(summary).toMatchObject({
			detectedTimezone: "+05:00",
			timezoneSource: "file",
			timezoneOrigin: "file_name",
		});
		expect(conflicts(summary)).toEqual([
			"Used +05:00 from the file name instead of the selected IST.",
		]);
		for (const stored of await persisted(summary))
			expect(stored).toMatchObject({ timezoneOrigin: "file_name" });
	});
	it("the file name wins over the column header and the warning says so", async () => {
		const summary = await importOk(
			fixture("binance-trade-history.csv"),
			"trades(UTC+5:30).csv",
			{ source: "binance", timezone: "UTC" },
		);
		expect(summary).toMatchObject({
			detectedTimezone: "+05:30",
			timezoneOrigin: "file_name",
		});
		expect(conflicts(summary)).toEqual([
			"Used +05:30 from the file name instead of the selected UTC.",
		]);
	});
	it("a file without a zone uses the user's selection: origin null, no conflict warning", async () => {
		const summary = await importOk(
			readFileSync(join(FIXTURES, "report-kinds", "binance-convert.csv")),
			"binance-convert.csv",
			{ source: "binance", timezone: "IST" },
		);
		expect(summary).toMatchObject({
			timezone: "IST",
			detectedTimezone: null,
			timezoneSource: "user",
			timezoneOrigin: null,
		});
		expect(conflicts(summary)).toEqual([]);
		for (const stored of await persisted(summary))
			expect(stored).toMatchObject({
				timezoneSource: "user",
				timezoneOrigin: null,
			});
	});
	it("a matching selection gives no conflict warning", async () => {
		const summary = await importOk(
			fixture("binance-withdrawals.csv"),
			"binance-withdrawals.csv",
			{ source: "binance", timezone: "UTC" },
		);
		expect(summary.timezoneOrigin).toBe("header");
		expect(conflicts(summary)).toEqual([]);
	});
});

describe("PATCH venue on manual rows (contract 2b7d028, server 7426d76)", () => {
	let connectionId = "";
	let manualId = "";
	const usdt = async () =>
		(await balances(connectionId)).rows.find((r) => r.asset === "USDT");
	const patch = (id: string, json: Record<string, unknown>) =>
		call("PATCH", `/api/transactions/${id}`, { json });
	const venueOf = async (id: string) =>
		(await allTx()).find((t) => t.id === id)?.venue;
	beforeAll(async () => {
		await wipeP2();
		connectionId = (await addBinance("Binance venue patch")).id;
		await syncOk(connectionId);
		manualId = (
			await addManual({
				timestamp: await mockDay(1, "10:00:00"),
				type: "withdrawal",
				assetOut: "USDT",
				amountOut: "7",
			})
		).id;
	}, SYNC_TIMEOUT);

	it("a venue-manual withdrawal leaves the synced Binance USDT check at zero", async () => {
		expect(await venueOf(manualId)).toBe("manual");
		expect(await usdt()).toMatchObject({ difference: "0", flagged: false });
	});
	it("manual → binance: the row now counts toward Binance and opens a 7 USDT gap", async () => {
		const patched = ok(
			await patch(manualId, { venue: "binance" }),
			200,
			api.PatchTransactionResponseSchema,
		);
		expect(patched).toMatchObject({ source: "manual", venue: "binance" });
		expect(await venueOf(manualId)).toBe("binance");
		expect(await usdt()).toMatchObject({ difference: "7", flagged: true });
	});
	it("binance → coindcx: the Binance gap closes again", async () => {
		ok(
			await patch(manualId, { venue: "coindcx" }),
			200,
			api.PatchTransactionResponseSchema,
		);
		expect(await usdt()).toMatchObject({ difference: "0", flagged: false });
	});
	it("coindcx → binance → manual: the gap opens and closes, without a re-sync", async () => {
		ok(
			await patch(manualId, { venue: "binance" }),
			200,
			api.PatchTransactionResponseSchema,
		);
		expect(await usdt()).toMatchObject({ difference: "7", flagged: true });
		ok(
			await patch(manualId, { venue: "manual" }),
			200,
			api.PatchTransactionResponseSchema,
		);
		expect(await usdt()).toMatchObject({ difference: "0", flagged: false });
		expect(await venueOf(manualId)).toBe("manual");
	});
	it("a PATCH without venue keeps the venue", async () => {
		ok(
			await patch(manualId, { venue: "binance" }),
			200,
			api.PatchTransactionResponseSchema,
		);
		const patched = ok(
			await patch(manualId, { userNote: "venue kept" }),
			200,
			api.PatchTransactionResponseSchema,
		);
		expect(patched).toMatchObject({ venue: "binance", userNote: "venue kept" });
		ok(
			await patch(manualId, { venue: "manual" }),
			200,
			api.PatchTransactionResponseSchema,
		);
	});
	it.each(["kraken", "evm:1", "", "BINANCE"])(
		"an unknown venue %j → 400 validation_error and nothing changes",
		async (venue) => {
			fail(await patch(manualId, { venue }), 400, "validation_error");
			expect(await venueOf(manualId)).toBe("manual");
			expect(await usdt()).toMatchObject({ difference: "0", flagged: false });
		},
	);
	it("venue null → 400 validation_error", async () => {
		fail(await patch(manualId, { venue: null }), 400, "validation_error");
	});
	it.each(["manual", "binance", "coindcx"])(
		"an imported (synced) row → 400 for venue %s, row and balances unchanged",
		async (venue) => {
			const synced = (await allTx({ source: "binance-api" })).find(
				(t) => t.assetIn === "USDT" || t.assetOut === "USDT",
			);
			expect(synced).toBeDefined();
			const before = JSON.stringify(synced);
			const error = fail(
				await patch(synced?.id ?? "", { venue }),
				400,
				"validation_error",
			);
			expect(error?.message).toBe(
				"Venue can only be changed for manual transactions.",
			);
			const after = (await allTx()).find((t) => t.id === synced?.id);
			expect(JSON.stringify(after)).toBe(before);
			expect(await usdt()).toMatchObject({ difference: "0", flagged: false });
		},
	);
	it("an imported file row → 400 as well", async () => {
		const { id } = await importOk(
			fixture("binance-deposits.csv"),
			"deposits.csv",
			{ source: "binance", timezone: "UTC" },
		);
		const row = (await allTx()).find((t) => t.importId === id);
		fail(
			await patch(row?.id ?? "", { venue: "manual" }),
			400,
			"validation_error",
		);
	});
});

describe("merged flag reasons are joined by a newline (server 7426d76)", () => {
	const merged = [
		"first note about this row.",
		"second note about this row.",
		"third line.",
		"fourth line.",
	].join("\n");
	let id = "";
	beforeAll(async () => {
		await wipeP2();
		id = (
			await addManual({
				timestamp: "2026-06-01T06:30:00.000Z",
				type: "buy",
				assetIn: "BTC",
				amountIn: "0.01",
				inrValue: "60000",
				reviewFlags: [
					{ code: "parse_warning", message: "first note about this row" },
					{ code: "parse_warning", message: "second note about this row." },
					{ code: "parse_warning", message: "first note about this row." },
					{ code: "parse_warning", message: "third line\nfourth line" },
					{ code: "tds_not_deducted", message: "no TDS on this row" },
				],
			})
		).id;
	});
	const flags = async () =>
		(await allTx()).find((t) => t.id === id)?.reviewFlags ?? [];

	it("one flag per code; duplicate reasons dropped; reasons kept as separate lines", async () => {
		// Phase 4 (2d31f5f): flags also carry severity and txId.
		expect(await flags()).toEqual([
			{ code: "parse_warning", message: merged, severity: "action", txId: id },
			{
				code: "tds_not_deducted",
				message: "no TDS on this row",
				severity: "action",
				txId: id,
			},
		]);
	});
	it("a single reason keeps its own wording (no added full stop)", async () => {
		const only = (await flags()).find((f) => f.code === "tds_not_deducted");
		expect(only?.message).toBe("no TDS on this row");
	});
	it("Review returns the same newline-separated message", async () => {
		const body = (await call("GET", "/api/review?taxYear=2026-27")).text;
		expect(body).toContain(JSON.stringify(merged).slice(1, -1));
		expect(body).not.toContain("first note about this row. second note");
	});
	it("a PATCH with the merged flags keeps them stable (no re-splitting into new reasons)", async () => {
		const patched = ok(
			await call("PATCH", `/api/transactions/${id}`, {
				json: { userNote: "seen" },
			}),
			200,
			api.PatchTransactionResponseSchema,
		);
		expect(
			patched.reviewFlags.find((f) => f.code === "parse_warning")?.message,
		).toBe(merged);
	});
	it("an imported CoinDCX swap with two notes carries them on separate lines", async () => {
		await importOk(fixture("coindcx-report.xlsx"), "coindcx-report.xlsx", {
			source: "coindcx",
			timezone: "IST",
			type: XLSX,
		});
		const multi = (await allTx({ source: "coindcx" }))
			.flatMap((t) => t.reviewFlags)
			.filter((f) => f.message.includes("\n"));
		expect(multi.length).toBeGreaterThan(0);
		for (const f of multi) {
			const lines = f.message.split("\n");
			expect(new Set(lines).size).toBe(lines.length);
			for (const line of lines) expect(line.trim()).toBe(line);
		}
	});
});

describe("unknown statement operations are transfers (P2-API-8)", () => {
	let rows: Tx[] = [];
	beforeAll(async () => {
		await wipeP2();
		const { id } = await importOk(
			readFileSync(
				join(FIXTURES, "report-kinds", "binance-statement-all-operations.csv"),
			),
			"all-operations.csv",
			{ source: "binance", timezone: "UTC" },
		);
		await importOk(
			fixture("binance-transaction-statement.csv"),
			"statement.csv",
			{ source: "binance", timezone: "UTC" },
		);
		rows = (await allTx()).filter(
			(t) => t.importId === id || t.source === "binance",
		);
	});
	it("no amount-free fee rows in either statement", () => {
		expect(rows.filter((t) => t.type === "fee" && amountFree(t))).toEqual([]);
	});
	it("'Some Future Operation' is an amount-free transfer flagged unknown_type with its raw row", () => {
		const future = rows.filter((t) =>
			JSON.stringify(t.raw).includes("Some Future Operation"),
		);
		expect(future.length).toBeGreaterThan(0);
		for (const t of future) {
			expect(t.type).toBe("transfer");
			expect(amountFree(t)).toBe(true);
			expect(codes(t)).toContain("unknown_type");
		}
	});
	it("the review-only rows do not change any holding (no amounts booked)", () => {
		for (const t of rows.filter((r) => codes(r).includes("unknown_type")))
			if (t.type === "transfer") expect(amountFree(t), t.sourceRef).toBe(true);
	});
});
