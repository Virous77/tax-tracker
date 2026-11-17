// One coherent fixture user for the mock-sync server: the raw events, the vendor payloads built
// from them, and the balances those events imply. Amounts are decimal strings here and BigInt
// units everywhere else, so no float ever touches a ledger amount.

import { createHash } from "node:crypto";

export const DATA_NOW = "2026-04-01T00:00:00.000Z";

export const FY = { start: "2025-04-01", end: "2026-03-31" };

export const CREDENTIALS = {
	binance: { apiKey: "mock-binance-key", secret: "mock-binance-secret" },
	coindcx: { apiKey: "mock-dcx-key", secret: "mock-dcx-secret" },
	// The free Etherscan V2 key covers chains 1, 137 and 42161 only; the paid key covers all five
	// chains this repo supports (research multichain §1.1, §1.3).
	etherscan: {
		apiKey: "mock-etherscan-key",
		paidApiKey: "mock-etherscan-paid-key",
	},
	blockscout: { apiKey: "mock-blockscout-key" },
	alchemy: { apiKey: "mock-alchemy-key" },
	nodereal: { apiKey: "mock-nodereal-key" },
	coingecko: { apiKey: "mock-coingecko-key" },
};

export const ADDRESSES = {
	walletA: "0x5a17c9e3b4d28f6019ca7b3e5d8f2a4c6b1e9d70",
	walletB: "0x9c4e2a7d1f83b650e4d9a2c5f7b1e8d3a6c0b459",
	binanceDeposit: "0x3d7b4e2a9c1f0586b3e7a2d9c4f6018e5b2a7c43",
	binanceHotWallet: "0xb71f3c8d92a45e6017ca9b3d5f8e2a4c60d1b9e7",
	externalFunder: "0x2b5f8e1c9d3a70465fe2b9c4d7a10f836c5e29b4",
	dexRouter: "0x7c2e9a4b6d1f8350a2c7e4b9d6f1038a5c2b7e40",
	spamSender: "0x6f1d3b8e5a2c9074d6e3b1a8c5f2047d9b6e3a1c",
	usdcContract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
	usdtContract: "0xdac17f958d2ee523a2206206994597c13d831ec7",
	spamToken: "0xdeadbeefcafebabe00112233445566778899aabb",
	bigSpamToken: "0xfacade000000000000000000000000000000c0de",
	// Chain-specific fixtures. Every one is invented except the token, bridge and predeploy
	// contracts, which are the real published addresses from research multichain §1.6 and §1.7.
	baseRouter: "0x2f9b6d3e8a1c74052e6b9d3f8a2c71e5b6049d3a",
	binanceBaseHotWallet: "0xc1a7f4e9b2d6805317c4a9e6b3d85027a1c6f9e4",
	baseStandardBridge: "0x4200000000000000000000000000000000000010",
	baseUsdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
	arbFunder: "0x8f2c5b7e1a9d3406c8e2f5b7a1d9c3e60482f7b1",
	arbRecipient: "0x4a8e1c7d2f9b53064e1a8c5d7f2b9e3064c8a1d5",
	arbRouter: "0x6c3d9f1e7a2b5408163c9d7e2a5b8f1064c2e9d3",
	arbUsdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
	arbUsdce: "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
	polyFunder: "0x7d3b9e5c1a8f24067b4d9e2c6a1f85037c2e9b4d",
	polyRecipient: "0xb2e6f9d4c1a85037e2b6d9f4a1c87036e5b2d9c4",
	binanceBscHotWallet: "0xe4a1c9d7b3f2608419d5c7e2a9b4f60318d2c5e7",
	bscRecipient: "0x1f7a3c9e5b2d84061a7c9e3f5b8d2046a1c7e9b3",
	bscUsdt: "0x55d398326f99059ff775485246999027b3197955",
};

export const OWN_ADDRESSES = [ADDRESSES.walletA, ADDRESSES.walletB];

// Every hash is sha256 of a label, so the values are stable across runs and never a real
// transaction. The Binance withdrawal txId and the wallet-A incoming tx share one label on
// purpose: that equality is what the engine matches on.
function hashOf(label) {
	return `0x${createHash("sha256").update(`tax-tracker/mock-sync/${label}`).digest("hex")}`;
}

export const HASHES = {
	binanceToWalletA: hashOf("binance-withdraw-eth-to-wallet-a"),
	walletAToWalletB: hashOf("wallet-a-usdc-to-wallet-b"),
	swap: hashOf("wallet-a-eth-usdc-swap"),
	spam: hashOf("spam-usdt-to-wallet-a"),
	failed: hashOf("wallet-a-failed-swap"),
	approve: hashOf("wallet-a-usdc-approve"),
	fundWalletB: hashOf("fund-wallet-b-eth"),
	walletBToBinance: hashOf("wallet-b-usdc-to-binance-deposit"),
	xrpDeposit: hashOf("xrp-deposit-to-binance"),
	pendingUsdcDeposit: hashOf("pending-usdc-deposit"),
	// Base
	binanceToWalletABase: hashOf("binance-withdraw-eth-to-wallet-a-base"),
	baseSwap: hashOf("wallet-a-base-eth-usdc-swap"),
	baseBridge: hashOf("wallet-a-base-bridge-out"),
	// Arbitrum One
	arbFundEth: hashOf("arbitrum-fund-eth-to-wallet-a"),
	arbFundUsdce: hashOf("arbitrum-fund-usdc-e-to-wallet-a"),
	arbFundUsdc: hashOf("arbitrum-fund-usdc-to-wallet-a"),
	arbSendUsdce: hashOf("wallet-a-arbitrum-usdc-e-out"),
	arbSendUsdc: hashOf("wallet-a-arbitrum-usdc-out"),
	arbSwap: hashOf("wallet-a-arbitrum-usdc-e-to-eth-swap"),
	// Polygon PoS
	polyMaticIn: hashOf("polygon-matic-to-wallet-b"),
	polyMaticOut: hashOf("wallet-b-polygon-matic-out"),
	polyPolIn: hashOf("polygon-pol-to-wallet-b"),
	polyPolOut: hashOf("wallet-b-polygon-pol-out"),
	// BNB Smart Chain
	binanceToWalletABscUsdt: hashOf("binance-withdraw-usdt-to-wallet-a-bsc"),
	binanceToWalletABscBnb: hashOf("binance-withdraw-bnb-to-wallet-a-bsc"),
	bscUsdtOut: hashOf("wallet-a-bsc-usdt-out"),
};

export const TOKENS = {
	USDC: {
		contract: ADDRESSES.usdcContract,
		name: "USD Coin",
		symbol: "USDC",
		decimals: 6,
	},
	USDT: {
		contract: ADDRESSES.usdtContract,
		name: "Tether USD",
		symbol: "USDT",
		decimals: 6,
	},
	SPAM_USDT: {
		contract: ADDRESSES.spamToken,
		name: "Tether USD",
		symbol: "USDT",
		decimals: 6,
	},
	SPAM_USDC: {
		contract: ADDRESSES.bigSpamToken,
		name: "USD Coin",
		symbol: "USDC",
		decimals: 6,
	},
};

// --- Chains ----------------------------------------------------------------
// The five chains in SPEC-phase2 §1, with the native asset per research §1.4 and the free-tier
// coverage per research §1.1. `headBlock` is the chain head at the pinned data clock; the mock
// reports `headBlock` and derives confirmations from it.

