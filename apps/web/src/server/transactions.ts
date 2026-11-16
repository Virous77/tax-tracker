import { randomUUID } from "node:crypto";
import { D, LedgerTxSchema, taxYearOf } from "@tax/core";
import {
	CreateTransactionRequestSchema,
	PatchTransactionRequestSchema,
	type ReportReviewItem,
	type TransactionsQuery,
} from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import { listTaxYears } from "@tax/rules";
import { ApiError, required } from "./errors";

function reviewedLedger(db: TaxDatabase) {
	const ledger = db.transactions.all();
	const flags = listTaxYears().flatMap(
		(year) => db.reports.latest(year.id)?.warnings ?? [],
	);
	return ledger.map((tx) => ({
		...tx,
		reviewFlags: [
			...tx.reviewFlags,
			...flags.filter(
				(flag) =>
					(flag.txId === tx.id || flag.txIds?.includes(tx.id)) &&
					!tx.reviewFlags.some(
						(original) =>
							original.code === flag.code && original.message === flag.message,
					),
			),
		],
	}));
}
export function listTransactions(db: TaxDatabase, query: TransactionsQuery) {
	const needle = query.q?.toLowerCase();
	const items = reviewedLedger(db).filter(
		(tx) =>
			(!query.taxYear || taxYearOf(tx.timestamp) === query.taxYear) &&
			(!query.asset ||
				[tx.assetIn, tx.assetOut, tx.feeAsset].includes(
					query.asset.toUpperCase(),
				)) &&
			(!query.type || tx.type === query.type) &&
			(!query.source || tx.source === query.source) &&
			(query.flagged === undefined ||
				Boolean(tx.reviewFlags.length) === query.flagged) &&
			(!needle ||
				[
					tx.source,
					tx.sourceRef,
					tx.assetIn,
					tx.assetOut,
					tx.userNote,
					tx.txHash,
				].some((value) => value?.toLowerCase().includes(needle))),
	);
	const [field, direction] = query.sort.split(":");
	items.sort((a, b) => {
		const left =
			field === "asset"
				? (a.assetIn ?? a.assetOut ?? "")
				: field === "source"
					? a.source
					: a.timestamp;
		const right =
			field === "asset"
				? (b.assetIn ?? b.assetOut ?? "")
				: field === "source"
					? b.source
					: b.timestamp;
		return (
			(left.localeCompare(right) || a.id.localeCompare(b.id)) *
			(direction === "asc" ? 1 : -1)
		);
	});
	return {
		items: items.slice(
			(query.page - 1) * query.pageSize,
			query.page * query.pageSize,
		),
		total: items.length,
		page: query.page,
		pageSize: query.pageSize,
	};
}
export function createTransaction(db: TaxDatabase, input: unknown) {
	const body = CreateTransactionRequestSchema.parse(input);
	if (body.importId !== null)
		throw new ApiError(
			400,
			"validation_error",
			"Manual transactions must have importId: null.",
		);
	const tx = LedgerTxSchema.parse({
		...body,
		id: randomUUID(),
		source: "manual",
	});
	if (!db.transactions.insert([{ tx }]).inserted)
		throw new ApiError(
			409,
			"conflict",
			"A manual transaction with this sourceRef already exists.",
		);
	return tx;
}
export function patchTransaction(db: TaxDatabase, id: string, input: unknown) {
	const current = required(db.transactions.get(id));
	const { resolveFlags, ...patch } = PatchTransactionRequestSchema.parse(input);
	const tx = LedgerTxSchema.parse({
		...current,
		...patch,
		...(patch.type && patch.type !== "income" ? { incomeKind: undefined } : {}),
		...(patch.inrValue !== undefined ? { inrRateSource: "manual" } : {}),
		reviewFlags: current.reviewFlags.filter(
			(flag) => !resolveFlags?.includes(flag.code),
		),
	});
	db.transactions.update(tx);
	return tx;
}
export function deleteTransaction(db: TaxDatabase, id: string): void {
	const tx = required(db.transactions.get(id));
	if (tx.source !== "manual")
		throw new ApiError(
			409,
			"conflict",
			"Imported transactions can only be removed by deleting their import.",
		);
	db.transactions.deleteManual(id);
}
export function review(db: TaxDatabase, taxYear?: string) {
	const years = taxYear ? [taxYear] : listTaxYears().map((year) => year.id);
	const reports = years.flatMap((year) => {
		const report = db.reports.latest(year);
		return report ? [report] : [];
	});
	const reportItems: { code: string; item: ReportReviewItem }[] =
		reports.flatMap((report) => [
			...report.balances
				.filter(
					(balance) =>
						balance.difference !== undefined && !D(balance.difference).isZero(),
				)
				.map((balance) => ({
					code: "balance_mismatch",
					item: {
						kind: "balance" as const,
						taxYear: report.taxYear,
						message: `${balance.asset}${balance.source ? ` at ${balance.source}` : ""}: computed ${balance.computed}, actual ${balance.actual}`,
						balance,
					},
				})),
			...report.unresolved
				.filter((item) => item.reason === "missing_history")
				.map((unresolved) => ({
					code: unresolved.reason,
					item: {
						kind: "unresolved" as const,
						taxYear: report.taxYear,
						message: `Missing acquisition history for ${unresolved.quantity} ${unresolved.asset}.`,
						unresolved,
					},
				})),
		]);
	const unresolvedTxIds = new Set(
		reportItems.flatMap(({ item }) =>
			item.kind === "unresolved" ? [item.unresolved.txId] : [],
		),
	);
	const groups = new Map<
		string,
		{
			code: string;
			count: number;
			items: ReturnType<typeof db.transactions.all>;
			reportItems: ReportReviewItem[];
		}
	>();
	for (const tx of reviewedLedger(db)) {
		if (taxYear && taxYearOf(tx.timestamp) !== taxYear) continue;
		for (const code of new Set(tx.reviewFlags.map((flag) => flag.code))) {
			if (code === "missing_history" && unresolvedTxIds.has(tx.id)) continue;
			const group = groups.get(code) ?? {
				code,
				count: 0,
				items: [],
				reportItems: [],
			};
			group.items.push(tx);
			group.count++;
			groups.set(code, group);
		}
	}
	for (const { code, item } of reportItems) {
		const group = groups.get(code) ?? {
			code,
			count: 0,
			items: [],
			reportItems: [],
		};
		group.reportItems.push(item);
		group.count++;
		groups.set(code, group);
	}
	return {
		reportStatus: reports.length === years.length ? "current" : "missing",
		groups: [...groups.values()].sort((a, b) => a.code.localeCompare(b.code)),
	};
}
