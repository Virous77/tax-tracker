import {
	D,
	formatDecimal,
	formatInr,
	istDate,
	type TxType,
	type VdaReport,
} from "@tax/core";
import type { ReportMissingDetails } from "@tax/core/api";
import { getEvmChain } from "@/lib/client/chains";

export { formatInr };

export function pluralise(
	count: number,
	singular: string,
	plural = `${singular}s`,
): string {
	return count === 1 ? singular : plural;
}

const MISSING_CAUSE_LABELS: Record<
	Exclude<ReportMissingDetails["cause"], "never_computed">,
	string
> = {
	ledger_changed: "transactions changed",
	settings_changed: "tax engine settings changed",
	balances_changed: "actual balances changed",
};

export function formatReportMissingState(
	missing: ReportMissingDetails | null,
	taxYear: string,
	context: "overview" | "report",
): { title: string; description: string } {
	if (missing && missing.cause !== "never_computed") {
		const causeText = MISSING_CAUSE_LABELS[missing.cause];
		const when = missing.invalidatedAt
			? formatIstDateTime(missing.invalidatedAt)
			: null;
		return {
			title: `Report cleared for ${taxYear}`,
			description: `Your report was cleared because ${causeText}${when ? ` on ${when}` : ""} — compute again to refresh Schedule VDA rows, totals, and review checks.`,
		};
	}

	return context === "overview"
		? {
				title: `No computed report for ${taxYear}`,
				description:
					"Your transactions are in the ledger. Run Compute report to calculate Schedule VDA gains, tax, and TDS credit for this tax year.",
			}
		: {
				title: `No report computed for ${taxYear}`,
				description:
					"Compute the report to generate Schedule VDA rows, TDS totals, and year-end balance checks.",
			};
}

const istDateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
	timeZone: "Asia/Kolkata",
	day: "2-digit",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

const istDateFormatter = new Intl.DateTimeFormat("en-IN", {
	timeZone: "Asia/Kolkata",
	day: "2-digit",
	month: "short",
	year: "numeric",
});

export function formatInrNullable(value: string | null | undefined): string {
	if (value === null || value === undefined || value === "") return "—";
	try {
		return formatInr(value);
	} catch {
		return value;
	}
}

export function formatQty(value: string | null | undefined): string {
	if (value === null || value === undefined || value === "") return "—";
	try {
		const fixed = formatDecimal(value);
		if (!fixed.includes(".")) return fixed;
		const trimmed = fixed.replace(/\.?0+$/, "");
		return trimmed === "-0" ? "0" : trimmed;
	} catch {
		return value;
	}
}

export function formatIstDateTime(utcIso: string): string {
	const d = new Date(utcIso);
	if (!Number.isFinite(d.getTime())) return utcIso;
	return `${istDateTimeFormatter.format(d)} IST`;
}

export function formatIstDate(dateOrIso: string | null | undefined): string {
	if (!dateOrIso) return "—";
	if (/^\d{4}-\d{2}-\d{2}$/.test(dateOrIso)) {
		const d = new Date(`${dateOrIso}T00:00:00+05:30`);
		return Number.isFinite(d.getTime())
			? istDateFormatter.format(d)
			: dateOrIso;
	}
	try {
		const ymd = istDate(dateOrIso);
		const d = new Date(`${ymd}T00:00:00+05:30`);
		return Number.isFinite(d.getTime()) ? istDateFormatter.format(d) : ymd;
	} catch {
		return dateOrIso;
	}
}

export function isNegativeDecimal(value: string | null | undefined): boolean {
	if (!value) return false;
	try {
		return D(value).lt("0");
	} catch {
		return false;
	}
}

export function isPositiveDecimal(value: string | null | undefined): boolean {
	if (!value) return false;
	try {
		return D(value).gt("0");
	} catch {
		return false;
	}
}

export function isZeroDecimal(value: string | null | undefined): boolean {
	if (!value) return false;
	try {
		return D(value).eq("0");
	} catch {
		return false;
	}
}

