import { D, formatDecimal, formatInr, istDate, type TxType } from "@tax/core";

export { formatInr };

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
	if (source === "coindcx") return "CoinDCX";
	if (source === "manual") return "Manual";
	if (source.startsWith("csv:")) return `CSV (${source.slice(4)})`;
	if (source.startsWith("evm:")) return `EVM (${source.slice(4)})`;
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

export function isLocalEndpoint(url: string): boolean {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		if (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "::1" ||
			host === "[::1]" ||
			host === "0.0.0.0" ||
			host === "ollama" ||
			host === "host.docker.internal" ||
			host.endsWith(".local")
		) {
			return true;
		}
		if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
		const m172 = /^172\.(\d+)\./.exec(host);
		if (m172?.[1]) {
			const octet = Number(m172[1]);
			if (octet >= 16 && octet <= 31) return true;
		}
		return false;
	} catch {
		return false;
	}
}
