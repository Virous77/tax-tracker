import { isDeepStrictEqual } from "node:util";
import { type ActualBalance, ActualBalanceSchema, D } from "@tax/core";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { actualBalances, usEquityActualBalances } from "./schema.js";

export function actualBalanceRepository(
	orm: BetterSQLite3Database,
	table: typeof actualBalances | typeof usEquityActualBalances,
	invalidate: (taxYear: string) => void,
) {
	const get = (taxYear: string): ActualBalance[] =>
		orm
			.select()
			.from(table)
			.where(eq(table.taxYear, taxYear))
			.all()
			.map(({ asset, amount, source }) =>
				ActualBalanceSchema.parse({
					asset,
					amount,
					...(source ? { source } : {}),
				}),
			);
	return {
		get,
		replace: (taxYear: string, values: ActualBalance[]) =>
			orm.transaction(() => {
				const rows = ActualBalanceSchema.array().parse(values);
				const stored = get(taxYear);
				const normalized = (balances: ActualBalance[]) =>
					balances
						.map(({ asset, source, amount }) =>
							JSON.stringify([asset, source ?? "", D(amount).toFixed()]),
						)
						.sort();
				if (isDeepStrictEqual(normalized(rows), normalized(stored)))
					return stored;
				orm.delete(table).where(eq(table.taxYear, taxYear)).run();
				for (const row of rows)
					orm
						.insert(table)
						.values({ ...row, taxYear, source: row.source ?? "" })
						.run();
				invalidate(taxYear);
				return rows;
			}),
	};
}