export const CHAINS = {
	1: {
		chainId: 1,
		name: "Ethereum",
		native: "ETH",
		headBlock: 24_700_000,
		alchemyNetwork: "eth-mainnet",
		blockscoutPrefix: "eth",
		freeEtherscan: true,
		freeBlockscout: true,
		nodereal: false,
		arbitrumInternals: true,
		l1Fee: false,
	},
	8453: {
		chainId: 8453,
		name: "Base",
		native: "ETH",
		headBlock: 40_100_000,
		alchemyNetwork: "base-mainnet",
		blockscoutPrefix: "base",
		freeEtherscan: false,
		freeBlockscout: false,
		nodereal: false,
		arbitrumInternals: true,
		// OP-stack chains charge an L1 data fee on top of gasUsed × effectiveGasPrice (§1.8).
		l1Fee: true,
	},
	42161: {
		chainId: 42161,
		name: "Arbitrum One",
		native: "ETH",
		headBlock: 420_000_000,
		alchemyNetwork: "arb-mainnet",
		blockscoutPrefix: "arbitrum",
		freeEtherscan: true,
		freeBlockscout: true,
		nodereal: false,
		// Alchemy does not serve the internal category on Arbitrum (§1.3).
		arbitrumInternals: false,
		l1Fee: false,
	},
	137: {
		chainId: 137,
		name: "Polygon PoS",
		native: "POL",
		headBlock: 78_000_000,
		alchemyNetwork: "polygon-mainnet",
		blockscoutPrefix: "polygon",
		freeEtherscan: true,
		freeBlockscout: true,
		nodereal: false,
		arbitrumInternals: true,
		l1Fee: false,
		// POL replaced MATIC 1:1 on 2024-09-04T12:00:00Z with no transaction (§1.4).
		nativeRename: { from: "MATIC", to: "POL", at: "2024-09-04T12:00:00Z" },
	},
	56: {
		chainId: 56,
		name: "BNB Smart Chain",
		native: "BNB",
		headBlock: 75_400_000,
		alchemyNetwork: null,
		blockscoutPrefix: null,
		freeEtherscan: false,
		freeBlockscout: false,
		nodereal: true,
		arbitrumInternals: true,
		l1Fee: false,
	},
};

export function chainNativeAsset(chainId, timeIso) {
	const chain = CHAINS[chainId];
	if (!chain) return null;
	const rename = chain.nativeRename;
	if (rename && timeIso && Date.parse(timeIso) < Date.parse(rename.at))
		return rename.from;
	return chain.native;
}

// Contracts per chain, from research §1.6. Decimals always come from here, never from a guess:
// BSC USDT and USDC are 18 dp, everywhere else 6.
export const CHAIN_TOKENS = {
	1: {
		[ADDRESSES.usdcContract]: TOKENS.USDC,
		[ADDRESSES.usdtContract]: TOKENS.USDT,
	},
	8453: {
		[ADDRESSES.baseUsdc]: {
			contract: ADDRESSES.baseUsdc,
			name: "USD Coin",
			symbol: "USDC",
			decimals: 6,
		},
	},
	42161: {
		[ADDRESSES.arbUsdc]: {
			contract: ADDRESSES.arbUsdc,
			name: "USD Coin",
			symbol: "USDC",
			decimals: 6,
		},
		[ADDRESSES.arbUsdce]: {
			contract: ADDRESSES.arbUsdce,
			name: "USD Coin (Arb1)",
			symbol: "USDC.e",
			decimals: 6,
		},
	},
	137: {},
	56: {
		[ADDRESSES.bscUsdt]: {
			contract: ADDRESSES.bscUsdt,
			name: "Binance-Peg BSC-USD",
			symbol: "USDT",
			decimals: 18,
		},
	},
};

export function tokenLeg(
	chainId,
	contract,
	from,
	to,
	valueUnits,
	statusRep = "1",
) {
	const token = CHAIN_TOKENS[chainId]?.[contract];
	if (!token)
		throw new Error(`No fixture token ${contract} on chain ${chainId}`);
	return {
		contract: token.contract,
		name: token.name,
		symbol: token.symbol,
		decimals: token.decimals,
		from,
		to,
		valueUnits,
		statusRep,
	};
}

export function toUnits(amount) {
	const text = String(amount).trim();
	const negative = text.startsWith("-");
	const [whole, frac = ""] = (negative ? text.slice(1) : text).split(".");
	const units =
		BigInt(whole || "0") * 10n ** 18n +
		BigInt(`${frac}${"0".repeat(18)}`.slice(0, 18));
	return negative ? -units : units;
}

