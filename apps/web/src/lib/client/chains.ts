export interface EvmChainInfo {
	chainId: number;
	name: string;
	shortName: string;
	nativeAsset: string;
	explorerName: string;
	explorerTxUrl: (hash: string) => string;
}

export const EVM_CHAINS: readonly EvmChainInfo[] = [
	{
		chainId: 1,
		name: "Ethereum",
		shortName: "Ethereum",
		nativeAsset: "ETH",
		explorerName: "Etherscan",
		explorerTxUrl: (hash) =>
			`https://etherscan.io/tx/${encodeURIComponent(hash)}`,
	},
	{
		chainId: 8453,
		name: "Base",
		shortName: "Base",
		nativeAsset: "ETH",
		explorerName: "BaseScan",
		explorerTxUrl: (hash) =>
			`https://basescan.org/tx/${encodeURIComponent(hash)}`,
	},
	{
		chainId: 42161,
		name: "Arbitrum One",
		shortName: "Arbitrum",
		nativeAsset: "ETH",
		explorerName: "Arbiscan",
		explorerTxUrl: (hash) =>
			`https://arbiscan.io/tx/${encodeURIComponent(hash)}`,
	},
	{
		chainId: 137,
		name: "Polygon PoS",
		shortName: "Polygon",
		nativeAsset: "POL",
		explorerName: "PolygonScan",
		explorerTxUrl: (hash) =>
			`https://polygonscan.com/tx/${encodeURIComponent(hash)}`,
	},
	{
		chainId: 56,
		name: "BNB Smart Chain",
		shortName: "BNB Chain",
		nativeAsset: "BNB",
		explorerName: "BscScan",
		explorerTxUrl: (hash) =>
			`https://bscscan.com/tx/${encodeURIComponent(hash)}`,
	},
] as const;

const CHAIN_BY_ID = new Map<number, EvmChainInfo>(
	EVM_CHAINS.map((chain) => [chain.chainId, chain]),
);

const CHAIN_NAME_ALIASES: Record<string, number> = {
	"1": 1,
	ethereum: 1,
	eth: 1,
	mainnet: 1,
	"8453": 8453,
	base: 8453,
	"42161": 42161,
	arbitrum: 42161,
	"arbitrum-one": 42161,
	"137": 137,
	polygon: 137,
	"polygon-pos": 137,
	matic: 137,
	"56": 56,
	bsc: 56,
	bnb: 56,
	"bnb-smart-chain": 56,
};

export function getEvmChain(chainId?: number | null): EvmChainInfo | undefined {
	if (chainId === undefined || chainId === null) return undefined;
	return CHAIN_BY_ID.get(chainId);
}

export function getEvmChainName(chainId?: number | null): string {
	if (chainId === undefined || chainId === null) return "EVM";
	return CHAIN_BY_ID.get(chainId)?.name ?? `Chain ${chainId}`;
}

export function resolveTxExplorer(
	txHash?: string | null,
	chain?: string | null,
	source?: string | null,
): { url: string; label: string } | null {
	if (!txHash) return null;
	const cleanHash = txHash.trim();
	if (!cleanHash) return null;

	let chainId: number | undefined;
	if (chain) {
		chainId = CHAIN_NAME_ALIASES[chain.trim().toLowerCase()];
	}
	if (chainId === undefined && source?.startsWith("evm:")) {
		const rawId = Number(source.slice(4));
		if (Number.isInteger(rawId)) chainId = rawId;
	}
	if (chainId === undefined) return null;

	const info = CHAIN_BY_ID.get(chainId);
	if (!info) return null;
	return {
		url: info.explorerTxUrl(cleanHash),
		label: `View on ${info.explorerName}`,
	};
}

export function shortenAddress(address: string): string {
	if (address.length <= 12) return address;
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
