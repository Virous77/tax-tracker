import {
	type Connector,
	D,
	type FetchedBalance,
	type StreamBatch,
} from "@tax/core";
import { UpstreamAuthError, UpstreamError } from "@tax/sync";
import {
	address,
	block,
	type ExplorerAction,
	type ExplorerRow,
	field,
} from "./api.js";
import { chainConfig } from "./chains.js";
import { classifyTransactions } from "./classify.js";
import {
	createExplorer,
	type EvmOptions,
	type ExplorerProvider,
} from "./provider.js";
import { fromUnits, spamReasons, tokenAsset, tokenDecimals } from "./tokens.js";
import { type WalkResult, walkBlocks } from "./walk.js";

const actions: ExplorerAction[] = ["txlist", "txlistinternal", "tokentx"];
export class IncompleteExplorerHistoryError extends UpstreamError {
	constructor(readonly streams: { stream: string; message: string }[]) {
		super("Cannot reconcile balances while explorer history is incomplete");
	}
}

function streamName(opts: EvmOptions, action: ExplorerAction): string {
	return `evm:${opts.chainId}:${address(opts.address)}:${action}`;
}
function lastBlock(value: unknown): number {
	if (value && typeof value === "object" && "lastBlock" in value)
		return block(String(value.lastBlock));
	return 0;
}
async function readHistory(
	opts: EvmOptions,
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
	for (const action of actions) {
		result[action] = await walkBlocks(
			provider,
			action,
			address(opts.address),
			start,
			safe,
		);
		result[action].provider = provider.providerFor?.(action) ?? provider.kind;
	}
	if (provider.transactionCount && !result.txlist.incomplete) {
		const checkedProvider = provider.providerFor?.("txlist") ?? provider.kind;
		try {
			const sent = await provider.transactionCount(
				address(opts.address),
				`0x${safe.toString(16)}`,
			);
			const before =
				start > 0
					? await provider.transactionCount(
							address(opts.address),
							`0x${(start - 1).toString(16)}`,
						)
					: 0;
			if (
				checkedProvider !== (provider.providerFor?.("txlist") ?? provider.kind)
			)
				return readHistory(opts, provider, safe);
			const found = new Set(
				result.txlist.rows
					.filter(
						(row) =>
							row.from?.toLowerCase() === address(opts.address) &&
							row.type !== "0x7e",
					)
					.map((row) => row.hash?.toLowerCase()),
			).size;
			if (found < sent - before)
				result.txlist.incomplete = `${sent - before - found} sent transactions not found (their gas is missing); add another explorer key`;
		} catch (error) {
			if (
				error instanceof UpstreamAuthError ||
				!(error instanceof UpstreamError)
			)
				throw error;
			result.txlist.incomplete = `Sent-transaction completeness check unavailable: ${error.message}`;
		}
	}
	return result;
}
export const evmConnector: Connector<EvmOptions> = {
	async *sync(opts): AsyncGenerator<StreamBatch> {
		address(opts.address);
		opts.ownAddresses.forEach(address);
		const provider = createExplorer(opts),
			safe = Math.max(0, (await provider.blockNumber()) - 64);
		let history: Record<ExplorerAction, WalkResult>;
		try {
			history = await readHistory(opts, provider, safe);
		} catch (error) {
			if (
				error instanceof UpstreamAuthError ||
				!(error instanceof UpstreamError)
			)
				throw error;
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
		if (provider.notices?.length && mapped[0])
			mapped[0].tx.reviewFlags.push({
				code: "parse_warning",
				message: [...new Set(provider.notices)].join("; "),
			});
		for (const [index, action] of actions.entries()) {
			const incomplete = history[action].incomplete;
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
				cursor: {
					lastBlock:
						history[action].incomplete &&
						history[action].blockedAt === undefined
							? lastBlock(opts.cursors[streamName(opts, action)])
							: last,
					provider: history[action].provider,
					...(provider.notices.length
						? { notices: [...new Set(provider.notices)] }
						: {}),
				},
				...(incomplete ? { incomplete } : {}),
			};
		}
	},
	async balances(opts): Promise<FetchedBalance[]> {
		const provider = createExplorer(opts),
			current = await provider.blockNumber(),
			safe = Math.max(0, current - 64);
		const history = await readHistory({ ...opts, cursors: {} }, provider, safe);
		const incomplete = actions.flatMap((action) => {
			const message = history[action].incomplete;
			return message ? [{ stream: streamName(opts, action), message }] : [];
		});
		if (incomplete.length) throw new IncompleteExplorerHistoryError(incomplete);
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
			if (
				!chainConfig(opts.chainId).nativeTokenAliases?.includes(
					field(row, "contractAddress").toLowerCase(),
				) &&
				!spamReasons(opts.chainId, row, initiated).length
			)
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
		const combined = new Map<string, FetchedBalance>();
		for (const row of result) {
			const previous = combined.get(row.asset);
			combined.set(row.asset, {
				...row,
				amount: D(previous?.amount ?? "0")
					.plus(row.amount)
					.toFixed(),
			});
		}
		return [...combined.values()].filter((row) => D(row.amount).gte("0"));
	},
	async checkKey(opts) {
		const provider = createExplorer(opts);
		await provider.blockNumber();
		return {
			ok: true,
			readOnly: true,
			permissions: ["public-chain-data"],
			message: [
				"Explorer key verified; public blockchain reads only",
				...provider.notices,
			].join("; "),
		};
	},
};
export type { ExplorerAction, ExplorerRow } from "./api.js";
export * from "./chains.js";
export * from "./classify.js";
export * from "./provider.js";
export * from "./tokens.js";
export * from "./walk.js";
