import { createHash } from "node:crypto";
import {
	D,
	type LedgerTx,
	type ReportWarning,
	type ReviewCode,
	type ReviewFlag,
	taxYearOf,
	transactionTaxInputs,
	type Valuation,
} from "@tax/core";
import type { ReportReviewItem } from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import { listTaxYears } from "@tax/rules";
import { warningSeverity } from "./report-presentation";
import { presentWarningMessage, sourceLabels } from "./source-labels";

type ReviewEntry = {
	taxYear: string;
	code: ReviewCode;
	txId: string;
	itemKey: string;
} & ({ flag: ReviewFlag } | { item: ReportReviewItem });

function itemKey(...details: unknown[]): string {
	return createHash("sha256").update(JSON.stringify(details)).digest("hex");
}

function resolutionKey(
	entry: Pick<ReviewEntry, "taxYear" | "code" | "txId" | "itemKey">,
	txId = entry.txId,
): string {
	return JSON.stringify([entry.taxYear, entry.code, txId, entry.itemKey]);
}

function reviewSnapshot(
	db: TaxDatabase,
	taxYear?: string,
	includeSuperseded = false,
) {
	const years = taxYear ? [taxYear] : listTaxYears().map(({ id }) => id);
	const reports = years.map((year) => ({
		taxYear: year,
		...db.reports.snapshot(year),
	}));
	const ledger = (
		includeSuperseded ? db.transactions.all() : db.transactions.active()
	).filter((tx) => !taxYear || taxYearOf(tx.timestamp) === taxYear);
	const visible = new Map(ledger.map((tx) => [tx.id, tx]));
	const entries = new Map<string, ReviewEntry>();
	const add = (entry: ReviewEntry) => {
		entries.set(resolutionKey(entry), entry);
	};
	const label = sourceLabels(db);

	const addWarning = (
		taxYear: string,
		warning: ReportWarning,
		txId: string,
		tx?: LedgerTx,
		valuation?: Valuation,
	) => {
		const { code, asset, source, importId } = warning;
		const severity = warningSeverity(warning);
		const message = presentWarningMessage(warning, label);
		const entry = {
			taxYear,
			code,
			txId,
			itemKey: itemKey(
				"warning",
				txId,
				warning.message,
				severity,
				asset,
				source,
				importId,
				tx && transactionTaxInputs(tx),
				valuation,
				txId ? undefined : warning.count,
			),
		};
		const flag = { code, message, severity, ...(txId ? { txId } : {}) };
		const currentTx = visible.get(txId);
		if (
			currentTx &&
			(includeSuperseded || taxYearOf(currentTx.timestamp) === taxYear)
		) {
			add({ ...entry, flag });
		} else {
			const sourceId = source ?? tx?.source;
			add({
				...entry,
				item: {
					kind: "warning",
					taxYear,
					message,
					warning: {
						...warning,
						...flag,
						...(txId ? { txIds: [txId], count: 1 } : {}),
					},
					severity,
					sourceLabel: sourceId ? label(sourceId) : undefined,
				},
			});
		}
	};
	for (const tx of ledger)
		for (const flag of tx.reviewFlags)
			addWarning(taxYearOf(tx.timestamp), flag, tx.id, tx);

	for (const { taxYear, report } of reports) {
		if (!report) continue;
		const reportLedger = new Map(report.ledger.map((tx) => [tx.id, tx]));
		const valuations = new Map(
			report.valuations.map((value) => [value.txId, value]),
		);
		const balanceWarnings = new Set<string>();
		for (const balance of report.balances) {
			const sourceLabel = balance.source ? label(balance.source) : undefined;
			const addBalance = (code: ReviewCode, before: string, after: string) => {
				balanceWarnings.add(
					JSON.stringify([
						code,
						`${before}${balance.source ? ` at ${balance.source}` : ""}${after}`,
					]),
				);
				add({
					taxYear,
					code,
					txId: "",
					itemKey: itemKey("balance", balance),
					item: {
						kind: "balance",
						severity: "action",
						taxYear,
						balance,
						sourceLabel,
						message: `${before}${sourceLabel ? ` at ${sourceLabel}` : ""}${after}`,
					},
				});
			};
			if (balance.difference !== undefined && !D(balance.difference).isZero())
				addBalance(
					"balance_mismatch",
					balance.asset,
					`: computed ${balance.computed}, actual ${balance.actual}`,
				);
			if (D(balance.computed).lt("0"))
				addBalance(
					"missing_history",
					`Negative ${balance.asset} holding`,
					`: ${balance.computed}`,
				);
		}
		const slices = new Map<string, number>();
		for (const unresolved of report.unresolved) {
			const { txId, reason: code } = unresolved;
			const tx = reportLedger.get(txId);
			const signature = itemKey(
				"unresolved",
				unresolved,
				tx && transactionTaxInputs(tx),
				valuations.get(txId),
			);
			const occurrence = slices.get(signature) ?? 0;
			slices.set(signature, occurrence + 1);
			add({
				taxYear,
				code,
				txId,
				itemKey: itemKey(signature, occurrence),
				item: {
					kind: "unresolved",
					severity: "action",
					taxYear,
					unresolved,
					sourceLabel: tx ? label(tx.source) : undefined,
					message: `Unresolved ${unresolved.quantity} ${unresolved.asset}: ${code}.`,
				},
			});
		}
		for (const warning of report.warnings) {
			if (balanceWarnings.has(JSON.stringify([warning.code, warning.message])))
				continue;
			const ids = new Set([
				...(warning.txIds ?? []),
				...(warning.txId ? [warning.txId] : []),
			]);
			if (!ids.size) addWarning(taxYear, warning, "");
			for (const id of ids) {
				const tx = reportLedger.get(id);
				const original = tx?.reviewFlags.some(
					(flag) =>
						flag.code === warning.code && flag.message === warning.message,
				);
				addWarning(
					taxYear,
					warning,
					id,
					tx,
					original ? undefined : valuations.get(id),
				);
			}
		}
	}
	return {
		ledger: ledger.map((tx) => ({ ...tx, sourceLabel: label(tx.source) })),
		entries: [...entries.values()],
		reportStatuses: reports.map(({ taxYear, status }) => ({ taxYear, status })),
	};
}

