import { randomUUID } from "node:crypto";
import {
	D,
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
	type ResolveReviewRequestSchema,
	type TransactionsQuery,
} from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import type { z } from "zod";
import { listConnections } from "./connections";
import { ApiError, required } from "./errors";
import { warningSeverity } from "./report-presentation";
import { readReview, saveReviewResolutions } from "./report-review";

function reviewedLedger(db: TaxDatabase) {
	const { ledger, entries } = readReview(db, undefined, true);
	const flags = new Map<string, (typeof ledger)[number]["reviewFlags"]>();
	for (const entry of entries) {
		if (!("flag" in entry)) continue;
		const reasons = flags.get(entry.txId) ?? [];
		reasons.push(entry.flag);
		flags.set(entry.txId, reasons);
	}
	return ledger.map((tx) => ({
		...tx,
		reviewFlags: mergeReviewFlags(flags.get(tx.id) ?? []),
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
						tx.sourceLabel,
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
	const { resolveFlags, ...patch } = PatchTransactionRequestSchema.parse(input);
	return db.atomic(() => {
		const current = required(db.transactions.get(id));
		if (patch.venue !== undefined && current.source !== "manual")
			throw new ApiError(
				400,
				"validation_error",
				"Venue can only be changed for manual transactions.",
			);
		const inrChanged =
			patch.inrValue !== undefined &&
			(current.inrValue === undefined ||
				!D(current.inrValue).eq(patch.inrValue));
		const tx = LedgerTxSchema.parse({
			...current,
			...patch,
			...(patch.type && patch.type !== "income"
				? { incomeKind: undefined }
				: {}),
			inrValue: inrChanged ? patch.inrValue : current.inrValue,
			inrRateSource: inrChanged ? "manual" : current.inrRateSource,
		});
		if (Object.keys(patch).length) db.transactions.update(tx);
		if (resolveFlags?.length) {
			const { entries } = readReview(db, undefined, true);
			saveReviewResolutions(
				db,
				entries.filter(
					(entry) => entry.txId === id && resolveFlags.includes(entry.code),
				),
				false,
				patch.userNote,
			);
		}
		return required(reviewedLedger(db).find((row) => row.id === id));
	}, "immediate");
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
	const { ledger, entries, reportStatuses } = readReview(db, taxYear);
	const visible = displayedReviewEntries(entries);
	const rows = new Map<
		string,
		{
			tx: (typeof ledger)[number];
			flags: (typeof ledger)[number]["reviewFlags"];
		}
	>();
	for (const tx of ledger) rows.set(tx.id, { tx, flags: [] });
	for (const entry of visible)
		if ("flag" in entry) rows.get(entry.txId)?.flags.push(entry.flag);
	type Group = {
		code: ReviewCode;
		severity: ReviewSeverity;
		count: number;
		items: typeof ledger;
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
	for (const { tx, flags } of rows.values()) {
		const pending = mergeReviewFlags(flags);
		for (const flag of pending)
			getGroup(flag.code, warningSeverity(flag)).items.push({
				...tx,
				reviewFlags: pending,
			});
	}
	for (const entry of visible)
		if ("item" in entry)
			getGroup(entry.code, entry.item.severity).reportItems.push(entry.item);
	const totals = { action: 0, info: 0 };
	for (const group of groups.values()) totals[group.severity] += group.count;
	const reportStatus = reportStatuses.some(({ status }) => status === "stale")
		? "stale"
		: reportStatuses.some(({ status }) => status === "missing")
			? "missing"
			: "current";
	return {
		connections: listConnections(db).filter((row) =>
			["failed", "incomplete"].includes(row.lastSyncStatus ?? ""),
		),
		reportStatus,
		reportStatuses,
		computeTaxYears: reportStatuses
			.filter((entry) => entry.status !== "current")
			.map((entry) => entry.taxYear),
		groups: [...groups.values()].sort(
			(a, b) =>
				a.code.localeCompare(b.code) || a.severity.localeCompare(b.severity),
		),
		totals,
	};
}

function displayedReviewEntries(
	entries: ReturnType<typeof readReview>["entries"],
) {
	const key = ({ taxYear, code, txId }: (typeof entries)[number]) =>
		JSON.stringify([taxYear, code, txId]);
	const represented = new Set(
		entries
			.filter((entry) => "item" in entry && entry.item.kind === "unresolved")
			.map(key),
	);
	return entries.filter(
		(entry) => !("flag" in entry) || !represented.has(key(entry)),
	);
}

export function resolveReview(
	db: TaxDatabase,
	{ code, taxYear, txIds, note }: z.infer<typeof ResolveReviewRequestSchema>,
) {
	return db.atomic(() => {
		const { entries } = readReview(db, taxYear);
		const ids = txIds && new Set(txIds);
		const selected = entries.filter(
			(entry) => entry.code === code && (!ids || ids.has(entry.txId)),
		);
		saveReviewResolutions(db, selected, txIds === undefined, note);
		const visible = displayedReviewEntries(selected);
		return {
			resolved: new Set(
				visible.map((entry) => ("flag" in entry ? entry.txId : entry.itemKey)),
			).size,
		};
	}, "immediate");
}
