import {
	type ActualBalance,
	ActualBalanceSchema,
	D,
	DISCLAIMER,
	type EngineSettings,
	EngineSettingsSchema,
	type FxLookup,
	FxRateSchema,
	type IncomeRow,
	istDate,
	type LedgerTx,
	LedgerTxSchema,
	type PriceLookup,
	type ReportWarning,
	roundInr,
	TaxYearSchema,
	taxYearBounds,
	type Valuation,
	type VdaReport,
	venueForSource,
} from "@tax/core";
import { type VdaRules, VdaRulesSchema } from "@tax/rules";
import { BalanceBook } from "./balances.js";
import { DisposalBook } from "./disposals.js";
import { LotBook, type LotSlice } from "./lots.js";
import { compareTransactions, matchTransfers } from "./matching.js";
import { TdsBook, taxTotals } from "./tax.js";
import {
	FIAT,
	feeValueInr,
	type LedgerRate,
	ledgerStablecoinRate,
	valueTransaction,
} from "./valuation.js";

export { computeHoldings } from "./holdings.js";
export { type Lot, LotBook, type LotSlice } from "./lots.js";
export { compareTransactions, matchTransfers } from "./matching.js";
export { valueTransaction } from "./valuation.js";
export interface ComputeVdaInput {
	transactions: LedgerTx[];
	rules: VdaRules;
	settings: EngineSettings;
	taxYear: string;
	actualBalances?: ActualBalance[];
	fx: FxLookup;
	priceLookup?: PriceLookup;
}
export function computeVdaReport(input: ComputeVdaInput): VdaReport {
	const settings = EngineSettingsSchema.parse(input.settings);
	const rules = VdaRulesSchema.parse(input.rules);
	const taxYear = TaxYearSchema.parse(input.taxYear);
	const bounds = taxYearBounds(taxYear);
	if (
		rules.taxYear !== taxYear ||
		rules.period.start !== bounds.start ||
		rules.period.end !== bounds.end
	)
		throw new Error("Rule period does not match requested tax year");
	const transactions = input.transactions
		.map((tx) => LedgerTxSchema.parse(tx))
		.sort(compareTransactions);
	const keys = new Set<string>();
	const ids = new Set<string>();
	for (const tx of transactions) {
		const key = JSON.stringify([tx.source, tx.sourceRef]);
		if (keys.has(key) || ids.has(tx.id))
			throw new Error(
				"Duplicate ledger id or source/sourceRef; deduplicate at import boundary",
			);
		keys.add(key);
		ids.add(tx.id);
	}
	const checkedFx: FxLookup = (currency, date) => {
		const result = input.fx(currency, date);
		if (result === null) return null;
		const parsed = FxRateSchema.parse(result);
		if (parsed.rateDate > date)
			throw new Error("FX lookup returned a future publication date");
		return parsed;
	};
	const throughYear = transactions.filter(
		(tx) => Date.parse(tx.timestamp) < Date.parse(bounds.endExclusiveUtc),
	);
	const excluded = throughYear
		.filter((tx) => tx.reviewFlags.some((f) => f.code === "suspected_spam"))
		.map((tx) => ({ txId: tx.id, reason: "suspected_spam" }));
	const included = throughYear.filter(
		(tx) => !excluded.some((row) => row.txId === tx.id),
	);
	const inYear = (tx: LedgerTx) =>
		Date.parse(tx.timestamp) >= Date.parse(bounds.startUtc);
	const warnings: ReportWarning[] = [];
	const warningKeys = new Set<string>();
	const warn = (flag: ReportWarning) => {
		const key = JSON.stringify(flag);
		if (!warningKeys.has(key)) {
			warnings.push(flag);
			warningKeys.add(key);
		}
	};
	for (const tx of included)
		for (const flag of tx.reviewFlags) warn({ ...flag, txId: tx.id });
	if (!rules.sectionsVerified)
		warn({
			code: "ca_verification_pending",
			message: "Section numbers pending CA verification",
		});
	const matches = matchTransfers(included, settings);
	const withdrawals = new Map(matches.map((m) => [m.withdrawal.id, m]));
	for (const match of matches) {
		if (D(match.feeQuantity).lt("0"))
			warn({
				txId: match.withdrawal.id,
				code: "fee_review_required",
				message:
					"Hash-matched deposit exceeds withdrawal; confirm amounts and network fee.",
			});
		if (match.ambiguous)
			warn({
				txId: match.withdrawal.id,
				code: "ambiguous_transfer",
				message:
					"Multiple possible transfer pairs; earliest chronological pair was inferred. Confirm source history before filing.",
			});
	}
	const deposits = new Map(matches.map((m) => [m.deposit.id, m]));
	const moved = new Map<string, LotSlice[]>();
	const pool = (source: string) =>
		settings.lotPool === "global" ? "global" : venueForSource(source);
	const lots = new LotBook();
	const holdings = new BalanceBook(settings);
	const tds = new TdsBook();
	const incomeRows: IncomeRow[] = [];
	const valuations: Valuation[] = [];

	let giftsTotal = D("0");
	let rate: LedgerRate | null = null;
	const ledgerById = new Map(transactions.map((tx) => [tx.id, tx]));
	const disposals = new DisposalBook(settings, ledgerById, warn);
	const rawRefs = (txIds: string[]) =>
		[...new Set(txIds)].map((id) => {
			const tx = ledgerById.get(id);
			if (!tx) throw new Error("Missing trail ledger row");
			return {
				txId: tx.id,
				source: tx.source,
				sourceRef: tx.sourceRef,
				raw: tx.raw,
			};
		});
	const prepareTransfer = (match: (typeof matches)[number]) => {
		if (moved.has(match.deposit.id)) return;
		const slices = lots.consume(
			match.withdrawal.assetOut ?? "",
			pool(match.withdrawal.source),
			match.withdrawal.amountOut ?? "0",
		);
		const ratio = D(match.deposit.amountIn ?? "0").div(
			match.withdrawal.amountOut ?? "1",
		);
		moved.set(
			match.deposit.id,
			slices.map((lot) => ({
				...lot,
				qty: lot.qty.mul(ratio),
				costInr:
					lot.costInr === null
						? null
						: settings.feeTreatment === "include"
							? lot.costInr
							: lot.costInr.mul(ratio),
				trailTxIds: [...lot.trailTxIds, match.withdrawal.id],
			})),
		);
	};
	for (const [order, tx] of included.entries()) {
		const current = inYear(tx);
		const sourcePool = pool(tx.source);
		const inferredRate = ledgerStablecoinRate(tx);
		if (inferredRate) rate = inferredRate;
		const isTrade = ["buy", "sell", "swap"].includes(tx.type);
		const isDisposal =
			isTrade &&
			tx.assetOut !== undefined &&
			!FIAT.has(tx.assetOut) &&
			tx.amountOut !== undefined;
		const isAcquisition =
			isTrade &&
			tx.assetIn !== undefined &&
			!FIAT.has(tx.assetIn) &&
			tx.amountIn !== undefined;
		const needsValue = isTrade || tx.type === "income" || tx.type === "gift";
		const valuation: Valuation = needsValue
			? valueTransaction(tx, settings, checkedFx, rate, input.priceLookup)
			: { txId: tx.id, valueInr: null };

		const gross = valuation.valueInr === null ? null : D(valuation.valueInr);
		let fee = D("0");
		let unknownFee = false;
		if (settings.feeTreatment === "include" && isTrade) {
			const value = feeValueInr(
				tx,
				valuation,
				settings,
				checkedFx,
				rate,
				input.priceLookup,
			);
			if (value.valueInr === null) {
				unknownFee = true;
				warn({
					txId: tx.id,
					code: "missing_inr_value",
					message:
						"Fee has no recorded INR valuation; affected tax leg is unresolved.",
				});
			} else fee = D(value.valueInr);
			valuation.fee = {
				...value,
				valueInr: value.valueInr === null ? null : roundInr(value.valueInr),
			};
		}
		if (valuation.marketPrice) {
			const asset = ["buy", "income", "gift"].includes(tx.type)
				? tx.assetIn
				: tx.assetOut;
			if (
				valuation.marketPrice.dayBasis === "UTC" ||
				(valuation.marketPrice.source === "binance_klines" &&
					valuation.marketPrice.sourceId !== `${asset}USDT`)
			)
				warn({
					txId: tx.id,
					code: "parse_warning",
					message: `Market price from ${valuation.marketPrice.source} (${valuation.marketPrice.sourceId}), ${valuation.marketPrice.date} ${valuation.marketPrice.dayBasis ?? "IST"}, ${valuation.marketPrice.kind}; confirm date basis and asset identity.`,
				});
		}
		if (needsValue) {
			valuations.push({
				...valuation,
				valueInr:
					valuation.valueInr === null ? null : roundInr(valuation.valueInr),
			});
			if (valuation.valueInr === null)
				warn({
					txId: tx.id,
					code: "missing_inr_value",
					message:
						"No recorded INR value, INR trade price or supported stablecoin/FX value.",
				});
		}
		if (current)
			tds.add(
				tx,
				isDisposal ? (gross?.toFixed() ?? null) : null,
				isDisposal,
				warn,
			);
		holdings.change(tx.assetIn, tx.source, tx.amountIn, tx.id);
		holdings.change(
			tx.assetOut,
			tx.source,
			tx.amountOut ? D(tx.amountOut).negated().toFixed() : undefined,
			tx.id,
		);
		if (tx.type === "withdrawal" && tx.assetOut && tx.amountOut) {
			const match = withdrawals.get(tx.id);
			if (match) {
				prepareTransfer(match);
			} else {
				lots.consume(tx.assetOut, sourcePool, tx.amountOut);
				if (current)
					warn({
						txId: tx.id,
						code: "unmatched_transfer",
						message:
							"Withdrawal has no matching deposit in the reporting history.",
					});
			}
		}
		if (tx.type === "deposit" && tx.assetIn && tx.amountIn) {
			if (deposits.has(tx.id)) {
				const match = deposits.get(tx.id);
				if (match) prepareTransfer(match);
				for (const lot of moved.get(tx.id) ?? [])
					lots.add({
						...lot,
						order: lot.order === Number.MAX_SAFE_INTEGER ? order : lot.order,
						pool: sourcePool,
						trailTxIds: [...lot.trailTxIds, tx.id],
					});
			} else {
				lots.add({
					asset: tx.assetIn,
					qty: D(tx.amountIn),
					costInr: null,
					acquiredAt: null,
					txId: tx.id,
					pool: sourcePool,
					order,
					trailTxIds: [tx.id],
				});
				if (current)
					warn({
						txId: tx.id,
						code: "unmatched_transfer",
						message:
							"Deposit has no matching withdrawal; acquisition basis is unknown.",
					});
			}
		}
		if (isDisposal && tx.assetOut && tx.amountOut) {
			const consideration =
				gross === null || unknownFee ? null : gross.minus(fee);
			const slices = lots.consume(tx.assetOut, sourcePool, tx.amountOut);
			if (current)
				disposals.add(tx, tx.assetOut, tx.amountOut, slices, consideration);
		}
		if (isAcquisition && tx.assetIn && tx.amountIn) {
			const cost =
				gross === null || (unknownFee && !isDisposal)
					? null
					: gross.plus(isDisposal ? "0" : fee);
			lots.add({
				asset: tx.assetIn,
				qty: D(tx.amountIn),
				costInr: cost,
				acquiredAt: tx.timestamp,
				txId: tx.id,
				pool: sourcePool,
				order,
				trailTxIds: [tx.id],
			});
		}
		if (
			(tx.type === "income" || tx.type === "gift") &&
			tx.assetIn &&
			tx.amountIn
		) {
			const cost =
				tx.type === "gift"
					? null
					: settings.incomeCostBasis === "zero"
						? D("0")
						: gross;
			lots.add({
				asset: tx.assetIn,
				qty: D(tx.amountIn),
				costInr: cost,
				acquiredAt: tx.timestamp,
				txId: tx.id,
				pool: sourcePool,
				order,
				trailTxIds: [tx.id],
			});
			if (current) {
				incomeRows.push({
					txId: tx.id,
					type: tx.type,
					...(tx.incomeKind ? { incomeKind: tx.incomeKind } : {}),
					date: istDate(tx.timestamp),
					asset: tx.assetIn,
					quantity: tx.amountIn,
					fmvInr: gross === null ? null : roundInr(gross),
					trail: rawRefs([tx.id]),
				});
				if (tx.type === "gift" && gross !== null)
					giftsTotal = giftsTotal.plus(gross);
			}
		}
		if (tx.type === "fee" && tx.assetOut && tx.amountOut)
			lots.consume(tx.assetOut, sourcePool, tx.amountOut);
		if (tx.type === "transfer")
			warn({
				txId: tx.id,
				code: "unmatched_transfer",
				message:
					"A standalone transfer needs explicit withdrawal/deposit sources; review before assigning lots.",
			});
		if (tx.type === "dividend")
			warn({
				txId: tx.id,
				code: "unknown_type",
				message:
					"US-equity dividends are outside the VDA calculation; Phase 3 treatment is required.",
			});
		if (
			tx.feeAsset &&
			tx.feeAmount &&
			D(tx.feeAmount).gt("0") &&
			!FIAT.has(tx.feeAsset)
		) {
			const matched = withdrawals.get(tx.id);
			const includedNetworkFee =
				matched && tx.feeAsset === tx.assetOut && D(matched.feeQuantity).gt("0")
					? D(matched.feeQuantity)
					: D("0");
			const extraFee = D(tx.feeAmount).minus(includedNetworkFee);
			if (extraFee.gt("0")) {
				holdings.change(
					tx.feeAsset,
					tx.source,
					extraFee.negated().toFixed(),
					tx.id,
				);
				lots.consume(tx.feeAsset, sourcePool, extraFee);
				warn({
					txId: tx.id,
					code: "fee_review_required",
					message:
						"Crypto-denominated fee reduces holdings; confirm whether paying the fee is a separate taxable disposal.",
				});
			}
		}
	}
	const balances = holdings.finish(
		(input.actualBalances ?? []).map((v) => ActualBalanceSchema.parse(v)),
		warn,
	);
	const tdsResult = tds.finish(rules, settings);
	const giftsOverThreshold = giftsTotal.gt(rules.giftThresholdInr);
	return {
		taxYear,
		act: rules.act,
		generatedFrom: {
			txCount: transactions.length,
			ruleFile: `india-vda/${taxYear}.json`,
			settings,
		},
		sectionsVerified: rules.sectionsVerified,
		sections: rules.sections,
		scheduleVdaRows: disposals.rows,
		totals: taxTotals(disposals.totals, rules, settings, tdsResult.credit),
		tds: { bySource: tdsResult.bySource, checklist: tdsResult.checklist },
		income: {
			rows: incomeRows,
			giftsTotalInr: roundInr(giftsTotal),
			giftsOverThreshold,
			...(giftsOverThreshold
				? {
						note: `Gift FMV exceeds the rule threshold ${rules.giftThresholdInr}; review exemptions and slab-income treatment with a CA.`,
					}
				: {}),
		},
		balances,
		unresolved: disposals.unresolved,
		excluded,
		warnings,
		valuations,
		ledger: transactions,
		disclaimer: DISCLAIMER,
	};
}
