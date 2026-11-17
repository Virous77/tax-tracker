import { UpstreamError } from "@tax/sync";
import { block, type ExplorerAction, type ExplorerRow, field } from "./api.js";
import { type ExplorerProvider, ExplorerRangeError } from "./provider.js";
export function rawRowKeys(
	action: ExplorerAction,
	rows: ExplorerRow[],
): string[] {
	const counts = new Map<string, number>();
	return rows.map((row) => {
		const hash = field(row, "hash").toLowerCase();
		if (action === "txlist") return `tx:${hash}`;
		if (action === "txlistinternal")
			return `int:${hash}:${field(row, "traceId")}`;
		const tuple = `erc20:${hash}:${field(row, "contractAddress").toLowerCase()}:${field(row, "from").toLowerCase()}:${field(row, "to").toLowerCase()}:${field(row, "value")}`;
		const ordinal = counts.get(tuple) ?? 0;
		counts.set(tuple, ordinal + 1);
		return `${tuple}#${ordinal}`;
	});
}
export interface WalkResult {
	rows: ExplorerRow[];
	lastBlock: number;
	incomplete?: string;
	blockedAt?: number;
}
export async function walkBlocks(
	provider: ExplorerProvider,
	action: ExplorerAction,
	wallet: string,
	start: number,
	safeBlock: number,
): Promise<WalkResult> {
	const collected = new Map<string, ExplorerRow>();
	let cursor = start,
		end = safeBlock;
	while (cursor <= safeBlock) {
		let page: ExplorerRow[];
		try {
			page = await provider.history(action, wallet, cursor, end);
		} catch (error) {
			if (!(error instanceof ExplorerRangeError)) throw error;
			if (cursor === end)
				return {
					rows: [...collected.values()],
					lastBlock: Math.max(0, cursor - 1),
					blockedAt: cursor,
					incomplete: "Explorer timed out even for a single block",
				};
			end = Math.floor((cursor + end) / 2);
			continue;
		}
		if (page.length > 1000)
			throw new UpstreamError("Explorer exceeded the requested page size");
		let previous = cursor;
		for (const row of page) {
			const number = block(field(row, "blockNumber"));
			if (number < previous || number > end)
				throw new UpstreamError(
					"Explorer returned an unsorted or out-of-range block",
				);
			previous = number;
		}
		const keys = rawRowKeys(action, page);
		page.forEach((row, index) => {
			const key = keys[index];
			if (key) collected.set(key, row);
		});
		if (page.length < 1000) {
			if (end === safeBlock)
				return { rows: [...collected.values()], lastBlock: safeBlock };
			cursor = end + 1;
			end = safeBlock;
			continue;
		}
		const last = page.at(-1);
		if (!last) throw new UpstreamError("Missing last explorer row");
		const next = block(field(last, "blockNumber"));
		if (
			page.every((row) => block(field(row, "blockNumber")) === next) ||
			next <= cursor
		) {
			return {
				rows: [...collected.values()].filter(
					(row) => block(field(row, "blockNumber")) < next,
				),
				lastBlock: Math.max(0, next - 1),
				blockedAt: next,
				incomplete:
					"At least 1000 records share one block; explorer cap prevents proving this block complete",
			};
		}
		cursor = next;
		end = safeBlock;
	}
	return { rows: [...collected.values()], lastBlock: safeBlock };
}
