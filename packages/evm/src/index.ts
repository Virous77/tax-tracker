import {
	type Connector,
	D,
	type EvmSyncOptions,
	type FetchedBalance,
	type StreamBatch,
} from "@tax/core";
import { UpstreamError } from "@tax/sync";
import {
	address,
	block,
	type ExplorerAction,
	type ExplorerRow,
	field,
} from "./api.js";
import { chainConfig } from "./chains.js";
import { classifyTransactions } from "./classify.js";
import { createExplorer, type ExplorerProvider } from "./provider.js";
import { fromUnits, spamReasons, tokenAsset, tokenDecimals } from "./tokens.js";
import { type WalkResult, walkBlocks } from "./walk.js";

const actions: ExplorerAction[] = ["txlist", "txlistinternal", "tokentx"];
function streamName(opts: EvmSyncOptions, action: ExplorerAction): string {
	return `evm:${opts.chainId}:${address(opts.address)}:${action}`;
}
function lastBlock(value: unknown): number {
	if (value && typeof value === "object" && "lastBlock" in value)
		return block(String(value.lastBlock));
	return 0;
}
async function readHistory(
	opts: EvmSyncOptions,
	provider: ExplorerProvider,
	safe: number,
): Promise<Record<ExplorerAction, WalkResult>> {
	// All actions restart at the oldest persisted cursor so interrupted multi-stream persistence cannot split a swap.
	const start = Math.min(
		...actions.map((action) =>
			lastBlock(opts.cursors[streamName(opts, action)]),
		),
	);
	const result = {} as Record<ExplorerAction, WalkResult>;
	for (const action of actions)
		result[action] = await walkBlocks(
			provider,
			action,
			address(opts.address),
			start,
			safe,
		);
	return result;
}
export const evmConnector: Connector<EvmSyncOptions> = {
	async *sync(opts): AsyncGenerator<StreamBatch> {
		address(opts.address);
		opts.ownAddresses.forEach(address);
		const provider = createExplorer(opts),
			safe = Math.max(0, (await provider.blockNumber()) - 64);
		let history: Record<ExplorerAction, WalkResult>;
		try {
			history = await readHistory(opts, provider, safe);
		} catch (error) {
			if (!(error instanceof UpstreamError)) throw error;
			yield {
				stream: streamName(opts, "txlist"),
				rows: [],
				cursor: opts.cursors[streamName(opts, "txlist")] ?? null,
				incomplete: error.message,
			};
			return;
		}
		const last = Math.min(
			...actions.map((action) => history[action].lastBlock),
		);
		const filtered = (action: ExplorerAction): ExplorerRow[] =>
			history[action].rows.filter(
				(row) => block(field(row, "blockNumber")) <= last,
			);
		const mapped = classifyTransactions({
			chainId: opts.chainId,
			address: opts.address,
			ownAddresses: opts.ownAddresses,
			txlist: filtered("txlist"),
			txlistinternal: filtered("txlistinternal"),
			tokentx: filtered("tokentx"),
		});
		const incomplete = actions
			.map((action) => history[action].incomplete)
			.filter(Boolean)
			.join("; ");
		for (const [index, action] of actions.entries()) {
			opts.onProgress?.({
				stream: streamName(opts, action),
				streamsDone: index,
				streamsTotal: 3,
				rowsFetched: actions.reduce(
					(sum, key) => sum + history[key].rows.length,
					0,
				),
			});
			yield {
				stream: streamName(opts, action),
				rows: index === 0 ? mapped : [],
				cursor: { lastBlock: last },
				...(incomplete ? { incomplete } : {}),
			};
		}
	},
	async balances(opts): Promise<FetchedBalance[]> {
		const provider = createExplorer(opts),
			current = await provider.blockNumber(),
			safe = Math.max(0, current - 64);
		const history = await readHistory({ ...opts, cursors: {} }, provider, safe);
		if (actions.some((action) => history[action].incomplete))
			throw new UpstreamError(
				"Cannot reconcile balances while explorer history is incomplete",
			);
		for (const action of actions)
			if (
				safe < current &&
				(
					await provider.history(
						action,
						address(opts.address),
						safe + 1,
						current,
					)
				).length
			)
				throw new UpstreamError(
					"Wallet changed after the safe block; wait for confirmations before comparing latest balances",
				);
		const tokens = new Map<string, ExplorerRow>();
		for (const row of history.tokentx.rows) {
			const owned = new Set([
				address(opts.address),
				...opts.ownAddresses.map(address),
			]);
			const initiated =
				owned.has(field(row, "from").toLowerCase()) ||
				history.txlist.rows.some(
					(tx) =>
						tx.hash?.toLowerCase() === row.hash?.toLowerCase() &&
						tx.from !== undefined &&
						owned.has(tx.from.toLowerCase()),
				);
			if (!spamReasons(opts.chainId, row, initiated).length)
				tokens.set(field(row, "contractAddress").toLowerCase(), row);
		}

		const tag = `0x${safe.toString(16)}`;
		const result: FetchedBalance[] = [
			{
				asset: chainConfig(opts.chainId).nativeAsset,
				amount: fromUnits(
					await provider.balance(address(opts.address), tag),
					chainConfig(opts.chainId).nativeDecimals,
				),
				wallet: "wallet",
			},
		];
		for (const [contract, row] of tokens)
			result.push({
				asset: tokenAsset(opts.chainId, contract),
				amount: fromUnits(
					await provider.tokenBalance(address(opts.address), contract, tag),
					tokenDecimals(opts.chainId, row),
				),
				wallet: "wallet",
			});
		return result.filter((row) => D(row.amount).gte("0"));
	},
	async checkKey(opts) {
		await createExplorer(opts).blockNumber();
		return {
			ok: true,
			readOnly: true,
			permissions: ["public-chain-data"],
			message: "Explorer key verified; public blockchain reads only",
		};
	},
};
export type { ExplorerAction, ExplorerRow } from "./api.js";
export * from "./chains.js";
export * from "./classify.js";
export * from "./provider.js";
export * from "./tokens.js";
export * from "./walk.js";
