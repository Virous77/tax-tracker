import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	D,
	DISCLAIMER,
	EngineSettingsSchema,
	type LedgerTx,
	type Recipe,
	type ReportWarning,
	UsEquityReportSchema,
} from "@tax/core";
import {
	ApiContract,
	GetImportResponseSchema,
	SettingsResponseSchema,
} from "@tax/core/api";
import {
	csvRecords,
	headerFingerprint,
	readSheets,
	writeXlsx,
} from "@tax/importers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { syntheticPdf } from "../../../../../packages/importers/test/pdf-fixture";
import {
	vestedPdf,
	vestedWorkbook,
} from "../../../../../packages/importers/test/vested-fixture";
import {
	GET as getMetadataRoute,
	PUT as putMetadataRoute,
} from "../../app/api/us-equity/metadata/route";
import { POST as fillEquityPricesRoute } from "../../app/api/us-equity/prices/fill/route";
import { GET as equityPricesStatusRoute } from "../../app/api/us-equity/prices/status/route";
import { POST as computeEquityRoute } from "../../app/api/us-equity/reports/[taxYear]/compute/route";
import { createSession, SESSION_COOKIE } from "../auth";
import { settleBackgroundJobs } from "../background";
import { closeDatabases, database } from "../context";
import { type Endpoint, handle } from "../http";

let directory: string;
const taxYear = "2025-26";
const nextYear = "2026-27";

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "tax-equity-api-"));
	vi.stubEnv("DATA_DIR", directory);
	vi.stubEnv("APP_PASSWORD", "");
	vi.stubEnv("APP_SECRET", "");
	vi.stubEnv("SECRETS_PASSPHRASE", "");
});

afterEach(async () => {
	await closeDatabases();
	vi.unstubAllEnvs();
	await rm(directory, { recursive: true, force: true });
});

type CallOptions = {
	body?: unknown;
	query?: string;
	year?: string;
	id?: string;
	name?: string;
};

function call(
	name: Endpoint,
	{
		body,
		query = "",
		year = taxYear,
		id = "",
		name: providerName = "",
	}: CallOptions = {},
) {
	const route = ApiContract[name].path
		.replace(":taxYear", year)
		.replace(":id", id)
		.replace(":name", providerName);
	return handle(
		name,
		new Request(`http://localhost${route}${query}`, {
			method: ApiContract[name].method,
			body: body === undefined ? undefined : JSON.stringify(body),
			headers:
				body === undefined ? undefined : { "Content-Type": "application/json" },
		}),
		{ taxYear: year, id, name: providerName },
	);
}

async function json<T = unknown>(response: Response, status = 200): Promise<T> {
	const body = await response.json();
	expect(response.status, JSON.stringify(body)).toBe(status);
	return body;
}

async function compute(year = taxYear) {
	return UsEquityReportSchema.parse(
		await json(await call("computeUsEquityReport", { year })),
	);
}

async function uploadResponse(
	contents: string | Uint8Array,
	name: string,
	source: string,
) {
	const form = new FormData();
	form.set(
		"file",
		new File(
			[typeof contents === "string" ? contents : new Uint8Array(contents)],
			name,
		),
	);
	form.set("source", source);
	form.set("timezone", "UTC");
	return handle(
		"createImport",
		new Request("http://localhost/api/imports", {
			method: "POST",
			body: form,
		}),
	);
}

async function upload(
	contents: string | Uint8Array,
	name: string,
	source = "generic",
) {
	return json<{
		id: string;
		status: string;
		rowsInserted: number;
		rowsSkipped: number;
		rowsError: number;
	}>(await uploadResponse(contents, name, source), 201);
}

async function importEquity() {
	const schwab = await readFile(
		new URL(
			"../../../../../packages/importers/test/fixtures/us-broker-schwab-like.csv",
			import.meta.url,
		),
		"utf8",
	);
	const data = [
		schwab.trimEnd().replace("Fees & Comm", "Test Broker Commission"),
		'"07/30/2025","Sell","VTI","VANGUARD TOTAL STOCK MARKET ETF","1","$300.00","","$300.00"',
		'"07/30/2026","NRA Tax Adj","AAPL","APPLE INC","","","","-$1.00"',
	].join("\n");
	const { id, status } = await upload(data, "synthetic-schwab.csv");
	expect(status).toBe("pending_recipe");
	const sheet = readSheets({
		name: "synthetic-schwab.csv",
		bytes: new TextEncoder().encode(data),
	})[0];
	if (!sheet) throw new Error("Schwab test fixture has no sheet.");
	const recipe = {
		id: "phase3-schwab-test",
		name: "Synthetic Schwab",
		version: 1,
		fingerprint: headerFingerprint(sheet.headers, sheet.name),
		sheet: sheet.name,
		assetClass: "us_equity",
		dateAsOf: "as_of",
		defaultQuoteAsset: "USD",
		defaultFeeAsset: "USD",
		dateFormat: "MM/dd/yyyy",
		signStyle: "side_column",
		columns: {
			timestamp: "Date",
			side: "Action",
			baseAsset: "Symbol",
			description: "Description",
			amount: "Quantity",
			price: "Price",
			feeAmount: "Test Broker Commission",
			total: "Amount",
		},
		sideMap: {
			Buy: "buy",
			Sell: "sell",
			"NRA Tax Adj": "foreign_tax",
			"Qualified Dividend": "dividend",
			"Wire Funds Received": "skip",
		},
	} satisfies Recipe;
	const imported = await json(
		await call("confirmImport", { id, body: { recipe, saveRecipe: false } }),
	);
	expect(imported).toMatchObject({
		status: "imported",
		rowsInserted: 10,
		rowsSkipped: 1,
		rowsError: 0,
	});
	return id;
}

async function computeVda(year = taxYear) {
	return json(await call("computeReport", { year }));
}

