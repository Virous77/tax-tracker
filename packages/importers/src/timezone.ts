import { timezoneOffsetMinutes } from "@tax/core";

export { timezoneOffsetMinutes } from "@tax/core";

import type { ImportTimezone } from "./types.js";

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
