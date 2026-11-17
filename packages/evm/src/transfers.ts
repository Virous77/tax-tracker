import { UpstreamError } from "@tax/sync";
import {
	address,
	block,
	type ExplorerAction,
	type ExplorerRow,
	field,
	record,
} from "./api.js";
import type { EvmOptions, ExplorerProvider } from "./provider-types.js";
import { integer, RpcClient, receiptFields } from "./rpc.js";

export interface TransferPage {
	transfers: unknown[];
	pageKey?: string;
}
export abstract class TransfersAdapter implements ExplorerProvider {
	abstract readonly kind: string;
	protected rpc: RpcClient;
	protected windowSize = Number.MAX_SAFE_INTEGER;
	private cache = new Map<
		string,
		Promise<Record<ExplorerAction, ExplorerRow[]>>
	>();
	private receipts = new Map<string, Promise<Record<string, unknown>>>();
	constructor(
		protected opts: EvmOptions,
		url: URL,
	) {
		this.rpc = new RpcClient(opts, url);
	}
	protected abstract page(
		wallet: string,
		direction: "fromAddress" | "toAddress",
		start: number,
		end: number,
		pageKey?: string,
	): Promise<TransferPage>;
	protected abstract normalize(transfer: Record<string, unknown>): {
		action: ExplorerAction;
		row: ExplorerRow;
	};
	historyIsComplete() {
		return true;
	}
	historyNotice(_action: ExplorerAction): string | undefined {
		return undefined;
	}
	async blockNumber() {
		return block(integer(await this.rpc.call("eth_blockNumber", [])));
	}
	async balance(wallet: string, tag = "latest") {
		return integer(
			await this.rpc.call("eth_getBalance", [address(wallet), tag]),
		);
	}
	async transactionCount(wallet: string, tag: string) {
		return block(
			integer(
				await this.rpc.call("eth_getTransactionCount", [address(wallet), tag]),
			),
		);
	}
	abstract tokenBalance(
		wallet: string,
		contract: string,
		tag?: string,
	): Promise<string>;
	async history(
		action: ExplorerAction,
		wallet: string,
		start: number,
		end: number,
	) {
		const key = `${address(wallet)}:${start}:${end}`;
		let result = this.cache.get(key);
		if (!result) {
			result = this.load(address(wallet), start, end);
			this.cache.set(key, result);
			result.catch(() => this.cache.delete(key));
		}
		return (await result)[action];
	}
	private receipt(hash: string) {
		let result = this.receipts.get(hash);
		if (!result) {
			result = this.rpc.call("eth_getTransactionReceipt", [hash]).then(record);
			this.receipts.set(hash, result);
			result.catch(() => this.receipts.delete(hash));
		}
		return result;
	}
	private async load(wallet: string, start: number, end: number) {
		const result: Record<ExplorerAction, ExplorerRow[]> = {
			txlist: [],
			txlistinternal: [],
			tokentx: [],
		};
		const ids = new Set<string>();
		for (let lower = start; lower <= end; lower += this.windowSize) {
			const upper = Math.min(end, lower + this.windowSize - 1);
			for (const direction of ["fromAddress", "toAddress"] as const) {
				let pageKey: string | undefined;
				const keys = new Set<string>();
				do {
					const page = await this.page(
						wallet,
						direction,
						lower,
						upper,
						pageKey,
					);
					for (const value of page.transfers) {
						const transfer = record(value),
							{ action, row } = this.normalize(transfer);
						if (direction === "toAddress" && row.from?.toLowerCase() === wallet)
							continue;
						if (typeof transfer.uniqueId === "string") {
							if (ids.has(transfer.uniqueId)) continue;
							ids.add(transfer.uniqueId);
						}
						const number = block(field(row, "blockNumber"));
						if (number < lower || number > upper)
							throw new UpstreamError(
								"Transfer provider returned an out-of-range block",
							);
						result[action].push(row);
					}
					pageKey = page.pageKey;
					if (pageKey && keys.has(pageKey))
						throw new UpstreamError("Transfer provider repeated a page key");
					if (pageKey) keys.add(pageKey);
				} while (pageKey);
			}
		}
		const normal = new Map(
			result.txlist.map((row) => [field(row, "hash").toLowerCase(), row]),
		);
		const exemplars = new Map(
			[...result.txlist, ...result.txlistinternal, ...result.tokentx].map(
				(row) => [field(row, "hash").toLowerCase(), row],
			),
		);
		for (const [hash, exemplar] of exemplars) {
			let main = normal.get(hash);
			// Transfer APIs omit zero-value calls; receipts identify token-only senders (research §1.3).
			if (
				this.kind === "nodereal" &&
				main?.gasUsed !== undefined &&
				main.gasPrice !== undefined
			)
				continue;
			const receipt = await this.receipt(hash);
			const sender = address(String(receipt.from));
			if (!main && sender === wallet) {
				main = {
					hash,
					blockNumber: field(exemplar, "blockNumber"),
					timeStamp: field(exemplar, "timeStamp"),
					from: sender,
					to: typeof receipt.to === "string" ? receipt.to : "",
					value: "0",
					gasPrice: "0",
				};
				result.txlist.push(main);
				normal.set(hash, main);
			}
			if (main) {
				Object.assign(main, receiptFields(receipt), {
					receiptRaw: JSON.stringify(receipt),
				});
				if (
					sender === wallet &&
					(main.gasUsed === undefined || main.effectiveGasPrice === undefined)
				)
					throw new UpstreamError("Receipt is missing gas fields", 503);
			}
		}
		for (const action of Object.keys(result) as ExplorerAction[]) {
			result[action].sort(
				(a, b) =>
					block(field(a, "blockNumber")) - block(field(b, "blockNumber")) ||
					field(a, "hash").localeCompare(field(b, "hash")),
			);
		}
		return result;
	}
	protected async callBalance(wallet: string, contract: string, tag: string) {
		const data = `0x70a08231${address(wallet).slice(2).padStart(64, "0")}`;
		return integer(
			await this.rpc.call("eth_call", [{ to: address(contract), data }, tag]),
		);
	}
}
export function transferPage(value: unknown): TransferPage {
	const page = record(value);
	if (!Array.isArray(page.transfers))
		throw new UpstreamError("Expected RPC transfers");
	if (page.pageKey !== undefined && typeof page.pageKey !== "string")
		throw new UpstreamError("Invalid RPC page key");
	return {
		transfers: page.transfers,
		...(typeof page.pageKey === "string" && page.pageKey
			? { pageKey: page.pageKey }
			: {}),
	};
}
export function timestamp(value: unknown): string {
	if (typeof value !== "string")
		throw new UpstreamError("Transfer timestamp is missing");
	const seconds = /^(0x[0-9a-f]+|\d+)$/i.test(value)
		? block(integer(value))
		: Date.parse(value) / 1000;
	if (!Number.isSafeInteger(seconds))
		throw new UpstreamError("Invalid transfer timestamp");
	return String(seconds);
}
