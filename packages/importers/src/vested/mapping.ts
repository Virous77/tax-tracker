import { AssetSchema, D, type LedgerTx, LedgerTxSchema } from "@tax/core";
import { normaliseHeader } from "../spreadsheet.js";
import { timezoneConflict } from "../timezone.js";
import type { ImportOptions, ImportResult } from "../types.js";
import {
	baseTransaction,
	numberString,
	parseTimestamp,
	RowParseError,
} from "../values.js";

const dateColumns = ["Date", "Time (in UTC)"];
export const sectionColumns = {
	"All Transactions": [
		...dateColumns,
		"Type",
		"Amount",
		"Currency",
		"Account Balance",
		"Comment",
	],
	Trades: [
		...dateColumns,
		"Name",
		"Ticker",
		"Activity",
		"Order Type",
		"Quantity",
		"Price Per Share",
		"Cash Amount",
		"Commission Charges",
		"Currency",
	],
	Income: [
		...dateColumns,
		"Activity",
		"Ticker",
		"Gross Cash Amount",
		"Currency",
	],
} as const;
export type Section = keyof typeof sectionColumns;

export function columnKey(header: string) {
	const key = normaliseHeader(header);
	return key === "comissioncharges" ? "commissioncharges" : key;
}

export function sectionForHeaders(headers: string[]): Section | undefined {
	const keys = headers.map(columnKey);
	return (Object.keys(sectionColumns) as Section[]).find((section) =>
		sectionColumns[section].every((column) => keys.includes(columnKey(column))),
	);
}

export interface StatementRow {
	values: Record<string, string>;
	raw: LedgerTx["raw"];
	error?: string;
}

export interface StatementTable {
	name: string;
	section?: Section;
	rows: StatementRow[];
}

function utcTimestamp(date: string, time: string) {
	const match = /^(0?[1-9]|1[0-2]):([0-5]\d):([0-5]\d)\s*(AM|PM)$/i.exec(time);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match)
		throw new RowParseError(
			"Expected a Vested date and 12-hour UTC time.",
			"date",
		);
	const hour =
		(Number(match[1]) % 12) + (match[4]?.toUpperCase() === "PM" ? 12 : 0);
	return parseTimestamp(
		`${date} ${String(hour).padStart(2, "0")}:${match[2]}:${match[3]}`,
		"yyyy-MM-dd HH:mm:ss",
		"UTC",
	);
}

function currencyCode(value: string) {
	const currency = value.toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency))
		throw new RowParseError("Expected a three-letter currency code.");
	return currency;
}

function tickerSymbol(value: string) {
	const ticker = AssetSchema.safeParse(value.toUpperCase());
	if (!ticker.success) throw new RowParseError("Expected a stock ticker.");
	return ticker.data;
}

function positive(value: string, label: string) {
	const amount = numberString(value);
	if (!D(amount).gt("0"))
		throw new RowParseError(`${label} must be positive.`, "number");
	return amount;
}

function referenceAmount(value: string) {
	try {
		return numberString(value);
	} catch {
		return value;
	}
}

type ReadCell = (column: string) => string;
type VestedEvent = {
	key: string[];
	fields: Partial<LedgerTx>;
};

