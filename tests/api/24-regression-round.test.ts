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
	addCoindcx,
	addEvm,
	api,
	call,
	connections,
	fail,
	KEYS,
	ok,
	putProvider,
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
