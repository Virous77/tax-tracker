export const DEMO_SAMPLES = {
	"binance-spot-trades.SYNTHETIC.csv": {
		label: "Binance Spot Trades",
		csv: `Date(UTC),Pair,Side,Price,Executed,Amount,Fee
2025-06-03 09:20:00,USDTINR,BUY,86,500USDT,43000INR,0.5USDT
2025-06-05 12:15:00,BTCUSDT,BUY,105000,0.003BTC,315USDT,0.000003BTC
2025-12-03 10:00:00,BTCUSDT,SELL,115000,0.002BTC,230USDT,0.23USDT
2025-12-05 13:30:00,USDTINR,SELL,90,200USDT,18000INR,18INR
`,
	},
	"coindcx-order-history.SYNTHETIC.csv": {
		label: "CoinDCX Order History",
		csv: `Order ID,Market,Pair,Total Quantity,Remaining Quantity,Price Per Unit,Avg Price,Fee Amount,Total Tds INR,Side,Order Type,Status,Exchange Code,Created At,Updated At
90000001,ETHINR,I-ETH_INR,0.25,0,220000,220000,275,,buy,limit_order,filled,I,2025-07-07 09:00:00 UTC,2025-07-07 09:00:05 UTC
90000002,ETHINR,I-ETH_INR,0.20,0,275000,275000,275,550,sell,limit_order,filled,I,2026-01-06 11:30:00 UTC,2026-01-06 11:30:04 UTC
`,
	},
	"us-stocks-trades.SYNTHETIC.csv": {
		label: "US Stocks Trades & Dividends",
		csv: `Date,Action,Symbol,Company,Quantity,Price,Fee,Total,Tax Withheld,Currency,ID
2023-05-15,Buy,AAPL,APPLE INC,20,172.07,1.00,-3442.40,,USD,demo-us-001
2025-09-15,Dividend,AAPL,APPLE INC,,,,4.80,1.20,USD,demo-us-002
2025-11-12,Sell,AAPL,APPLE INC,8,268.10,0.02,2144.78,,USD,demo-us-003
`,
	},
};

export function findDemoSample(name: string) {
	return Object.hasOwn(DEMO_SAMPLES, name)
		? DEMO_SAMPLES[name as keyof typeof DEMO_SAMPLES]
		: undefined;
}