export function formatUnits(units, decimals = 8) {
	const negative = units < 0n;
	const abs = negative ? -units : units;
	const scale = 10n ** BigInt(decimals);
	const whole = abs / scale;
	const frac = (abs % scale).toString().padStart(decimals, "0");
	return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function formatAsset(units, decimals = 8) {
	const negative = units < 0n;
	const abs = negative ? -units : units;
	const text = formatUnits(abs, 18);
	const [whole, frac = ""] = text.split(".");
	const cut = `${frac}${"0".repeat(decimals)}`.slice(0, decimals);
	return `${negative ? "-" : ""}${whole}.${cut}`;
}

export function shortUnits(units) {
	const text = formatUnits(units < 0n ? -units : units, 18);
	const trimmed = text.includes(".")
		? text.replace(/0+$/, "").replace(/\.$/, "")
		: text;
	return units < 0n ? `-${trimmed}` : trimmed;
}

const ms = (iso) => Date.parse(iso);

export const BINANCE_SYMBOLS = [
	{ symbol: "ETHUSDT", base: "ETH", quote: "USDT", status: "TRADING" },
	{ symbol: "BTCUSDT", base: "BTC", quote: "USDT", status: "TRADING" },
	{ symbol: "BNBUSDT", base: "BNB", quote: "USDT", status: "TRADING" },
	{ symbol: "XRPUSDT", base: "XRP", quote: "USDT", status: "TRADING" },
	{ symbol: "ETHBTC", base: "ETH", quote: "BTC", status: "BREAK" },
];

// --- Ethereum mainnet ------------------------------------------------------
// One list of transactions, each with the token legs Etherscan reports separately. Timestamps
// and block numbers climb together so block walking behaves like mainnet.

export const EVM_TRANSACTIONS = [
	{
		label: "binance withdrawal: 0.5 ETH into wallet A",
		hash: HASHES.binanceToWalletA,
		blockNumber: 22310000,
		time: "2025-05-02T08:14:23Z",
		from: ADDRESSES.binanceHotWallet,
		to: ADDRESSES.walletA,
		// Binance's `amount` is what arrives here; `transactionFee` is charged on top of it.
		valueWei: "500000000000000000",
		gasUsed: 21000,
		gasPriceWei: "12000000000",
		isError: false,
		methodId: "0x",
		functionName: "",
		contractAddress: "",
		tokenTransfers: [],
	},
	{
		label: "wallet A swaps 0.2 ETH for 480 USDC",
		hash: HASHES.swap,
		blockNumber: 22380000,
		time: "2025-06-10T14:32:05Z",
		from: ADDRESSES.walletA,
		to: ADDRESSES.dexRouter,
		valueWei: "200000000000000000",
		gasUsed: 118402,
		gasPriceWei: "12000000000",
		isError: false,
		methodId: "0x7ff36ab5",
		functionName: "swapExactETHForTokens(uint256,address[],address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			{
				...TOKENS.USDC,
				from: ADDRESSES.dexRouter,
				to: ADDRESSES.walletA,
				valueUnits: "480000000",
				statusRep: "1",
			},
		],
		internalCalls: [
			{
				from: ADDRESSES.walletA,
				to: ADDRESSES.dexRouter,
				valueWei: "0",
				type: "call",
				traceId: "0",
				isError: false,
			},
		],
	},
	{
		label: "gas money for wallet B",
		hash: HASHES.fundWalletB,
		blockNumber: 22430000,
		time: "2025-07-30T07:11:20Z",
		from: ADDRESSES.externalFunder,
		to: ADDRESSES.walletB,
		valueWei: "10000000000000000",
		gasUsed: 21000,
		gasPriceWei: "10000000000",
		isError: false,
		methodId: "0x",
		functionName: "",
		contractAddress: "",
		tokenTransfers: [],
	},
	{
		label: "wallet A sends 300 USDC to wallet B",
		hash: HASHES.walletAToWalletB,
		blockNumber: 22450000,
		time: "2025-08-14T05:02:44Z",
		from: ADDRESSES.walletA,
		to: ADDRESSES.walletB,
		valueWei: "0",
		gasUsed: 51209,
		gasPriceWei: "7000000000",
		isError: false,
		methodId: "0xa9059cbb",
		functionName: "transfer(address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			{
				...TOKENS.USDC,
				from: ADDRESSES.walletA,
				to: ADDRESSES.walletB,
				valueUnits: "300000000",
				statusRep: "1",
			},
		],
	},
	{
		label: "unsolicited lookalike USDT from a spam contract",
		hash: HASHES.spam,
		blockNumber: 22480000,
		time: "2025-09-03T11:20:11Z",
		from: ADDRESSES.spamSender,
		to: ADDRESSES.walletA,
		valueWei: "0",
		gasUsed: 42000,
		gasPriceWei: "5000000000",
		isError: false,
		methodId: "0xa9059cbb",
		functionName: "transfer(address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			{
				...TOKENS.SPAM_USDT,
				from: ADDRESSES.spamSender,
				to: ADDRESSES.walletA,
				valueUnits: "50000000000",
				statusRep: "2",
			},
		],
	},
	{
		label: "failed swap, gas only",
		hash: HASHES.failed,
		blockNumber: 22520000,
		time: "2025-10-07T09:47:02Z",
		from: ADDRESSES.walletA,
		to: ADDRESSES.dexRouter,
		valueWei: "50000000000000000",
		gasUsed: 38412,
		gasPriceWei: "9000000000",
		isError: true,
		methodId: "0x7ff36ab5",
		functionName: "swapExactETHForTokens(uint256,address[],address,uint256)",
		contractAddress: "",
		tokenTransfers: [],
	},
	{
		label: "USDC approve, gas only",
		hash: HASHES.approve,
		blockNumber: 22580000,
		time: "2025-11-19T17:05:39Z",
		from: ADDRESSES.walletA,
		to: ADDRESSES.usdcContract,
		valueWei: "0",
		gasUsed: 46201,
		gasPriceWei: "6500000000",
		isError: false,
		methodId: "0x095ea7b3",
		functionName: "approve(address spender, uint256 value)",
		contractAddress: "",
		tokenTransfers: [],
	},
	{
		label: "wallet B sends 120 USDC to its Binance deposit address",
		hash: HASHES.walletBToBinance,
		blockNumber: 22630000,
		time: "2025-12-12T12:31:08Z",
		from: ADDRESSES.walletB,
		to: ADDRESSES.binanceDeposit,
		valueWei: "0",
		gasUsed: 44900,
		gasPriceWei: "6000000000",
		isError: false,
		methodId: "0xa9059cbb",
		functionName: "transfer(address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			{
				...TOKENS.USDC,
				from: ADDRESSES.walletB,
				to: ADDRESSES.binanceDeposit,
				valueUnits: "120000000",
				statusRep: "1",
			},
		],
	},
];

// Added only in the `big_history` scenario: 3,050 one-unit lookalike-USDC transfers, one per
// block, so a client that does not walk block ranges stops at 1,000 rows.
export const BIG_HISTORY_COUNT = 3050;
export const BIG_HISTORY_FIRST_BLOCK = 22900000;

export function bigHistoryTransactions() {
	const rows = [];
	for (let index = 0; index < BIG_HISTORY_COUNT; index++) {
		const blockNumber = BIG_HISTORY_FIRST_BLOCK + index;
		rows.push({
			label: `big history spam #${index}`,
			hash: hashOf(`big-history-${index}`),
			blockNumber,
			time: new Date(ms("2026-02-01T00:00:00Z") + index * 60_000).toISOString(),
			from: ADDRESSES.spamSender,
			to: ADDRESSES.walletA,
			valueWei: "0",
			gasUsed: 21000,
			gasPriceWei: "3000000000",
			isError: false,
			methodId: "0xa9059cbb",
			functionName: "transfer(address,uint256)",
			contractAddress: "",
			tokenTransfers: [
				{
					...TOKENS.SPAM_USDC,
					from: ADDRESSES.spamSender,
					to: ADDRESSES.walletA,
					valueUnits: "1000000",
					statusRep: "2",
				},
			],
		});
	}
	return rows;
}

// --- Base (8453) -----------------------------------------------------------
// OP-stack receipts carry `l1Fee` on top of gasUsed × effectiveGasPrice. Every Base tx here has
// one, and the replay charges it to the sender, so a client that ignores l1Fee fails the balance
// check exactly as the research §1.8 says it would on a real wallet.

export const BASE_TRANSACTIONS = [
	{
		label: "binance withdrawal: 0.02 ETH into wallet A on Base",
		hash: HASHES.binanceToWalletABase,
		blockNumber: 32_450_000,
		time: "2025-05-20T09:12:44Z",
		from: ADDRESSES.binanceBaseHotWallet,
		to: ADDRESSES.walletA,
		valueWei: "20000000000000000",
		gasUsed: 21000,
		gasPriceWei: "8000000",
		l1FeeWei: "1180000000",
		type: "0x2",
		isError: false,
		methodId: "0x",
		functionName: "",
		contractAddress: "",
		tokenTransfers: [],
	},
	{
		label: "wallet A swaps 0.005 ETH for 12.5 USDC on Base",
		hash: HASHES.baseSwap,
		blockNumber: 33_100_000,
		time: "2025-06-18T11:20:03Z",
		from: ADDRESSES.walletA,
		to: ADDRESSES.baseRouter,
		valueWei: "5000000000000000",
		gasUsed: 152_304,
		gasPriceWei: "7000000",
		l1FeeWei: "1248000000",
		type: "0x2",
		isError: false,
		methodId: "0x7ff36ab5",
		functionName: "swapExactETHForTokens(uint256,address[],address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			tokenLeg(
				8453,
				ADDRESSES.baseUsdc,
				ADDRESSES.baseRouter,
				ADDRESSES.walletA,
				"12500000",
			),
		],
	},
	{
		label: "wallet A bridges 0.002 ETH from Base to Ethereum",
		hash: HASHES.baseBridge,
		blockNumber: 33_880_000,
		time: "2025-08-25T06:40:12Z",
		from: ADDRESSES.walletA,
		to: ADDRESSES.baseStandardBridge,
		valueWei: "2000000000000000",
		gasUsed: 61_002,
		gasPriceWei: "6000000",
		l1FeeWei: "1102500000",
		type: "0x2",
		isError: false,
		methodId: "0x32b7006d",
		functionName: "bridgeETH(uint32,bytes)",
		contractAddress: "",
		tokenTransfers: [],
	},
];

// --- Arbitrum One (42161) --------------------------------------------------
// Wallet A holds both the bridged USDC.e and Circle's native USDC (research §1.6) and moves each
// once. `gasUsed × effectiveGasPrice` already contains the L1 poster fee (§1.8), so no extra field
// exists here. The one swap pays ETH out of a router through an internal call: Alchemy does not
// serve the internal category on Arbitrum (§1.3), which is the documented limitation this fixture
// reproduces.

