import { randomUUID } from "node:crypto";
import {
	LedgerTxSchema,
	mergeReviewFlags,
	type ReviewCode,
	type ReviewSeverity,
	taxYearOf,
} from "@tax/core";
import {
	CreateTransactionRequestSchema,
	PatchTransactionRequestSchema,
	type ReportReviewItem,
	type TransactionsQuery,
} from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import { listTaxYears } from "@tax/rules";
import { listConnections } from "./connections";
import { ApiError, required } from "./errors";
import { warningSeverity } from "./report-presentation";
import { reportReviewItems } from "./report-review";

function reviewedLedger(
	db: TaxDatabase,
	years = listTaxYears().map((year) => year.id),
) {
	const ledger = db.transactions.all();
	const flags = years.flatMap(
		(year) => db.reports.latest(year)?.warnings ?? [],
	);
	return ledger.map((tx) => ({
		...tx,
		reviewFlags: mergeReviewFlags([
			...tx.reviewFlags,
			...flags.filter(
				(flag) =>
					(flag.txId === tx.id || flag.txIds?.includes(tx.id)) &&
					!tx.reviewFlags.some(
						(original) =>
							original.code === flag.code && original.message === flag.message,
					),
			),
		]),
	}));
}
export function listTransactions(db: TaxDatabase, query: TransactionsQuery) {
	const needle = query.q?.toLowerCase();
	const supersededBy = new Map(
		db.transactions.superseded().map((row) => [row.txId, row.importId]),
	);
	const items = reviewedLedger(db)
		.map((tx) => ({ ...tx, supersededBy: supersededBy.get(tx.id) ?? null }))
		.filter(
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
				(query.superseded === undefined ||
					(tx.supersededBy !== null) === query.superseded) &&
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
	if (patch.venue !== undefined && current.source !== "manual")
		throw new ApiError(
			400,
			"validation_error",
			"Venue can only be changed for manual transactions.",
		);
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

	const superseded = new Set(
		db.transactions.superseded().map(({ txId }) => txId),
	);
	const ledger = reviewedLedger(db, years).filter(
		(tx) =>
			!superseded.has(tx.id) &&
			(!taxYear || taxYearOf(tx.timestamp) === taxYear),
	);
	const reportItems = reportReviewItems(
		reports,
		new Set(ledger.map((tx) => tx.id)),
	);
	const represented = new Set(
		reportItems.flatMap(({ code, item }) => {
			if (item.kind === "unresolved")
				return [JSON.stringify([code, item.unresolved.txId])];
			return [];
		}),
	);
	const balanceWarnings = new Set(
		reportItems
			.filter(({ item }) => item.kind === "balance")
			.map(({ code, item }) => JSON.stringify([code, item.message])),
	);
	type Group = {
		code: ReviewCode;
		severity: ReviewSeverity;
		count: number;
		items: ReturnType<typeof db.transactions.all>;
		reportItems: ReportReviewItem[];
	};
	const groups = new Map<string, Group>();
	const getGroup = (code: ReviewCode, severity: ReviewSeverity) => {
		const key = JSON.stringify([code, severity]);
		const group = groups.get(key) ?? {
			code,
			severity,
			count: 0,
			items: [],
			reportItems: [],
		};
		groups.set(key, group);
		group.count++;
		return group;
	};
	for (const tx of ledger) {
		for (const flag of tx.reviewFlags) {
			if (
				balanceWarnings.has(JSON.stringify([flag.code, flag.message])) ||
				represented.has(JSON.stringify([flag.code, tx.id]))
			)
				continue;
			getGroup(flag.code, warningSeverity(flag)).items.push(tx);
		}
	}
	for (const { code, item } of reportItems)
		getGroup(code, item.severity).reportItems.push(item);
	const totals = { action: 0, info: 0 };
	for (const group of groups.values()) totals[group.severity] += group.count;
	const reportStatuses = years.map((year) => ({
		taxYear: year,
		status: reports.some((report) => report.taxYear === year)
			? ("current" as const)
			: ("missing" as const),
	}));
	return {
		connections: listConnections(db).filter((row) =>
			["failed", "incomplete"].includes(row.lastSyncStatus ?? ""),
		),
		reportStatus: reports.length === years.length ? "current" : "missing",
		reportStatuses,
		computeTaxYears: reportStatuses
			.filter((entry) => entry.status === "missing")
			.map((entry) => entry.taxYear),
		groups: [...groups.values()].sort(
			(a, b) =>
				a.code.localeCompare(b.code) || a.severity.localeCompare(b.severity),
		),
		totals,
	};
}