export function formatSourceLabel(source: string): string {
	if (source === "binance") return "Binance";
	if (source === "binance-api") return "Binance (API)";
	if (source === "coindcx") return "CoinDCX";
	if (source === "coindcx-api") return "CoinDCX (API)";
	if (source === "manual") return "Manual";
	if (source === "generic") return "Generic CSV";
	if (source.startsWith("csv:")) return `Generic CSV (${source.slice(4)})`;
	if (source.startsWith("evm:")) {
		const rawId = Number(source.slice(4));
		const chain = Number.isInteger(rawId) ? getEvmChain(rawId) : undefined;
		return chain ? chain.name : `EVM (${source.slice(4)})`;
	}
	return source;
}

const TX_TYPE_LABELS: Record<TxType, string> = {
	buy: "Buy",
	sell: "Sell",
	swap: "Swap",
	deposit: "Deposit",
	withdrawal: "Withdrawal",
	transfer: "Transfer",
	income: "Income",
	gift: "Gift",
	dividend: "Dividend",
	fee: "Fee",
};

export function formatTxType(type: TxType): string {
	return TX_TYPE_LABELS[type] ?? type;
}

const SECTION_LABELS: Record<string, string> = {
	vdaTax: "VDA Tax",
	vdaTds: "VDA TDS",
	vdaDefinition: "VDA Definition",
	platformReporting: "Platform Reporting",
	currencyConversionRule: "Currency Conversion Rule",
};

export function formatSectionLabel(key: string): string {
	if (SECTION_LABELS[key]) return SECTION_LABELS[key];
	return key
		.replace(/([A-Z])/g, " $1")
		.replace(/^./, (c) => c.toUpperCase())
		.trim();
}

const ENGINE_SETTING_LABELS: Record<string, string> = {
	marketPriceBasis: "Market price basis",
	feeTreatment: "Fee & GST treatment",
	lotMethod: "Lot matching method",
	lotPool: "Lot pool scope",
	usdtInrRate: "USDT / stablecoin INR rate",
	incomeCostBasis: "Income receipt cost basis",
	headOfIncome: "Head of income",
	surchargeRate: "Surcharge rate",
	specifiedPerson: "Specified person (TDS)",
	transferMatchWindowHours: "Transfer match window",
	transferAmountTolerance: "Transfer amount tolerance",
};

export function formatEngineSettingLabel(key: string): string {
	if (ENGINE_SETTING_LABELS[key]) return ENGINE_SETTING_LABELS[key];
	return key
		.replace(/([A-Z])/g, " $1")
		.replace(/^./, (c) => c.toUpperCase())
		.trim();
}

export function formatEngineSettingValue(key: string, value: unknown): string {
	const str = String(value);
	switch (key) {
		case "marketPriceBasis":
			return str === "vwap"
				? "IST-day VWAP"
				: "IST-day close (pending CA verification)";
		case "feeTreatment":
			return str === "include" ? "Include fees" : "Exclude fees";
		case "lotMethod":
			return str === "FIFO" ? "FIFO (First-In, First-Out)" : str;
		case "lotPool":
			return str === "per_source"
				? "Per-source (by exchange)"
				: "Global (all wallets)";
		case "usdtInrRate":
			return str === "sbi_usd_tt"
				? "SBI TT buying USD/INR"
				: "Ledger USDT/INR (fallback SBI TT)";
		case "incomeCostBasis":
			return str === "fmv_at_receipt"
				? "FMV at receipt"
				: "₹0 (conservative default)";
		case "headOfIncome":
			return str === "business" ? "Business Income" : "Capital Gains";
		case "surchargeRate": {
			const map: Record<string, string> = {
				"0": "0%",
				"0.10": "10%",
				"0.15": "15%",
				"0.25": "25%",
				"0.37": "37%",
			};
			return map[str] ?? str;
		}
		case "specifiedPerson":
			return value ? "Yes (₹50,000 threshold)" : "No (₹10,000 threshold)";
		case "transferMatchWindowHours":
			return `${str} hours`;
		case "transferAmountTolerance":
			try {
				return `${D(str).mul("100").toString()}%`;
			} catch {
				return str;
			}
		default:
			return str;
	}
}

