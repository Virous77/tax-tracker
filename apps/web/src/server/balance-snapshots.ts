import { D, taxYearBounds, timezoneOffsetMinutes } from "@tax/core";
import type { BalanceSnapshot } from "@tax/core/api";
import type { TaxDatabase } from "@tax/db";
import { computeHoldings } from "@tax/engine";
import { ApiError, required } from "./errors";
import { checkYear, putBalances } from "./reports";
import { getSettings } from "./settings";

// Statements expose a date, not a timestamp: compare at the close of that date in its stated zone.
function snapshotInstant(snapshot: BalanceSnapshot): string {
	return new Date(
		Date.parse(`${snapshot.asOf}T00:00:00.000Z`) +
			86_400_000 -
			1 -
			timezoneOffsetMinutes(snapshot.timezone) * 60_000,
	).toISOString();
}
function amounts(snapshot: BalanceSnapshot): Map<string, string> {
	const totals = new Map<string, string>();
	for (const row of snapshot.rows)
		totals.set(
			row.asset,
			D(totals.get(row.asset) ?? "0")
				.plus(row.amount)
				.toFixed(),
		);
	return totals;
}
export function listBalanceSnapshots(db: TaxDatabase) {
	const settings = getSettings(db);
	const transactions = db.transactions.active();
	return db.balanceSnapshots.list().map((snapshot) => {
		const computed = new Map(
			computeHoldings({
				transactions,
				settings,
				asOf: snapshotInstant(snapshot),
			})
				.filter((row) => row.venue === snapshot.venue)
				.map((row) => [row.asset, row.quantity]),
		);
		const statement = amounts(snapshot);
		const comparison = [...new Set([...computed.keys(), ...statement.keys()])]
			.sort()
			.map((asset) => ({
				asset,
				statement: statement.get(asset) ?? "0",
				computed: computed.get(asset) ?? "0",
				difference: D(statement.get(asset) ?? "0")
					.minus(computed.get(asset) ?? "0")
					.toFixed(),
			}));
		return { ...snapshot, comparison };
	});
}
export function applyBalanceSnapshot(
	db: TaxDatabase,
	id: string,
	taxYear: string,
) {
	checkYear(taxYear);
	const snapshot = required(db.balanceSnapshots.get(id));
	const yearEnd = Date.parse(taxYearBounds(taxYear).endExclusiveUtc) - 1;
	if (Math.abs(Date.parse(snapshotInstant(snapshot)) - yearEnd) > 86_400_000)
		throw new ApiError(
			409,
			"snapshot_not_year_end",
			"The statement must be within one day of the selected tax year's end in IST.",
			{ asOf: snapshot.asOf, taxYear, reason: "outside_year_end_window" },
		);
	const source =
		getSettings(db).lotPool === "per_source" ? snapshot.venue : undefined;
	const values = amounts(snapshot);
	const existing = db.actualBalances
		.get(taxYear)
		.filter((row) => row.source !== source || !values.has(row.asset));
	return putBalances(db, taxYear, [
		...existing,
		...[...values].map(([asset, amount]) => ({
			asset,
			amount,
			...(source ? { source } : {}),
		})),
	]);
}
