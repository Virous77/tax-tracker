import { D, type LedgerTx, type TxType, type VdaReport } from "@tax/core";
import { formatInr, formatQty } from "@/lib/client/format";

/** What the user typed into an INR amount field: the total for the row, or the price of one unit. */
export type InrEntryMode = "total" | "perUnit";

/** A per-unit price is flagged when it is below 1/10 or above 10× the reference. */
const PLAUSIBLE_FACTOR = 10;

function decimalText(text: string | undefined): string | null {
	const trimmed = text?.trim() ?? "";
	return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/**
 * The total INR value to store. In "total" mode it is what the user typed, untouched;
 * in "perUnit" mode it is price × quantity, unrounded. Null when it can't be worked out.
 */
export function inrTotalFromEntry(
	mode: InrEntryMode,
	text: string,
	quantity: string | undefined,
): string | null {
	const amount = decimalText(text);
	if (amount === null) return null;
	if (mode === "total") return amount;
	const qty = decimalText(quantity);
	if (qty === null || D(qty).isZero()) return null;
	return D(amount).times(qty).toFixed();
}

/** Price of one unit implied by an entry, whichever way it was typed. */
export function perUnitFromEntry(
	mode: InrEntryMode,
	text: string,
	quantity: string | undefined,
): string | null {
	const amount = decimalText(text);
	if (amount === null) return null;
	if (mode === "perUnit") return amount;
	const qty = decimalText(quantity);
	if (qty === null || D(qty).isZero()) return null;
	return D(amount).div(qty).toFixed();
}

/** ₹ with paise, and enough significant digits for prices under one rupee. */
export function formatInrPrice(value: string): string {
	const d = D(value);
	if (d.isZero() || d.abs().gte(1)) return formatInr(value);
	return `₹${d.toSignificantDigits(3).toFixed()}`;
}

/** The live line under the field: the other way of reading the same entry. */
export function describeOtherValue(
	mode: InrEntryMode,
	text: string,
	quantity: string | undefined,
	asset: string,
): string | null {
	const unit = asset || "unit";
	if (mode === "total") {
		const perUnit = perUnitFromEntry(mode, text, quantity);
		return perUnit === null ? null : `= ${formatInrPrice(perUnit)} per ${unit}`;
	}
	const total = inrTotalFromEntry(mode, text, quantity);
	if (total === null)
		return decimalText(text) === null
			? null
			: "Enter the quantity to work out the total.";
	return `= ${formatInr(total)} total for ${formatQty(quantity)} ${asset}`.trim();
}

/** The coin leg an INR value prices: what was received for a buy, what left for a sale. */
export function pricedLeg(
	tx: LedgerTx,
	type: TxType = tx.type,
): { asset: string; quantity: string } | null {
	const incoming = ["buy", "income", "gift", "deposit", "dividend"].includes(
		type,
	);
	const legs = [
		{ asset: tx.assetIn, quantity: tx.amountIn },
		{ asset: tx.assetOut, quantity: tx.amountOut },
	];
	if (!incoming) legs.reverse();
	const leg = legs.find((l) => l.asset && l.quantity);
	return leg?.asset && leg.quantity
		? { asset: leg.asset, quantity: leg.quantity }
		: null;
}

export interface PriceReference {
	/** INR for one unit of the asset. */
	perUnit: string;
	/** Where the reference comes from, shown to the user. */
	basis: string;
}

/** The INR quantity leg of a row for `asset`, if the row moved that asset. */
function assetQuantity(tx: LedgerTx, asset: string): string | null {
	if (tx.assetOut === asset && tx.amountOut) return tx.amountOut;
	if (tx.assetIn === asset && tx.amountIn) return tx.amountIn;
	return null;
}

/** The sale's own INR consideration per unit, when it has one. */
export function referenceFromSale(
	sale: LedgerTx,
	asset: string,
): PriceReference | null {
	const qty = assetQuantity(sale, asset);
	if (!sale.inrValue || !qty || D(qty).isZero() || D(sale.inrValue).isZero())
		return null;
	return {
		perUnit: D(sale.inrValue).div(qty).toFixed(),
		basis: "the sale this purchase is for",
	};
}

function median(values: ReturnType<typeof D>[]): string | null {
	const sorted = [...values].sort((a, b) => a.comparedTo(b));
	const mid = Math.floor(sorted.length / 2);
	const upper = sorted[mid];
	const lower = sorted[sorted.length % 2 === 1 ? mid : mid - 1];
	return upper && lower ? lower.plus(upper).div(2).toFixed() : null;
}

function perUnitInr(
	tx: LedgerTx,
	asset: string,
	valueInr: string | null | undefined,
): ReturnType<typeof D> | null {
	const qty = assetQuantity(tx, asset);
	if (!valueInr || !qty || D(qty).isZero() || D(valueInr).isZero()) return null;
	return D(valueInr).div(qty);
}

/**
 * Median INR per unit across imported rows that moved `asset` and carry an INR value.
 * Hand-entered rows are skipped: a mistyped one must not vouch for the next.
 */
export function referenceFromLedger(
	rows: readonly LedgerTx[],
	asset: string,
	excludeTxId?: string,
): PriceReference | null {
	const prices = rows
		.filter((tx) => tx.source !== "manual" && tx.id !== excludeTxId)
		.flatMap((tx) => perUnitInr(tx, asset, tx.inrValue) ?? []);
	const perUnit = median(prices);
	return perUnit === null
		? null
		: { perUnit, basis: `your other ${asset} transactions` };
}

/** Same, from the INR values the last computed report gave imported rows (e.g. USDT-quoted trades). */
export function referenceFromReport(
	report: Pick<VdaReport, "taxYear" | "ledger" | "valuations">,
	asset: string,
	excludeTxId?: string,
): PriceReference | null {
	const ledger = new Map(report.ledger.map((tx) => [tx.id, tx]));
	const prices = report.valuations.flatMap((v) => {
		const tx = ledger.get(v.txId);
		if (!tx || tx.source === "manual" || tx.id === excludeTxId) return [];
		return perUnitInr(tx, asset, v.valueInr) ?? [];
	});
	const perUnit = median(prices);
	return perUnit === null
		? null
		: { perUnit, basis: `${asset} values in your ${report.taxYear} report` };
}

export function costPlausibility(
	perUnit: string,
	reference: PriceReference,
): "low" | "high" | null {
	const price = D(perUnit);
	const ref = D(reference.perUnit);
	if (ref.isZero() || price.isZero()) return null;
	if (price.lt(ref.div(PLAUSIBLE_FACTOR))) return "low";
	if (price.gt(ref.times(PLAUSIBLE_FACTOR))) return "high";
	return null;
}

/**
 * A soft warning when the implied price is far from the reference, with the likely
 * mix-up spelled out. It never changes the value and never blocks saving.
 */
export function implausibleCostWarning(
	mode: InrEntryMode,
	text: string,
	quantity: string | undefined,
	asset: string,
	reference: PriceReference | null,
): string | null {
	if (!reference || !asset) return null;
	const perUnit = perUnitFromEntry(mode, text, quantity);
	if (perUnit === null) return null;
	const verdict = costPlausibility(perUnit, reference);
	if (!verdict) return null;
	const typed = decimalText(text) ?? "0";
	const lead = `${formatInrPrice(perUnit)} per ${asset} looks very ${verdict === "low" ? "low" : "high"} next to about ${formatInrPrice(reference.perUnit)} per ${asset} (${reference.basis}).`;
	if (
		mode === "total" &&
		verdict === "low" &&
		!costPlausibility(typed, reference)
	) {
		return `${lead} Did you mean ${formatInrPrice(typed)} per ${asset}? Then choose “Per unit”. You can still save as it is.`;
	}
	if (mode === "perUnit" && verdict === "high") {
		const asTotal = perUnitFromEntry("total", text, quantity);
		if (asTotal !== null && !costPlausibility(asTotal, reference)) {
			return `${lead} Did you type the total? Then choose “Total”. You can still save as it is.`;
		}
	}
	return `${lead} Check the amount. You can still save as it is.`;
}