it.each(["vda", "us_equity"] as const)(
	"scopes %s import warnings to transactions evaluated for the report year",
	async (assetClass) => {
		const db = await database();
		const isVda = assetClass === "vda";
		const source = isVda ? "binance" : "vested";
		const asset = isVda ? "ETH" : "AAPL";
		const currency = isVda ? "INR" : "USD";
		const computeReport = isVda ? "computeReport" : "computeUsEquityReport";
		const buy = {
			id: randomUUID(),
			source,
			sourceRef: "prior-year-buy",
			importId: "prior-year",
			timestamp: "2025-07-01T12:00:00.000Z",
			assetClass,
			type: "buy",
			assetIn: asset,
			amountIn: "1",
			assetOut: currency,
			amountOut: "100",
			raw: {},
			reviewFlags: [],
		} satisfies LedgerTx;
		const sale = {
			...buy,
			id: randomUUID(),
			sourceRef: "next-year-sale",
			importId: "next-year",
			timestamp: "2026-03-31T18:30:00.000Z",
			type: "sell",
			assetIn: currency,
			amountIn: "150",
			assetOut: asset,
			amountOut: "1",
		} satisfies LedgerTx;
		for (const [id, status, rowsInserted, rowsDuplicate] of [
			[buy.importId, "imported", 1, 0],
			[sale.importId, "imported", 1, 0],
			["duplicate-only", "imported", 0, 1],
			["pending", "pending_recipe", 0, 0],
		] as const) {
			db.imports.save(
				GetImportResponseSchema.parse({
					id,
					source,
					status,
					fileName: `${id}.csv`,
					fileSha256: id,
					timezone: "UTC",
					rowsRead: 1,
					rowsInserted,
					rowsDuplicate,
					rowsError: 0,
					recipeId: null,
					createdAt: sale.timestamp,
					error: null,
					warnings: [{ code: "parse_warning", message: `Check ${id}.csv` }],
					rowErrors: [],
				}),
				assetClass,
			);
		}
		db.transactions.insert([{ tx: buy }, { tx: sale }]);

		const report = (year: string) =>
			call(computeReport, { year }).then((response) =>
				json<{ warnings: ReportWarning[] }>(response),
			);
		const parseWarningImports = (warnings: ReportWarning[]) =>
			warnings
				.filter((warning) => warning.code === "parse_warning")
				.map(({ importId }) => importId)
				.sort();
		const earlier = await report(taxYear);
		expect(parseWarningImports(earlier.warnings)).toEqual([
			"duplicate-only",
			"pending",
			buy.importId,
		]);
		expect(earlier.warnings).toContainEqual(
			expect.objectContaining({
				code: "import_incomplete",
				importId: "pending",
			}),
		);

		const later = await report(nextYear);
		expect(parseWarningImports(later.warnings)).toEqual([
			"duplicate-only",
			sale.importId,
			"pending",
			buy.importId,
		]);
		expect(later).toMatchObject(
			isVda
				? { scheduleVdaRows: [{ costOfAcquisition: "100.00" }] }
				: { capitalGains: { rows: [{ costUsd: "100.00" }] } },
		);
	},
);

it("flags a USD dividend when its prior-month-end SBI rate is stale", async () => {
	const { id } = await json<{ id: string }>(
		await call("createTransaction", {
			body: {
				assetClass: "us_equity",
				importId: null,
				sourceRef: "stale-fx-dividend",
				timestamp: "2027-02-10T12:00:00Z",
				type: "dividend",
				dividendAsset: "ACME",
				assetIn: "USD",
				amountIn: "20",
				raw: {},
				reviewFlags: [],
			},
		}),
		201,
	);
	const report = await compute(nextYear);
	const warning = expect.objectContaining({ code: "fx_unavailable", txId: id });
	expect(report.dividends.rows).toMatchObject([
		{
			txId: id,
			grossUsd: "20.00",
			grossInr: null,
			fx: null,
			reviewFlags: [warning],
		},
	]);
	expect(report.warnings).toContainEqual(warning);
});

it("links Vested PDF and XLSX originals to one US equity ledger and builds filing schedules", async () => {
	const vda = await computeVda();
	const pdf = await upload(vestedPdf(), "synthetic-vested.pdf", "vested");
	const xlsx = await upload(vestedWorkbook(), "synthetic-vested.xlsx", "auto");
	const common = {
		source: "vested",
		sourceLabel: "Vested",
		detectedTimezone: "UTC",
		timezoneSource: "file",
		timezoneOrigin: "header",
		status: "imported",
		rowsRead: 12,
		rowsSkipped: 5,
		rowsError: 0,
		sheets: [
			{ name: "All Transactions", rowsRead: 6 },
			{ name: "Trades", rowsRead: 4 },
			{ name: "Income", rowsRead: 2 },
		],
	};
	expect(pdf).toMatchObject({
		...common,
		reportKind: "vested:account-statement-pdf",
		rowsInserted: 7,
		rowsDuplicate: 0,
	});
	expect(xlsx).toMatchObject({
		...common,
		reportKind: "vested:account-statement-xlsx",
		rowsInserted: 0,
		rowsDuplicate: 7,
	});
	const db = await database();
	expect(
		db.imports
			.list("us_equity")
			.map(({ id }) => id)
			.sort(),
	).toEqual([pdf.id, xlsx.id].sort());
	expect(await json(await call("getReport"))).toEqual(vda);
	const ledger = db.transactions.list({ assetClass: "us_equity" });
	expect(ledger).toHaveLength(7);
	const refs = ledger.map(({ id, sourceRef }) => [id, sourceRef]).sort();
	for (const id of [pdf.id, xlsx.id]) {
		const originals = db.rawRows.list(id);
		const linked = originals.filter(({ txId }) => txId);
		expect(
			linked.map(({ txId, sourceRef }) => [txId, sourceRef]).sort(),
		).toEqual(refs);
		if (id === pdf.id) {
			expect(originals).toHaveLength(12);
			expect(linked).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						data: {
							line: expect.objectContaining({ page: 3 }),
							wrappedLines: [],
						},
					}),
				]),
			);
		}
	}

	const report = await compute();
	expect(report.capitalGains.rows).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				asset: "FAKE",
				term: "long",
				quantity: "4",
				considerationUsd: "798.00",
			}),
			expect.objectContaining({
				asset: "DEMO",
				term: "short",
				quantity: "1",
				considerationUsd: "200.00",
			}),
		]),
	);
	expect(report.dividends.totals).toMatchObject({
		grossUsd: "20.00",
		taxWithheldUsd: "5.00",
	});
	expect(report.form67.rows).toMatchObject([
		{ asset: "FAKE", foreignIncomeUsd: "20.00", foreignTaxPaidUsd: "5.00" },
	]);
	expect(report.scheduleFa.rows).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				asset: "FAKE",
				entityName: "Synthetic Alphabet - Class C Shares",
			}),
			expect.objectContaining({
				asset: "DEMO",
				entityName: "Synthetic Semiconductor Manufacturing Co.",
			}),
		]),
	);
});

