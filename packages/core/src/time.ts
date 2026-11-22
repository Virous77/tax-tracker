import { z } from "zod";

const istOffsetMs = 330 * 60 * 1000;
export function istDate(utcIso: string): string {
	const instant = new Date(utcIso);
	if (!Number.isFinite(instant.getTime())) throw new Error("Invalid timestamp");
	return new Date(instant.getTime() + istOffsetMs).toISOString().slice(0, 10);
}
export function taxYearOf(utcIso: string): string {
	const date = istDate(utcIso);
	const year = Number(date.slice(0, 4)) - (date.slice(5, 10) < "04-01" ? 1 : 0);
	return `${year}-${String(year + 1).slice(-2)}`;
}
export function taxYearBounds(id: string): {
	start: string;
	end: string;
	startUtc: string;
	endExclusiveUtc: string;
} {
	const year = Number(id.slice(0, 4));
	if (
		!/^\d{4}-\d{2}$/.test(id) ||
		id !== `${year}-${String(year + 1).slice(-2)}`
	)
		throw new Error("Invalid tax year");
	return {
		start: `${year}-04-01`,
		end: `${year + 1}-03-31`,
		startUtc: `${year}-03-31T18:30:00.000Z`,
		endExclusiveUtc: `${year + 1}-03-31T18:30:00.000Z`,
	};
}

export function addCalendarMonths(date: string, months: number): string {
	const day = Number(date.slice(8, 10));
	const result = new Date(`${date.slice(0, 7)}-01T00:00:00.000Z`);
	result.setUTCMonth(result.getUTCMonth() + months + 1, 0);
	result.setUTCDate(Math.min(day, result.getUTCDate()));
	return result.toISOString().slice(0, 10);
}

export function lastDayOfPreviousMonth(date: string): string {
	const result = new Date(`${date.slice(0, 7)}-01T00:00:00.000Z`);
	result.setUTCDate(0);
	return result.toISOString().slice(0, 10);
}

export function timezoneOffsetMinutes(timezone: string): number {
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

export const TimezoneSchema = z
	.union([
		z.enum(["IST", "UTC"]),
		z.templateLiteral([z.enum(["+", "-"]), z.string().regex(/\d{2}:\d{2}/)]),
	])
	.refine((value) => {
		try {
			timezoneOffsetMinutes(value);
			return true;
		} catch {
			return false;
		}
	}, "Timezone must be IST, UTC or a fixed offset within ±14:00.");
