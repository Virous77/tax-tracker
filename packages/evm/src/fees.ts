import { D, type ReviewFlag } from "@tax/core";
import { type ExplorerRow, field } from "./api.js";
import type { ChainConfig } from "./chains.js";
import { fromUnits } from "./tokens.js";

export function transactionFee(chain: ChainConfig, row: ExplorerRow) {
	let wei = D(field(row, "gasUsed")).mul(
		row.effectiveGasPrice ?? field(row, "gasPrice"),
	);
	const flags: ReviewFlag[] = [];
	if (chain.feeModel === "op-stack" && row.type !== "0x7e") {
		if (row.l1Fee === undefined)
			flags.push({
				code: "fee_review_required",
				message: "Receipt lacks l1Fee; OP-stack total gas fee is incomplete",
			});
		else wei = wei.plus(row.l1Fee);
		if (row.operatorFee !== undefined) wei = wei.plus(row.operatorFee);
		else if (
			row.operatorFeeScalar !== undefined ||
			row.operatorFeeConstant !== undefined
		)
			flags.push({
				code: "fee_review_required",
				message:
					"The receipt lists operator-fee parameters without a confirmed fee amount. Review the additional fee.",
			});
	}
	// Arbitrum gasUsed already includes gasUsedForL1; adding it would double-count (research §1.8).
	return { amount: fromUnits(wei.toFixed(), chain.nativeDecimals), flags };
}
