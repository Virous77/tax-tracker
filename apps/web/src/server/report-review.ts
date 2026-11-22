import { createHash } from "node:crypto";
import {
	type AssetClass,
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
	assetClass: AssetClass | "all" = "all",
) {
	const years = taxYear ? [taxYear] : listTaxYears().map(({ id }) => id);
	const reports = years.map((year) => ({
		taxYear: year,
		...db.reports.snapshot(year),
	}));
	const equityReports = years.map((year) => ({
		taxYear: year,
		...db.usEquityReports.snapshot(year),
	}));
	const transactions = db.transactions.list({ assetClass });
	const superseded = new Set(
		includeSuperseded
			? []
			: db.transactions.superseded().map((row) => row.txId),
	);
	const ledger = transactions.filter(
		(tx) =>
			!superseded.has(tx.id) &&
			(!taxYear || taxYearOf(tx.timestamp) === taxYear),
	);
	const visible = new Map(ledger.map((tx) => [tx.id, tx]));
	const existingIds = new Set(transactions.map((tx) => tx.id));
	const snapshots = [
		...(assetClass !== "us_equity" ? reports : []),
		...(assetClass !== "vda" ? equityReports : []),
	];
	const staleYears = new Set(
		snapshots.flatMap(({ taxYear, status, report }) =>
			status === "stale" && report
				? [`${taxYear}:${"valuations" in report ? "vda" : "us_equity"}`]
				: [],
		),
	);
	const wasDeleted = (year: string, id: string, regime: AssetClass) =>
		staleYears.has(`${year}:${regime}`) && !existingIds.has(id);
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
		regime: AssetClass = tx?.assetClass ?? "vda",
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
				...(regime === "us_equity" ? [regime] : []),
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
			const rowDeleted = Boolean(txId) && wasDeleted(taxYear, txId, regime);
			add({
				...entry,
				item: {
					kind: "warning",
					taxYear,
					message: rowDeleted ? `${message} (row deleted)` : message,
					warning: {
						...warning,
						...flag,
						...(txId
							? {
									count: 1,
									txId: rowDeleted ? undefined : txId,
									txIds: rowDeleted ? undefined : [txId],
								}
							: {}),
					},
					severity,
					sourceLabel: sourceId ? label(sourceId) : undefined,
					rowDeleted: rowDeleted ? true : undefined,
				},
			});
		}
	};
	for (const tx of ledger)
		for (const flag of tx.reviewFlags)
			addWarning(taxYearOf(tx.timestamp), flag, tx.id, tx);

	for (const { taxYear, report } of snapshots) {
		if (!report) continue;
		const regime = "valuations" in report ? "vda" : "us_equity";
		const reportLedger = new Map(report.ledger.map((tx) => [tx.id, tx]));
		const valuations = new Map(
			"valuations" in report
				? report.valuations.map((value) => [value.txId, value])
				: [],
		);
		const balanceWarnings = new Set<string>();
		for (const balance of report.balances) {
			const sourceLabel = balance.source ? label(balance.source) : undefined;
			const txIds = balance.txIds.filter(
				(id) => !wasDeleted(taxYear, id, regime),
			);
			const rowDeleted = balance.txIds.length > 0 && txIds.length === 0;
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
					itemKey: itemKey(
						"balance",
						balance,
						...(regime === "us_equity" ? [regime] : []),
					),
					item: {
						kind: "balance",
						severity: "action",
						taxYear,
						balance: { ...balance, txIds },
						sourceLabel,
						rowDeleted: rowDeleted ? true : undefined,
						message: `${before}${sourceLabel ? ` at ${sourceLabel}` : ""}${after}${rowDeleted ? " (rows deleted)" : ""}`,
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
			const rowDeleted = wasDeleted(taxYear, txId, regime);
			const signature = itemKey(
				"unresolved",
				unresolved,
				tx && transactionTaxInputs(tx),
				valuations.get(txId),
				...(regime === "us_equity" ? [regime] : []),
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
					rowDeleted: rowDeleted ? true : undefined,
					message: `Unresolved ${unresolved.quantity} ${unresolved.asset}: ${code}.${rowDeleted ? " (row deleted)" : ""}`,
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
			if (!ids.size)
				addWarning(taxYear, warning, "", undefined, undefined, regime);
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
					regime,
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
	assetClass?: AssetClass | "all",
) {
	const snapshot = reviewSnapshot(db, taxYear, includeSuperseded, assetClass);
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
