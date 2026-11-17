import { UpstreamError } from "@tax/sync";
import {
	address,
	type ExplorerAction,
	type ExplorerRow,
	record,
	rpcText,
} from "./api.js";
import { chainConfig } from "./chains.js";
import {
	type EvmOptions,
	ExplorerUnsupportedError,
	type ProviderConfig,
} from "./provider-types.js";
import { integer, keyedUrl } from "./rpc.js";
import { TransfersAdapter, timestamp, transferPage } from "./transfers.js";

export class AlchemyAdapter extends TransfersAdapter {
	readonly kind = "alchemy";
	constructor(opts: EvmOptions, config: ProviderConfig) {
		const network = chainConfig(opts.chainId).alchemyNetwork;
		if (!network)
			throw new ExplorerUnsupportedError(
				"Alchemy Transfers does not serve this chain",
				400,
			);
		super(
			opts,
			keyedUrl(
				opts.baseUrls.alchemy ?? "https://{network}.g.alchemy.com/v2",
				config.apiKey,
				network,
			),
		);
	}
	historyNotice(action: ExplorerAction) {
		return this.opts.chainId === 42161 && action === "txlistinternal"
			? "Internal transfers not available from this provider on Arbitrum; add an Etherscan or Blockscout key"
			: undefined;
	}
	protected async page(
		wallet: string,
		direction: "fromAddress" | "toAddress",
		start: number,
		end: number,
		pageKey?: string,
	) {
		return transferPage(
			await this.rpc.call("alchemy_getAssetTransfers", [
				{
					fromBlock: `0x${start.toString(16)}`,
					toBlock: `0x${end.toString(16)}`,
					[direction]: wallet,
					category:
						this.opts.chainId === 42161
							? ["external", "erc20"]
							: ["external", "internal", "erc20"],
					withMetadata: true,
					excludeZeroValue: false,
					maxCount: "0x3e8",
					order: "asc",
					...(pageKey ? { pageKey } : {}),
				},
			]),
		);
	}
	protected normalize(transfer: Record<string, unknown>): {
		action: ExplorerAction;
		row: ExplorerRow;
	} {
		const contract = record(transfer.rawContract),
			metadata = record(transfer.metadata);
		const category = transfer.category;
		if (!["external", "internal", "erc20"].includes(String(category)))
			throw new UpstreamError("Unsupported Alchemy transfer category");
		const row: ExplorerRow = {
			hash: rpcText(transfer.hash, "hash"),
			blockNumber: integer(transfer.blockNum),
			timeStamp: timestamp(metadata.blockTimestamp),
			from: address(String(transfer.from)),
			to: address(String(transfer.to)),
			value: integer(contract.value),
			providerRaw: JSON.stringify(transfer),
		};
		if (category === "erc20") {
			row.contractAddress = address(String(contract.address));
			row.tokenSymbol = String(transfer.asset ?? "");
			row.tokenDecimal = integer(contract.decimal);
		} else if (category === "internal")
			row.traceId = rpcText(transfer.uniqueId, "uniqueId");
		else {
			row.gasPrice = "0";
			row.nativeSymbol = String(
				transfer.asset ?? chainConfig(this.opts.chainId).nativeAsset,
			);
		}
		return {
			action:
				category === "erc20"
					? "tokentx"
					: category === "internal"
						? "txlistinternal"
						: "txlist",
			row,
		};
	}
	async tokenBalance(wallet: string, contract: string, tag = "latest") {
		// Alchemy's token inventory has no historical block argument; balanceOf pins reconciliation to the safe block.
		if (tag !== "latest") return this.callBalance(wallet, contract, tag);
		const result = record(
			await this.rpc.call("alchemy_getTokenBalances", [
				address(wallet),
				[address(contract)],
			]),
		);
		if (!Array.isArray(result.tokenBalances))
			throw new UpstreamError("Expected Alchemy token balances");
		const token = result.tokenBalances
			.map(record)
			.find(
				(row) =>
					typeof row.contractAddress === "string" &&
					address(row.contractAddress) === address(contract),
			);
		if (!token || token.error)
			throw new UpstreamError("Alchemy token balance unavailable", 503);
		return integer(token.tokenBalance);
	}
}
