import { D, type LedgerTx, LedgerTxSchema } from "@tax/core";
import { normaliseHeader, readSheets } from "../spreadsheet.js";
import type {
	Importer,
	ImportOptions,
	ImportResult,
	TableSheet,
} from "../types.js";
import {
	amountAsset,
	baseTransaction,
	numberString,
	parseTimestamp,
	RowParseError,
	sourceReferences,
	splitPair,
	tradePriceQuote,
} from "../values.js";
import {
	BINANCE_HEADERS,
	BINANCE_INCOME,
	STATEMENT_OVERLAP,
} from "./headers.js";

const has = (sheet: TableSheet, columns: string[]) =>
	columns.every((column) =>
		sheet.headers.some(
			(header) => normaliseHeader(header) === normaliseHeader(column),
		),
	);
export function binanceKind(
	sheet: TableSheet,
): "trade" | "oldTrade" | "statement" | "wallet" | undefined {
	if (has(sheet, BINANCE_HEADERS.statement)) return "statement";
	if (has(sheet, BINANCE_HEADERS.trade)) return "trade";
	if (has(sheet, BINANCE_HEADERS.oldTrade)) return "oldTrade";
	if (
		has(sheet, BINANCE_HEADERS.wallet) &&
		sheet.headers.some((header) => /^date/i.test(header))
	)
		return "wallet";
	return undefined;
}
function rowTransaction(
	raw: Record<string, string>,
	sheet: TableSheet,
	kind: NonNullable<ReturnType<typeof binanceKind>>,
	opts: ImportOptions,
	sourceRef: string,
	fileName: string,
): LedgerTx {
	if (raw.__extraColumns)
		throw new RowParseError("Row has more cells than the header.");
	const dateColumn =
		kind === "statement"
			? "UTC_Time"
			: (sheet.headers.find((v) => /^date/i.test(v)) ?? "");
	const timezoneExplicit =
		/UTC(?:\+0)?\)/i.test(dateColumn) || dateColumn === "UTC_Time";
	const tx = baseTransaction(
		"binance",
		sourceRef,
		parseTimestamp(
			raw[dateColumn] ?? "",
			"yyyy-MM-dd HH:mm:ss",
			timezoneExplicit ? "UTC" : opts.timezone,
			sheet.excelDate1904,
		),
		raw,
	);
	if (
		(timezoneExplicit && opts.timezone !== "UTC") ||
		(/UTC(?!\)|\+0\))/i.test(dateColumn) && !timezoneExplicit)
	)
		tx.reviewFlags.push({
			code: "ambiguous_timezone",
			message:
				"Header timezone conflicts with the selected timezone or has an unsupported offset. Verify this timestamp.",
		});
	if (kind === "statement") {
		const operation = raw.Operation ?? "";
		const income = BINANCE_INCOME[operation];
		if (!income)
			throw new RowParseError(
				"Unknown or unsupported statement operation; requires manual review or a recipe.",
			);
		const quantity = numberString(raw.Change ?? "");
		if (!D(quantity).gt("0"))
			throw new RowParseError(
				"Income receipt must have positive change.",
				"number",
			);
		tx.type = "income";
		tx.incomeKind = income;
		tx.assetIn = raw.Coin?.toUpperCase();
		tx.amountIn = quantity;
		return LedgerTxSchema.parse(tx);
	}
	if (kind === "wallet") {
		if (
			!["completed", "successful"].includes(
				(raw.Status ?? "").trim().toLowerCase(),
			)
		)
			throw new RowParseError(
				"Wallet row is not completed; it has no confirmed balance effect.",
			);
		const combined = sheet.headers.includes("TransactionFee");
		if (combined && !/deposit|withdraw/i.test(fileName))
			throw new RowParseError(
				"Combined wallet layout requires deposit/withdraw in the file name.",
			);
		const withdrawal = combined
			? /withdraw/i.test(fileName)
			: sheet.headers.includes("Fee");
		const amount = numberString(raw.Amount ?? "", true);
		const asset = (raw.Coin ?? "").toUpperCase();
		tx.type = withdrawal ? "withdrawal" : "deposit";
		if (withdrawal) {
			tx.assetOut = asset;
			tx.amountOut = amount;
			const fee = raw.Fee ?? raw.TransactionFee;
			if (fee?.trim()) {
				tx.feeAsset = asset;
				tx.feeAmount = numberString(fee, true);
				tx.reviewFlags.push({
					code: "parse_warning",
					message:
						"Withdrawal amount is treated as sent quantity and fee as additional; confirm against the exchange balance statement.",
				});
			}
		} else {
			tx.assetIn = asset;
			tx.amountIn = amount;
		}
		if (raw.TXID) tx.txHash = raw.TXID;
		if (raw.Network) tx.chain = raw.Network;
		return LedgerTxSchema.parse(tx);
	}
	const [base, quote] = splitPair(raw.Pair ?? raw.Market ?? "");
	const side = (raw.Side ?? raw.Type ?? "").toLowerCase();
	if (!["buy", "sell"].includes(side))
		throw new RowParseError("Unknown trade side.");
	const quantity =
		kind === "trade"
			? amountAsset(raw.Executed ?? "", base).amount
			: numberString(raw.Amount ?? "", true);
	const total =
		kind === "trade"
			? amountAsset(raw.Amount ?? "", quote).amount
			: numberString(raw.Total ?? "", true);
	tx.type = ["INR", "USD", "EUR", "GBP"].includes(quote)
		? (side as "buy" | "sell")
		: "swap";
	tx.assetIn = side === "buy" ? base : quote;
	tx.amountIn = side === "buy" ? quantity : total;
	tx.assetOut = side === "buy" ? quote : base;
	tx.amountOut = side === "buy" ? total : quantity;
	tx.priceQuote = tradePriceQuote(side, tx.type, quote, raw.Price ?? "");
	if (quote === "INR") {
		tx.inrValue = total;
		tx.inrRateSource = "trade_inr";
	}
	if (raw.Fee?.trim()) {
		const knownFeeAsset = [base, quote, "BNB", "BTC", "ETH", "USDT", "USDC"]
			.sort((a, b) => b.length - a.length)
			.find((asset) => raw.Fee?.trim().toUpperCase().endsWith(asset));
		const fee =
			kind === "trade"
				? amountAsset(raw.Fee, knownFeeAsset)
				: {
						amount: numberString(raw.Fee, true),
						asset: (raw["Fee Coin"] ?? "").toUpperCase(),
					};
		tx.feeAsset = fee.asset;
		tx.feeAmount = fee.amount;
		if (kind === "trade" && !knownFeeAsset)
			tx.reviewFlags.push({
				code: "parse_warning",
				message:
					"Fee asset was inferred from a concatenated cell; verify its symbol and quantity, especially symbols beginning with digits.",
			});
	}
	return LedgerTxSchema.parse(tx);
}
export function parseBinance(
	sheets: TableSheet[],
	opts: ImportOptions,
	fileName = "export.csv",
): ImportResult {
	const result: ImportResult = {
		transactions: [],
		rowsRead: 0,
		warnings: [],
		rowErrors: [],
		skippedRows: [],
		sheets: [],
	};
	const ref = sourceReferences();
	for (const sheet of sheets) {
		const kind = binanceKind(sheet);
		result.rowsRead += sheet.rows.length;
		result.sheets?.push({ name: sheet.name, rowsRead: sheet.rows.length });
		sheet.rows.forEach((raw, rowIndex) => {
			try {
				if (!kind) throw new RowParseError("Unrecognised Binance sheet.");
				if (
					kind === "statement" &&
					STATEMENT_OVERLAP.has(raw.Operation ?? "")
				) {
					result.skippedRows?.push({
						rowIndex,
						sheet: sheet.name,
						reason:
							"Statement row overlaps trade/deposit/withdrawal exports; import the dedicated history file. This row is preserved but not applied.",
					});
					return;
				}
				result.transactions.push(
					rowTransaction(
						raw,
						sheet,
						kind,
						opts,
						ref(raw, raw["Trade ID"] ?? raw["Transaction ID"]),
						fileName,
					),
				);
			} catch (error) {
				result.rowErrors.push({
					rowIndex,
					sheet: sheet.name,
					message: error instanceof Error ? error.message : "Invalid row",
					raw,
					field: error instanceof RowParseError ? error.field : "other",
				});
			}
		});
	}
	if (result.rowErrors.length)
		result.warnings.push({
			code: "parse_warning",
			message:
				"Some source rows require review; inspect row errors before computing tax.",
		});
	return result;
}
export const binance: Importer = {
	id: "binance",
	detect: (file) =>
		readSheets(file).some((sheet) => binanceKind(sheet) !== undefined),
	parse: (file, opts) => parseBinance(readSheets(file), opts, file.name),
};
