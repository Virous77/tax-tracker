import {
	type ActualBalance,
	ActualBalanceSchema,
	DISCLAIMER,
	type EngineSettings,
	EngineSettingsSchema,
	type EquityCyPrice,
	EquityCyPriceSchema,
	type EquityMetadata,
	EquityMetadataSchema,
	type FxLookup,
	type LedgerTx,
	LedgerTxSchema,
	type ReportWarning,
	TaxYearSchema,
	taxYearBounds,
	type UsEquityReport,
} from "@tax/core";
import { type UsEquityRules, UsEquityRulesSchema } from "@tax/rules";
import { compareTransactions } from "../matching.js";
import { computeDividends } from "./dividends.js";
import { computeGains } from "./gains.js";
import { computeScheduleFa } from "./schedule-fa.js";
import { createUsdFx, equityEvent, equityEventFx, flag } from "./values.js";

export interface ComputeUsEquityInput {
	transactions: LedgerTx[];
	rules: UsEquityRules;
	settings: EngineSettings;
	taxYear: string;
	fx: FxLookup;
	actualBalances?: ActualBalance[];
	metadata?: EquityMetadata[];
	cyPrices?: EquityCyPrice[];
}

const supportedTypes = new Set([
	"buy",
	"sell",
	"deposit",
	"withdrawal",
	"dividend",
	"foreign_tax",
]);
const incompleteCodes = new Set([
	"corporate_action",
	"fx_unavailable",
	"missing_history",
	"missing_inr_value",
	"missing_market_price",
	"unmatched_foreign_tax",
	"unmatched_transfer",
	"unknown_type",
	"import_incomplete",
]);

export function computeUsEquityReport(
	input: ComputeUsEquityInput,
): UsEquityReport {
	const settings = EngineSettingsSchema.parse(input.settings);
	const rules = UsEquityRulesSchema.parse(input.rules);
	const taxYear = TaxYearSchema.parse(input.taxYear);
	const bounds = taxYearBounds(taxYear);
	if (
		rules.taxYear !== taxYear ||
		rules.period.start !== bounds.start ||
		rules.period.end !== bounds.end
	)
		throw new Error("Rule period does not match requested tax year");
	const actualBalances = ActualBalanceSchema.array().parse(
		input.actualBalances ?? [],
	);
	const metadata = EquityMetadataSchema.array().parse(input.metadata ?? []);
	const prices = EquityCyPriceSchema.array().parse(input.cyPrices ?? []);
	const ledger = input.transactions
		.filter((tx) => tx.assetClass === "us_equity")
		.map((tx) => LedgerTxSchema.parse(tx))
		.sort(compareTransactions);

	const ids = new Set<string>();
	const refs = new Set<string>();
	for (const tx of ledger) {
		const key = JSON.stringify([tx.source, tx.sourceRef]);
		if (ids.has(tx.id) || refs.has(key))
			throw new Error(
				"Duplicate ledger id or source/sourceRef; deduplicate at import boundary",
			);
		ids.add(tx.id);
		refs.add(key);
	}

	const warnings = new Map<string, ReportWarning>();
	const warn = (item: ReportWarning) => {
		warnings.set(
			JSON.stringify([
				item.code,
				item.txId,
				item.asset,
				item.source,
				item.message,
			]),
			item,
		);
	};
	if (!rules.sectionsVerified)
		warn({
			code: "ca_verification_pending",
			message: "Section numbers pending CA verification",
		});
	const excluded: UsEquityReport["excluded"] = [];
	const events = [];
	const through = [bounds.end, `${rules.scheduleFaCalendarYear}-12-31`]
		.sort()
		.at(-1);
	for (const tx of ledger) {
		const event = equityEvent(tx, settings);
		if (through && event.date > through) continue;
		if (tx.reviewFlags.some((item) => item.code === "suspected_spam")) {
			excluded.push({ txId: tx.id, reason: "suspected_spam" });
			continue;
		}
		for (const item of tx.reviewFlags)
			warn({
				...item,
				txId: tx.id,
				...(event.share ? { asset: event.share.asset } : {}),
			});
		if (tx.reviewFlags.some((item) => item.code === "corporate_action")) {
			excluded.push({ txId: tx.id, reason: "corporate_action" });
			continue;
		}
		if (!supportedTypes.has(tx.type) || (event.trade && !event.share)) {
			warn(
				flag(
					tx,
					"unknown_type",
					"This ledger action cannot be included in the equity calculation.",
				),
			);
			continue;
		}
		events.push(event);
	}

	const exactFx = createUsdFx(input.fx);
	const eventFx = equityEventFx(exactFx, settings.usEquityFxBasis);
	const throughYear = events.filter(({ date }) => date <= bounds.end);
	const gains = computeGains({
		events: throughYear,
		start: bounds.start,
		rules,
		settings,
		fx: eventFx,
		actualBalances,
		warn,
	});
	const income = computeDividends(
		throughYear.filter(({ date }) => date >= bounds.start),
		rules,
		eventFx,
		warn,
	);
	const scheduleFa = computeScheduleFa({
		events,
		rules,
		settings,
		exactFx,
		eventFx,
		metadata,
		prices,
		warn,
	});
	const incomplete =
		gains.unresolved.length > 0 ||
		[...warnings.values()].some(({ code }) => incompleteCodes.has(code));
	return {
		taxYear,
		act: rules.act,
		calendarYear: rules.scheduleFaCalendarYear,
		generatedFrom: {
			txCount: ledger.length,
			ruleFile: `india-us-equity/${taxYear}.json`,
			settings,
		},
		sectionsVerified: rules.sectionsVerified,
		sections: rules.sections,
		dtaa: rules.dtaa,
		...gains,
		...income,
		scheduleFa,
		excluded,
		warnings: [...warnings.values()],
		ledger,
		disclaimer: DISCLAIMER,
		...(incomplete ? { incomplete: true } : {}),
	};
}
