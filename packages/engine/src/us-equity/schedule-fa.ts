import {
	D,
	type EngineSettings,
	type EquityCyPrice,
	type EquityMetadata,
	type FxApplied,
	istDate,
	type LedgerTx,
	type ReviewFlag,
	type ScheduleFaRow,
	type UsEquityReport,
	venueForTransaction,
} from "@tax/core";
import type { UsEquityRules } from "@tax/rules";
import { type Lot, LotBook } from "../lots.js";
import { compareText } from "../matching.js";
import {
	type EquityEvent,
	type EventFx,
	equityTransfers,
	flag,
	inr,
	type Money,
	money,
	rawRef,
	sumKnown,
	type UsdFx,
	type Warn,
} from "./values.js";

interface Flow {
	txId: string;
	kind: "dividend" | "sale";
	usd: Money | null;
	fx: FxApplied | null;
}

class Position {
	quantity = D("0");
	opening = D("0");
	max = D("0");
	onPeakDate = D("0");
	included = false;
	name: string | undefined;
	lots: Lot[] = [];
	flows: Flow[] = [];
	trail: LedgerTx[] = [];
	flags: ReviewFlag[] = [];

	constructor(readonly prices?: EquityCyPrice) {}

	recordFlow(event: EquityEvent, fx: EventFx, kind: Flow["kind"]): void {
		const { tx, date, trade } = event;
		const usd =
			kind === "sale"
				? (trade?.grossUsd ?? null)
				: tx.assetIn === "USD" && tx.amountIn
					? D(tx.amountIn)
					: null;
		const rate = usd === null ? null : fx(date);
		this.flows.push({ txId: tx.id, kind, usd, fx: rate });
		if (usd === null)
			this.flags.push(
				flag(
					tx,
					"missing_inr_value",
					"The Schedule FA cash flow has no gross USD amount.",
				),
			);
		else if (!rate)
			this.flags.push(
				flag(
					tx,
					"fx_unavailable",
					"SBI USD/INR buying rate is unavailable for the Schedule FA cash flow.",
				),
			);
	}
}

interface ScheduleFaInput {
	events: EquityEvent[];
	rules: UsEquityRules;
	settings: EngineSettings;
	exactFx: UsdFx;
	eventFx: EventFx;
	metadata: EquityMetadata[];
	prices: EquityCyPrice[];
	warn: Warn;
}

