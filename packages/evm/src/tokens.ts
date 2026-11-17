import { D } from "@tax/core";
import { UpstreamError } from "@tax/sync";
import mainnet from "../data/tokens-1.json" with { type: "json" };
import bnb from "../data/tokens-56.json" with { type: "json" };
import polygon from "../data/tokens-137.json" with { type: "json" };
import baseTokens from "../data/tokens-8453.json" with { type: "json" };
import arbitrum from "../data/tokens-42161.json" with { type: "json" };
import { address, type ExplorerRow, field } from "./api.js";
import { chainConfig } from "./chains.js";
export interface Token {
	symbol: string;
	decimals: number;
	reviewNote?: string;
}
const tokenLists: Record<string, Readonly<Record<string, Token>>> = {
	"tokens-1.json": mainnet,
	"tokens-8453.json": baseTokens,
	"tokens-42161.json": arbitrum,
	"tokens-137.json": polygon,
	"tokens-56.json": bnb,
};
export function knownTokensForChain(
	chainId: number,
): Readonly<Record<string, Token>> {
	return tokenLists[chainConfig(chainId).tokenListFile] ?? {};
}
export function knownToken(
	chainId: number,
	contract: string,
): Token | undefined {
	return knownTokensForChain(chainId)[address(contract)];
}
export function tokenAsset(chainId: number, contract: string): string {
	return (
		knownToken(chainId, contract)?.symbol ??
		`ERC20:${chainId}:${address(contract).toUpperCase()}`
	);
}
export function tokenDecimals(chainId: number, row: ExplorerRow): number {
	const known = knownToken(chainId, field(row, "contractAddress"));
	if (known) return known.decimals;
	const decimals = Number(field(row, "tokenDecimal"));
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
		throw new UpstreamError("Invalid token decimals");
	return decimals;
}
export function fromUnits(value: string, decimals: number): string {
	if (!/^\d+$/.test(value)) throw new UpstreamError("Invalid token units");
	return D(value).div(D("10").pow(decimals)).toFixed();
}
export function spamReasons(
	chainId: number,
	row: ExplorerRow,
	initiated: boolean,
): string[] {
	const contract = field(row, "contractAddress"),
		known = knownToken(chainId, contract);
	const reasons: string[] = [];
	if (row.statusRep === "2") reasons.push("Explorer marks this token unsafe");
	if (D(field(row, "value")).isZero())
		reasons.push(
			"Zero-value inbound token transfer may be address poisoning; no zero-amount movement recorded",
		);
	if (!known && !initiated)
		reasons.push(
			"Unsolicited token from an unknown contract; verify before accepting",
		);
	if (
		!known &&
		(row.tokenSymbol?.toUpperCase() === chainConfig(chainId).nativeAsset ||
			Object.values(tokenLists)
				.flatMap((list) => Object.values(list))
				.some((token) => token.symbol === row.tokenSymbol?.toUpperCase()))
	)
		reasons.push(
			"Claimed symbol imitates a known asset at a different contract",
		);
	return reasons;
}
