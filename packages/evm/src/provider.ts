import type { EvmProviderConfig, EvmSyncOptions } from "@tax/core";
import {
	HttpClient,
	UpstreamAuthError,
	UpstreamError,
	UpstreamRateLimitError,
} from "@tax/sync";
import {
	address,
	block,
	type ExplorerAction,
	type ExplorerRow,
	explorerRows,
	record,
} from "./api.js";
export interface ExplorerProvider {
	history(
		action: ExplorerAction,
		address: string,
		startBlock: number,
		endBlock: number,
	): Promise<ExplorerRow[]>;
	blockNumber(): Promise<number>;
	balance(address: string, tag?: string): Promise<string>;
	tokenBalance(
		address: string,
		contract: string,
		tag?: string,
	): Promise<string>;
}
export class ExplorerRangeError extends UpstreamError {}
export class ExplorerAdapter implements ExplorerProvider {
	private http: HttpClient;
	constructor(
		private opts: EvmSyncOptions,
		private config: EvmProviderConfig,
	) {
		this.http = new HttpClient({
			fetch: opts.fetch,
			now: opts.now,
			minIntervalMs: config.kind === "etherscan" ? 334 : 200,
		});
	}
	private async request(
		module: string,
		action: string,
		params: Record<string, string> = {},
	): Promise<unknown> {
		const etherscan = this.config.kind === "etherscan";
		const url = new URL(
			this.opts.baseUrls[this.config.kind] ??
				(etherscan
					? "https://api.etherscan.io/v2/api"
					: "https://api.blockscout.com/v2/api"),
		);
		url.searchParams.set(
			etherscan ? "chainid" : "chain_id",
			String(this.opts.chainId),
		);
		url.searchParams.set("module", module);
		url.searchParams.set("action", action);
		for (const [key, value] of Object.entries(params))
			url.searchParams.set(key, value);
		if (etherscan) url.searchParams.set("apikey", this.config.apiKey);
		const envelope = record(
			await this.http.request(url, {
				signal: this.opts.signal,
				...(etherscan
					? {}
					: { headers: { authorization: this.config.apiKey } }),
			}),
		);
		if (envelope.status === "0" && !Array.isArray(envelope.result)) {
			const message = String(envelope.result ?? "");
			if (/timeout|smaller result dataset/i.test(message))
				throw new ExplorerRangeError(
					"Explorer query requires a smaller block range",
					200,
				);
			if (/busy|unexpected err|unavailable/i.test(message))
				throw new UpstreamError("Explorer is temporarily unavailable", 503);
			if (/invalid api.?key/i.test(message))
				throw new UpstreamAuthError("Explorer rejected the API key", 200);
			throw new UpstreamError(
				"Explorer rejected the request; check chain access and parameters",
				400,
			);
		}
		return envelope.result;
	}
	async history(
		action: ExplorerAction,
		wallet: string,
		startBlock: number,
		endBlock: number,
	): Promise<ExplorerRow[]> {
		return explorerRows(
			await this.request("account", action, {
				address: address(wallet),
				startblock: String(startBlock),
				endblock: String(endBlock),
				page: "1",
				offset: "1000",
				sort: "asc",
			}),
		);
	}
	async blockNumber(): Promise<number> {
		return block(String(await this.request("proxy", "eth_blockNumber")));
	}
	async balance(wallet: string, tag = "latest"): Promise<string> {
		return this.units(
			await this.request("account", "balance", {
				address: address(wallet),
				tag,
			}),
		);
	}
	async tokenBalance(
		wallet: string,
		contract: string,
		tag = "latest",
	): Promise<string> {
		return this.units(
			await this.request("account", "tokenbalance", {
				address: address(wallet),
				contractaddress: address(contract),
				tag,
			}),
		);
	}
	private units(value: unknown): string {
		if (typeof value !== "string" || !/^\d+$/.test(value))
			throw new UpstreamError("Invalid explorer balance");
		return value;
	}
}
export class FallbackExplorer implements ExplorerProvider {
	private active = 0;
	constructor(private providers: ExplorerProvider[]) {
		if (!providers.length)
			throw new UpstreamError("At least one explorer provider is required");
	}
	private async run<T>(
		operation: (provider: ExplorerProvider) => Promise<T>,
	): Promise<T> {
		for (;;) {
			const provider = this.providers[this.active];
			if (!provider) throw new UpstreamError("No explorer provider available");
			try {
				return await operation(provider);
			} catch (error) {
				if (
					!(
						error instanceof UpstreamRateLimitError ||
						(error instanceof UpstreamError &&
							(error.status === 0 || error.status >= 500))
					) ||
					this.active + 1 >= this.providers.length
				)
					throw error;
				this.active++;
			}
		}
	}
	history(action: ExplorerAction, wallet: string, start: number, end: number) {
		return this.run((p) => p.history(action, wallet, start, end));
	}
	blockNumber() {
		return this.run((p) => p.blockNumber());
	}
	balance(wallet: string, tag?: string) {
		return this.run((p) => p.balance(wallet, tag));
	}
	tokenBalance(wallet: string, contract: string, tag?: string) {
		return this.run((p) => p.tokenBalance(wallet, contract, tag));
	}
}
export function createExplorer(opts: EvmSyncOptions): ExplorerProvider {
	return new FallbackExplorer(
		opts.providers.map((config) => new ExplorerAdapter(opts, config)),
	);
}