export const ARBITRUM_TRANSACTIONS = [
	{
		label: "arbitrum gas money: 0.01 ETH into wallet A",
		hash: HASHES.arbFundEth,
		blockNumber: 350_000_000,
		time: "2025-07-08T04:30:00Z",
		from: ADDRESSES.arbFunder,
		to: ADDRESSES.walletA,
		valueWei: "10000000000000000",
		gasUsed: 21000,
		gasPriceWei: "10000000",
		type: "0x2",
		isError: false,
		methodId: "0x",
		functionName: "",
		contractAddress: "",
		tokenTransfers: [],
	},
	{
		label: "100 USDC.e into wallet A on Arbitrum",
		hash: HASHES.arbFundUsdce,
		blockNumber: 352_100_000,
		time: "2025-07-09T08:00:00Z",
		from: ADDRESSES.arbFunder,
		to: ADDRESSES.walletA,
		valueWei: "0",
		gasUsed: 42000,
		gasPriceWei: "10000000",
		type: "0x2",
		isError: false,
		methodId: "0xa9059cbb",
		functionName: "transfer(address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			tokenLeg(
				42161,
				ADDRESSES.arbUsdce,
				ADDRESSES.arbFunder,
				ADDRESSES.walletA,
				"100000000",
			),
		],
	},
	{
		label: "50 native USDC into wallet A on Arbitrum",
		hash: HASHES.arbFundUsdc,
		blockNumber: 352_100_500,
		time: "2025-07-09T08:05:00Z",
		from: ADDRESSES.arbFunder,
		to: ADDRESSES.walletA,
		valueWei: "0",
		gasUsed: 42000,
		gasPriceWei: "10000000",
		type: "0x2",
		isError: false,
		methodId: "0xa9059cbb",
		functionName: "transfer(address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			tokenLeg(
				42161,
				ADDRESSES.arbUsdc,
				ADDRESSES.arbFunder,
				ADDRESSES.walletA,
				"50000000",
			),
		],
	},
	{
		label: "wallet A sends 40 USDC.e on Arbitrum",
		hash: HASHES.arbSendUsdce,
		blockNumber: 360_400_000,
		time: "2025-08-20T10:15:00Z",
		from: ADDRESSES.walletA,
		to: ADDRESSES.arbRecipient,
		valueWei: "0",
		gasUsed: 51000,
		gasPriceWei: "10000000",
		type: "0x2",
		isError: false,
		methodId: "0xa9059cbb",
		functionName: "transfer(address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			tokenLeg(
				42161,
				ADDRESSES.arbUsdce,
				ADDRESSES.walletA,
				ADDRESSES.arbRecipient,
				"40000000",
			),
		],
	},
	{
		label: "wallet A sends 20 native USDC on Arbitrum",
		hash: HASHES.arbSendUsdc,
		blockNumber: 361_000_000,
		time: "2025-08-28T12:00:00Z",
		from: ADDRESSES.walletA,
		to: ADDRESSES.arbRecipient,
		valueWei: "0",
		gasUsed: 51000,
		gasPriceWei: "10000000",
		type: "0x2",
		isError: false,
		methodId: "0xa9059cbb",
		functionName: "transfer(address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			tokenLeg(
				42161,
				ADDRESSES.arbUsdc,
				ADDRESSES.walletA,
				ADDRESSES.arbRecipient,
				"20000000",
			),
		],
	},
	{
		label: "wallet A swaps 10 USDC.e for 0.0035 ETH on Arbitrum",
		hash: HASHES.arbSwap,
		blockNumber: 365_200_000,
		time: "2025-09-15T05:20:00Z",
		from: ADDRESSES.walletA,
		to: ADDRESSES.arbRouter,
		valueWei: "0",
		gasUsed: 148_000,
		gasPriceWei: "10000000",
		type: "0x2",
		isError: false,
		methodId: "0x38ed1739",
		functionName:
			"swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			tokenLeg(
				42161,
				ADDRESSES.arbUsdce,
				ADDRESSES.walletA,
				ADDRESSES.arbRouter,
				"10000000",
			),
		],
		internalCalls: [
			{
				from: ADDRESSES.arbRouter,
				to: ADDRESSES.walletA,
				valueWei: "3500000000000000",
				type: "call",
				traceId: "0",
				isError: false,
			},
		],
	},
];

// --- Polygon PoS (137) -----------------------------------------------------
// Wallet B holds POL. Two transfers predate the MATIC → POL redenomination of 2024-09-04T12:00:00Z
// (research §1.4) and two follow it; both eras are native 18-dp units of the same chain balance.

export const POLYGON_TRANSACTIONS = [
	{
		label: "MATIC era: 5 MATIC into wallet B",
		hash: HASHES.polyMaticIn,
		blockNumber: 58_200_000,
		time: "2024-07-15T09:00:00Z",
		from: ADDRESSES.polyFunder,
		to: ADDRESSES.walletB,
		valueWei: "5000000000000000000",
		gasUsed: 21000,
		gasPriceWei: "30000000000",
		type: "0x2",
		isError: false,
		methodId: "0x",
		functionName: "",
		contractAddress: "",
		tokenTransfers: [],
	},
	{
		label: "MATIC era: wallet B sends 2 MATIC",
		hash: HASHES.polyMaticOut,
		blockNumber: 59_400_000,
		time: "2024-08-01T07:30:00Z",
		from: ADDRESSES.walletB,
		to: ADDRESSES.polyRecipient,
		valueWei: "2000000000000000000",
		gasUsed: 21000,
		gasPriceWei: "30000000000",
		type: "0x2",
		isError: false,
		methodId: "0x",
		functionName: "",
		contractAddress: "",
		tokenTransfers: [],
	},
	{
		label: "POL era: 14 POL into wallet B",
		hash: HASHES.polyPolIn,
		blockNumber: 71_500_000,
		time: "2025-05-20T13:10:00Z",
		from: ADDRESSES.polyFunder,
		to: ADDRESSES.walletB,
		valueWei: "14000000000000000000",
		gasUsed: 21000,
		gasPriceWei: "30000000000",
		type: "0x2",
		isError: false,
		methodId: "0x",
		functionName: "",
		contractAddress: "",
		tokenTransfers: [],
	},
	{
		label: "POL era: wallet B sends 4 POL",
		hash: HASHES.polyPolOut,
		blockNumber: 72_600_000,
		time: "2025-06-02T09:45:00Z",
		from: ADDRESSES.walletB,
		to: ADDRESSES.polyRecipient,
		valueWei: "4000000000000000000",
		gasUsed: 21000,
		gasPriceWei: "30000000000",
		type: "0x2",
		isError: false,
		methodId: "0x",
		functionName: "",
		contractAddress: "",
		tokenTransfers: [],
	},
];

// --- BNB Smart Chain (56) -------------------------------------------------
// Both receipts are Binance withdrawals on network BSC, so their txIds must equal the on-chain
// hashes. BSC USDT is the 18-decimal Binance-Peg contract (research §1.5, §1.6).