it("reports a Vested layout error when the selected venue does not match", async () => {
	for (const [contents, name] of [
		[
			syntheticPdf([[{ text: "Synthetic unrelated statement", x: 40, y: 40 }]]),
			"unrelated.pdf",
		],
		[
			writeXlsx([
				{
					name: "Sheet",
					rows: [
						["Date", "Text", "Amount"],
						["2025-01-01", "Synthetic", "10"],
					],
				},
			]),
			"unrelated.xlsx",
		],
	] as const) {
		expect(
			await json(await uploadResponse(contents, name, "vested"), 422),
		).toMatchObject({
			error: {
				code: "unprocessable_file",
				message: expect.stringContaining("Vested Account Statement"),
			},
		});
	}
});

it("imports a broker recipe and reports LT/ST gains, dividends, Form 67 and calendar-year holdings", async () => {
	const importId = await importEquity();
	const txs = (await database()).transactions.list({ assetClass: "us_equity" });
	expect(txs.every((row) => row.importId === importId)).toBe(true);
	expect(
		txs.find((row) => row.type === "dividend" && row.dividendAsset === "AAPL"),
	).toMatchObject({
		entityName: "APPLE INC",
		timestamp: "2025-12-31T00:00:00.000Z",
		raw: { Date: "01/02/2026 as of 12/31/2025" },
	});

	const first = await compute();
	expect(first.scheduleFa).toMatchObject({
		calendarYear: 2025,
		period: { start: "2025-01-01", end: "2025-12-31" },
	});
	expect(first.scheduleFa.rows).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				asset: "AAPL",
				openingQty: "10",
				closingQty: "5",
				peakValueInr: null,
				closingValueInr: null,
			}),
		]),
	);
	expect(first.capitalGains.rows).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				asset: "AAPL",
				term: "long",
				quantity: "5",
				considerationUsd: "1340.48",
			}),
			expect.objectContaining({
				asset: "VTI",
				term: "short",
				quantity: "1",
				considerationUsd: "300.00",
			}),
		]),
	);
	expect(D(first.capitalGains.summary.setOff.netTaxableLtcgInr).gt("0")).toBe(
		true,
	);
	expect(D(first.capitalGains.summary.setOff.netTaxableStcgInr).gt("0")).toBe(
		true,
	);
	expect(first.dividends.totals).toMatchObject({
		grossUsd: "11.84",
		taxWithheldUsd: "2.96",
	});
	expect(first.form67.rows).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				asset: "AAPL",
				foreignIncomeUsd: "2.60",
				foreignTaxPaidUsd: "0.65",
			}),
			expect.objectContaining({
				asset: "VTI",
				foreignIncomeUsd: "9.24",
				foreignTaxPaidUsd: "2.31",
			}),
		]),
	);
	expect(first.form67.totals.foreignTaxPaidInr).toBe("267.01");
	expect(first.warnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ code: "missing_market_price" }),
		]),
	);

	const second = await compute(nextYear);
	expect(second.scheduleFa.calendarYear).toBe(2026);
	expect(second.scheduleFa.rows).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				asset: "VTI",
				openingQty: "9",
				closingQty: "5",
			}),
		]),
	);
	expect(second.capitalGains.rows).toMatchObject([
		{ asset: "VTI", term: "long", quantity: "4", considerationUsd: "1249.57" },
	]);
	expect(second.dividends.rows).toEqual([]);
	expect(second.warnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ code: "unmatched_foreign_tax" }),
		]),
	);
	expect(
		await json(await call("review", { query: `?taxYear=${nextYear}` })),
	).toMatchObject({
		groups: expect.arrayContaining([
			expect.objectContaining({ code: "missing_market_price" }),
			expect.objectContaining({ code: "unmatched_foreign_tax" }),
		]),
	});
});

