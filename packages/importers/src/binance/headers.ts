export const BINANCE_HEADERS = {
	trade: ["Date(UTC)", "Pair", "Side", "Price", "Executed", "Amount", "Fee"],
	oldTrade: [
		"Date(UTC)",
		"Market",
		"Type",
		"Price",
		"Amount",
		"Total",
		"Fee",
		"Fee Coin",
	],
	statement: ["UTC_Time", "Account", "Operation", "Coin", "Change", "Remark"],
	wallet: ["Coin", "Amount", "TXID", "Status"],
};
export const BINANCE_INCOME: Record<
	string,
	"interest" | "staking" | "airdrop" | "referral" | "mining"
> = Object.fromEntries([
	...[
		"Simple Earn Flexible Interest",
		"Savings Interest",
		"Savings distribution",
		"Pool Distribution",
		"Launchpool Interest",
	].map((v) => [v, "interest"]),
	...[
		"Staking Rewards",
		"ETH 2.0 Staking Rewards",
		"Simple Earn Locked Rewards",
		"POS savings interest",
		"BNB Vault Rewards",
		"Swap Farming Rewards",
		"Liquid Swap rewards",
	].map((v) => [v, "staking"]),
	...[
		"Airdrop Assets",
		"Distribution",
		"Simple Earn Flexible Airdrop",
		"HODLer Airdrops Distribution",
		"Launchpool Airdrop",
		"Megadrop Rewards",
		"Cash Voucher distribution",
		"Campaign Related Reward",
	].map((v) => [v, "airdrop"]),
	...[
		"Commission Rebate",
		"Commission History",
		"Referral Kickback",
		"Referral Commission",
		"Referrer rebates",
		"Commission Fee Shared With You",
	].map((v) => [v, "referral"]),
	["Super BNB Mining", "mining"],
]) as Record<
	string,
	"interest" | "staking" | "airdrop" | "referral" | "mining"
>;
export const STATEMENT_OVERLAP = new Set([
	"Transaction Buy",
	"Transaction Spend",
	"Transaction Fee",
	"Transaction Sold",
	"Transaction Revenue",
	"Transaction Related",
	"Buy",
	"Sell",
	"Fee",
	"Deposit",
	"Withdraw",
	"Fiat Deposit",
	"Fiat Withdraw",
	"Fiat Withdrawal",
	"Send",
	"Buy Crypto",
]);
