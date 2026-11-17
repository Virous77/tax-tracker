import type { ImportTimezone } from "./types.js";

export function timezoneOffsetMinutes(timezone: ImportTimezone): number {
	if (timezone === "IST") return 330;
	if (timezone === "UTC") return 0;
	const match = timezone.match(/^([+-])(\d{2}):(\d{2})$/);
	if (!match)
		throw new Error("Timezone must be IST, UTC or a fixed offset ±HH:MM.");
	const hours = Number(match[2]);
	const minutes = Number(match[3]);
	if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0))
		throw new Error("Timezone offset must be within ±14:00.");
	return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}
export function timezoneFromFileName(name: string): ImportTimezone | undefined {
	const match = name.match(/\(UTC([+-])(\d{1,2})(?::(\d{2}))?\)/i);
	if (!match) return undefined;
	const offset: ImportTimezone = `${match[1] === "-" ? "-" : "+"}${(match[2] ?? "").padStart(2, "0")}:${match[3] ?? "00"}`;
	try {
		timezoneOffsetMinutes(offset);
		return offset;
	} catch {
		return undefined;
	}
}
