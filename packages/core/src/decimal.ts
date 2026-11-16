import { Decimal } from "decimal.js";

const MoneyDecimal = Decimal.clone({
	precision: 80,
	rounding: Decimal.ROUND_HALF_UP,
	toExpNeg: -100,
	toExpPos: 100,
});
export type DecimalValue = string | Decimal;
export function D(value: DecimalValue): Decimal {
	return new MoneyDecimal(value);
}
export function parseDecimal(value: string): Decimal {
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
		throw new Error(`Invalid decimal: ${value}`);
	const result = D(value.trim());
	if (!result.isFinite()) throw new Error("Decimal must be finite");
	return result;
}
export function formatDecimal(value: DecimalValue): string {
	return D(value).toFixed();
}
export function roundInr(value: DecimalValue): string {
	return D(value).toFixed(2, Decimal.ROUND_HALF_UP);
}
export function formatInr(value: DecimalValue): string {
	const fixed = roundInr(value);
	const negative = fixed.startsWith("-");
	const [whole = "0", fraction = "00"] = fixed.replace(/^-/, "").split(".");
	const tail = whole.slice(-3);
	const prefix = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
	return `${negative ? "-" : ""}₹${prefix ? `${prefix},` : ""}${tail}.${fraction}`;
}
