import {
	HttpClient,
	UpstreamAuthError,
	UpstreamError,
	UpstreamRateLimitError,
} from "@tax/sync";
import { type ExplorerRow, record } from "./api.js";
import { type EvmOptions, ExplorerUnsupportedError } from "./provider-types.js";

export function integer(value: unknown): string {
	if (typeof value !== "string" || !/^(?:0x[0-9a-f]+|\d+)$/i.test(value))
		throw new UpstreamError("Invalid RPC integer");
	return BigInt(value).toString();
}
export function receiptFields(receipt: Record<string, unknown>): ExplorerRow {
	const result: ExplorerRow = {};
	for (const key of [
		"gasUsed",
		"effectiveGasPrice",
		"l1Fee",
		"gasUsedForL1",
		"operatorFee",
		"operatorFeeScalar",
		"operatorFeeConstant",
	]) {
		if (receipt[key] !== undefined && receipt[key] !== null)
			result[key] = integer(receipt[key]);
	}
	if (receipt.status !== undefined)
		result.txreceipt_status = integer(receipt.status);
	if (typeof receipt.type === "string") result.type = receipt.type;
	return result;
}
export class RpcClient {
	private http: HttpClient;
	constructor(
		private opts: EvmOptions,
		private url: URL,
	) {
		const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		this.http = new HttpClient({
			fetch: opts.fetch,
			now: opts.now,
			minIntervalMs: isLocal ? 0 : 200,
			maxRetries: opts.providers.length > 1 ? 0 : 4,
		});
	}
	async call(method: string, params: unknown[]): Promise<unknown> {
		const envelope = record(
			await this.http.request(this.url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				signal: this.opts.signal,
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
			}),
		);
		if (envelope.error) {
			const error = record(envelope.error),
				message = String(error.message ?? "");
			if (
				/limit|capacity|credits|rate/i.test(message) ||
				error.code === "429" ||
				error.code === "-32005"
			)
				throw new UpstreamRateLimitError("RPC provider rate limit reached");
			if (/api.?key|unauthor|authenticat/i.test(message))
				throw new UpstreamAuthError("RPC provider rejected the API key", 401);
			if (
				/unsupported|not supported|method not found|paid.*plan/i.test(
					message,
				) ||
				error.code === "-32601"
			)
				throw new ExplorerUnsupportedError(
					"RPC provider does not support this chain or method; add another provider key",
					400,
				);
			if (/busy|unavailable|internal error|temporar/i.test(message))
				throw new UpstreamError("RPC provider is temporarily unavailable", 503);
			throw new UpstreamError("RPC provider rejected the request", 400);
		}
		if (envelope.result === undefined || envelope.result === null)
			throw new UpstreamError("RPC provider returned no result", 503);
		return envelope.result;
	}
}
export function keyedUrl(base: string, key: string, network?: string): URL {
	const value = base.replace("{network}", network ?? "");
	return new URL(`${value.replace(/\/$/, "")}/${encodeURIComponent(key)}`);
}
