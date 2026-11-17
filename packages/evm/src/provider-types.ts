import type { EvmSyncOptions } from "@tax/core";
import { UpstreamError } from "@tax/sync";
import type { ExplorerAction, ExplorerRow } from "./api.js";

export interface ProviderConfig {
	kind: string;
	apiKey: string;
	tier?: "free" | "paid";
}
export type EvmOptions = Omit<EvmSyncOptions, "providers"> & {
	providers: ProviderConfig[];
};
export interface ExplorerProvider {
	readonly kind?: string;
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
	transactionCount?(address: string, tag: string): Promise<number>;
	providerFor?(action: ExplorerAction): string | undefined;
	historyIsComplete?(action: ExplorerAction): boolean;
	historyNotice?(action: ExplorerAction): string | undefined;
	notices?: string[];
}
export class ExplorerRangeError extends UpstreamError {}
export class ExplorerUnsupportedError extends UpstreamError {}
