import {
	D,
	type Form67Row,
	type Form67Totals,
	type FxApplied,
	type LedgerTx,
	type ReviewFlag,
	type UsEquityDividendRow,
} from "@tax/core";
import type { UsEquityRules } from "@tax/rules";
import { compareText } from "../matching.js";
import {
	type EquityEvent,
	type EventFx,
	flag,
	inr,
	type Money,
	money,
	rawRef,
	sumKnown,
	type Warn,
} from "./values.js";

interface Amounts {
	gross: Money | null;
	tax: Money | null;
	net: Money | null;
	fx: FxApplied | null;
}

interface ForeignPayment {
	tx: LedgerTx;
	usd: Money | null;
	fx: FxApplied | null;
	possibleOverlap?: true;
}

function dividendTotals(rows: Amounts[]) {
	return {
		grossUsd: money(sumKnown(rows.map((row) => row.gross))),
		taxWithheldUsd: money(sumKnown(rows.map((row) => row.tax))),
		netUsd: money(sumKnown(rows.map((row) => row.net))),
		grossInr: money(sumKnown(rows.map((row) => inr(row.gross, row.fx)))),
		taxWithheldInr: money(sumKnown(rows.map((row) => inr(row.tax, row.fx)))),
		netInr: money(sumKnown(rows.map((row) => inr(row.net, row.fx)))),
	};
}

function formTotals(
	dividends: Amounts[],
	payments: ForeignPayment[],
): Form67Totals {
	const taxUsd = sumKnown(
		payments.map((row) => (row.possibleOverlap ? null : row.usd)),
	);
	const taxInr = money(
		sumKnown(
			payments.map((row) =>
				row.possibleOverlap ? null : inr(row.usd, row.fx),
			),
		),
	);
	return {
		foreignIncomeUsd: money(sumKnown(dividends.map((row) => row.gross))),
		foreignIncomeInr: money(
			sumKnown(dividends.map((row) => inr(row.gross, row.fx))),
		),
		foreignTaxPaidUsd: money(taxUsd),
		foreignTaxPaidInr: taxInr,
		maxCreditEligibleInr: taxInr,
	};
}

function dividendKey({ date, tx }: EquityEvent) {
	return JSON.stringify([date, tx.dividendAsset]);
}