function trade(cell: ReadCell): VestedEvent {
	const activity = cell("Activity").toLowerCase();
	if (activity !== "buy" && activity !== "sell")
		throw new RowParseError("Vested trade activity must be Buy or Sell.");
	const ticker = tickerSymbol(cell("Ticker"));
	const currency = currencyCode(cell("Currency"));
	const quantity = positive(cell("Quantity"), "Trade quantity");
	const price = positive(cell("Price Per Share"), "Price per share");
	const cash = numberString(cell("Cash Amount"));
	const commissionCell = cell("Commission Charges");
	const commission = commissionCell
		? numberString(commissionCell, true)
		: undefined;
	const fee = commission && D(commission).gt("0") ? commission : undefined;
	const net = D(cash).abs();
	const gross = fee ? net.plus(activity === "buy" ? D(fee).neg() : fee) : net;
	if (
		!gross.gt("0") ||
		(fee && gross.minus(D(quantity).mul(price)).abs().gt("0.05"))
	)
		throw new RowParseError(
			"Vested cash amount, quantity, price and commission disagree. Verify the trade against the original statement.",
			"number",
		);
	const amount = gross.toFixed();
	return {
		key: [ticker, activity, quantity, cash],
		fields: {
			type: activity,
			entityName: cell("Name") || undefined,
			priceQuote: { asset: currency, price },
			...(fee ? { feeAsset: currency, feeAmount: fee } : {}),
			...(activity === "buy"
				? {
						assetIn: ticker,
						amountIn: quantity,
						assetOut: currency,
						amountOut: amount,
					}
				: {
						assetIn: currency,
						amountIn: amount,
						assetOut: ticker,
						amountOut: quantity,
					}),
		},
	};
}

function foreignTax(currency: string, amount: string): Partial<LedgerTx> {
	return {
		type: "foreign_tax",
		assetOut: currency,
		amountOut: amount,
		withholdingTaxAmount: amount,
		withholdingTaxAsset: currency,
	};
}

function income(cell: ReadCell): VestedEvent {
	const activity = cell("Activity").replace(/\s+/g, " ").toLowerCase();
	const rawAmount = cell("Gross Cash Amount");
	if (!["dividend", "manufactured dividend", "tax"].includes(activity)) {
		return {
			key: [cell("Ticker").toUpperCase(), activity, referenceAmount(rawAmount)],
			fields: {
				reviewFlags: [
					{
						code: "unknown_type",
						message: `Review Vested income activity ${cell("Activity") || "(blank)"}.`,
					},
				],
			},
		};
	}
	const ticker = tickerSymbol(cell("Ticker"));
	const currency = currencyCode(cell("Currency"));
	const signed = numberString(rawAmount);
	const amount = D(signed).abs().toFixed();
	return {
		key: [ticker, activity, signed],
		fields: {
			dividendAsset: ticker,
			...(activity === "tax"
				? foreignTax(currency, amount)
				: { type: "dividend", assetIn: currency, amountIn: amount }),
		},
	};
}

const tradeTypes = new Set(["SPUR", "SSAL"]);
const dividendTypes = new Set(["DIV", "DIVM", "DIVTAX"]);
const corporateTypes = new Set([
	"STOCK_SPLIT",
	"MERGER_ACQUISITION",
	"SPINOFF",
	"SC",
	"STCK",
]);

function cashSkip(type: string, sections: ReadonlySet<Section>) {
	if (type === "ORDER") return "Pending order not executed";
	const detail = tradeTypes.has(type)
		? "Trades"
		: dividendTypes.has(type)
			? "Income"
			: undefined;
	if (!detail) return undefined;
	if (sections.has(detail))
		return `Covered by ${detail} section in this Vested statement`;
	throw new RowParseError(
		`Vested ${type} requires the ${detail} section. Import a complete statement.`,
	);
}

