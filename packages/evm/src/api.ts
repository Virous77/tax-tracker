import { UpstreamError } from "@tax/sync";
export type ExplorerRow = Record<string, string>;
export type ExplorerAction = "txlist" | "txlistinternal" | "tokentx";
export function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new UpstreamError("Expected explorer envelope");
	return value as Record<string, unknown>;
}
export function explorerRows(value: unknown): ExplorerRow[] {
	if (!Array.isArray(value)) throw new UpstreamError("Expected explorer rows");
	return value.map((value) => {
		const row = record(value);
		if (!Object.values(row).every((v) => typeof v === "string"))
			throw new UpstreamError("Explorer row fields must retain source text");
		for (const key of [
			"hash",
			"blockNumber",
			"timeStamp",
			"from",
			"to",
			"value",
		])
			if (typeof row[key] !== "string")
				throw new UpstreamError(`Missing explorer field: ${key}`);
		return row as ExplorerRow;
	});
}
export function field(row: ExplorerRow, key: string): string {
	const value = row[key];
	if (value === undefined)
		throw new UpstreamError(`Missing explorer field: ${key}`);
	return value;
}
export function address(value: string): string {
	if (!/^0x[0-9a-f]{40}$/i.test(value))
		throw new UpstreamError("Invalid Ethereum address");
	return value.toLowerCase();
}
export function block(value: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0)
		throw new UpstreamError("Invalid explorer block number");
	return number;
}
