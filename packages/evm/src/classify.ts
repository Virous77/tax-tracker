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
	record,
} from "./api.js";
import { chainConfig } from "./chains.js";
import { transactionFee } from "./fees.js";
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
		const fee =
			initiated && main
				? transactionFee(chain, main)
				: { amount: "0", flags: [] };
		const gas = fee.amount;
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
				if (
					chain.nativeTokenAliases?.includes(
						field(row, "contractAddress").toLowerCase(),
					)
				)
					continue;
				if (!known && row.tokenDecimal === undefined) {
					markers.push(...flags, {
						code: "parse_warning",
						message:
							"Provider omitted token decimals; original transfer retained without a guessed amount",
					});
					continue;
				}
				if (known?.reviewNote)
					flags.push({ code: "complex_onchain", message: known.reviewNote });
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
			nativeSymbols: [...group.txlist, ...group.txlistinternal].flatMap(
				(row) => {
					const symbol = row.nativeSymbol ?? row.tokenSymbol ?? row.asset;
					return symbol ? [symbol] : [];
				},
			),
			providerRows: [...group.txlist, ...group.txlistinternal, ...group.tokentx]
				.filter((row) => row.providerRaw)
				.map((row) => JSON.parse(row.providerRaw ?? "{}") as unknown),
			receipts: group.txlist
				.filter((row) => row.receiptRaw)
				.map((row) => JSON.parse(row.receiptRaw ?? "{}") as unknown),
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
			type: kind === "fee" ? "fee" : "transfer",
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
		const bridge = [
			...group.txlist,
			...group.txlistinternal,
			...group.tokentx,
		].some(
			(row) =>
				chain.bridgeContracts.some(
					(contract) =>
						row.from?.toLowerCase() === contract ||
						row.to?.toLowerCase() === contract,
				) ||
				row.type === "0x7e" ||
				/bridge|depositeth|withdraweth|retryable|finalizedeposit/i.test(
					row.functionName ?? "",
				) ||
				(input.chainId !== 1 &&
					row.to?.toLowerCase() === wallet &&
					(/binance|coindcx|coinbase|kraken|okx|bybit/i.test(
						[row.fromLabel, row.fromTag, row.exchange]
							.filter(Boolean)
							.join(" "),
					) ||
						row.from === "0x0000000000000000000000000000000000000000")),
		);
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
			bridge ||
			defi ||
			multi ||
			(incoming.length > 0 && outgoing.length > 0 && !initiated && !ownMove) ||
			(incoming.length > 0 && outgoing.length === 0 && initiated && !ownMove);
		const complexFlags: ReviewFlag[] = complex
			? [
					{
						code: "complex_onchain",
						message: bridge
							? "Possible bridge between chains"
							: wrap
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
		if (markers.length) {
			const spam = markers.every((flag) => flag.code === "suspected_spam");
			mapped.push(make(spam ? "spam" : "review", 0, markers));
		}
		if (D(gas).gt("0") || fee.flags.length) {
			let target = mapped.find(
				(tx) => !tx.reviewFlags.some((flag) => flag.code === "suspected_spam"),
			);
			if (!target) {
				target = make("fee", 0);
				mapped.push(target);
			}
			if (target.type === "transfer") target.type = "fee";
			target.feeAsset = chain.nativeAsset;
			target.feeAmount = gas;
			target.reviewFlags.push(...fee.flags);
		}
		if (!mapped.length) mapped.push(make("review", 0));
		for (const tx of mapped) {
			if (
				tx.type === "transfer" &&
				!tx.reviewFlags.some((flag) => flag.code === "suspected_spam")
			)
				tx.reviewFlags.push({
					code: "unknown_type",
					message:
						"No confirmed asset movement. The original transaction has no balance effect.",
				});
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
	const sorted = result.sort(
		(a, b) =>
			a.tx.timestamp.localeCompare(b.tx.timestamp) ||
			a.tx.sourceRef.localeCompare(b.tx.sourceRef),
	);
	const rename = chain.nativeRename;
	if (rename) {
		const first = sorted.find(({ tx }) => {
			const symbols = record(tx.raw).nativeSymbols;
			const historical =
				tx.timestamp < new Date(rename.at).toISOString() ||
				(Array.isArray(symbols) && symbols.includes(rename.from));
			return (
				historical &&
				(tx.assetIn === chain.nativeAsset ||
					tx.assetOut === chain.nativeAsset ||
					tx.feeAsset === chain.nativeAsset)
			);
		});
		first?.tx.reviewFlags.push({
			code: "parse_warning",
			message: `Polygon ${rename.from} was renamed ${rename.to} on ${rename.at}; mapped to ${rename.to} with the provider's original symbol retained in raw. Tax treatment requires CA review.`,
		});
	}
	return sorted;
}