it("persists metadata and prices, serves stale snapshots by request and fills Schedule FA values", async () => {
	await importEquity();
	expect(await json(await call("getUsEquityReport"), 404)).toMatchObject({
		error: {
			code: "report_not_computed",
			details: { invalidatedAt: null, cause: "never_computed" },
		},
	});
	const vda = await computeVda();
	const before = await compute();
	await compute(nextYear);
	const apple = {
		symbol: "AAPL",
		entityName: "Apple Inc.",
		entityAddress: "1 Apple Park Way",
		zipCode: "95014",
		natureOfEntity: "Corporation",
		countryName: "United States",
		countryCode: "US",
	};
	expect(
		await json(await call("putEquityMetadata", { body: [apple, apple] }), 409),
	).toMatchObject({
		error: { code: "conflict" },
	});
	expect(
		(await call("putEquityMetadata", { body: [{ ...apple, symbol: "aapl" }] }))
			.status,
	).toBe(400);
	expect(
		await json(await call("putEquityMetadata", { body: [apple] })),
	).toEqual([apple]);
	expect(await json(await call("getEquityMetadata"))).toEqual([apple]);
	expect(await json(await call("getUsEquityReport"), 404)).toMatchObject({
		error: {
			code: "report_not_computed",
			details: { invalidatedAt: expect.any(String), cause: "metadata_changed" },
		},
	});
	expect(
		await json(await call("getUsEquityReport", { query: "?allowStale=true" })),
	).toEqual({ ...before, stale: true });
	expect(
		(
			await call("exportUsEquityReport", {
				query: "?format=csv&kind=schedule-fa",
			})
		).status,
	).toBe(404);
	await compute();
	const prices = [
		{
			calendarYear: 2025,
			symbol: "AAPL",
			peakPriceUsd: "299",
			peakDate: "2025-08-01",
			closingPriceUsd: "200",
		},
		{
			calendarYear: 2025,
			symbol: "VTI",
			peakPriceUsd: "400",
			peakDate: "2025-10-01",
			closingPriceUsd: "301",
		},
	];
	expect(
		(await call("putEquityPrices", { body: { calendarYear: 2026, prices } }))
			.status,
	).toBe(400);
	expect(
		(
			await call("putEquityPrices", {
				body: { calendarYear: 2025, prices: [prices[0], prices[0]] },
			})
		).status,
	).toBe(409);
	expect(
		await json(
			await call("putEquityPrices", { body: { calendarYear: 2025, prices } }),
		),
	).toEqual(prices);
	expect(
		await json(await call("getEquityPrices", { query: "?calendarYear=2025" })),
	).toEqual(prices);
	expect(
		await json(await call("getEquityPrices", { query: "?calendarYear=2026" })),
	).toEqual([]);
	expect(await json(await call("getUsEquityReport"), 404)).toMatchObject({
		error: { details: { cause: "prices_changed" } },
	});
	expect(await json(await call("getReport"))).toEqual(vda);
	const after = await compute();
	expect(after.scheduleFa.rows).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				asset: "AAPL",
				entityName: "Apple Inc.",
				entityAddress: "1 Apple Park Way",
				zipCode: "95014",
				peakValueUsd: "2990.00",
				peakValueInr: expect.any(String),
				closingValueUsd: "1000.00",
				closingValueInr: expect.any(String),
				peakFx: expect.objectContaining({ currency: "USD" }),
				closingFx: expect.objectContaining({ currency: "USD" }),
			}),
		]),
	);
	expect(
		after.warnings.some(({ code }) => code === "missing_market_price"),
	).toBe(false);
	expect(await json(await call("getUsEquityReport"))).toEqual(after);
});

const pricesPath = "http://localhost/api/us-equity/prices";

function requestEquityFill(
	body: { provider?: string; overwrite?: boolean } = {},
) {
	return fillEquityPricesRoute(
		new Request(`${pricesPath}/fill`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ taxYear, ...body }),
		}),
	);
}

function requestEquityPriceStatus() {
	return equityPricesStatusRoute(
		new Request(`${pricesPath}/status?taxYear=${taxYear}`),
	);
}

async function enablePrices() {
	await json(
		await call("putSettings", { body: { prices: { enabled: true } } }),
	);
}

async function setupPriceVault() {
	await json(
		await call("setupVault", {
			body: { passphrase: "synthetic test vault secret" },
		}),
	);
}

async function configureStockProvider(name: string) {
	const result = await json(
		await call("putProvider", { name, body: { apiKey: `secret-${name}` } }),
	);
	expect(result).toMatchObject({ [name]: { keySet: true } });
	expect(JSON.stringify(result)).not.toContain(`secret-${name}`);
}

async function stockBuy(date: string, quantity: string) {
	await json(
		await call("createTransaction", {
			body: {
				assetClass: "us_equity",
				venue: "manual",
				importId: null,
				sourceRef: date,
				timestamp: `${date}T12:00:00Z`,
				type: "buy",
				assetIn: "ACME",
				amountIn: quantity,
				assetOut: "USD",
				amountOut: "100",
				raw: {},
				reviewFlags: [],
			},
		}),
		201,
	);
}