export const BSC_TRANSACTIONS = [
	{
		label: "binance withdrawal: 250 USDT into wallet A on BSC",
		hash: HASHES.binanceToWalletABscUsdt,
		blockNumber: 46_800_000,
		time: "2025-05-20T09:40:00Z",
		from: ADDRESSES.binanceBscHotWallet,
		to: ADDRESSES.walletA,
		valueWei: "0",
		gasUsed: 51000,
		gasPriceWei: "3000000000",
		type: "0x2",
		isError: false,
		methodId: "0xa9059cbb",
		functionName: "transfer(address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			tokenLeg(
				56,
				ADDRESSES.bscUsdt,
				ADDRESSES.binanceBscHotWallet,
				ADDRESSES.walletA,
				"250000000000000000000",
			),
		],
	},
	{
		label: "binance withdrawal: 0.05 BNB into wallet A on BSC",
		hash: HASHES.binanceToWalletABscBnb,
		blockNumber: 46_800_100,
		time: "2025-05-20T09:42:00Z",
		from: ADDRESSES.binanceBscHotWallet,
		to: ADDRESSES.walletA,
		valueWei: "50000000000000000",
		gasUsed: 21000,
		gasPriceWei: "3000000000",
		type: "0x2",
		isError: false,
		methodId: "0x",
		functionName: "",
		contractAddress: "",
		tokenTransfers: [],
	},
	{
		label: "wallet A sends 25 USDT on BSC",
		hash: HASHES.bscUsdtOut,
		blockNumber: 52_100_000,
		time: "2025-10-02T08:30:00Z",
		from: ADDRESSES.walletA,
		to: ADDRESSES.bscRecipient,
		valueWei: "0",
		gasUsed: 51000,
		gasPriceWei: "3000000000",
		type: "0x2",
		isError: false,
		methodId: "0xa9059cbb",
		functionName: "transfer(address,uint256)",
		contractAddress: "",
		tokenTransfers: [
			tokenLeg(
				56,
				ADDRESSES.bscUsdt,
				ADDRESSES.walletA,
				ADDRESSES.bscRecipient,
				"25000000000000000000",
			),
		],
	},
];

export const CHAIN_TRANSACTIONS = {
	1: EVM_TRANSACTIONS,
	8453: BASE_TRANSACTIONS,
	42161: ARBITRUM_TRANSACTIONS,
	137: POLYGON_TRANSACTIONS,
	56: BSC_TRANSACTIONS,
};

export function chainTransactions(chainId, { bigHistory = false } = {}) {
	const base = CHAIN_TRANSACTIONS[chainId] ?? [];
	if (bigHistory && chainId === 1)
		return [...base, ...bigHistoryTransactions()];
	return base;
}

// --- Binance ---------------------------------------------------------------
// The P2P buy lands in the funding wallet. The user then moves most of it to spot with an
// internal transfer, which has no read endpoint (research §1.7), so the fixture records it here
// and the README documents it as a total-neutral move.

export const P2P_BUY = {
	orderNumber: "22449801234567890123",
	advNo: "11218246497340923904",
	tradeType: "BUY",
	asset: "USDT",
	fiat: "INR",
	fiatSymbol: "\u20b9",
	amount: "5000.00000000",
	totalPrice: "442500.00000000",
	unitPrice: "88.50",
	orderStatus: "COMPLETED",
	createTime: ms("2025-04-08T09:12:37Z"),
	commission: "0",
	counterPartNickName: "mock-counterparty",
	payMethodName: "UPI",
	additionalKycVerify: 0,
	takerCommissionRate: "0",
	takerCommission: "0",
	takerAmount: "5000.00000000",
	advertisementRole: "TAKER",
};

export const INTERNAL_TRANSFERS = [
	{
		from: "funding",
		to: "spot",
		asset: "USDT",
		amount: "4990.00000000",
		time: ms("2025-04-08T09:40:00Z"),
	},
];

export const BINANCE_TRADES = [
	{
		base: "ETH",
		quote: "USDT",
		raw: {
			symbol: "ETHUSDT",
			id: 1001,
			orderId: 5001001,
			orderListId: -1,
			price: "2512.40000000",
			qty: "0.80000000",
			quoteQty: "2009.92000000",
			commission: "0.00080000",
			commissionAsset: "ETH",
			time: ms("2025-04-15T10:02:11.240Z"),
			isBuyer: true,
			isMaker: false,
			isBestMatch: true,
		},
	},
	{
		base: "ETH",
		quote: "USDT",
		raw: {
			symbol: "ETHUSDT",
			id: 1002,
			orderId: 5001001,
			orderListId: -1,
			price: "2513.90000000",
			qty: "0.70000000",
			quoteQty: "1759.73000000",
			commission: "1.75973000",
			commissionAsset: "USDT",
			time: ms("2025-04-15T10:02:11.612Z"),
			isBuyer: true,
			isMaker: false,
			isBestMatch: true,
		},
	},
	{
		base: "ETH",
		quote: "USDT",
		raw: {
			symbol: "ETHUSDT",
			id: 1003,
			orderId: 5001002,
			orderListId: -1,
			price: "2504.75000000",
			qty: "0.30000000",
			quoteQty: "751.42500000",
			commission: "0.75142500",
			commissionAsset: "USDT",
			time: ms("2025-04-15T13:40:52.055Z"),
			isBuyer: true,
			isMaker: false,
			isBestMatch: true,
		},
	},
	{
		base: "ETH",
		quote: "USDT",
		raw: {
			symbol: "ETHUSDT",
			id: 1101,
			orderId: 5101001,
			orderListId: -1,
			price: "2960.55000000",
			qty: "0.40000000",
			quoteQty: "1184.22000000",
			commission: "0.00005200",
			commissionAsset: "BNB",
			time: ms("2026-01-20T09:15:03.101Z"),
			isBuyer: false,
			isMaker: true,
			isBestMatch: true,
		},
	},
	{
		base: "ETH",
		quote: "USDT",
		raw: {
			symbol: "ETHUSDT",
			id: 1102,
			orderId: 5101001,
			orderListId: -1,
			price: "2961.90000000",
			qty: "0.20000000",
			quoteQty: "592.38000000",
			commission: "0.00002600",
			commissionAsset: "BNB",
			time: ms("2026-01-20T09:15:03.487Z"),
			isBuyer: false,
			isMaker: true,
			isBestMatch: true,
		},
	},
];

// `amount` is the quantity that ARRIVES at `address`; `transactionFee` is charged on top of it, so
// the spot balance drops by amount + transactionFee and the on-chain transfer carries exactly
// `amount` (research §1.3 leaves this unverified; the fixture pins it as the lead decision).
export const BINANCE_WITHDRAWALS = [
	{
		id: "5d1c7a9e3b2468f0a1c5e7d9b3f24680",
		amount: "0.50000000",
		transactionFee: "0.00180000",
		coin: "ETH",
		status: 6,
		address: ADDRESSES.walletA,
		txId: HASHES.binanceToWalletA,
		applyTime: "2025-05-02 08:11:40",
		network: "ETH",
		transferType: 0,
		withdrawOrderId: "mock-withdraw-1",
		info: '{"withdrawOrderId":"mock-withdraw-1"}',
		confirmNo: 12,
		walletType: 0,
		txKey: "",
		completeTime: "2025-05-02 08:14:23",
	},
	{
		id: "b4e8d2a6c1f73950e8b4d2a6c1f73950",
		amount: "0.02000000",
		transactionFee: "0.00050000",
		coin: "ETH",
		status: 6,
		address: ADDRESSES.walletA,
		txId: HASHES.binanceToWalletABase,
		applyTime: "2025-05-20 09:10:12",
		network: "BASE",
		transferType: 0,
		withdrawOrderId: "mock-withdraw-2",
		info: '{"withdrawOrderId":"mock-withdraw-2"}',
		confirmNo: 12,
		walletType: 0,
		txKey: "",
		completeTime: "2025-05-20 09:12:44",
	},
	{
		id: "a7c2f9e4b8d13570a2c7f9e4b8d13570",
		amount: "250.00000000",
		transactionFee: "1.00000000",
		coin: "USDT",
		status: 6,
		address: ADDRESSES.walletA,
		txId: HASHES.binanceToWalletABscUsdt,
		applyTime: "2025-05-20 09:38:02",
		network: "BSC",
		transferType: 0,
		withdrawOrderId: "mock-withdraw-3",
		info: '{"withdrawOrderId":"mock-withdraw-3"}',
		confirmNo: 15,
		walletType: 0,
		txKey: "",
		completeTime: "2025-05-20 09:40:00",
	},
	{
		id: "c9d4a1f7e3b62580c9d4a1f7e3b62580",
		amount: "0.05000000",
		transactionFee: "0.00050000",
		coin: "BNB",
		status: 6,
		address: ADDRESSES.walletA,
		txId: HASHES.binanceToWalletABscBnb,
		applyTime: "2025-05-20 09:40:31",
		network: "BSC",
		transferType: 0,
		withdrawOrderId: "mock-withdraw-4",
		info: '{"withdrawOrderId":"mock-withdraw-4"}',
		confirmNo: 15,
		walletType: 0,
		txKey: "",
		completeTime: "2025-05-20 09:42:00",
	},
	{
		id: "7f3b8c1d5e2a4b6c8d0e2f4a6b8c0d2e",
		amount: "100.00000000",
		transactionFee: "1.00000000",
		coin: "USDT",
		status: 4,
		address: ADDRESSES.walletA,
		txId: "",
		applyTime: "2026-03-02 19:04:11",
		network: "ETH",
		transferType: 0,
		info: "{}",
		confirmNo: 0,
		walletType: 0,
		txKey: "",
	},
];