const INR_RATE_SOURCE_LABELS: Record<string, string> = {
	trade_inr: "Direct INR trade",
	trade_usdt_x_usd_inr: "USDT trade × SBI USD/INR",
	market_price_cache: "Cached market price",
	manual: "Manual entry",
	fmv_receipt: "FMV at receipt",
};

export function formatInrRateSource(source: string): string {
	return INR_RATE_SOURCE_LABELS[source] ?? source;
}

export function formatSignStyle(signStyle: string): string {
	if (signStyle === "side_column") return "Side / type column";
	if (signStyle === "negative_is_sell") return "Negative amount is sell";
	return signStyle;
}

const INCOME_KIND_LABELS: Record<string, string> = {
	staking: "Staking",
	mining: "Mining",
	airdrop: "Airdrop",
	referral: "Referral",
	interest: "Interest",
	other: "Other",
};

export function formatIncomeKind(kind: string): string {
	return INCOME_KIND_LABELS[kind] ?? kind;
}

const REPORT_KIND_LABELS: Record<string, string> = {
	"binance:spot-order-history": "Binance Spot Order History",
	"binance:spot-trade-history": "Binance Spot Trade History",
	"binance:spot-trade-history-assets":
		"Binance Spot Trade History (asset columns)",
	"binance:legacy-spot-trade-history": "Binance Spot Trade History (legacy)",
	"binance:transaction-history": "Binance Transaction History Statement",
	"binance:deposits": "Binance Deposit History",
	"binance:withdrawals": "Binance Withdrawal History",
	"binance:wallet-history": "Binance Wallet History (legacy)",
	"binance:convert": "Binance Convert History",
	"binance:fiat": "Binance Fiat History",
	"binance:futures-trades": "Binance Futures Trade History",
	"binance:futures-transactions": "Binance Futures Transaction History",
	"binance:account-statement-pdf": "Binance Account Statement",
	"binance:mixed": "Binance Combined Reports",
	"coindcx:order-history": "CoinDCX Order History",
	"coindcx:instant-orders": "CoinDCX Trade Report — Instant Orders",
	"coindcx:spot-orders": "CoinDCX Trade Report — Spot Orders",
	"coindcx:futures-orders": "CoinDCX Futures Orders",
	"coindcx:options": "CoinDCX Options",
	"coindcx:form16a-pdf": "CoinDCX Form 16A",
	"coindcx:mixed": "CoinDCX Trade Report",
};

export function formatReportKindLabel(
	reportKind: string | null | undefined,
	serverLabel?: string | null,
): string | null {
	if (serverLabel) return serverLabel;
	if (!reportKind) return null;
	return REPORT_KIND_LABELS[reportKind] ?? reportKind;
}

export function formatExcludedReason(reason: string): string {
	if (reason === "superseded") {
		return "Replaced by a more detailed export (kept for records, excluded from tax calculation)";
	}
	if (reason === "suspected_spam") {
		return "Suspected spam token (excluded until cleared)";
	}
	return reason;
}

const localTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

export function formatLocalTime(utcIso: string): string | null {
	const d = new Date(utcIso);
	if (!Number.isFinite(d.getTime())) return null;
	return localTimeFormatter.format(d);
}