function cashTransaction(cell: ReadCell, type: string): VestedEvent {
	const rawAmount = cell("Amount");
	if (corporateTypes.has(type)) {
		return {
			key: [type, referenceAmount(rawAmount)],
			fields: {
				reviewFlags: [
					{
						code: "corporate_action",
						message: `Review the share quantities and cost basis for Vested corporate action ${type}.`,
					},
				],
			},
		};
	}

	const known = [
		"CSR",
		"ACATS_CASH",
		"CSD",
		"FEE",
		"INT",
		"SLIP",
		"JNLC",
		"SLIPNRA",
		"PTP_WITHHOLDING",
	];
	if (!known.includes(type)) {
		return {
			key: [type, referenceAmount(rawAmount)],
			fields: {
				reviewFlags: [
					{
						code: "unknown_type",
						message: `Review Vested cash transaction type ${type || "(blank)"}.`,
					},
				],
			},
		};
	}

	const currency = currencyCode(cell("Currency"));
	const signed = numberString(rawAmount);
	const amount = D(signed).abs().toFixed();
	const key = [type, signed];
	switch (type) {
		case "CSR":
		case "ACATS_CASH":
			return {
				key,
				fields: { type: "deposit", assetIn: currency, amountIn: amount },
			};
		case "CSD":
			return {
				key,
				fields: { type: "withdrawal", assetOut: currency, amountOut: amount },
			};
		case "FEE":
			return {
				key,
				fields: { type: "fee", feeAsset: currency, feeAmount: amount },
			};
		case "INT":
		case "SLIP":
		case "JNLC":
			return {
				key,
				fields: {
					type: "income",
					incomeKind: type === "INT" ? "interest" : "other",
					assetIn: currency,
					amountIn: amount,
				},
			};
		default:
			return { key, fields: foreignTax(currency, amount) };
	}
}

const refSection = {
	Trades: "trade",
	Income: "income",
	"All Transactions": "tx",
};

export function mapStatement(
	tables: StatementTable[],
	options: ImportOptions,
	reportKind: string,
): ImportResult {
	const sections = new Set(
		tables.flatMap(({ section }) => (section ? [section] : [])),
	);
	const ordinals = new Map<string, number>();
	const result: ImportResult &
		Required<Pick<ImportResult, "sheets" | "skippedRows">> = {
		transactions: [],
		rowsRead: 0,
		rowErrors: [],
		skippedRows: [],
		sheets: [],
		reportKind,
		detectedTimezone: "UTC",
		timezoneSource: "file",
		timezoneOrigin: "header",
		warnings: timezoneConflict(options.timezone, "UTC", "the column header"),
	};
	for (const { name, section, rows } of tables) {
		result.rowsRead += rows.length;
		result.sheets.push({
			name,
			rowsRead: rows.length,
			reportKind: section ? reportKind : undefined,
		});
		for (const [rowIndex, { values, raw, error }] of rows.entries()) {
			try {
				if (error) throw new RowParseError(error);
				if (!section)
					throw new RowParseError("Unsupported Vested statement table.");
				const cells = new Map(
					Object.entries(values).map(([header, value]) => [
						columnKey(header),
						value.trim(),
					]),
				);
				const cell: ReadCell = (header) => cells.get(columnKey(header)) ?? "";
				const type = cell("Type").toUpperCase();
				const reason =
					section === "All Transactions" ? cashSkip(type, sections) : undefined;
				if (reason) {
					result.skippedRows.push({ rowIndex, sheet: name, reason, raw });
					continue;
				}
				const timestamp = utcTimestamp(cell("Date"), cell("Time (in UTC)"));
				const event =
					section === "Trades"
						? trade(cell)
						: section === "Income"
							? income(cell)
							: cashTransaction(cell, type);
				const key = [
					"vested",
					refSection[section],
					timestamp,
					...event.key,
				].join(":");
				const ordinal = ordinals.get(key) ?? 0;
				const tx = LedgerTxSchema.safeParse({
					...baseTransaction("vested", `${key}#${ordinal}`, timestamp, raw),
					assetClass: "us_equity",
					...event.fields,
				});
				if (!tx.success)
					throw new RowParseError(
						"Vested row does not have valid ledger amounts or assets.",
					);
				ordinals.set(key, ordinal + 1);
				result.transactions.push(tx.data);
			} catch (error) {
				result.rowErrors.push({
					rowIndex,
					sheet: name,
					raw,
					message:
						error instanceof Error ? error.message : "Invalid Vested row.",
					field: error instanceof RowParseError ? error.field : "other",
				});
			}
		}
	}
	return result;
}