export const BINANCE_DEPOSITS = [
	{
		id: "769800519366885377",
		amount: "2.10000000",
		coin: "XRP",
		network: "XRP",
		status: 1,
		address: "rMOCKxrpFixture9Qd4fZ2Lk8Tn6Vb3Ws",
		addressTag: "",
		txId: HASHES.xrpDeposit,
		insertTime: ms("2025-10-01T06:15:00Z"),
		completeTime: ms("2025-10-01T06:16:10Z"),
		transferType: 0,
		confirmTimes: "1/1",
		unlockConfirm: 0,
		walletType: 0,
		travelRuleStatus: 0,
	},
	{
		id: "769800519366885401",
		amount: "25.00000000",
		coin: "USDC",
		network: "ETH",
		status: 0,
		address: ADDRESSES.binanceDeposit,
		addressTag: "",
		txId: HASHES.pendingUsdcDeposit,
		insertTime: ms("2026-02-05T21:44:02Z"),
		transferType: 0,
		confirmTimes: "0/12",
		unlockConfirm: 0,
		walletType: 0,
		travelRuleStatus: 0,
	},
	{
		id: "769800519366885390",
		amount: "120.00000000",
		coin: "USDC",
		network: "ETH",
		status: 1,
		address: ADDRESSES.binanceDeposit,
		addressTag: "",
		txId: HASHES.walletBToBinance,
		insertTime: ms("2025-12-12T12:39:51Z"),
		completeTime: ms("2025-12-12T12:41:03Z"),
		transferType: 0,
		confirmTimes: "12/12",
		unlockConfirm: 0,
		walletType: 0,
		travelRuleStatus: 0,
	},
];

// The single income feed: every reward that moves a balance appears here, including the Simple
// Earn interest that the rewards endpoint also lists for audit (research §1.3 overlap warning).
export const BINANCE_DIVIDENDS = [
	{
		id: 1637366104,
		amount: "0.06000000",
		asset: "BNB",
		divTime: ms("2025-06-20T04:00:00Z"),
		enInfo: "BNB Vault rewards",
		tranId: 2968885920,
		direction: 1,
	},
	{
		id: 1637366105,
		amount: "0.42000000",
		asset: "USDT",
		divTime: ms("2025-12-01T00:00:00Z"),
		enInfo: "Simple Earn Flexible Interest",
		tranId: 2968885921,
		direction: 1,
	},
];

// The Simple Earn rewards feed repeats the USDT interest above for audit. It is not a second
// receipt: the dividend row is the income, and `binanceBalances()` credits it once.
export const BINANCE_EARN_REWARDS = [
	{
		asset: "USDT",
		rewards: "0.42000000",
		projectId: "USDT001",
		type: "REWARDS",
		time: ms("2025-12-01T00:00:00Z"),
		dividendId: 1637366105,
	},
];

// Earn positions count toward the total-wallet balance check (research §1.7). Subscriptions have no
// read endpoint, so the fixture records the spot → earn move the same way it records internal
// transfers: the position list and the subscription list must agree, and check-fixture.mjs asserts
// that they do.
export const EARN_SUBSCRIPTIONS = [
	{
		wallet: "spot",
		to: "earn",
		asset: "USDT",
		amount: "100.00000000",
		time: ms("2025-09-15T06:00:00Z"),
	},
	{
		wallet: "spot",
		to: "earn",
		asset: "ETH",
		amount: "0.02000000",
		time: ms("2026-02-01T07:30:00Z"),
	},
];

export const BINANCE_EARN_POSITIONS = {
	flexible: [
		{
			asset: "USDT",
			productId: "USDT001",
			productName: "USDT Flexible",
			totalAmount: "100.00000000",
			tierAnnualPercentageRate: { "0-1000": "0.04120000" },
			latestAnnualPercentageRate: "0.04120000",
			dailyPercentageRate: "0.00011288",
			cumulativeBonusRewards: "0.00000000",
			cumulativeRealTimeRewards: "0.00000000",
			cumulativeTotalRewards: "0.42000000",
			canRedeem: true,
			collateralAmount: "0.00000000",
			automaticSubscribe: false,
		},
	],
	locked: [
		{
			positionId: 9001,
			projectId: "ETH120",
			asset: "ETH",
			amount: "0.02000000",
			purchaseTime: ms("2026-02-01T07:30:00Z"),
			duration: 120,
			accrualDays: 59,
			rewardAmt: "0.00000000",
			rewardsAsset: "ETH",
			extraRewards: "0.00000000",
			extraRewardsAsset: "ETH",
			status: "HOLDING",
			subscriptionStartTime: ms("2026-02-01T07:30:00Z"),
			type: "AUTO",
			autoSubscribe: false,
		},
	],
};

export const BINANCE_DUST = [
	{
		operateTime: ms("2025-11-05T03:00:00Z"),
		totalTransferedAmount: "0.00013200",
		totalServiceChargeAmount: "0.00000270",
		transId: 45178372831,
		userAssetDribbletDetails: [
			{
				transId: 4359321,
				serviceChargeAmount: "0.00000270",
				amount: "2.10000000",
				operateTime: ms("2025-11-05T03:00:00Z"),
				transferedAmount: "0.00013200",
				fromAsset: "XRP",
				targetAsset: "BNB",
			},
		],
	},
];

export const BINANCE_CONVERTS = [
	{
		quoteId: "mock-quote-1",
		orderId: 9834211,
		orderStatus: "SUCCESS",
		fromAsset: "USDT",
		fromAmount: "25.00000000",
		toAsset: "USDC",
		toAmount: "24.98000000",
		ratio: "0.99920000",
		inverseRatio: "1.00080064",
		createTime: ms("2025-11-28T15:20:31Z"),
	},
	{
		quoteId: "mock-quote-2",
		orderId: 9835999,
		orderStatus: "FAILED",
		fromAsset: "USDT",
		fromAmount: "10.00000000",
		toAsset: "BNB",
		toAmount: "0.01660000",
		ratio: "0.00166000",
		inverseRatio: "602.40963855",
		createTime: ms("2026-01-05T11:02:00Z"),
	},
];

