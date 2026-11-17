import type { LedgerTx } from "./ledger.js";

/**
 * Contract between the sync connectors (`@tax/sync`, `@tax/evm`) and the app that stores their output.
 * Connectors do network I/O but never touch the database; the app owns persistence, dedupe and cursors.
 */

export const SUPPORTED_EVM_CHAIN_IDS = [1, 8453, 42161, 137, 56] as const;

export type ConnectorKind = "binance" | "coindcx" | "evm";

/** Opaque per-stream resume point, stored as JSON by the app and handed back unchanged. */
export type StreamCursor = unknown;

export interface ConnectorRow {
	/** LedgerTx without `id`/`importId`; the app assigns both. `raw` holds the untouched API row. */
	tx: Omit<LedgerTx, "id" | "importId">;
}

export interface StreamBatch {
	/** Stable stream name, e.g. `binance:myTrades:BTCUSDT`, `evm:1:0xabc…:tokentx`. */
	stream: string;
	rows: ConnectorRow[];
	/** Cursor to persist after this batch's rows are stored. */
	cursor: StreamCursor;
	/** Set when the stream could not be fetched completely; the app raises `import_incomplete`. */
	incomplete?: string;
}

export interface ConnectorProgress {
	stream: string;
	streamsDone: number;
	streamsTotal: number | null;
	rowsFetched: number;
}

export interface FetchedBalance {
	asset: string;
	amount: string;
	/** e.g. "spot", "funding", "earn", "wallet". */
	wallet?: string;
}

export interface KeyCheck {
	ok: boolean;
	/** true = verified read-only, false = key can trade or withdraw, null = venue cannot tell us. */
	readOnly: boolean | null;
	permissions: string[];
	message: string;
}

export interface ConnectorContext {
	/** Overridable base URLs so tests can point at the mock server. */
	baseUrls: Record<string, string>;
	cursors: Record<string, StreamCursor>;
	signal?: AbortSignal;
	onProgress?: (p: ConnectorProgress) => void;
	/** Injected for tests; defaults to global fetch. */
	fetch?: typeof fetch;
	/** Injected for tests; defaults to Date.now. */
	now?: () => number;
}

export interface ExchangeCredentials {
	apiKey: string;
	apiSecret: string;
}

export interface BinanceSyncOptions extends ConnectorContext {
	credentials: ExchangeCredentials;
	/** Assets seen anywhere in the ledger, used to discover which trading pairs to query. */
	knownAssets: string[];
	/** Pairs the user added by hand, e.g. "LUNAUSDT". */
	extraSymbols: string[];
}

export interface CoinDcxSyncOptions extends ConnectorContext {
	credentials: ExchangeCredentials;
}

export interface EvmProviderConfig {
	kind: "etherscan" | "blockscout" | "alchemy" | "nodereal";
	apiKey: string;
	tier?: "free" | "paid";
}

export interface EvmSyncOptions extends ConnectorContext {
	chainId: number;
	address: string;
	/** Every address the user owns on this chain, lower-case, including `address`. */
	ownAddresses: string[];
	providers: EvmProviderConfig[];
}

export interface Connector<O extends ConnectorContext> {
	sync(opts: O): AsyncIterable<StreamBatch>;
	balances(opts: O): Promise<FetchedBalance[]>;
	checkKey(opts: O): Promise<KeyCheck>;
}
