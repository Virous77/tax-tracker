import { UpstreamError } from "@tax/sync";
import {
	address,
	type ExplorerAction,
	type ExplorerRow,
	rpcText,
} from "./api.js";
import { chainConfig } from "./chains.js";
import {
	type EvmOptions,
	ExplorerUnsupportedError,
	type ProviderConfig,
} from "./provider-types.js";
import { integer, keyedUrl } from "./rpc.js";
import { knownToken } from "./tokens.js";
import { TransfersAdapter, timestamp, transferPage } from "./transfers.js";

export class NodeRealAdapter extends TransfersAdapter {
	readonly kind = "nodereal";
	protected windowSize = 100_000;
	private missingDecimals = false;
	historyNotice(action: ExplorerAction) {
		return action === "tokentx" && this.missingDecimals
			? "NodeReal omitted decimals for an unknown token; raw transfers retained for review without guessed amounts"
			: undefined;
	}
	constructor(opts: EvmOptions, config: ProviderConfig) {
		if (![1, 56].includes(opts.chainId))
			throw new ExplorerUnsupportedError(
				"NodeReal Transfers serves BSC and Ethereum only",
				400,
			);
		super(
			opts,
			keyedUrl(
				opts.baseUrls.nodereal ??
					(opts.chainId === 56
						? "https://bsc-mainnet.nodereal.io/v1"
						: "https://eth-mainnet.nodereal.io/v1"),
				config.apiKey,
			),
		);
	}
	protected async page(
		wallet: string,
		direction: "fromAddress" | "toAddress",
		start: number,
		end: number,
		pageKey?: string,
	) {
		return transferPage(
			await this.rpc.call("nr_getAssetTransfers", [
				{
					fromBlock: `0x${start.toString(16)}`,
					toBlock: `0x${end.toString(16)}`,
					[direction]: wallet,
					category: ["external", "internal", "20"],
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
		const category = transfer.category;
		if (!["external", "internal", "20"].includes(String(category)))
			throw new UpstreamError("Unsupported NodeReal transfer category");
		const row: ExplorerRow = {
			hash: rpcText(transfer.hash, "hash"),
			blockNumber: integer(transfer.blockNum),
			timeStamp: timestamp(transfer.blockTimeStamp ?? transfer.blockTimestamp),
			from: address(String(transfer.from)),
			to: address(String(transfer.to)),
			value: integer(transfer.value),
			providerRaw: JSON.stringify(transfer),
		};
		if (category === "20") {
			row.contractAddress = address(String(transfer.contractAddress));
			row.tokenSymbol = String(transfer.asset ?? "");
			const decimals =
				transfer.decimal ??
				knownToken(
					this.opts.chainId,
					row.contractAddress,
				)?.decimals?.toString();
			if (decimals === undefined || decimals === null)
				this.missingDecimals = true;
			else row.tokenDecimal = integer(decimals);
		} else if (category === "internal") {
			row.traceId = String(
				transfer.uniqueId ?? transfer.traceId ?? JSON.stringify(transfer),
			);
		} else {
			row.nativeSymbol = String(
				transfer.asset ?? chainConfig(this.opts.chainId).nativeAsset,
			);
			if (transfer.gasPrice !== undefined)
				row.gasPrice = integer(transfer.gasPrice);
			if (transfer.gasUsed !== undefined)
				row.gasUsed = integer(transfer.gasUsed);
			if (transfer.receiptsStatus !== undefined)
				row.txreceipt_status = integer(transfer.receiptsStatus);
		}
		return {
			action:
				category === "20"
					? "tokentx"
					: category === "internal"
						? "txlistinternal"
						: "txlist",
			row,
		};
	}
	async tokenBalance(wallet: string, contract: string, tag = "latest") {
		return this.callBalance(wallet, contract, tag);
	}
}
