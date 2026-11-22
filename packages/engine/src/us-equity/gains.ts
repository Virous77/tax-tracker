import {
	type ActualBalance,
	addCalendarMonths,
	D,
	type EngineSettings,
	type FxApplied,
	istDate,
	type Unresolved,
	type UsEquityGainRow,
	venueForTransaction,
} from "@tax/core";
import type { UsEquityRules } from "@tax/rules";
import { BalanceBook } from "../balances.js";
import { type Lot, LotBook } from "../lots.js";
import { FIAT } from "../valuation.js";
import { CapitalGains } from "./capital-gains.js";
import {
	type EquityEvent,
	type EventFx,
	equityTransfers,
	flag,
	inr,
	money,
	rawRef,
	type Warn,
} from "./values.js";

interface GainsInput {
	events: EquityEvent[];
	start: string;
	rules: UsEquityRules;
	settings: EngineSettings;
	fx: EventFx;
	actualBalances: ActualBalance[];
	warn: Warn;
}

export function computeGains({
	events,
	start,
	rules,
	settings,
	fx,
	actualBalances,
	warn,
}: GainsInput) {
	const moves = equityTransfers(events, settings);
	const withdrawals = new Map(
		moves.map((move) => [move.withdrawal.id, move.deposit.id]),
	);
	const deposits = new Set(moves.map((move) => move.deposit.id));
	const inTransit = new Map<string, Lot[]>();
	const rows: UsEquityGainRow[] = [];
	const unresolved: Unresolved[] = [];
	const book = new LotBook();
	const balances = new BalanceBook(settings);
	const totals = new CapitalGains();
	const acquisitions = new Map<
		string,
		{ fx: FxApplied | null; flags: UsEquityGainRow["reviewFlags"] }
	>();
	const ledger = new Map(events.map(({ tx }) => [tx.id, tx]));
	const refs = (ids: string[]) =>
		[...new Set(ids)].map((id) => {
			const tx = ledger.get(id);
			if (!tx) throw new Error("Missing equity trail ledger row");
			return rawRef(tx);
		});

	for (const [order, { tx, date, share, trade }] of events.entries()) {
		if (!share) continue;
		const { asset, quantity, direction } = share;
		const venue = venueForTransaction(tx);
		const pool = settings.lotPool === "global" ? "global" : venue;
		balances.change(
			asset,
			venue,
			direction === "in" ? quantity : D(quantity).negated().toFixed(),
			tx.id,
		);
		if (tx.type === "deposit" && deposits.has(tx.id)) {
			for (const lot of inTransit.get(tx.id) ?? [])
				book.add({ ...lot, pool, trailTxIds: [...lot.trailTxIds, tx.id] });
			continue;
		}
		if (direction === "in") {
			const costUsd = trade?.netUsd ?? null;
			const costFx = costUsd === null ? null : fx(date);
			const flags = [...(trade?.flags ?? [])];
			if (costUsd !== null && !costFx)
				flags.push(
					flag(
						tx,
						"fx_unavailable",
						"SBI USD/INR buying rate is unavailable for the acquisition.",
					),
				);
			if (tx.type === "deposit")
				flags.push(
					flag(
						tx,
						"unmatched_transfer",
						"The share deposit has no matching withdrawal or documented cost basis.",
					),
				);
			for (const item of flags) warn({ ...item, asset });
			acquisitions.set(tx.id, { fx: costFx, flags });
			book.add({
				asset,
				pool,
				qty: D(quantity),
				costUsd,
				costInr: inr(costUsd, costFx),
				acquiredAt: tx.type === "buy" ? tx.timestamp : null,
				txId: tx.id,
				order,
				trailTxIds: [tx.id],
			});
			continue;
		}
		const slices = book.consume(asset, pool, quantity);
		if (tx.type === "withdrawal") {
			const depositId = withdrawals.get(tx.id);
			if (depositId)
				inTransit.set(
					depositId,
					slices.map((lot) => ({
						...lot,
						trailTxIds: [...lot.trailTxIds, tx.id],
					})),
				);
			else
				warn({
					...flag(
						tx,
						"unmatched_transfer",
						"The share withdrawal has no matching deposit.",
					),
					asset,
				});
			if (slices.some((lot) => lot.txId === null))
				warn({
					...flag(
						tx,
						"missing_history",
						"Insufficient share history for the withdrawal.",
					),
					asset,
				});
			continue;
		}
		if (date < start) {
			if (slices.some((lot) => lot.acquiredAt === null))
				warn({
					...flag(
						tx,
						"missing_history",
						"An earlier sale has shares without documented acquisition history.",
					),
					asset,
				});
			continue;
		}
		if (!trade) continue;

		const considerationFx =
			trade.netUsd !== null || trade.feeUsd !== null ? fx(date) : null;
		const eventFlags = [...tx.reviewFlags, ...trade.flags];
		if (!considerationFx && trade.netUsd !== null)
			eventFlags.push(
				flag(
					tx,
					"fx_unavailable",
					"SBI USD/INR buying rate is unavailable for the disposal.",
				),
			);
		for (const lot of slices) {
			const acquisition = lot.txId ? acquisitions.get(lot.txId) : undefined;
			const acquired = lot.acquiredAt ? istDate(lot.acquiredAt) : null;
			const term =
				acquired === null
					? null
					: date > addCalendarMonths(acquired, rules.longTermHoldingMonths)
						? "long"
						: "short";
			const split = (value: ReturnType<typeof D> | null) =>
				value?.mul(lot.qty).div(quantity) ?? null;
			const considerationUsd = split(trade.netUsd);
			const considerationInr = inr(considerationUsd, considerationFx);
			const feeUsd = split(trade.feeUsd);
			const gainInr =
				considerationInr !== null && lot.costInr !== null
					? considerationInr.minus(lot.costInr)
					: null;
			const flags = [...eventFlags, ...(acquisition?.flags ?? [])];
			if (!term || gainInr === null) {
				const reason = !term ? "missing_history" : "missing_inr_value";
				flags.push(
					flag(
						tx,
						reason,
						!term
							? "The sale has shares without documented acquisition history."
							: "The sale slice has an unknown INR acquisition cost or consideration.",
					),
				);
				unresolved.push({
					txId: tx.id,
					asset,
					quantity: lot.qty.toFixed(),
					reason,
				});
			} else if (considerationInr !== null && lot.costInr !== null) {
				totals.add(term, considerationInr, lot.costInr, gainInr);
			}
			for (const item of flags) warn({ ...item, asset });
			rows.push({
				asset,
				quantity: lot.qty.toFixed(),
				dateOfAcquisition: acquired,
				dateOfTransfer: date,
				holdingDays:
					acquired === null
						? null
						: (Date.parse(date) - Date.parse(acquired)) / 86400000,
				term,
				costUsd: money(lot.costUsd ?? null),
				costFx: acquisition?.fx ?? null,
				costInr: money(lot.costInr),
				considerationUsd: money(considerationUsd),
				considerationFx,
				considerationInr: money(considerationInr),
				feeUsd: money(feeUsd),
				feeInr: money(inr(feeUsd, considerationFx)),
				gainInr: money(gainInr),
				trail: {
					disposalTxId: tx.id,
					lotTxIds: lot.txId ? [lot.txId] : [],
					rawRefs: refs([tx.id, ...lot.trailTxIds]),
				},
				reviewFlags: flags,
			});
		}
	}
	return {
		capitalGains: { rows, summary: totals.summarize(rules, settings) },
		balances: balances.finish(
			actualBalances.filter(({ asset }) => !FIAT.has(asset)),
			warn,
		),
		unresolved,
	};
}
