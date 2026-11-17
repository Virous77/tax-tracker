import { UpstreamError, UpstreamRateLimitError } from "@tax/sync";
import { AlchemyAdapter } from "./alchemy.js";
import type { ExplorerAction } from "./api.js";
import { BlockscoutAdapter } from "./blockscout.js";
import { chainConfig } from "./chains.js";
import { EtherscanAdapter } from "./etherscan.js";
import { NodeRealAdapter } from "./nodereal.js";
import {
	type EvmOptions,
	type ExplorerProvider,
	ExplorerUnsupportedError,
} from "./provider-types.js";

export { ExplorerAdapter } from "./explorer.js";
export * from "./provider-types.js";
export { AlchemyAdapter, BlockscoutAdapter, EtherscanAdapter, NodeRealAdapter };

export class FallbackExplorer implements ExplorerProvider {
	private active = new Map<string, number>();
	readonly notices: string[] = [];
	constructor(
		private providers: ExplorerProvider[],
		cursors: Record<string, unknown> = {},
	) {
		if (!providers.length)
			throw new UpstreamError("At least one explorer provider is required");
		for (const [stream, value] of Object.entries(cursors)) {
			if (!value || typeof value !== "object" || !("provider" in value))
				continue;
			const action = stream.split(":").at(-1);
			const index = providers.findIndex(
				(provider) => provider.kind === value.provider,
			);
			if (action && index >= 0) this.active.set(action, index);
		}
	}
	private current(key: string) {
		return this.providers[this.active.get(key) ?? 0];
	}
	private async run<T>(
		key: string,
		operation: (provider: ExplorerProvider) => Promise<T>,
	): Promise<T> {
		for (;;) {
			const index = this.active.get(key) ?? 0,
				provider = this.providers[index];
			if (!provider) throw new UpstreamError("No explorer provider available");
			try {
				return await operation(provider);
			} catch (error) {
				if (
					!(
						error instanceof ExplorerUnsupportedError ||
						error instanceof UpstreamRateLimitError ||
						(error instanceof UpstreamError &&
							(error.status === 0 || error.status >= 500))
					) ||
					index + 1 >= this.providers.length
				)
					throw error;
				this.notices.push(
					`${provider.kind ?? "Explorer"}: ${error.message}; switched provider and restarted the stream from its last safe block`,
				);
				this.active.set(key, index + 1);
			}
		}
	}
	providerFor(action: ExplorerAction) {
		return this.current(action)?.kind;
	}
	historyIsComplete(action: ExplorerAction) {
		return this.current(action)?.historyIsComplete?.(action) ?? false;
	}
	historyNotice(action: ExplorerAction) {
		return this.current(action)?.historyNotice?.(action);
	}
	history(action: ExplorerAction, wallet: string, start: number, end: number) {
		return this.run(action, (p) => p.history(action, wallet, start, end));
	}
	blockNumber() {
		return this.run("head", (p) => p.blockNumber());
	}
	balance(wallet: string, tag?: string) {
		return this.run("balance", (p) => p.balance(wallet, tag));
	}
	tokenBalance(wallet: string, contract: string, tag?: string) {
		return this.run("balance", (p) => p.tokenBalance(wallet, contract, tag));
	}
	async transactionCount(wallet: string, tag: string) {
		return this.run("txlist", (p) => {
			if (!p.transactionCount)
				throw new ExplorerUnsupportedError(
					"Provider cannot check sent-transaction completeness",
					400,
				);
			return p.transactionCount(wallet, tag);
		});
	}
}
export function createExplorer(opts: EvmOptions): FallbackExplorer {
	const order = chainConfig(opts.chainId).defaultProviders;
	const configurations = [...opts.providers]
		.filter((config) => order.includes(config.kind))
		.sort((a, b) => {
			const rank = (kind: string) => {
				const index = order.indexOf(kind);
				return index < 0 ? order.length : index;
			};
			return rank(a.kind) - rank(b.kind);
		});
	return new FallbackExplorer(
		configurations.map((config) => {
			switch (config.kind) {
				case "etherscan":
					return new EtherscanAdapter(opts, config);
				case "blockscout":
					return new BlockscoutAdapter(opts, config);
				case "alchemy":
					return new AlchemyAdapter(opts, config);
				case "nodereal":
					return new NodeRealAdapter(opts, config);
				default:
					throw new ExplorerUnsupportedError("Unknown explorer provider", 400);
			}
		}),
		opts.cursors,
	);
}