function buildRow(
	asset: string,
	position: Position,
	slNo: number,
	end: string,
	metadata: EquityMetadata | undefined,
	rules: UsEquityRules,
	fx: UsdFx,
): ScheduleFaRow {
	const prices = position.prices;
	const flags = position.flags;
	const { quantity, opening, max, onPeakDate, lots, flows } = position;
	const initialLots = lots.map((lot) => {
		const date = lot.acquiredAt ? istDate(lot.acquiredAt) : null;
		return {
			date,
			txId: lot.txId,
			usd: lot.costUsd ?? null,
			fx: date && lot.costUsd != null ? fx(date) : null,
		};
	});
	const acquisitionDates = initialLots.map((lot) => lot.date).sort();
	const earliest = acquisitionDates.includes(null)
		? null
		: (acquisitionDates[0] ?? null);
	const initialValueUsd = sumKnown(initialLots.map(({ usd }) => usd));
	const initialValueInr = sumKnown(
		initialLots.map((lot) => inr(lot.usd, lot.fx)),
	);
	const initialFx = initialLots[0]?.fx ?? null;
	const uniformFx =
		initialFx &&
		initialLots.every(
			({ fx }) =>
				fx?.rateDate === initialFx.rateDate &&
				fx?.source === initialFx.source &&
				fx?.rate === initialFx.rate,
		);

	if (initialLots.some((lot) => lot.usd === null))
		flags.push({
			code: "missing_history",
			message:
				"Some shares held during the calendar year have no documented USD acquisition cost.",
		});
	if (initialLots.some((lot) => lot.usd !== null && !lot.fx))
		flags.push({
			code: "fx_unavailable",
			message: "SBI USD/INR buying rate is unavailable on an acquisition date.",
		});

	let peakUsd: Money | null = null;
	let peakFx: FxApplied | null = null;
	if (!prices?.peakPriceUsd || !prices.peakDate)
		flags.push({
			code: "missing_market_price",
			message: "Enter the USD peak price and date for Schedule FA.",
		});
	else if (onPeakDate.gte("0")) {
		peakUsd = onPeakDate.mul(prices.peakPriceUsd);
		peakFx = fx(prices.peakDate);
		if (onPeakDate.isZero())
			flags.push({
				code: "parse_warning",
				message: "No shares were held at the end of the supplied peak date.",
			});
		else if (!peakFx)
			flags.push({
				code: "fx_unavailable",
				message: "SBI USD/INR buying rate is unavailable on the peak date.",
			});
	}

	let closingUsd: Money | null = null;
	let closingFx: FxApplied | null = null;
	if (quantity.isZero()) closingUsd = D("0");
	else if (quantity.gt("0")) {
		if (!prices?.closingPriceUsd)
			flags.push({
				code: "missing_market_price",
				message: "Enter the December 31 USD closing price for Schedule FA.",
			});
		else {
			closingUsd = quantity.mul(prices.closingPriceUsd);
			closingFx = fx(end);
			if (!closingFx)
				flags.push({
					code: "fx_unavailable",
					message: "SBI USD/INR buying rate is unavailable on December 31.",
				});
		}
	}

	const dividends = flows.filter((flow) => flow.kind === "dividend");
	const sales = flows.filter((flow) => flow.kind === "sale");
	return {
		slNo,
		asset,
		countryName: metadata?.countryName ?? rules.dtaa.countryName,
		countryCode: metadata?.countryCode ?? rules.dtaa.countryCode,
		entityName: metadata?.entityName ?? position.name ?? asset,
		entityAddress: metadata?.entityAddress ?? "",
		zipCode: metadata?.zipCode ?? "",
		natureOfEntity: metadata?.natureOfEntity ?? "Listed Company",
		dateOfAcquiring: earliest,
		lotCount: lots.length,
		openingQty: opening.toFixed(),
		closingQty: quantity.toFixed(),
		maxQtyHeld: max.toFixed(),
		initialValueUsd: money(initialValueUsd),
		initialValueInr: money(initialValueInr),
		initialFx: uniformFx ? initialFx : null,
		initialFxByLot: initialLots.flatMap(({ txId, fx }) =>
			txId ? [{ txId, fx }] : [],
		),
		peakPriceUsd: prices?.peakPriceUsd ? money(D(prices.peakPriceUsd)) : null,
		peakDate: prices?.peakDate ?? null,
		peakValueUsd: money(peakUsd),
		peakValueInr: money(inr(peakUsd, peakFx)),
		peakFx,
		closingPriceUsd: prices?.closingPriceUsd
			? money(D(prices.closingPriceUsd))
			: null,
		closingValueUsd: money(closingUsd),
		closingValueInr: money(inr(closingUsd, closingFx)),
		closingFx,
		grossDividendsPaidUsd: money(sumKnown(dividends.map((flow) => flow.usd))),
		grossDividendsPaidInr: money(
			sumKnown(dividends.map((flow) => inr(flow.usd, flow.fx))),
		),
		grossSaleProceedsUsd: money(sumKnown(sales.map((flow) => flow.usd))),
		grossSaleProceedsInr: money(
			sumKnown(sales.map((flow) => inr(flow.usd, flow.fx))),
		),
		flowFx: flows.map(({ txId, fx }) => ({ txId, fx })),
		trail: position.trail.map(rawRef),
		reviewFlags: flags,
	};
}

