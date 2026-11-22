import {
	D,
	type EngineSettings,
	type FxApplied,
	type FxLookup,
	FxRateSchema,
	istDate,
	type LedgerTx,
	lastDayOfPreviousMonth,
	type ReportWarning,
	type ReviewCode,
	type ReviewFlag,
	roundInr,
} from "@tax/core";
import { matchTransfers } from "../matching.js";
import { FIAT } from "../valuation.js";

export type Money = ReturnType<typeof D>;
export type Warn = (warning: ReportWarning) => void;
export type UsdFx = (date: string) => FxApplied | null;
export type EventFx = (date: string) => FxApplied | null;

export const money = (value: Money | null) =>
	value === null ? null : roundInr(value);
export const inr = (usd: Money | null, fx: FxApplied | null) =>
	usd?.isZero() ? D("0") : fx ? (usd?.mul(fx.rate) ?? null) : null;

export function sumKnown(values: Iterable<Money | null>): Money | null {
	let sum = D("0");
	for (const value of values) {
		if (value === null) return null;
		sum = sum.plus(value);
	}
	return sum;
}

export function createUsdFx(lookup: FxLookup): UsdFx {
	const cache = new Map<string, FxApplied | null>();
	return (date) => {
		const cached = cache.get(date);
		if (cached !== undefined) return cached;
		const rate = lookup("USD", date);
		const parsed =
			rate === null ? null : { currency: "USD", ...FxRateSchema.parse(rate) };
		if (parsed && parsed.rateDate > date)
			throw new Error("FX lookup returned a future publication date");
		cache.set(date, parsed);
		return parsed;
	};
}

export function equityEventFx(
	fx: UsdFx,
	basis: EngineSettings["usEquityFxBasis"],
): EventFx {
	return (date) =>
		fx(basis === "prev_month_end" ? lastDayOfPreviousMonth(date) : date);
}

export function rawRef(tx: LedgerTx) {
	return {
		txId: tx.id,
		source: tx.source,
		sourceRef: tx.sourceRef,
		raw: tx.raw,
	};
}

export function flag(
	tx: LedgerTx,
	code: ReviewCode,
	message: string,
): ReviewFlag {
	return { txId: tx.id, code, message };
}

export interface ShareLeg {
	asset: string;
	quantity: string;
	direction: "in" | "out";
}

interface TradeValue {
	grossUsd: Money | null;
	feeUsd: Money | null;
	netUsd: Money | null;
	flags: ReviewFlag[];
}

export interface EquityEvent {
	tx: LedgerTx;
	date: string;
	share: ShareLeg | null;
	trade: TradeValue | null;
}

function tradeValue(tx: LedgerTx, settings: EngineSettings): TradeValue {
	const buy = tx.type === "buy";
	const quoteAsset = buy ? tx.assetOut : tx.assetIn;
	const quoteAmount = buy ? tx.amountOut : tx.amountIn;
	const grossUsd = quoteAsset === "USD" && quoteAmount ? D(quoteAmount) : null;
	const flags: ReviewFlag[] = [];
	if (grossUsd === null)
		flags.push(
			flag(
				tx,
				"missing_inr_value",
				"Record the gross equity trade value in USD.",
			),
		);
	const feeAmount = D(tx.feeAmount ?? "0");
	const feeUsd = feeAmount.isZero() || tx.feeAsset === "USD" ? feeAmount : null;
	let netUsd = grossUsd;
	if (settings.usEquityFeeTreatment === "include") {
		netUsd =
			grossUsd === null || feeUsd === null
				? null
				: buy
					? grossUsd.plus(feeUsd)
					: grossUsd.minus(feeUsd);
	}
	if (feeUsd === null || netUsd?.lt("0")) {
		flags.push(
			flag(
				tx,
				"fee_review_required",
				feeUsd === null
					? "The equity fee is not recorded in USD."
					: "The equity fee exceeds gross proceeds.",
			),
		);
		if (netUsd?.lt("0")) netUsd = null;
	}
	return { grossUsd, feeUsd, netUsd, flags };
}

export function equityShareLeg(tx: LedgerTx): ShareLeg | null {
	const incoming = tx.type === "buy" || tx.type === "deposit";
	const outgoing = tx.type === "sell" || tx.type === "withdrawal";
	const asset = incoming ? tx.assetIn : tx.assetOut;
	const quantity = incoming ? tx.amountIn : tx.amountOut;
	return (incoming || outgoing) && asset && quantity && !FIAT.has(asset)
		? { asset, quantity, direction: incoming ? "in" : "out" }
		: null;
}

export function equityEvent(
	tx: LedgerTx,
	settings: EngineSettings,
): EquityEvent {
	return {
		tx,
		date: istDate(tx.timestamp),
		share: equityShareLeg(tx),
		trade:
			tx.type === "buy" || tx.type === "sell" ? tradeValue(tx, settings) : null,
	};
}

export function equityTransfers(
	events: EquityEvent[],
	settings: EngineSettings,
) {
	const moves = events.filter(
		({ share, tx }) =>
			share && (tx.type === "deposit" || tx.type === "withdrawal"),
	);
	const order = new Map(moves.map(({ tx }, index) => [tx.id, index]));
	return matchTransfers(
		moves.map(({ tx }) => tx),
		{
			...settings,
			transferAmountTolerance: "0",
		},
	).filter(
		({ withdrawal, deposit, ambiguous, feeQuantity }) =>
			!ambiguous &&
			D(feeQuantity).isZero() &&
			(order.get(withdrawal.id) ?? 0) < (order.get(deposit.id) ?? 0),
	);
}
