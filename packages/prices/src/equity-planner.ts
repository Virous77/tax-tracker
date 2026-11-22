import {
	D,
	type EngineSettings,
	type EquityCyPrice,
	istDate,
	type LedgerTx,
} from "@tax/core";
import { compareTransactions, matchTransfers } from "@tax/engine";

export interface EquityHoldingEvent {
	date: string;
	quantity: string;
}

interface EquityPriceHolding {
	symbol: string;
	openingQty: string;
	closingQty: string;
	events: EquityHoldingEvent[];
	needsPeak: boolean;
	needsClosing: boolean;
}

const cash = new Set(["INR", "USD", "EUR", "GBP"]);

export function planEquityPriceFill({
	transactions,
	rules,
	settings,
	existingPrices,
}: {
	transactions: readonly LedgerTx[];
	rules: { scheduleFaCalendarYear: number };
	settings: EngineSettings;
	existingPrices: readonly EquityCyPrice[];
}): { calendarYear: number; holdings: EquityPriceHolding[] } {
	const calendarYear = rules.scheduleFaCalendarYear;
	const start = `${calendarYear}-01-01`;
	const end = `${calendarYear}-12-31`;
	const shares = transactions
		.filter(
			(tx) =>
				tx.assetClass === "us_equity" &&
				!tx.reviewFlags.some(
					({ code }) =>
						code === "suspected_spam" || code === "corporate_action",
				),
		)
		.sort(compareTransactions)
		.flatMap((tx) => {
			const date = istDate(tx.timestamp);
			if (date > end) return [];
			const incoming = tx.type === "buy" || tx.type === "deposit";
			const outgoing = tx.type === "sell" || tx.type === "withdrawal";
			const symbol = incoming ? tx.assetIn : tx.assetOut;
			const quantity = incoming ? tx.amountIn : tx.amountOut;
			return (incoming || outgoing) && symbol && quantity && !cash.has(symbol)
				? [{ tx, date, symbol, quantity, incoming }]
				: [];
		});
	const moves = shares
		.map(({ tx }) => tx)
		.filter(({ type }) => type === "deposit" || type === "withdrawal");
	const order = new Map(moves.map(({ id }, index) => [id, index]));
	const matched = new Set(
		matchTransfers(moves, {
			...settings,
			transferAmountTolerance: "0",
		}).flatMap(({ withdrawal, deposit, ambiguous, feeQuantity }) =>
			!ambiguous &&
			D(feeQuantity).isZero() &&
			(order.get(withdrawal.id) ?? 0) < (order.get(deposit.id) ?? 0)
				? [withdrawal.id, deposit.id]
				: [],
		),
	);

	const prices = new Map(
		existingPrices
			.filter((price) => price.calendarYear === calendarYear)
			.map((price) => [price.symbol, price]),
	);
	const positions = new Map<
		string,
		{
			quantity: ReturnType<typeof D>;
			openingQty: string;
			included: boolean;
			days: Map<string, string>;
		}
	>();
	for (const { tx, date, symbol, quantity, incoming } of shares) {
		if (matched.has(tx.id)) continue;
		const position = positions.get(symbol) ?? {
			quantity: D("0"),
			openingQty: "0",
			included: false,
			days: new Map<string, string>(),
		};
		position.quantity = incoming
			? position.quantity.plus(quantity)
			: position.quantity.minus(quantity);
		const currentQty = position.quantity.toFixed();
		if (date < start) {
			position.openingQty = currentQty;
			position.included = position.quantity.gt("0");
			position.days.set(start, currentQty);
		} else {
			position.included ||= incoming;
			position.days.set(date, currentQty);
		}
		positions.set(symbol, position);
	}
	const holdings = [...positions]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.flatMap(([symbol, position]) => {
			if (!position.included) return [];
			const price = prices.get(symbol);
			return [
				{
					symbol,
					openingQty: position.openingQty,
					closingQty: position.quantity.toFixed(),
					events: [...position.days].map(([date, quantity]) => ({
						date,
						quantity,
					})),
					needsPeak: !price?.peakPriceUsd || !price.peakDate,
					needsClosing: position.quantity.gt("0") && !price?.closingPriceUsd,
				},
			];
		});
	return { calendarYear, holdings };
}