async function withPriceServer(
	listener: (req: IncomingMessage, res: ServerResponse) => void,
	operation: () => Promise<void>,
) {
	const server = createServer(listener);
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing price server address");
		const base = `http://127.0.0.1:${address.port}`;
		vi.stubEnv("POLYGON_API_BASE", base);
		vi.stubEnv("FINNHUB_API_BASE", base);
		await operation();
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

function writeVendorJson(res: ServerResponse, body: unknown, status = 200) {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
}

const marketTime = (date: string) => Date.parse(`${date}T05:00:00Z`);

it("requires price opt-in, an unlocked vault, and a key for the selected provider", async () => {
	expect(await json(await requestEquityFill(), 409)).toMatchObject({
		error: { code: "prices_disabled" },
	});
	await enablePrices();
	await setupPriceVault();
	expect(await json(await requestEquityFill(), 409)).toMatchObject({
		error: {
			code: "provider_key_required",
			details: { needs: ["polygon", "finnhub"] },
		},
	});
	await configureStockProvider("polygon");
	expect(
		await json(await requestEquityFill({ provider: "finnhub" }), 409),
	).toMatchObject({
		error: { code: "provider_key_required", details: { needs: ["finnhub"] } },
	});
	await json(await call("lockVault"));
	expect(await json(await requestEquityFill(), 423)).toMatchObject({
		error: { code: "vault_locked" },
	});
	expect(await json(await requestEquityPriceStatus())).toMatchObject({
		enabled: true,
		vaultUnlocked: false,
		calendarYear: 2025,
		sources: { polygon: { keySet: true }, finnhub: { keySet: false } },
	});
});

it("reports a Polygon rate-limit wait, then persists the prices and recomputes exact Schedule FA INR values", async () => {
	const requests: {
		url: string | undefined;
		authorization: string | undefined;
	}[] = [];
	await withPriceServer(
		(req, res) => {
			requests.push({ url: req.url, authorization: req.headers.authorization });
			if (requests.length === 1) {
				res.setHeader("Retry-After", "0.8");
				writeVendorJson(res, {}, 429);
				return;
			}
			writeVendorJson(res, {
				results: [
					{ t: marketTime("2025-06-03"), h: 500, c: 200 },
					{ t: marketTime("2025-06-05"), h: 160, c: 140 },
					{ t: marketTime("2025-12-30"), h: 101, c: 100 },
				],
			});
		},
		async () => {
			await enablePrices();
			await setupPriceVault();
			await configureStockProvider("polygon");
			await stockBuy("2025-06-03", "1");
			await stockBuy("2025-06-05", "2");
			expect((await compute()).warnings.map(({ code }) => code)).toContain(
				"missing_market_price",
			);
			expect(requests).toEqual([]);
			expect(await json(await requestEquityPriceStatus())).toMatchObject({
				needed: 1,
				filled: 0,
				missing: [{ symbol: "ACME", needsPeak: true, needsClosing: true }],
			});
			const { jobId } = await json<{ jobId: string }>(
				await requestEquityFill(),
				202,
			);
			await vi.waitFor(
				async () => {
					expect(await json(await call("getJob", { id: jobId }))).toMatchObject(
						{
							status: "running",
							progress: {
								streamsDone: 0,
								streamsTotal: 1,
								waitingUntil: expect.any(String),
							},
						},
					);
				},
				{ interval: 20, timeout: 2000 },
			);
			const db = await database();
			await settleBackgroundJobs(db);
			expect(await json(await call("getJob", { id: jobId }))).toMatchObject({
				kind: "equity_price_fill",
				status: "completed",
				progress: { streamsDone: 1, waitingUntil: null },
				result: {
					calendarYear: 2025,
					requested: 1,
					filled: 1,
					skipped: 0,
					providerUsed: "polygon",
					failed: [],
				},
			});
			expect(requests).toEqual(
				Array.from({ length: 2 }, () => ({
					url: "/v2/aggs/ticker/ACME/range/1/day/2025-01-01/2025-12-31?adjusted=false&sort=asc&limit=50000",
					authorization: "Bearer secret-polygon",
				})),
			);
			expect(db.equityCyPrices.list(2025)).toEqual([
				{
					calendarYear: 2025,
					symbol: "ACME",
					source: "polygon",
					peakPriceUsd: "140",
					peakDate: "2025-06-05",
					closingPriceUsd: "100",
				},
			]);
			expect(await json(await call("getUsEquityReport"), 404)).toMatchObject({
				error: { details: { cause: "prices_changed" } },
			});
			expect(await json(await requestEquityPriceStatus())).toMatchObject({
				needed: 1,
				filled: 1,
				missing: [],
			});
			const report = await compute();
			expect(report.warnings.map(({ code }) => code)).not.toContain(
				"missing_market_price",
			);
			expect(report.scheduleFa.rows).toMatchObject([
				{
					peakDate: "2025-06-05",
					peakValueUsd: "420.00",
					peakValueInr: "35889.00",
					closingValueUsd: "300.00",
					closingValueInr: "26841.00",
				},
			]);
			expect(requests).toHaveLength(2);
		},
	);
});

it("falls back after Polygon rejects the plan, preserves manual prices and overwrites only on request", async () => {
	const requests: {
		url: string | undefined;
		headers: IncomingMessage["headers"];
	}[] = [];
	await withPriceServer(
		(req, res) => {
			requests.push({ url: req.url, headers: req.headers });
			if (req.url?.startsWith("/v2/aggs/ticker/")) {
				writeVendorJson(res, { message: "Plan rejected" }, 403);
				return;
			}
			writeVendorJson(res, {
				s: "ok",
				t: [marketTime("2025-06-05") / 1000, marketTime("2025-12-31") / 1000],
				h: [145, 97],
				c: [140, 95],
			});
		},
		async () => {
			await enablePrices();
			await setupPriceVault();
			await configureStockProvider("polygon");
			await configureStockProvider("finnhub");
			await stockBuy("2025-06-03", "1");
			const db = await database();
			const manual = {
				calendarYear: 2025,
				symbol: "ACME",
				peakPriceUsd: "125",
				peakDate: "2025-06-04",
				source: "manual",
			};
			const other = {
				calendarYear: 2025,
				symbol: "OTHER",
				closingPriceUsd: "99",
				source: "manual",
			};
			await json(
				await call("putEquityPrices", {
					body: { calendarYear: 2025, prices: [manual, other] },
				}),
			);
			const { jobId } = await json<{ jobId: string }>(
				await requestEquityFill(),
				202,
			);
			await settleBackgroundJobs(db);
			expect(await json(await call("getJob", { id: jobId }))).toMatchObject({
				status: "completed",
				result: { filled: 1, providerUsed: "finnhub", failed: [] },
			});
			expect(requests.map(({ url }) => url?.split("?")[0])).toEqual([
				"/v2/aggs/ticker/ACME/range/1/day/2025-01-01/2025-12-31",
				"/stock/candle",
			]);
			expect(requests[1]?.url).toBe(
				"/stock/candle?symbol=ACME&resolution=D&from=1735689600&to=1767225599",
			);
			expect(requests[1]?.headers["x-finnhub-token"]).toBe("secret-finnhub");
			expect(db.equityCyPrices.list(2025)).toEqual([
				{ ...manual, closingPriceUsd: "95", source: "manual + finnhub" },
				other,
			]);
			const retry = await json<{ jobId: string }>(
				await requestEquityFill(),
				202,
			);
			await settleBackgroundJobs(db);
			expect(
				await json(await call("getJob", { id: retry.jobId })),
			).toMatchObject({
				status: "completed",
				result: {
					requested: 1,
					skipped: 1,
					filled: 0,
					providerUsed: null,
					failed: [],
				},
			});
			expect(requests).toHaveLength(2);
			expect(
				await json(await call("deleteProvider", { name: "polygon" })),
			).toMatchObject({ polygon: { keySet: false } });
			const refresh = await json<{ jobId: string }>(
				await requestEquityFill({ overwrite: true }),
				202,
			);
			await settleBackgroundJobs(db);
			expect(
				await json(await call("getJob", { id: refresh.jobId })),
			).toMatchObject({
				status: "completed",
				result: { filled: 1, providerUsed: "finnhub", failed: [] },
			});
			expect(requests).toHaveLength(3);
			expect(requests[2]?.url).toMatch(/^\/stock\/candle\?/);
			expect(db.equityCyPrices.list(2025)).toEqual([
				{
					...manual,
					peakPriceUsd: "140",
					peakDate: "2025-06-05",
					closingPriceUsd: "95",
					source: "finnhub",
				},
				other,
			]);
		},
	);
});

it("reconciles actual stock balances and validates the configured lot pool", async () => {
	await importEquity();
	await compute();
	const query = "?taxYear=2025-26";
	const wrong = [{ asset: "AAPL", amount: "4.5" }];
	expect(
		await json(await call("putUsEquityActualBalances", { query, body: wrong })),
	).toEqual(wrong);
	expect(
		await json(await call("getUsEquityActualBalances", { query })),
	).toEqual(wrong);
	expect(await json(await call("getUsEquityReport"), 404)).toMatchObject({
		error: { details: { cause: "balances_changed" } },
	});
	const mismatch = await compute();
	expect(mismatch.balances).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				asset: "AAPL",
				computed: "5",
				actual: "4.5",
				difference: "-0.5",
			}),
		]),
	);
	expect(mismatch.warnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ code: "balance_mismatch" }),
		]),
	);
	expect(await json(await call("review", { query }))).toMatchObject({
		groups: expect.arrayContaining([
			expect.objectContaining({ code: "balance_mismatch" }),
		]),
	});

	const right = [{ asset: "AAPL", amount: "5" }];
	await json(await call("putUsEquityActualBalances", { query, body: right }));
	const matched = await compute();
	expect(matched.balances).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ asset: "AAPL", actual: "5", difference: "0" }),
		]),
	);
	expect(matched.warnings.some(({ code }) => code === "balance_mismatch")).toBe(
		false,
	);
	expect(
		(
			await call("putUsEquityActualBalances", {
				query,
				body: [right[0], right[0]],
			})
		).status,
	).toBe(409);
	expect(
		(
			await call("putUsEquityActualBalances", {
				query,
				body: [{ ...right[0], source: "us_broker" }],
			})
		).status,
	).toBe(400);

	await json(await call("putSettings", { body: { lotPool: "per_source" } }));
	expect(await json(await call("computeUsEquityReport"), 409)).toMatchObject({
		error: { code: "balance_pool_conflict" },
	});
	expect(
		(await call("putUsEquityActualBalances", { query, body: right })).status,
	).toBe(400);
	const ledgerSource = matched.ledger.find(
		(row) => row.assetIn === "AAPL",
	)?.source;
	expect(ledgerSource).toMatch(/^csv:/);
	await json(
		await call("putUsEquityActualBalances", {
			query,
			body: [{ ...right[0], source: ledgerSource }],
		}),
	);
	expect((await compute()).balances).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				asset: "AAPL",
				source: ledgerSource,
				difference: "0",
			}),
		]),
	);
});