export const BINANCE_FIAT_ORDERS = [
	{
		orderNo: "fiat-order-1",
		transactionType: 0,
		fiatCurrency: "INR",
		indicatedAmount: "250000.00",
		amount: "250000.00",
		totalFee: "0.00",
		method: "Bank Transfer",
		status: "Completed",
		createTime: ms("2025-04-07T05:30:00Z"),
		updateTime: ms("2025-04-07T06:02:00Z"),
	},
	{
		orderNo: "fiat-order-2",
		transactionType: 1,
		fiatCurrency: "INR",
		indicatedAmount: "50000.00",
		amount: "50000.00",
		totalFee: "5.00",
		method: "Bank Transfer",
		status: "Completed",
		createTime: ms("2026-02-18T10:12:00Z"),
		updateTime: ms("2026-02-18T10:40:00Z"),
	},
];

export const BINANCE_C2C_CANCELLED = {
	orderNumber: "22449801234567890124",
	advNo: "11218246497340923905",
	tradeType: "BUY",
	asset: "USDT",
	fiat: "INR",
	fiatSymbol: "\u20b9",
	amount: "500.00000000",
	totalPrice: "44300.00000000",
	unitPrice: "88.60",
	orderStatus: "CANCELLED",
	createTime: ms("2025-04-08T09:20:00Z"),
	commission: "0",
	counterPartNickName: "mock-counterparty-2",
	payMethodName: "UPI",
	additionalKycVerify: 0,
	takerCommissionRate: "0",
	takerCommission: "0",
	takerAmount: "500.00000000",
	advertisementRole: "TAKER",
};

export const BINANCE_COIN_CONFIG = [
	{
		coin: "ETH",
		depositAllEnable: true,
		withdrawAllEnable: true,
		name: "Ethereum",
		free: "0",
		locked: "0",
		networkList: [
			{
				network: "ETH",
				coin: "ETH",
				withdrawIntegerMultiple: "0.00000001",
				isDefault: true,
				depositEnable: true,
				withdrawEnable: true,
				contractAddress: "",
				withdrawFee: "0.00180000",
				withdrawMin: "0.00500000",
			},
			{
				network: "BASE",
				coin: "ETH",
				withdrawIntegerMultiple: "0.00000001",
				isDefault: false,
				depositEnable: true,
				withdrawEnable: true,
				contractAddress: "",
				withdrawFee: "0.00050000",
				withdrawMin: "0.00050000",
			},
		],
	},
	{
		coin: "USDC",
		depositAllEnable: true,
		withdrawAllEnable: true,
		name: "USD Coin",
		free: "0",
		locked: "0",
		networkList: [
			{
				network: "ETH",
				coin: "USDC",
				withdrawIntegerMultiple: "0.00000100",
				isDefault: true,
				depositEnable: true,
				withdrawEnable: true,
				contractAddress: ADDRESSES.usdcContract,
				withdrawFee: "1.00000000",
				withdrawMin: "5.00000000",
			},
			{
				network: "BASE",
				coin: "USDC",
				withdrawIntegerMultiple: "0.00000100",
				isDefault: false,
				depositEnable: true,
				withdrawEnable: true,
				contractAddress: ADDRESSES.baseUsdc,
				withdrawFee: "1.00000000",
				withdrawMin: "5.00000000",
			},
		],
	},
	{
		coin: "USDT",
		depositAllEnable: true,
		withdrawAllEnable: true,
		name: "TetherUS",
		free: "0",
		locked: "0",
		networkList: [
			{
				network: "ETH",
				coin: "USDT",
				withdrawIntegerMultiple: "0.00000100",
				isDefault: true,
				depositEnable: true,
				withdrawEnable: true,
				contractAddress: ADDRESSES.usdtContract,
				withdrawFee: "1.00000000",
				withdrawMin: "5.00000000",
			},
			{
				network: "BSC",
				coin: "USDT",
				withdrawIntegerMultiple: "0.00000100",
				isDefault: false,
				depositEnable: true,
				withdrawEnable: true,
				contractAddress: ADDRESSES.bscUsdt,
				withdrawFee: "1.00000000",
				withdrawMin: "5.00000000",
			},
		],
	},
	{
		coin: "BNB",
		depositAllEnable: true,
		withdrawAllEnable: true,
		name: "BNB",
		free: "0",
		locked: "0",
		networkList: [
			{
				network: "BSC",
				coin: "BNB",
				withdrawIntegerMultiple: "0.00000001",
				isDefault: true,
				depositEnable: true,
				withdrawEnable: true,
				contractAddress: "",
				withdrawFee: "0.00050000",
				withdrawMin: "0.00100000",
			},
		],
	},
];

// --- Balances implied by the events ----------------------------------------
// The server serves these; tools/mock-sync/check-fixture.mjs replays the same events with its
// own arithmetic and asserts they match what the endpoints return.

export const ASSET_DECIMALS = {
	ETH: 18,
	BNB: 18,
	BTC: 8,
	USDT: 6,
	USDC: 6,
	XRP: 6,
	POL: 18,
	MATIC: 18,
	INR: 2,
};

function bump(map, key, units) {
	map.set(key, (map.get(key) ?? 0n) + units);
}

function bumpNested(map, address, asset, units) {
	const byAsset = map.get(address) ?? new Map();
	map.set(address, byAsset);
	bump(byAsset, asset, units);
}

export function binanceBalances() {
	const spot = new Map();
	const funding = new Map();
	const earn = new Map();

	bump(funding, "USDT", toUnits(P2P_BUY.amount));
	for (const move of INTERNAL_TRANSFERS) {
		bump(funding, move.asset, -toUnits(move.amount));
		bump(spot, move.asset, toUnits(move.amount));
	}

	for (const trade of BINANCE_TRADES) {
		const { raw, base, quote } = trade;
		const sign = raw.isBuyer ? 1n : -1n;
		bump(spot, base, sign * toUnits(raw.qty));
		bump(spot, quote, -sign * toUnits(raw.quoteQty));
		bump(spot, raw.commissionAsset, -toUnits(raw.commission));
	}

	for (const deposit of BINANCE_DEPOSITS) {
		if (deposit.status === 1 || deposit.status === 6)
			bump(spot, deposit.coin, toUnits(deposit.amount));
	}

	// `amount` arrives on chain, `transactionFee` is charged on top, so both leave the spot wallet.
	for (const withdrawal of BINANCE_WITHDRAWALS) {
		if (withdrawal.status !== 6) continue;
		bump(
			spot,
			withdrawal.coin,
			-(toUnits(withdrawal.amount) + toUnits(withdrawal.transactionFee)),
		);
	}

	for (const subscription of EARN_SUBSCRIPTIONS) {
		bump(spot, subscription.asset, -toUnits(subscription.amount));
		bump(earn, subscription.asset, toUnits(subscription.amount));
	}

	// The dividend feed is the only income source: the Simple Earn reward appears here once and is
	// deliberately not added again from BINANCE_EARN_REWARDS.
	for (const dividend of BINANCE_DIVIDENDS)
		bump(spot, dividend.asset, toUnits(dividend.amount));

	for (const dribblet of BINANCE_DUST) {
		for (const detail of dribblet.userAssetDribbletDetails) {
			bump(spot, detail.fromAsset, -toUnits(detail.amount));
			bump(spot, detail.targetAsset, toUnits(detail.transferedAmount));
		}
	}

	for (const convert of BINANCE_CONVERTS) {
		if (convert.orderStatus !== "SUCCESS") continue;
		bump(spot, convert.fromAsset, -toUnits(convert.fromAmount));
		bump(spot, convert.toAsset, toUnits(convert.toAmount));
	}

	for (const reward of BINANCE_EARN_REWARDS) {
		// Audit-only: the matching dividend row above already credited the balance.
		if (!BINANCE_DIVIDENDS.some((row) => row.id === reward.dividendId))
			throw new Error(
				`Earn reward ${reward.asset} ${reward.time} has no matching dividend`,
			);
	}

	return { spot, funding, earn };
}