export function formatSyncStreamLabel(stream: string): string {
	if (stream === "binance:deposits") return "Binance deposit history";
	if (stream === "binance:withdrawals") return "Binance withdrawal history";
	if (stream === "binance:convert") return "Binance convert history";
	if (stream === "binance:dividends") return "Binance dividend history";
	if (stream === "binance:dust") return "Binance dust conversions";
	if (stream === "binance:symbols") return "Binance trading pairs";
	if (stream === "binance:fiat:0") return "Binance fiat history (deposits)";
	if (stream === "binance:fiat:1") return "Binance fiat history (withdrawals)";
	if (stream.startsWith("binance:fiat:")) return "Binance fiat history";
	if (stream === "binance:fiatpay:0") return "Binance fiat payments (buys)";
	if (stream === "binance:fiatpay:1") return "Binance fiat payments (sells)";
	if (stream.startsWith("binance:fiatpay:")) {
		return "Binance fiat payment history";
	}
	if (stream === "binance:p2p:BUY") return "Binance P2P buys";
	if (stream === "binance:p2p:SELL") return "Binance P2P sells";
	if (stream.startsWith("binance:p2p:")) return "Binance P2P history";
	if (stream === "binance:earn:flexible") {
		return "Binance Simple Earn (flexible)";
	}
	if (stream === "binance:earn:locked") return "Binance Simple Earn (locked)";
	if (stream.startsWith("binance:earn:")) return "Binance Earn history";
	if (stream.startsWith("binance:myTrades:")) {
		const pair = stream.slice("binance:myTrades:".length);
		return pair ? `Binance ${pair} trades` : "Binance spot trades";
	}
	if (stream === "coindcx:trades") return "CoinDCX trades";
	if (stream.startsWith("coindcx:")) return "CoinDCX history";
	if (stream.startsWith("evm:")) {
		const parts = stream.split(":");
		const chainId = Number(parts[1]);
		const chainName = Number.isInteger(chainId)
			? (getEvmChain(chainId)?.name ?? `Chain ${chainId}`)
			: "EVM";
		const action = parts[3];
		if (action === "txlist") return `${chainName} transactions`;
		if (action === "txlistinternal") {
			return `${chainName} internal transactions`;
		}
		if (action === "tokentx") return `${chainName} token transfers`;
		return `${chainName} history`;
	}
	return stream;
}

export function formatManualVenueLabel(venue: string): string {
	if (venue === "binance") return "Binance";
	if (venue === "coindcx") return "CoinDCX";
	if (venue === "manual") return "Manual (no exchange)";
	return venue;
}

export function formatTimezoneSourceLabel(
	timezoneSource: "file" | "user",
	timezoneOrigin?: "header" | "file_name" | null,
): string {
	if (timezoneSource !== "file") return "your answer";
	if (timezoneOrigin === "header") return "from the column header";
	if (timezoneOrigin === "file_name") return "from the file name";
	return "from the file";
}

export function effectiveTimezone(imp: {
	timezone: string;
	detectedTimezone: string | null;
	timezoneSource: "file" | "user";
}): string {
	return imp.timezoneSource === "file"
		? (imp.detectedTimezone ?? imp.timezone)
		: imp.timezone;
}

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Value for a datetime-local input showing the given instant in IST. */
function istDateTimeInputValue(ms: number): string {
	return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** A purchase has to come before the sale it covers: one day before it, else the year's first day. */
export function defaultMissingBuyDateTime(
	saleTimestamp: string | null,
	taxYear: { start: string } | undefined,
): string | undefined {
	const saleMs = saleTimestamp ? Date.parse(saleTimestamp) : Number.NaN;
	if (Number.isFinite(saleMs)) return istDateTimeInputValue(saleMs - DAY_MS);
	return taxYear ? `${taxYear.start}T00:00` : undefined;
}

export function reportHasActivity(report: VdaReport): boolean {
	return (
		report.scheduleVdaRows.length +
			report.income.rows.length +
			report.unresolved.length +
			report.excluded.length >
		0
	);
}

/** Any unresolved disposal makes the totals provisional, whatever the server flag says. */
export function isReportIncomplete(report: VdaReport): boolean {
	return report.incomplete ?? report.unresolved.length > 0;
}

export function formatIncompleteSummary(report: VdaReport): string {
	const sales = new Set(report.unresolved.map((u) => u.txId)).size;
	const noHistory = report.unresolved.every(
		(u) => u.reason === "missing_history",
	);
	return noHistory
		? `Incomplete — ${sales} ${pluralise(sales, "sale has", "sales have")} no purchase history`
		: `Incomplete — ${sales} ${pluralise(sales, "sale is", "sales are")} unresolved`;
}