export function computeScheduleFa({
	events,
	rules,
	settings,
	exactFx,
	eventFx,
	metadata,
	prices,
	warn,
}: ScheduleFaInput): UsEquityReport["scheduleFa"] {
	const calendarYear = rules.scheduleFaCalendarYear;
	const start = `${calendarYear}-01-01`;
	const end = `${calendarYear}-12-31`;
	const cyEvents = events.filter(({ date }) => date <= end);
	const moves = equityTransfers(cyEvents, settings);
	const withdrawals = new Map(
		moves.map((move) => [move.withdrawal.id, move.deposit.id]),
	);
	const deposits = new Set(moves.map((move) => move.deposit.id));
	const inTransit = new Map<string, Lot[]>();
	const priceByAsset = new Map(
		prices
			.filter((price) => price.calendarYear === calendarYear)
			.map((price) => [price.symbol, price]),
	);
	const metadataByAsset = new Map(metadata.map((item) => [item.symbol, item]));
	const positions = new Map<string, Position>();
	const positionFor = (asset: string) => {
		const position =
			positions.get(asset) ?? new Position(priceByAsset.get(asset));
		positions.set(asset, position);
		return position;
	};
	const book = new LotBook();

	function record(event: EquityEvent, order: number, inCalendarYear: boolean) {
		const { date, tx, share, trade } = event;
		const asset = share?.asset ?? tx.dividendAsset;
		if (!asset) return;
		const position = positionFor(asset);
		if (tx.entityName?.trim()) position.name = tx.entityName.trim();
		if (share || inCalendarYear) position.trail.push(tx);
		if (inCalendarYear && tx.type === "dividend")
			position.recordFlow(event, eventFx, "dividend");
		if (inCalendarYear && tx.type === "sell")
			position.recordFlow(event, eventFx, "sale");
		if (!share) return;

		const pool =
			settings.lotPool === "global" ? "global" : venueForTransaction(tx);
		if (tx.type === "deposit" && deposits.has(tx.id)) {
			if (!inCalendarYear)
				for (const lot of inTransit.get(tx.id) ?? [])
					book.add({ ...lot, pool, trailTxIds: [...lot.trailTxIds, tx.id] });
			return;
		}
		if (tx.type === "withdrawal" && withdrawals.has(tx.id)) {
			const depositId = withdrawals.get(tx.id);
			if (!inCalendarYear && depositId) {
				const slices = book.consume(asset, pool, share.quantity);
				inTransit.set(
					depositId,
					slices.map((lot) => ({
						...lot,
						trailTxIds: [...lot.trailTxIds, tx.id],
					})),
				);
			}
			return;
		}

		const quantity = D(share.quantity);
		if (share.direction === "in") {
			const lot: Lot = {
				asset,
				order,
				pool,
				qty: quantity,
				costInr: null,
				costUsd: trade?.netUsd ?? null,
				acquiredAt: tx.type === "buy" ? tx.timestamp : null,
				txId: tx.id,
				trailTxIds: [tx.id],
			};
			position.quantity = position.quantity.plus(quantity);
			if (inCalendarYear) {
				position.lots.push(lot);
				position.included = true;
			} else book.add(lot);
		} else {
			position.quantity = position.quantity.minus(quantity);
			if (!inCalendarYear) book.consume(asset, pool, quantity);
			else if (position.quantity.lt("0"))
				position.flags.push(
					flag(
						tx,
						"missing_history",
						"Calendar-year share history produces a negative position.",
					),
				);
		}
		if (inCalendarYear) {
			if (position.quantity.gt(position.max)) position.max = position.quantity;
			if (date <= (position.prices?.peakDate ?? ""))
				position.onPeakDate = position.quantity;
		}
	}

	const prior = cyEvents.filter(({ date }) => date < start);
	for (const [index, event] of prior.entries()) record(event, index, false);
	for (const position of positions.values()) {
		position.opening = position.quantity;
		position.onPeakDate = position.quantity;
		position.included = position.quantity.gt("0");
		if (position.included) position.max = position.quantity;
	}
	for (const lot of book.snapshot()) {
		const position = positionFor(lot.asset);
		if (position.included) position.lots.push(lot);
	}
	const current = cyEvents.filter(({ date }) => date >= start);
	for (const [index, event] of current.entries())
		record(event, prior.length + index, true);

	const rows: ScheduleFaRow[] = [];
	for (const [asset, position] of [...positions].sort(([a], [b]) =>
		compareText(a, b),
	)) {
		if (position.included)
			rows.push(
				buildRow(
					asset,
					position,
					rows.length + 1,
					end,
					metadataByAsset.get(asset),
					rules,
					exactFx,
				),
			);
		for (const item of position.flags)
			warn({
				...item,
				asset,
				txIds: item.txId ? [item.txId] : position.trail.map((tx) => tx.id),
			});
	}
	return {
		calendarYear,
		period: { start, end },
		rows,
		notes: [
			"Review Schedule FA filing applicability and complete entity addresses and ZIP codes with your CA.",
			"Ask your CA whether foreign crypto exchange accounts or other foreign assets need separate disclosure.",
		],
	};
}
