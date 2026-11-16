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
