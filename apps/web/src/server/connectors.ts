import type {
	BinanceSyncOptions,
	CoinDcxSyncOptions,
	Connector,
	ConnectorContext,
	ConnectorKind,
	EvmSyncOptions,
} from "@tax/core";
import { evmConnector } from "@tax/evm";
import { binanceConnector, coindcxConnector } from "@tax/sync";
export type SyncOptions =
	| BinanceSyncOptions
	| CoinDcxSyncOptions
	| EvmSyncOptions;
export function connectorFor(kind: ConnectorKind): Connector<SyncOptions> {
	const connector = {
		binance: binanceConnector,
		coindcx: coindcxConnector,
		evm: evmConnector,
	}[kind];
	return connector as Connector<SyncOptions>;
}
export function baseUrls(): ConnectorContext["baseUrls"] {
	return Object.fromEntries(
		Object.entries({
			binance: process.env.BINANCE_API_BASE,
			binanceData: process.env.BINANCE_DATA_BASE,
			coindcx: process.env.COINDCX_API_BASE,
			etherscan: process.env.ETHERSCAN_API_BASE,
			blockscout: process.env.BLOCKSCOUT_API_BASE,
			alchemy: process.env.ALCHEMY_API_BASE,
			nodereal: process.env.NODEREAL_API_BASE,
			coingecko: process.env.COINGECKO_API_BASE,
		}).filter((entry): entry is [string, string] => Boolean(entry[1]?.trim())),
	);
}
