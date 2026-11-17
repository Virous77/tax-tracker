import { describe, expect, it } from "vitest";
import {
	discoverSymbols,
	mapBinanceConvert,
	mapBinanceDeposit,
	mapBinanceDividend,
	mapBinanceDust,
	mapBinanceEarnAudit,
	mapBinanceFiatOrder,
	mapBinanceFiatPayment,
	mapBinanceP2p,
	mapBinanceTrade,
	mapBinanceWithdrawal,
	signBinance,
} from "../src/binance/index.js";
import { mapCoinDcxTrade, signCoinDcx } from "../src/coindcx/index.js";
import { object } from "../src/values.js";
import { envelope, first, sample } from "./samples.js";

const market = { symbol: "BNBBTC", baseAsset: "BNB", quoteAsset: "BTC" };
describe("signatures", () => {
	it("matches Binance's official worked example (research §1.1)", () => {
		expect(
			signBinance(
				"symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559",
				"NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j",
			),
		).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
	});
	it.each([
		[
			'{"timestamp":1763337600000}',
			"07136e2197650fb56cc542c9dc7d948d268ba545b7e1ce42fecebf8ae37b0e2f",
		],
		[
			'{"from_id":0,"limit":500,"sort":"asc","timestamp":1763337600000}',
			"e51d36fbcd01d5069b16f0991e71ceef385f86f0f9a7c7d8573b1a09070f6185",
		],
	])(
		"signs exact CoinDCX body bytes (research-computed vector)",
		(body, signature) =>
			expect(signCoinDcx(body, "test-secret-not-real")).toBe(signature),
	);
});
describe("Binance mappings", () => {
	it("maps official myTrades including a third-asset fee and raw text", () => {
		const raw = first(sample("binance-myTrades"));
		const tx = mapBinanceTrade(raw, market);
		expect(tx).toMatchObject({
			source: "binance-api",
			sourceRef: "trade:BNBBTC:28457",
			type: "swap",
			assetIn: "BNB",
			amountIn: "12",
			assetOut: "BTC",
			amountOut: "48.000012",
			feeAsset: "BNB",
			feeAmount: "10.1",
			priceQuote: { asset: "BTC", price: "1" },
		});
		expect(tx.raw).toBe(raw);
	});
	it.each([true, false])("maps INR trade isBuyer=%s", (buyer) => {
		const raw = { ...first(sample("binance-myTrades")), isBuyer: buyer };
		expect(
			mapBinanceTrade(raw, { ...market, quoteAsset: "INR" }),
		).toMatchObject({
			type: buyer ? "buy" : "sell",
			inrValue: "48.000012",
			priceQuote: { asset: "INR", price: "4.000001" },
		});
	});
	it("marks an unknown side", () =>
		expect(
			mapBinanceTrade(
				{ ...first(sample("binance-myTrades")), isBuyer: "unknown" },
				market,
			).reviewFlags[0]?.code,
		).toBe("unknown_type"));
	it("maps official deposits with hash", () =>
		expect(
			mapBinanceDeposit(first(sample("binance-deposit-hisrec"))),
		).toMatchObject({
			type: "deposit",
			amountIn: "0.001",
			chain: "BNB",
			sourceRef: "deposit:769800519366885376",
		}));
	it.each(["0", "2", "7", "8"])(
		"does not apply unsettled deposit status %s",
		(status) =>
			expect(
				mapBinanceDeposit({
					...first(sample("binance-deposit-hisrec")),
					status,
				}),
			).toBeNull(),
	);
	it("accepts credited status 6", () =>
		expect(
			mapBinanceDeposit({
				...first(sample("binance-deposit-hisrec")),
				status: "6",
			})?.type,
		).toBe("deposit"));
	it("maps official withdrawals at applyTime, preserves old missing network", () => {
		const raw = first(sample("binance-withdraw-history"));
		delete raw.network;
		expect(mapBinanceWithdrawal(raw)).toMatchObject({
			type: "withdrawal",
			amountOut: "8.91",
			feeAmount: "0.004",
			timestamp: "2019-10-12T11:12:02.000Z",
		});
	});
	it("ignores a processing withdrawal", () =>
		expect(
			mapBinanceWithdrawal({
				...first(sample("binance-withdraw-history")),
				status: "4",
			}),
		).toBeNull());
	it("maps Convert without assuming a fiat trade", () => {
		expect(
			mapBinanceConvert({
				orderId: "1",
				orderStatus: "SUCCESS",
				fromAsset: "ETH",
				toAsset: "USDT",
				fromAmount: "1",
				toAmount: "2000",
				createTime: "1600000000000",
			}),
		).toMatchObject({
			type: "swap",
			assetIn: "USDT",
			amountOut: "1",
			sourceRef: "convert:1",
		});
	});
	it("maps official dust details with stable parent/detail ids", () => {
		const parent = first(object(sample("binance-dribblet")).userAssetDribblets),
			raw = first(parent.userAssetDribbletDetails);
		expect(mapBinanceDust(raw, parent)).toMatchObject({
			type: "swap",
			sourceRef: "dust:45178372831:4359321",
			amountOut: "0.0009",
			amountIn: "0.000441",
			feeAmount: "0.000009",
		});
	});
	it("retains unknown official dividend description for review", () =>
		expect(mapBinanceDividend(envelope("binance-assetDividend"))).toMatchObject(
			{
				type: "income",
				incomeKind: "other",
				amountIn: "10",
				reviewFlags: [{ code: "unknown_type" }],
			},
		));
	it("uses the file-importer income table", () =>
		expect(
			mapBinanceDividend({
				...envelope("binance-assetDividend"),
				enInfo: "Staking Rewards",
			}).incomeKind,
		).toBe("staking"));
	it("maps fiat deposits and withdrawals", () => {
		const raw = {
			orderNo: "1",
			fiatCurrency: "INR",
			amount: "100",
			totalFee: "2",
			status: "Successful",
			createTime: "1600000000000",
		};
		expect(mapBinanceFiatOrder(raw, "0")).toMatchObject({
			type: "deposit",
			assetIn: "INR",
			amountIn: "100",
		});
		expect(mapBinanceFiatOrder(raw, "1")).toMatchObject({
			type: "withdrawal",
			assetOut: "INR",
		});
	});
	it("skips the failed official fiat payment and maps completed payments", () => {
		const raw = envelope("binance-fiat-payments", "data");
		expect(mapBinanceFiatPayment(raw, "0")).toBeNull();
		expect(
			mapBinanceFiatPayment(
				{ ...raw, status: "Completed", fiatCurrency: "INR" },
				"0",
			),
		).toMatchObject({ type: "buy", inrValue: "20", amountIn: "4.462" });
	});
	it("maps P2P and removes only counterparty personal data", () => {
		const raw = envelope("binance-c2c-listUserOrderHistory", "data");
		const tx = mapBinanceP2p(raw);
		expect(tx).toMatchObject({
			sourceRef: "p2p:20219644646554779648",
			type: "sell",
			amountOut: "5000",
			priceQuote: { asset: "CNY", price: "6.68" },
			raw: { counterPartNickName: "<removed>" },
		});
		expect(raw.counterPartNickName).not.toBe("<removed>");
	});
	it("Earn cross-check rows do not double-count income", () =>
		expect(
			mapBinanceEarnAudit(
				{ time: "1600000000000", asset: "ETH", amount: "0.1", type: "BONUS" },
				"locked",
			),
		).toMatchObject({ type: "fee", reviewFlags: [{ code: "parse_warning" }] }));
	it("discovers both assets from knownAssets and honours extra symbols", () => {
		const info = [
			market,
			{ symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT" },
		];
		expect(discoverSymbols(info, ["BNB", "BTC"], [])).toEqual([market]);
		expect(discoverSymbols(info, ["ETH"], [])).toEqual([]);
		expect(discoverSymbols(info, [], ["ETHUSDT"])).toEqual([info[1]]);
	});
});
describe("CoinDCX mapping", () => {
	const markets = [
		{
			coindcx_name: "USDTINR",
			target_currency_short_name: "USDT",
			base_currency_short_name: "INR",
			ecode: "I",
		},
	];
	it("maps official JSON float amounts with no TDS", () => {
		const raw = first(sample("coindcx-trade_history")),
			tx = mapCoinDcxTrade(raw, markets);
		expect(tx).toMatchObject({
			source: "coindcx-api",
			sourceRef: "trade:252949810",
			type: "buy",
			amountIn: "4.97",
			amountOut: "499.485",
			feeAmount: "2.9469615",
			feeAsset: "INR",
			inrValue: "499.485",
		});
		expect(tx.tdsInr).toBeUndefined();
		expect(tx.raw).toBe(raw);
	});
	it("uses inverted metadata naming and crypto swaps", () =>
		expect(
			mapCoinDcxTrade(
				{ ...first(sample("coindcx-trade_history")), symbol: "XTZBTC" },
				[
					{
						symbol: "XTZBTC",
						target_currency_short_name: "XTZ",
						base_currency_short_name: "BTC",
					},
				],
			),
		).toMatchObject({ type: "swap", assetIn: "XTZ", assetOut: "BTC" }));
	it("flags fallback splitting for a delisted market", () =>
		expect(
			mapCoinDcxTrade(first(sample("coindcx-trade_history")), []).reviewFlags[0]
				?.code,
		).toBe("parse_warning"));
	it("preserves unknown pairs and sides without inventing movements", () => {
		expect(
			mapCoinDcxTrade(
				{ ...first(sample("coindcx-trade_history")), symbol: "UNKNOWN" },
				[],
			).reviewFlags[0]?.code,
		).toBe("unknown_type");
		expect(
			mapCoinDcxTrade(
				{ ...first(sample("coindcx-trade_history")), side: "other" },
				markets,
			).reviewFlags[0]?.code,
		).toBe("unknown_type");
	});
});
