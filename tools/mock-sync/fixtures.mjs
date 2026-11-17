// One coherent fixture user for the mock-sync server: the raw events, the vendor payloads built
// from them, and the balances those events imply. Amounts are decimal strings here and BigInt
// units everywhere else, so no float ever touches a ledger amount.

import { createHash } from "node:crypto";

export const DATA_NOW = "2026-04-01T00:00:00.000Z";

export const FY = { start: "2025-04-01", end: "2026-03-31" };

export const CREDENTIALS = {
	binance: { apiKey: "mock-binance-key", secret: "mock-binance-secret" },
	coindcx: { apiKey: "mock-dcx-key", secret: "mock-dcx-secret" },
	etherscan: { apiKey: "mock-etherscan-key" },
	blockscout: { apiKey: "mock-blockscout-key" },
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
		label: "binance withdrawal: 0.4982 ETH into wallet A",
		hash: HASHES.binanceToWalletA,
		blockNumber: 22310000,
		time: "2025-05-02T08:14:23Z",
		from: ADDRESSES.binanceHotWallet,
		to: ADDRESSES.walletA,
		valueWei: "498200000000000000",
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
];

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

export const BINANCE_EARN_REWARDS = [
	{
		asset: "USDT",
		rewards: "0.42000000",
		projectId: "USDT001",
		type: "REWARDS",
		time: ms("2025-12-01T00:00:00Z"),
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

	for (const withdrawal of BINANCE_WITHDRAWALS) {
		if (withdrawal.status === 6)
			bump(spot, withdrawal.coin, -toUnits(withdrawal.amount));
	}

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

	for (const reward of BINANCE_EARN_REWARDS)
		bump(spot, reward.asset, toUnits(reward.rewards));

	return { spot, funding };
}

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
		}
		if (own.has(tx.from))
			bump(native, tx.from, -(BigInt(tx.gasUsed) * BigInt(tx.gasPriceWei)));
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
	return {
		binance: binanceBalances(),
		evm: evmBalances(),
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