export function readReview(
	db: TaxDatabase,
	taxYear?: string,
	includeSuperseded = false,
) {
	const snapshot = reviewSnapshot(db, taxYear, includeSuperseded);
	const resolutions = new Set(
		db.reviewResolutions
			.list([...new Set(snapshot.entries.map((entry) => entry.taxYear))])
			.map((row) => resolutionKey(row)),
	);
	return {
		...snapshot,
		entries: snapshot.entries.filter(
			(entry) =>
				!resolutions.has(resolutionKey(entry)) &&
				!resolutions.has(resolutionKey(entry, "")),
		),
	};
}

export function expireReviewResolutions(db: TaxDatabase, taxYear: string) {
	const resolutions = db.reviewResolutions.list([taxYear]);
	if (!resolutions.length) return;
	const { entries } = reviewSnapshot(db, taxYear);
	const current = new Set(
		entries.flatMap((entry) => [
			resolutionKey(entry),
			resolutionKey(entry, ""),
		]),
	);
	db.reviewResolutions.remove(
		resolutions.filter((row) => !current.has(resolutionKey(row))),
	);
}

export function saveReviewResolutions(
	db: TaxDatabase,
	entries: ReviewEntry[],
	group: boolean,
	note?: string,
) {
	// A blank txId stores the exact items acknowledged by a group action.
	db.reviewResolutions.save(
		entries.map(({ taxYear, code, txId, itemKey }) => ({
			taxYear,
			code,
			txId: group ? "" : txId,
			itemKey,
			note,
		})),
	);
}