it("downloads every format and kind with filing headers and escaped spreadsheet cells", async () => {
	await importEquity();
	const entityName = " \t=SUM(1,2)";
	await json(
		await call("putEquityMetadata", {
			body: [
				{
					symbol: "AAPL",
					entityName,
					entityAddress: "+HYPERLINK()",
					zipCode: "00123",
				},
			],
		}),
	);
	const before = await compute();
	const db = await database();
	db.usEquityReports.save({ ...before, includesDemoData: true });
	const headers = {
		"capital-gains": ["Ticker", "Quantity", "Date Acquired"],
		dividends: ["Date", "Ticker", "Gross USD"],
		form67: [
			"Country",
			"Country Code",
			"Nature of Income",
			"DTAA Article",
			"Ticker",
			"Foreign Income USD",
			"Foreign Income INR",
			"Foreign Tax Paid USD",
			"Foreign Tax Paid INR",
			"Max Eligible Credit INR",
			"Effective Rate",
		],
		"schedule-fa": [
			"Sl. No.",
			"Country Name",
			"Country Code",
			"Name of Entity",
			"Address of Entity",
			"ZIP Code",
			"Nature of Entity",
			"Date of Acquiring Interest",
			"Initial Value of Investment (INR)",
			"Peak Value of Investment during Period (INR)",
			"Closing Balance (INR)",
			"Total Gross Amount Paid/Credited (INR)",
			"Total Gross Proceeds from Sale/Redemption (INR)",
			"Ticker",
		],
	};
	const kinds = [
		"capital-gains",
		"dividends",
		"form67",
		"schedule-fa",
		"full",
	] as const;
	for (const kind of kinds) {
		const response = await call("exportUsEquityReport", {
			query: `?format=csv&kind=${kind}`,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"text/csv; charset=utf-8",
		);
		expect(response.headers.get("content-disposition")).toContain(
			`tax-tracker-us-equity-${taxYear}-${kind}.csv`,
		);
		const records = csvRecords(await response.text());
		expect(records[0]).toEqual([DISCLAIMER]);
		expect(records).toEqual(
			expect.arrayContaining([
				["Includes sample data"],
				["Incomplete report — review unresolved or missing inputs"],
				["Tax year", taxYear, "Act", before.act],
				["Schedule FA calendar year", "2025"],
				["US equity fee treatment", "include"],
				["Currency Conversion Rule", before.sections.currencyConversionRule],
				["Section verification", "Section numbers pending CA verification"],
			]),
		);
		for (const columns of kind === "full"
			? Object.values(headers)
			: [headers[kind]]) {
			const tableHeader = records.find(
				(row) => row[0] === columns[0] && row[1] === columns[1],
			);
			expect(tableHeader?.slice(0, columns.length)).toEqual(columns);
		}
		if (kind === "schedule-fa" || kind === "full") {
			const apple = records.find((row) => row[13] === "AAPL");
			expect(apple?.slice(3, 6)).toEqual([
				`'${entityName}`,
				"'+HYPERLINK()",
				"00123",
			]);
		}

		const workbook = await call("exportUsEquityReport", {
			query: `?format=xlsx&kind=${kind}`,
		});
		expect(workbook.status).toBe(200);
		expect(workbook.headers.get("content-type")).toBe(
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		);
		const sheets = readSheets({
			name: "report.xlsx",
			bytes: new Uint8Array(await workbook.arrayBuffer()),
		});
		expect(sheets.map(({ name }) => name)).toEqual(
			kind === "full"
				? [
						...kinds.slice(0, 4),
						"holdings",
						"warnings",
						"unresolved",
						"excluded",
					]
				: [kind],
		);
		const schedule = sheets.find(({ name }) => name === "schedule-fa");
		if (schedule) {
			expect(schedule.headers).toEqual([DISCLAIMER]);
			const firstColumn = schedule.rows.map((row) => row[DISCLAIMER]);
			expect(firstColumn).toContain("Sl. No.");
			const apple = schedule.rows.find(
				(row) => JSON.parse(row.__extraColumns ?? "[]")[12] === "AAPL",
			);
			expect(JSON.parse(apple?.__extraColumns ?? "[]").slice(2, 5)).toEqual([
				`'${entityName}`,
				"'+HYPERLINK()",
				"00123",
			]);
		}
		const form67 = sheets.find(({ name }) => name === "form67");
		if (form67) {
			expect(form67.headers).toEqual([DISCLAIMER]);
			const columns = form67.rows.find((row) => row[DISCLAIMER] === "Country");
			expect(JSON.parse(columns?.__extraColumns ?? "[]")).toEqual(
				headers.form67.slice(1),
			);
		}
	}
});

it("keeps VDA and US equity reports isolated through imports, deletes and settings updates", async () => {
	const vdaEmpty = await computeVda();
	const equityImport = await importEquity();
	expect(await json(await call("getReport"))).toEqual(vdaEmpty);
	const equity = await compute();
	const crypto = await upload(
		[
			"Date(UTC),Market,Type,Price,Amount,Total,Fee,Fee Coin",
			"2025-06-01 00:00:00,ETHINR,BUY,200000,1,200000,0,INR",
			"2025-07-01 00:00:00,ETHINR,SELL,250000,1,250000,0,INR",
		].join("\n"),
		"crypto.csv",
		"binance",
	);
	expect(crypto.rowsInserted).toBe(2);
	expect(await json(await call("getUsEquityReport"))).toEqual(equity);
	expect((await call("getReport")).status).toBe(404);
	const vda = await computeVda();
	expect(vda).toMatchObject({
		generatedFrom: { txCount: 2 },
		scheduleVdaRows: [{ asset: "ETH", income: "50000.00" }],
		ledger: [{ assetClass: "vda" }, { assetClass: "vda" }],
	});
	expect((await call("deleteImport", { id: equityImport })).status).toBe(204);
	expect((await call("getUsEquityReport")).status).toBe(404);
	expect(await json(await call("getReport"))).toEqual(vda);
	await compute();
	expect((await call("deleteImport", { id: crypto.id })).status).toBe(204);
	expect((await call("getUsEquityReport")).status).toBe(200);

	await computeVda();
	await json(
		await call("putSettings", { body: { usEquityFxBasis: "trade_date" } }),
	);
	expect((await call("getReport")).status).toBe(200);
	expect((await call("getUsEquityReport")).status).toBe(404);
	await compute();
	await json(await call("putSettings", { body: { feeTreatment: "include" } }));
	expect((await call("getReport")).status).toBe(404);
	expect((await call("getUsEquityReport")).status).toBe(200);
});

it("keeps both reports exportable when the full Settings form only toggles price lookups", async () => {
	const vda = await computeVda();
	const equity = await compute();
	const settings = SettingsResponseSchema.parse(
		await json(await call("getSettings")),
	);
	const { baseUrl, model, cloudAcknowledged } = settings.ai;
	const db = await database();
	const storedEngine = db.settings.get("engine");
	const body = {
		...EngineSettingsSchema.parse(settings),
		defaultTaxYear: settings.defaultTaxYear,
		prices: { ...settings.prices, enabled: !settings.prices.enabled },
		ai: { baseUrl, model, cloudAcknowledged },
	};
	const save = (patch: Partial<typeof body> = {}) =>
		call("putSettings", { body: { ...body, ...patch } }).then((response) =>
			json(response),
		);
	expect(await save()).toMatchObject({ prices: body.prices });
	expect(db.settings.get("engine")).toEqual(storedEngine);
	expect(await json(await call("getReport"))).toEqual(vda);
	expect(await json(await call("getUsEquityReport"))).toEqual(equity);
	expect(
		(await call("exportReport", { query: "?kind=schedule-vda&format=csv" }))
			.status,
	).toBe(200);
	expect(
		(
			await call("exportUsEquityReport", {
				query: "?kind=schedule-fa&format=csv",
			})
		).status,
	).toBe(200);

	await save({ feeTreatment: "include" });
	await json(await call("getReport"), 404);
	expect(await json(await call("getUsEquityReport"))).toEqual(equity);
	const updatedVda = await computeVda();

	await save({ feeTreatment: "include", usEquityFxBasis: "trade_date" });
	expect(await json(await call("getReport"))).toEqual(updatedVda);
	await json(await call("getUsEquityReport"), 404);
});

it("creates, lists, edits and deletes each manual US stock transaction type", async () => {
	const draft = {
		importId: null,
		timestamp: "2025-09-11T00:00:00.000Z",
		assetClass: "us_equity",
		venue: "us_broker",
		raw: { original: "manual" },
		reviewFlags: [],
		entityName: "Apple Inc.",
	};
	const events = [
		{
			type: "buy",
			assetIn: "AAPL",
			amountIn: "1.000000000001",
			assetOut: "USD",
			amountOut: "200",
		},
		{
			type: "sell",
			assetIn: "USD",
			amountIn: "110",
			assetOut: "AAPL",
			amountOut: "0.5",
		},
		{
			type: "dividend",
			assetIn: "USD",
			amountIn: "20",
			dividendAsset: "AAPL",
			withholdingTaxAmount: "5",
			withholdingTaxAsset: "USD",
		},
		{
			type: "foreign_tax",
			assetOut: "USD",
			amountOut: "7.5",
			dividendAsset: "AAPL",
			venue: "manual",
		},
	];
	expect(
		(
			await call("createTransaction", {
				body: {
					...draft,
					...events[0],
					sourceRef: "invalid",
					venue: "binance",
				},
			})
		).status,
	).toBe(400);
	const create = async (event: object, sourceRef: string) =>
		json<{ id: string }>(
			await call("createTransaction", {
				body: { ...draft, ...event, sourceRef },
			}),
			201,
		);
	const ids = [];
	for (const event of events) {
		const created = await create(event, event.type);
		expect(created).toMatchObject({ ...draft, ...event, source: "manual" });
		ids.push(created.id);
	}
	await create(
		{ ...events[0], assetClass: "vda", venue: "manual", assetIn: "ETH" },
		"vda",
	);
	expect(
		await json(
			await call("listTransactions", { query: "?assetClass=us_equity" }),
		),
	).toMatchObject({
		total: 4,
		items: expect.arrayContaining(
			events.map((event) => expect.objectContaining(event)),
		),
	});
	expect(
		await json(await call("listTransactions", { query: "?assetClass=vda" })),
	).toMatchObject({ total: 1 });
	expect(
		await json(await call("listTransactions", { query: "?assetClass=all" })),
	).toMatchObject({ total: 5 });
	expect(
		await json(
			await call("listTransactions", {
				query: "?assetClass=us_equity&asset=AAPL",
			}),
		),
	).toMatchObject({ total: 4 });

	for (const id of ids) {
		expect(
			await json(
				await call("patchTransaction", {
					id,
					body: { userNote: "checked", venue: "manual" },
				}),
			),
		).toMatchObject({
			id,
			assetClass: "us_equity",
			userNote: "checked",
			venue: "manual",
		});
		expect((await call("deleteTransaction", { id })).status).toBe(204);
	}
	expect(
		await json(
			await call("listTransactions", { query: "?assetClass=us_equity" }),
		),
	).toMatchObject({
		total: 0,
		items: [],
	});
	const corporate = await create(
		{
			...events[0],
			reviewFlags: [
				{ code: "corporate_action", message: "Broker reported a split." },
			],
		},
		"split",
	);
	expect((await compute()).excluded).toContainEqual({
		txId: corporate.id,
		reason: "corporate_action",
	});
	expect(
		await json(await call("review", { query: "?taxYear=2025-26" })),
	).toMatchObject({
		groups: expect.arrayContaining([
			expect.objectContaining({ code: "corporate_action", count: 1 }),
		]),
	});
});

it("uses password and same-origin checks on the Next route handlers", async () => {
	vi.stubEnv("APP_PASSWORD", "equity-route-password");
	const url = "http://localhost/api/us-equity/metadata";
	expect(
		await json(await getMetadataRoute(new Request(url)), 401),
	).toMatchObject({ error: { code: "unauthorized" } });
	const cookie = `${SESSION_COOKIE}=${createSession()}`;
	const send = (origin: string) =>
		putMetadataRoute(
			new Request(url, {
				method: "PUT",
				body: "[]",
				headers: { origin, cookie, "Content-Type": "application/json" },
			}),
		);
	expect(await json(await send("https://different.test"), 403)).toMatchObject({
		error: { code: "forbidden" },
	});
	expect(await json(await send("http://localhost"))).toEqual([]);
	expect(
		await json(
			await computeEquityRoute(
				new Request("http://localhost/api/us-equity/reports/2025-26/compute", {
					method: "POST",
					headers: { cookie },
				}),
				{ params: Promise.resolve({ taxYear }) },
			),
		),
	).toMatchObject({ taxYear, calendarYear: 2025 });
});

it("advertises US stock mappings and recipe fields to the AI assistant", async () => {
	const { id, status } = await upload(
		"Posted,Activity,Broker Symbol,Share Count,Cash Value\n2025-08-03,Dividend,AAPL,,10",
		"synthetic-ai.csv",
	);
	expect(status).toBe("pending_recipe");
	const preview = await json<{
		sentPayload: { messages: { content: string }[]; response_format: unknown };
	}>(await call("previewPayload", { body: { importId: id } }));
	const prompt = preview.sentPayload.messages[0]?.content;
	expect(prompt).toContain("Set assetClass to us_equity");
	expect(prompt).toContain("dateAsOf as_of");
	expect(preview.sentPayload.response_format).toMatchObject({
		json_schema: {
			schema: {
				properties: {
					assetClass: { enum: ["vda", "us_equity"] },
					defaultQuoteAsset: { type: "string" },
					defaultFeeAsset: { type: "string" },
					dateAsOf: { enum: ["as_of", "first"] },
					columns: {
						properties: {
							withholdingTax: { type: "string" },
							withholdingTaxAsset: { type: "string" },
							description: { type: "string" },
							currency: { type: "string" },
						},
					},
					sideMap: {
						additionalProperties: {
							enum: expect.arrayContaining(["dividend", "foreign_tax", "skip"]),
						},
					},
				},
			},
		},
	});
});
