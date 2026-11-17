import {
	type ConnectorRow,
	D,
	LedgerTxSchema,
	type ReviewFlag,
} from "@tax/core";
import {
	address,
	type ExplorerAction,
	type ExplorerRow,
	field,
} from "./api.js";
import { chainConfig } from "./chains.js";
import {
	fromUnits,
	knownToken,
	spamReasons,
	tokenAsset,
	tokenDecimals,
} from "./tokens.js";
import { rawRowKeys } from "./walk.js";
export interface ClassifierInput {
	chainId: number;
	address: string;
	ownAddresses: string[];
	txlist: ExplorerRow[];
	txlistinternal: ExplorerRow[];
	tokentx: ExplorerRow[];
}
interface Leg {
	asset: string;
	amount: string;
	direction: "in" | "out";
	flags: ReviewFlag[];
	own: boolean;
}
type Tx = ConnectorRow["tx"];
export function classifyTransactions(input: ClassifierInput): ConnectorRow[] {
	const chain = chainConfig(input.chainId);
	const wallet = address(input.address),
		own = new Set([wallet, ...input.ownAddresses.map(address)]);
	const groups = new Map<
		string,
		{
			txlist: ExplorerRow[];
			txlistinternal: ExplorerRow[];
			tokentx: ExplorerRow[];
		}
	>();
	for (const action of [
		"txlist",
		"txlistinternal",
		"tokentx",
	] as ExplorerAction[]) {
		const keys = rawRowKeys(action, input[action]);
		const seen = new Set<string>();
		input[action].forEach((row, index) => {
			const key = keys[index];
			if (!key || seen.has(key)) return;
			seen.add(key);
			const hash = field(row, "hash").toLowerCase();
			let group = groups.get(hash);
			if (!group) {
				group = { txlist: [], txlistinternal: [], tokentx: [] };
				groups.set(hash, group);
			}
			group[action].push(row);
		});
	}
	const result: ConnectorRow[] = [];
	for (const [hash, group] of [...groups].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const main = group.txlist[0];
		const exemplar = main ?? group.txlistinternal[0] ?? group.tokentx[0];
		if (!exemplar) continue;
		const initiated = main?.from?.toLowerCase() === wallet;
		const failed = main?.isError === "1" || main?.txreceipt_status === "0";
		const gas =
			initiated && main
				? D(field(main, "gasUsed"))
						.mul(main.effectiveGasPrice ?? field(main, "gasPrice"))
						.div(D("10").pow(chain.nativeDecimals))
						.toFixed()
				: "0";
		const legs: Leg[] = [];
		const markers: ReviewFlag[] = [];
		const append = (
			row: ExplorerRow,
			asset: string,
			value: string,
			flags: ReviewFlag[] = [],
		) => {
			const from = field(row, "from").toLowerCase(),
				to = field(row, "to").toLowerCase();
			const betweenOwn = own.has(from) && own.has(to);
			if (D(value).isZero()) {
				if (flags.length) markers.push(...flags);
				return;
			}
			if (from === wallet)
				legs.push({
					asset,
					amount: value,
					direction: "out",
					flags: flags.filter((flag) => flag.code !== "suspected_spam"),
					own: betweenOwn,
				});
			if (to === wallet)
				legs.push({
					asset,
					amount: value,
					direction: "in",
					flags,
					own: betweenOwn,
				});
		};
		if (!failed) {
			for (const row of group.txlist)
				if (row.isError !== "1" && row.txreceipt_status !== "0")
					append(
						row,
						chain.nativeAsset,
						fromUnits(field(row, "value"), chain.nativeDecimals),
					);
			for (const row of group.txlistinternal)
				if (row.isError !== "1")
					append(
						row,
						chain.nativeAsset,
						fromUnits(field(row, "value"), chain.nativeDecimals),
					);
			for (const row of group.tokentx) {
				const flags: ReviewFlag[] =
					field(row, "to").toLowerCase() === wallet
						? spamReasons(
								input.chainId,
								row,
								(main?.from !== undefined &&
									own.has(main.from.toLowerCase())) ||
									own.has(field(row, "from").toLowerCase()),
							).map((message) => ({ code: "suspected_spam", message }))
						: [];
				const known = knownToken(input.chainId, field(row, "contractAddress"));
				if (known && Number(row.tokenDecimal) !== known.decimals)
					flags.push({
						code: "parse_warning",
						message:
							"Explorer token decimals differ from the verified registry; verified decimals used",
					});
				append(
					row,
					tokenAsset(input.chainId, field(row, "contractAddress")),
					fromUnits(field(row, "value"), tokenDecimals(input.chainId, row)),
					flags,
				);
			}
		}
		const raw = {
			address: wallet,
			txlist: group.txlist,
			txlistinternal: group.txlistinternal,
			tokentx: group.tokentx,
		};
		const make = (
			kind: string,
			ordinal: number,
			flags: ReviewFlag[] = [],
		): Tx => ({
			source: `evm:${input.chainId}`,
			// Address namespaces are needed because both own-address connections share one source.
			sourceRef: `${hash}:${kind}:${wallet}#${ordinal}`,
			timestamp: new Date(
				Number(field(exemplar, "timeStamp")) * 1000,
			).toISOString(),
			type: "fee",
			txHash: hash,
			chain: String(input.chainId),
			raw,
			reviewFlags: [...flags],
		});
		const clean = legs.filter(
			(leg) => !leg.flags.some((flag) => flag.code === "suspected_spam"),
		);
		const tainted = legs.filter((leg) =>
			leg.flags.some((flag) => flag.code === "suspected_spam"),
		);
		const ownMove = clean.some((leg) => leg.own);
		const wrap =
			(main?.to &&
				/^0x[0-9a-f]{40}$/i.test(main.to) &&
				knownToken(input.chainId, main.to)?.symbol ===
					`W${chain.nativeAsset}`) ||
			(clean.some((leg) => leg.asset === `W${chain.nativeAsset}`) &&
				clean.some((leg) => leg.asset === chain.nativeAsset));
		const defi = /bridge|addliquidity|removeliquidity|mint\(|burn\(/i.test(
			main?.functionName ?? "",
		);
		const nets = new Map<
			string,
			{ amount: ReturnType<typeof D>; flags: ReviewFlag[] }
		>();
		for (const leg of clean) {
			const net = nets.get(leg.asset) ?? { amount: D("0"), flags: [] };
			net.amount =
				leg.direction === "in"
					? net.amount.plus(leg.amount)
					: net.amount.minus(leg.amount);
			net.flags.push(...leg.flags);
			nets.set(leg.asset, net);
		}
		const netLegs: Leg[] = [...nets].flatMap(([asset, net]) =>
			net.amount.isZero()
				? []
				: [
						{
							asset,
							amount: net.amount.abs().toFixed(),
							direction: net.amount.gt("0")
								? ("in" as const)
								: ("out" as const),
							flags: net.flags,
							own: false,
						},
					],
		);
		const incoming = netLegs.filter((leg) => leg.direction === "in"),
			outgoing = netLegs.filter((leg) => leg.direction === "out");
		const multi =
			new Set(incoming.map((leg) => leg.asset)).size > 1 ||
			new Set(outgoing.map((leg) => leg.asset)).size > 1;
		const complex =
			wrap ||
			defi ||
			multi ||
			(incoming.length > 0 && outgoing.length > 0 && !initiated && !ownMove) ||
			(incoming.length > 0 && outgoing.length === 0 && initiated && !ownMove);
		const complexFlags: ReviewFlag[] = complex
			? [
					{
						code: "complex_onchain",
						message: wrap
							? `${chain.nativeAsset} wrap/unwrap requires manual tax classification`
							: defi
								? "Liquidity or bridge activity; each movement retained for review"
								: "Transaction is outside simple transfer/swap patterns; each movement retained for review",
					},
				]
			: [];
		const mapped: Tx[] = [];
		if (
			!complex &&
			!ownMove &&
			initiated &&
			outgoing.length > 0 &&
			incoming.length > 0 &&
			tainted.length === 0
		) {
			const out = outgoing[0],
				into = incoming[0];
			if (out && into)
				mapped.push({
					...make(
						"swap",
						0,
						clean.flatMap((leg) => leg.flags),
					),
					type: "swap",
					assetOut: out.asset,
					amountOut: outgoing
						.reduce((sum, leg) => sum.plus(leg.amount), D("0"))
						.toFixed(),
					assetIn: into.asset,
					amountIn: incoming
						.reduce((sum, leg) => sum.plus(leg.amount), D("0"))
						.toFixed(),
				});
		} else {
			// Sort by complete leg content so refs are independent of explorer ordering.
			for (const [index, leg] of [
				...(complex || ownMove ? clean : netLegs),
				...tainted,
			]
				.sort((a, b) =>
					`${a.direction}:${a.asset}:${a.amount}`.localeCompare(
						`${b.direction}:${b.asset}:${b.amount}`,
					),
				)
				.entries()) {
				const kind = leg.direction === "in" ? "deposit" : "withdrawal";
				mapped.push({
					...make(kind, index, [...complexFlags, ...leg.flags]),
					type: kind,
					...(leg.direction === "in"
						? { assetIn: leg.asset, amountIn: leg.amount }
						: { assetOut: leg.asset, amountOut: leg.amount }),
				});
			}
		}
		if (markers.length) mapped.push(make("spam", 0, markers));
		if (D(gas).gt("0")) {
			let target = mapped.find(
				(tx) => !tx.reviewFlags.some((flag) => flag.code === "suspected_spam"),
			);
			if (!target) {
				target = make("fee", 0);
				mapped.push(target);
			}
			target.feeAsset = chain.nativeAsset;
			target.feeAmount = gas;
			if (chain.l1DataFees)
				target.reviewFlags.push({
					code: "fee_review_required",
					message: "Non-mainnet gas may omit L1 data fees",
				});
		}
		if (!mapped.length)
			mapped.push(
				make("review", 0, [
					{
						code: "parse_warning",
						message:
							"No positive confirmed asset movement; original transaction retained without a balance effect",
					},
				]),
			);
		for (const tx of mapped) {
			const {
				id: _id,
				importId: _import,
				...parsed
			} = LedgerTxSchema.parse({
				...tx,
				id: "00000000-0000-4000-8000-000000000000",
				importId: null,
			});
			result.push({ tx: parsed });
		}
	}
	return result.sort(
		(a, b) =>
			a.tx.timestamp.localeCompare(b.tx.timestamp) ||
			a.tx.sourceRef.localeCompare(b.tx.sourceRef),
	);
}
