import { randomUUID } from "node:crypto";
import { classifyTransactions } from "@tax/evm";
import {
	canonical,
	csvRecords,
	parseBinance,
	parseCoinDcx,
	readSheets,
	sha256,
	writeXlsx,
} from "@tax/importers";

const wallet = `0x${"0".repeat(39)}1`;
const sender = `0x${"0".repeat(39)}2`;
const transfer = `0x${"0".repeat(63)}1`;
const timezone = "UTC";

const spot = `Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Trade ID
2025-12-01 09:00:00,ETHINR,BUY,200000,1ETH,200000INR,,sample-buy
2026-01-02 09:00:00,ETHINR,SELL,250000,0.5ETH,125000INR,,sample-sell`;
const withdrawals = `Date(UTC),Coin,Network,Amount,Address,TXID,Status,Fee,Transaction ID
2026-01-02 10:00:00,ETH,ETH,0.25,${wallet},${transfer},Completed,,sample-withdrawal`;
const orders = `Order ID,Market,Pair,Total Quantity,Remaining Quantity,Price Per Unit,Avg Price,Fee Amount,Total Tds INR,Side,Order Type,Status,Exchange Code,Created At,Updated At
sample-buy,BTCINR,I-BTC_INR,0.01,0,8000000,8000000,,,buy,limit_order,filled,I,2025-12-02 09:00:00 UTC,2025-12-02 09:00:01 UTC
sample-sell,BTCINR,I-BTC_INR,0.005,0,9000000,9000000,,450,sell,limit_order,filled,I,2026-01-03 09:00:00 UTC,2026-01-03 09:00:01 UTC`;
const explorer = {
	chainId: 1,
	address: wallet,
	ownAddresses: [],
	txlist: [
		{
			hash: transfer,
			from: sender,
			to: wallet,
			timeStamp: "1767348300",
			value: "250000000000000000",
			isError: "0",
		},
	],
	txlistinternal: [],
	tokentx: [],
};

export function sampleImports() {
	const binance = {
		name: "Sample Binance.xlsx",
		bytes: writeXlsx([
			{ name: "Spot trades", rows: csvRecords(spot) },
			{ name: "Withdrawals", rows: csvRecords(withdrawals) },
		]),
	};
	const coindcx = {
		name: "Sample CoinDCX.csv",
		bytes: new TextEncoder().encode(orders),
	};
	const files = [
		{ ...binance, source: "binance", parse: parseBinance },
		{ ...coindcx, source: "coindcx", parse: parseCoinDcx },
	];
	const exchanges = files.map((file) => {
		const sheets = readSheets(file);
		const parsed = file.parse(sheets, { timezone }, file.name);
		const originals = sheets.flatMap((sheet) =>
			sheet.rows.map((data, rowIndex) => ({
				sheet: sheet.name,
				rowIndex,
				data,
			})),
		);
		if (
			parsed.rowErrors.length ||
			parsed.transactions.length !== originals.length
		)
			throw new Error("Sample export rows could not all be imported.");
		const rows = parsed.transactions.map((tx) => {
			const original = originals.find(
				(row) => canonical(row.data) === canonical(tx.raw),
			);
			if (!original)
				throw new Error("Sample transaction is missing its original row.");
			return { tx, ...original };
		});
		return {
			fileName: file.name,
			fileSha256: sha256(file.bytes),
			source: file.source,
			rows,
		};
	});
	const onchain = classifyTransactions(explorer).map(({ tx }, rowIndex) => ({
		tx: { ...tx, id: randomUUID(), importId: null },
		sheet: "Explorer",
		rowIndex,
		data: tx.raw,
	}));
	return [
		...exchanges,
		{
			fileName: "Sample Ethereum wallet.json",
			fileSha256: sha256(canonical(explorer)),
			source: "evm:1",
			rows: onchain,
		},
	];
}
