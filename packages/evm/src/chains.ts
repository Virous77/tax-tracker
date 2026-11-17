import { UpstreamError } from "@tax/sync";
import data from "../data/chains.json" with { type: "json" };
export interface ChainConfig {
	chainId: number;
	name: string;
	nativeAsset: string;
	nativeDecimals: number;
	explorerTxUrl: string;
	defaultProviders: string[];
	tokenListFile: string;
	feeModel: string;
	alchemyNetwork?: string | null;
	bridgeContracts: string[];
	nativeRename?: { from: string; to: string; at: string };
	nativeTokenAliases?: string[];
}
export const chains: readonly ChainConfig[] = data;
export function chainConfig(chainId: number): ChainConfig {
	const config = chains.find((chain) => chain.chainId === chainId);
	if (!config) throw new UpstreamError("Chain configuration is not bundled");
	return config;
}

export const providerSecretSlots = {
	etherscan: "provider:etherscan",
	blockscout: "provider:blockscout",
	alchemy: "provider:alchemy",
	nodereal: "provider:nodereal",
} as const;
