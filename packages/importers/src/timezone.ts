import { type ReviewFlag, timezoneOffsetMinutes } from "@tax/core";

export { timezoneOffsetMinutes } from "@tax/core";

import type { ImportTimezone } from "./types.js";

export function timezoneFromFileName(name: string): ImportTimezone | undefined {
	return timezoneMarker(
		name.match(/\(UTC(?:([+-])(\d{1,2})(?::(\d{2}))?)?\)/i),
	);
}

export function timezoneFromHeader(header: string): ImportTimezone | undefined {
	if (/^UTC_Time$/i.test(header)) return "UTC";
	return timezoneMarker(
		header.match(/\(\s*UTC(?:([+-])(\d{1,2})(?::(\d{2}))?)?\s*\)$/i),
	);
}

function timezoneMarker(
	match: RegExpMatchArray | null,
): ImportTimezone | undefined {
	if (!match) return undefined;
	if (!match[1]) return "UTC";
	const offset: ImportTimezone = `${match[1] === "-" ? "-" : "+"}${(match[2] ?? "").padStart(2, "0")}:${match[3] ?? "00"}`;
	try {
		timezoneOffsetMinutes(offset);
		return timezoneOffsetMinutes(offset) === 0 ? "UTC" : offset;
	} catch {
		return undefined;
	}
}

export function timezoneFromTimestamp(
	value: string,
): ImportTimezone | undefined {
	const input = value.trim();
	if (/ UTC$/i.test(input)) return "UTC";
	const suffix = input.match(
		/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/,
	)?.[1];
	return suffix === "Z"
		? "UTC"
		: timezoneMarker(suffix?.match(/^([+-])(\d{2}):(\d{2})$/) ?? null);
}

export function timezoneConflict(
	selected: ImportTimezone,
	fileZone: ImportTimezone | undefined,
	from: string,
): ReviewFlag[] {
	return fileZone &&
		timezoneOffsetMinutes(fileZone) !== timezoneOffsetMinutes(selected)
		? [
				{
					code: "parse_warning",
					message: `Used ${fileZone} from ${from} instead of the selected ${selected}.`,
				},
			]
		: [];
}