export function computeDividends(
	events: EquityEvent[],
	rules: UsEquityRules,
	fx: EventFx,
	warn: Warn,
) {
	const dividends = events.filter(({ tx }) => tx.type === "dividend");
	const dividendGroups = new Map<string, EquityEvent[]>();
	for (const event of dividends) {
		if (!event.tx.dividendAsset) continue;
		const key = dividendKey(event);
		const group = dividendGroups.get(key) ?? [];
		group.push(event);
		dividendGroups.set(key, group);
	}
	const allocations = new Map<string, ForeignPayment[]>();
	const orphaned: ForeignPayment[] = [];
	const ambiguous = new Set<string>();
	for (const event of events) {
		const { date, tx } = event;
		if (tx.type !== "foreign_tax") continue;
		const usd = tx.assetOut === "USD" && tx.amountOut ? D(tx.amountOut) : null;
		const payment = { tx, usd, fx: usd === null ? null : fx(date) };
		const candidates = dividendGroups.get(dividendKey(event)) ?? [];
		const sameSource = candidates.filter(
			({ tx: dividend }) => dividend.source === tx.source,
		);
		const eligible = sameSource.length ? sameSource : candidates;
		if (!eligible[0] || eligible.length !== 1) {
			for (const candidate of eligible) ambiguous.add(candidate.tx.id);
			warn(
				flag(
					tx,
					"unmatched_foreign_tax",
					eligible.length
						? "Several dividends share the date and ticker. Allocate this withholding before filing."
						: "No dividend with the same date and ticker matches this withholding.",
				),
			);
			const possibleOverlap = eligible.some(({ tx }) =>
				D(tx.withholdingTaxAmount ?? "0").gt("0"),
			);
			orphaned.push(
				possibleOverlap ? { ...payment, possibleOverlap: true } : payment,
			);
			continue;
		}
		const id = eligible[0].tx.id;
		const group = allocations.get(id) ?? [];
		group.push(payment);
		allocations.set(id, group);
	}

	const groups = new Map<
		string | null,
		{ amounts: Amounts[]; payments: ForeignPayment[]; ids: Set<string> }
	>();
	const groupFor = (asset: string | null) => {
		const group = groups.get(asset) ?? {
			amounts: [],
			payments: [],
			ids: new Set<string>(),
		};
		groups.set(asset, group);
		return group;
	};
	const rawAmounts: Amounts[] = [];
	const payments: ForeignPayment[] = [];
	const recordPayment = (payment: ForeignPayment) => {
		const group = groupFor(payment.tx.dividendAsset ?? null);
		group.payments.push(payment);
		group.ids.add(payment.tx.id);
		payments.push(payment);
		if (payment.usd === null)
			warn(
				flag(
					payment.tx,
					"missing_inr_value",
					"Record foreign withholding in USD.",
				),
			);
		else if (!payment.fx && !payment.usd.isZero())
			warn(
				flag(
					payment.tx,
					"fx_unavailable",
					"SBI USD/INR buying rate is unavailable for foreign withholding.",
				),
			);
	};

	const rows: UsEquityDividendRow[] = [];
	for (const { tx, date } of dividends) {
		const asset = tx.dividendAsset ?? null;
		const gross = tx.assetIn === "USD" && tx.amountIn ? D(tx.amountIn) : null;
		const rate = fx(date);
		const flags: ReviewFlag[] = [...tx.reviewFlags];
		if (!asset)
			flags.push(
				flag(tx, "parse_warning", "Specify the underlying dividend ticker."),
			);
		if (gross === null)
			flags.push(
				flag(tx, "missing_inr_value", "Record the gross dividend in USD."),
			);
		if (!rate && gross !== null)
			flags.push(
				flag(
					tx,
					"fx_unavailable",
					"SBI USD/INR buying rate is unavailable for the dividend.",
				),
			);

		const inline = D(tx.withholdingTaxAmount ?? "0");
		const inlineUsd =
			inline.isZero() || tx.withholdingTaxAsset === "USD" ? inline : null;
		const standalone = allocations.get(tx.id) ?? [];
		const standaloneUsd = sumKnown(standalone.map(({ usd }) => usd));
		const hasInline = inline.gt("0");
		const duplicate =
			hasInline && standaloneUsd !== null && inlineUsd?.eq(standaloneUsd);
		const possibleOverlap = hasInline && standalone.length > 0 && !duplicate;
		let tax = hasInline ? inlineUsd : standaloneUsd;
		if (hasInline) recordPayment({ tx, usd: inlineUsd, fx: rate });
		if (!duplicate) {
			for (const payment of standalone)
				recordPayment(
					possibleOverlap ? { ...payment, possibleOverlap: true } : payment,
				);
		}
		if (possibleOverlap) {
			tax = null;
			for (const payment of standalone)
				flags.push(
					flag(
						payment.tx,
						"unmatched_foreign_tax",
						"Standalone withholding differs from inline withholding. Confirm which amounts overlap.",
					),
				);
		}
		if (tax !== null && gross !== null && tax.gt(gross)) {
			tax = null;
			for (const payer of inline.gt("0")
				? [tx]
				: standalone.map((item) => item.tx)) {
				flags.push(
					flag(
						payer,
						"unmatched_foreign_tax",
						"Recorded withholding exceeds the gross dividend.",
					),
				);
			}
		}
		if (ambiguous.has(tx.id) && inline.isZero()) {
			tax = null;
			flags.push(
				flag(
					tx,
					"unmatched_foreign_tax",
					"Standalone withholding could apply to this dividend. Confirm the allocation.",
				),
			);
		}
		const net = tax !== null && gross !== null ? gross.minus(tax) : null;
		const amounts = { gross, tax, net, fx: rate };
		const group = groupFor(asset);
		group.amounts.push(amounts);
		group.ids.add(tx.id);
		for (const payment of standalone) group.ids.add(payment.tx.id);
		rawAmounts.push(amounts);
		for (const item of flags) warn({ ...item, ...(asset ? { asset } : {}) });
		rows.push({
			txId: tx.id,
			date,
			asset,
			fx: rate,
			...dividendTotals([amounts]),
			withholdingRate:
				gross !== null && tax !== null ? tax.div(gross).toFixed() : null,
			trail: [rawRef(tx), ...standalone.map((payment) => rawRef(payment.tx))],
			reviewFlags: flags,
		});
	}
	for (const payment of orphaned) recordPayment(payment);
	const { countryName, countryCode, dividendArticle: dtaaArticle } = rules.dtaa;
	const formRows: Form67Row[] = [...groups]
		.sort(([a], [b]) => compareText(a ?? "", b ?? ""))
		.map(([asset, { amounts, payments, ids }]) => {
			const gross = sumKnown(amounts.map((row) => row.gross));
			const tax = sumKnown(
				payments.map((row) => (row.possibleOverlap ? null : row.usd)),
			);
			return {
				countryName,
				countryCode,
				dtaaArticle,
				asset,
				natureOfIncome: "Dividends",
				...formTotals(amounts, payments),
				...(amounts.length
					? {}
					: { foreignIncomeUsd: null, foreignIncomeInr: null }),
				effectiveForeignTaxRate:
					gross?.gt("0") && tax !== null ? tax.div(gross).toFixed() : null,
				txIds: [...ids],
				foreignTaxPayments: payments.map(
					({ tx, usd, fx, possibleOverlap }) => ({
						txId: tx.id,
						fx,
						amountUsd: money(usd),
						amountInr: money(inr(usd, fx)),
						...(possibleOverlap ? { possibleOverlap } : {}),
					}),
				),
			};
		});
	return {
		dividends: { rows, totals: dividendTotals(rawAmounts) },
		form67: {
			countryName,
			countryCode,
			dtaaArticle,
			rows: formRows,
			totals: formTotals(rawAmounts, payments),
			notes: [
				`Confirm the Indian tax attributable to each dividend with your CA. Foreign tax credit is limited by that amount and applicable treaty rules. Dividends are taxed at ${rules.dividendRate} rates.`,
				`The worksheet ceiling uses recorded withholding. The default treaty withholding rate of ${D(rules.usWithholdingDefault).mul("100").toFixed()}% is for reference.`,
				"Resolve unallocated withholding and reconcile broker tax statements before filing Form 67.",
			],
		},
	};
}
