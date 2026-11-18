import { z } from "zod";
import { D } from "./decimal.js";
import { taxYearBounds } from "./time.js";

export const DecimalStringSchema = z
	.string()
	.regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i)
	.refine((v) => {
		try {
			return D(v).isFinite();
		} catch {
			return false;
		}
	}, "Must be finite");
export const PositiveDecimalSchema = DecimalStringSchema.pipe(
	z.string().refine((v) => D(v).gt("0"), "Must be positive"),
);
export const NonNegativeDecimalSchema = DecimalStringSchema.pipe(
	z.string().refine((v) => D(v).gte("0"), "Must be nonnegative"),
);
export const TaxYearSchema = z.string().refine((v) => {
	try {
		taxYearBounds(v);
		return true;
	} catch {
		return false;
	}
}, "Invalid tax year");
export const AssetSchema = z
	.string()
	.min(1)
	.regex(/^[A-Z0-9][A-Z0-9._:-]*$/);
export const ReviewCodeSchema = z.enum([
	"missing_history",
	"missing_inr_value",
	"unknown_type",
	"unmatched_transfer",
	"tds_not_deducted",
	"ambiguous_timezone",
	"balance_mismatch",
	"parse_warning",
	"complex_onchain",
	"ca_verification_pending",
	"import_incomplete",
	"fx_unavailable",
	"ambiguous_transfer",
	"fee_review_required",
	"suspected_spam",
	"possible_duplicate",
]);
export const ReviewFlagSchema = z.object({
	code: ReviewCodeSchema,
	message: z.string(),
	txId: z.string().optional(),
});
export type ReviewCode = z.infer<typeof ReviewCodeSchema>;
export type ReviewFlag = z.infer<typeof ReviewFlagSchema>;
export function mergeReviewFlags(flags: ReviewFlag[]): ReviewFlag[] {
	const byCode = new Map<
		ReviewCode,
		{ flag: ReviewFlag; reasons: Set<string> }
	>();
	for (const flag of flags) {
		const group = byCode.get(flag.code);
		if (group) group.reasons.add(flag.message);
		else byCode.set(flag.code, { flag, reasons: new Set([flag.message]) });
	}
	return [...byCode.values()].map(({ flag, reasons }) => ({
		...flag,
		message:
			reasons.size === 1
				? flag.message
				: [...reasons]
						.map((reason) => (/[.!?]$/.test(reason) ? reason : `${reason}.`))
						.join(" "),
	}));
}
export const ManualVenueSchema = z.enum(["manual", "binance", "coindcx"]);
export const TxTypeSchema = z.enum([
	"buy",
	"sell",
	"swap",
	"deposit",
	"withdrawal",
	"transfer",
	"income",
	"gift",
	"dividend",
	"fee",
]);
export const IncomeKindSchema = z.enum([
	"staking",
	"mining",
	"airdrop",
	"referral",
	"interest",
	"other",
]);
export const InrRateSourceSchema = z.enum([
	"trade_inr",
	"trade_usdt_x_usd_inr",
	"market_price_cache",
	"manual",
	"fmv_receipt",
]);
export const LedgerTxFieldsSchema = z.object({
	id: z.uuid(),
	source: z.string().min(1),
	venue: ManualVenueSchema.optional(),
	sourceRef: z.string().min(1),
	importId: z.string().nullable(),
	timestamp: z.iso.datetime(),
	type: TxTypeSchema,
	incomeKind: IncomeKindSchema.optional(),
	assetIn: AssetSchema.optional(),
	amountIn: PositiveDecimalSchema.optional(),
	assetOut: AssetSchema.optional(),
	amountOut: PositiveDecimalSchema.optional(),
	feeAsset: AssetSchema.optional(),
	feeAmount: NonNegativeDecimalSchema.optional(),
	gstInr: NonNegativeDecimalSchema.optional(),
	inrValue: NonNegativeDecimalSchema.optional(),
	inrRateSource: InrRateSourceSchema.optional(),
	priceQuote: z
		.object({ asset: AssetSchema, price: PositiveDecimalSchema })
		.optional(),
	tdsInr: NonNegativeDecimalSchema.optional(),
	txHash: z.string().optional(),
	chain: z.string().optional(),
	raw: z.unknown().refine((v) => v !== undefined, "Original row required"),
	reviewFlags: z.array(ReviewFlagSchema).transform(mergeReviewFlags),
	userNote: z.string().optional(),
});
export const LedgerTxSchema = LedgerTxFieldsSchema.superRefine((tx, ctx) => {
	const need = (field: keyof typeof tx) => {
		if (tx[field] === undefined)
			ctx.addIssue({
				code: "custom",
				path: [field],
				message: `${tx.type} requires ${field}`,
			});
	};
	if (["buy", "swap", "deposit", "income", "gift"].includes(tx.type)) {
		need("assetIn");
		need("amountIn");
	}
	if (["sell", "swap", "withdrawal"].includes(tx.type)) {
		need("assetOut");
		need("amountOut");
	}
	if (tx.type === "buy" && tx.inrValue === undefined) {
		need("assetOut");
		need("amountOut");
	}
	for (const [asset, amount] of [
		["assetIn", "amountIn"],
		["assetOut", "amountOut"],
		["feeAsset", "feeAmount"],
	] as const)
		if ((tx[asset] === undefined) !== (tx[amount] === undefined)) {
			need(asset);
			need(amount);
		}
	if (tx.incomeKind && tx.type !== "income")
		ctx.addIssue({
			code: "custom",
			path: ["incomeKind"],
			message: "Only income receipts have incomeKind",
		});
});
export type LedgerTx = z.infer<typeof LedgerTxSchema>;
export type TxType = z.infer<typeof TxTypeSchema>;
export type IncomeKind = z.infer<typeof IncomeKindSchema>;
export type InrRateSource = z.infer<typeof InrRateSourceSchema>;