// Replays one chain's events. Gas is charged to the sender, plus the OP-stack `l1Fee` where the
// receipt carries one (Base). Internal call value moves native currency like an external transfer.
export function evmBalances(transactions = EVM_TRANSACTIONS) {
	const native = new Map();
	const tokens = new Map();
	const own = new Set(OWN_ADDRESSES);
	for (const address of OWN_ADDRESSES) {
		native.set(address, 0n);
		tokens.set(address, new Map());
	}

	for (const tx of transactions) {
		const value = BigInt(tx.valueWei);
		if (!tx.isError) {
			if (own.has(tx.from)) bump(native, tx.from, -value);
			if (own.has(tx.to)) bump(native, tx.to, value);
			for (const call of tx.internalCalls ?? []) {
				const callValue = BigInt(call.valueWei);
				if (own.has(call.from)) bump(native, call.from, -callValue);
				if (own.has(call.to)) bump(native, call.to, callValue);
			}
		}
		if (own.has(tx.from)) {
			const gas = BigInt(tx.gasUsed) * BigInt(tx.gasPriceWei);
			bump(native, tx.from, -(gas + BigInt(tx.l1FeeWei ?? "0")));
		}
		for (const transfer of tx.tokenTransfers) {
			if (own.has(transfer.from))
				bumpNested(
					tokens,
					transfer.from,
					transfer.contract,
					-BigInt(transfer.valueUnits),
				);
			if (own.has(transfer.to))
				bumpNested(
					tokens,
					transfer.to,
					transfer.contract,
					BigInt(transfer.valueUnits),
				);
		}
	}
	return { native, tokens };
}

export function coindcxBalances() {
	const crypto = new Map();
	for (const trade of COINDCX_TRADES) {
		const quantity = toUnits(trade.quantity);
		bump(crypto, trade.base, trade.side === "buy" ? quantity : -quantity);
	}
	// The INR wallet is funded outside the sync (bank deposit) and only pays for the trades, so
	// it is reported at zero: fiat is not a ledger asset and the balance check ignores it.
	return { crypto, quote: { asset: "INR", units: 0n } };
}

export function allFixtures() {
	const evm = {};
	for (const chainId of Object.keys(CHAINS))
		evm[chainId] = evmBalances(chainTransactions(Number(chainId)));
	return {
		binance: binanceBalances(),
		evm,
		coindcx: coindcxBalances(),
	};
}

// --- Daily prices ----------------------------------------------------------
// One deterministic series feeds both the Binance klines and CoinGecko, so the two sources
// agree. Values are BigInt in 1e-8 USD, never a float.

export const PRICE_SERIES = {
	BTCUSDT: { asset: "BTC", baseUnits: 8200000000000n, trendBpPerDay: 7 },
	ETHUSDT: { asset: "ETH", baseUnits: 260000000000n, trendBpPerDay: 6 },
	BNBUSDT: { asset: "BNB", baseUnits: 58000000000n, trendBpPerDay: 3 },
};

export const COINGECKO_IDS = {
	bitcoin: "BTCUSDT",
	ethereum: "ETHUSDT",
	binancecoin: "BNBUSDT",
	"usd-coin": null,
	tether: null,
	ripple: null,
};

export const COINGECKO_USD_INR = 88n;

export const PRICE_FIRST_DAY = "2025-04-01";
export const PRICE_LAST_DAY = "2026-03-31";

function hashInt(text) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

function dayIndex(dateIso) {
	const day = Date.parse(`${dateIso}T00:00:00Z`);
	const first = Date.parse(`${PRICE_FIRST_DAY}T00:00:00Z`);
	return Math.round((day - first) / 86_400_000);
}

// A ±8% deterministic wobble around a straight trend, in basis points.
function swingBp(symbol, index) {
	return (hashInt(`${symbol}:${index}`) % 1601) - 800;
}

export function priceUnits(symbol, dateIso) {
	const series = PRICE_SERIES[symbol];
	if (!series) return 100000000n;
	const index = Math.max(-400, Math.min(1200, dayIndex(dateIso)));
	const factor =
		10000n +
		BigInt(series.trendBpPerDay * index) +
		BigInt(swingBp(symbol, index));
	return (series.baseUnits * factor) / 10000n;
}

export function priceUnitsByAsset(asset, dateIso) {
	if (asset === "USDC" || asset === "USDT") return 100000000n;
	for (const [symbol, series] of Object.entries(PRICE_SERIES))
		if (series.asset === asset) return priceUnits(symbol, dateIso);
	return priceUnits("BTCUSDT", dateIso);
}

export function formatPrice(units) {
	return formatUnits(units, 8);
}

export function isoDay(date) {
	return new Date(date).toISOString().slice(0, 10);
}

export function eachDay(firstIso, lastIso) {
	const days = [];
	const last = Date.parse(`${lastIso}T00:00:00Z`);
	for (
		let cursor = Date.parse(`${firstIso}T00:00:00Z`);
		cursor <= last;
		cursor += 86_400_000
	)
		days.push(isoDay(cursor));
	return days;
}

// --- CoinDCX ---------------------------------------------------------------
// Amounts are JSON numbers in the real API; the server converts these strings at the edge.

export const COINDCX_TRADES = [
	{
		id: 252949810,
		order_id: "284195365",
		side: "buy",
		fee_amount: "11.4",
		ecode: "I",
		quantity: "0.0015",
		price: "7600000",
		symbol: "BTCINR",
		base: "BTC",
		quote: "INR",
		timestamp: ms("2025-05-20T11:00:00Z"),
	},
	{
		id: 252950144,
		order_id: "284197702",
		side: "buy",
		fee_amount: "12.75",
		ecode: "I",
		quantity: "0.05",
		price: "255000",
		symbol: "ETHINR",
		base: "ETH",
		quote: "INR",
		timestamp: ms("2025-07-11T09:30:00Z"),
	},
	{
		id: 252961300,
		order_id: "284236118",
		side: "sell",
		fee_amount: "8.4",
		ecode: "I",
		quantity: "0.001",
		price: "8400000",
		symbol: "BTCINR",
		base: "BTC",
		quote: "INR",
		timestamp: ms("2025-09-22T14:45:00Z"),
	},
	{
		id: 252977421,
		order_id: "284281004",
		side: "buy",
		fee_amount: "7.38",
		ecode: "I",
		quantity: "0.03",
		price: "246000",
		symbol: "ETHINR",
		base: "ETH",
		quote: "INR",
		timestamp: ms("2025-11-03T07:05:00Z"),
	},
];

export const COINDCX_MARKETS = [
	{
		coindcx_name: "BTCINR",
		base_currency_short_name: "INR",
		target_currency_short_name: "BTC",
		symbol: "BTCINR",
		ecode: "I",
		pair: "BTCINR",
		status: "active",
	},
	{
		coindcx_name: "ETHINR",
		base_currency_short_name: "INR",
		target_currency_short_name: "ETH",
		symbol: "ETHINR",
		ecode: "I",
		pair: "ETHINR",
		status: "active",
	},
];
// The P2P buy lands in the funding wallet. The user then moves most of it to spot
// with an internal transfer, which has no read endpoint (research §1.7), so the fixture
// records it here and the README documents it as a total-neutral move.
