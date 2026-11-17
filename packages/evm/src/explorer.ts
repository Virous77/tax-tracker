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
	field,
	record,
} from "./api.js";
import { chainConfig } from "./chains.js";
import {
	type EvmOptions,
	type ExplorerProvider,
	ExplorerRangeError,
	ExplorerUnsupportedError,
	type ProviderConfig,
} from "./provider-types.js";
import { receiptFields } from "./rpc.js";
export class ExplorerAdapter implements ExplorerProvider {
	get kind() {
		return this.config.kind;
	}
	private http: HttpClient;
	constructor(
		protected opts: EvmOptions,
		protected config: ProviderConfig,
	) {
		this.http = new HttpClient({
			fetch: opts.fetch,
			now: opts.now,
			minIntervalMs: config.kind === "etherscan" ? 350 : 210,
			maxRetries: opts.providers.length > 1 ? 0 : 4,
		});
	}
	protected async request(
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
			const message = String(envelope.result ?? envelope.message ?? "");
			if (
				/paid.*(?:plan|tier)|(?:plan|tier).*paid|free.*(?:chain|access)|unsupported chain|chain.*(?:not supported|unsupported|not indexed)|missing or unsupported chain/i.test(
					message,
				)
			)
				throw new ExplorerUnsupportedError(
					`${this.config.kind} access unavailable on chain ${this.opts.chainId}; a paid plan is required for paid-only networks, or add another provider key`,
					400,
				);
			if (/rate limit|free api limit|credits.*exhaust/i.test(message))
				throw new UpstreamRateLimitError("Explorer rate limit reached");
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
		const rows = explorerRows(
			await this.request("account", action, {
				address: address(wallet),
				startblock: String(startBlock),
				endblock: String(endBlock),
				page: "1",
				offset: "1000",
				sort: "asc",
			}),
		);
		if (
			action === "txlist" &&
			chainConfig(this.opts.chainId).feeModel === "op-stack"
		) {
			for (const row of rows) {
				if (row.from?.toLowerCase() !== address(wallet)) continue;
				const receipt = record(
					await this.request("proxy", "eth_getTransactionReceipt", {
						txhash: field(row, "hash"),
					}),
				);
				const providerRaw = JSON.stringify(row);
				Object.assign(row, receiptFields(receipt), {
					providerRaw,
					receiptRaw: JSON.stringify(receipt),
				});
			}
		}
		return rows;
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
	async transactionCount(wallet: string, tag: string): Promise<number> {
		return block(
			String(
				await this.request("proxy", "eth_getTransactionCount", {
					address: address(wallet),
					tag,
				}),
			),
		);
	}
	private units(value: unknown): string {
		if (typeof value !== "string" || !/^\d+$/.test(value))
			throw new UpstreamError("Invalid explorer balance");
		return value;
	}
}
