import { beforeAll, describe, expect, it } from "vitest";
import { addManual, allTx, compute } from "./lib";
import {
	addBinance,
	addCoindcx,
	addEvm,
	allProviders,
	balances,
	CHAIN_IDS,
	connections,
	HASH,
	SYNC_TIMEOUT,
	syncOk,
	WALLET_A,
	WALLET_B,
	wipeP2,
} from "./p2";

type Tx = Awaited<ReturnType<typeof allTx>>[number];
let report: Awaited<ReturnType<typeof compute>>;
let ledger: Tx[] = [];
const byHash = (hash: string) =>
	ledger.filter((t) => t.txHash?.toLowerCase() === hash);
const codes = (t: Tx) => t.reviewFlags.map((f) => f.code);

describe("THE PHASE 2 GATE", () => {
	beforeAll(async () => {
		await wipeP2();
		await allProviders();
		const evm = [];
		for (const chain of CHAIN_IDS)
			for (const [w, a] of [
				["A", WALLET_A],
				["B", WALLET_B],
			] as const)
				evm.push(await addEvm(a, chain, `${w}@${chain}`));
		for (const c of evm) await syncOk(c.id);
		await syncOk((await addCoindcx()).id);
		await syncOk((await addBinance()).id);
		// The fixture's P2P buy (2025-04-08) is older than the six months Binance's API serves, so the
		// sync reports that stream incomplete. Entered by hand it fixes the global report pool, but a
		// manual row has venue "manual" and cannot close the Binance balance check (BUGS.md P2-API-4).
		await addManual({
			timestamp: "2025-04-08T09:12:37.000Z",
			type: "buy",
			source: "binance",
			assetIn: "USDT",
			amountIn: "5000",
			assetOut: "INR",
			amountOut: "442500",
			inrValue: "442500",
		});
		report = await compute("2025-26");
		ledger = await allTx();
	}, SYNC_TIMEOUT);

	describe("balances: zero differences for every asset on every connection", () => {
		it("12 connections synced", async () => {
			const list = await connections();
			expect(list).toHaveLength(12);
			for (const c of list)
				expect(["completed", "incomplete"], c.label).toContain(
					c.lastSyncStatus,
				);
		});
		it("Binance: zero differences except USDT, whose 5000 gap is the P2P buy the API cannot return (flagged incomplete)", async () => {
			const c = (await connections()).find((x) => x.label === "Binance");
			const rows = (await balances(c?.id ?? "")).rows;
			for (const row of rows.filter((r) => r.asset !== "USDT"))
				expect(row, row.asset).toMatchObject({
					difference: "0",
					flagged: false,
				});
			expect(rows.find((r) => r.asset === "USDT")).toMatchObject({
				difference: "5000",
				flagged: true,
			});
			expect(
				report.warnings.some(
					(w) =>
						w.code === "import_incomplete" &&
						/p2p:BUY.*six months/i.test(w.message),
				),
			).toBe(true);
		});
		it.each(["CoinDCX", ...CHAIN_IDS.flatMap((c) => [`A@${c}`, `B@${c}`])])(
			"%s",
			async (label) => {
				const c = (await connections()).find((x) => x.label === label);
				const rows = (await balances(c?.id ?? "")).rows;
				expect(rows.length).toBeGreaterThan(0);
				for (const row of rows)
					expect(row, `${label} ${row.asset}`).toMatchObject({
						difference: "0",
						flagged: false,
					});
			},
		);
	});

	describe("hash-linked transfers are matched (no unmatched_transfer)", () => {
		it.each([
			["Binance ETH withdrawal → wallet A (mainnet)", HASH.binanceToA, "ETH"],
			["wallet B → Binance USDC deposit", HASH.bToBinance, "USDC"],
			["Binance → wallet A on Base", HASH.baseWithdrawal, "ETH"],
			["Binance → wallet A USDT on BSC", HASH.bscUsdt, "USDT"],
			["Binance → wallet A BNB on BSC", HASH.bscBnb, "BNB"],
			["wallet A → wallet B USDC (own)", HASH.aToB, "USDC"],
		])("%s", (_, hash, asset) => {
			const legs = byHash(hash);
			expect(legs.map((t) => t.type).sort()).toEqual(["deposit", "withdrawal"]);
			for (const t of legs) {
				expect(t.assetIn ?? t.assetOut).toBe(asset);
				expect(codes(t), `${t.source} ${t.type}`).not.toContain(
					"unmatched_transfer",
				);
			}
			const unmatched = report.warnings
				.filter((w) => w.code === "unmatched_transfer")
				.flatMap((w) => w.txIds ?? (w.txId ? [w.txId] : []));
			for (const t of legs) expect(unmatched).not.toContain(t.id);
		});
		it("an exchange withdrawal's on-chain amount equals the deposit (fee charged on top, no fee_review on the match)", () => {
			const [w, d] = [
				byHash(HASH.binanceToA).find((t) => t.type === "withdrawal"),
				byHash(HASH.binanceToA).find((t) => t.type === "deposit"),
			];
			expect(w?.amountOut).toBe("0.5");
			expect(w?.feeAmount).toBe("0.0018");
			expect(d?.amountIn).toBe("0.5");
		});
	});

	describe("on-chain classification", () => {
		it("mainnet DEX swap is one swap: 0.2 ETH out, 480 USDC in, gas as the fee", () => {
			const [swap] = byHash(HASH.swap);
			expect(byHash(HASH.swap)).toHaveLength(1);
			expect(swap).toMatchObject({
				type: "swap",
				assetOut: "ETH",
				amountOut: "0.2",
				assetIn: "USDC",
				amountIn: "480",
				feeAsset: "ETH",
				feeAmount: "0.001420824",
			});
		});
		it("Base swap fee = gasUsed × gasPrice + l1Fee", () => {
			const [swap] = byHash(HASH.baseSwap);
			expect(swap).toMatchObject({
				type: "swap",
				source: "evm:8453",
				feeAsset: "ETH",
				feeAmount: "0.000001067376",
			});
		});
		it("an approval and a failed swap are gas-only fee rows", () => {
			expect(byHash(HASH.approve)).toEqual([
				expect.objectContaining({
					type: "fee",
					feeAsset: "ETH",
					feeAmount: "0.0003003065",
				}),
			]);
			expect(byHash(HASH.failedSwap)).toEqual([
				expect.objectContaining({
					type: "fee",
					feeAsset: "ETH",
					feeAmount: "0.000345708",
				}),
			]);
		});
		it("spam: lookalike USDT gets its own contract id, is flagged suspected_spam and listed in report.excluded", () => {
			const [spam] = byHash(HASH.spam);
			expect(spam?.assetIn).toBe(
				"ERC20:1:0XDEADBEEFCAFEBABE00112233445566778899AABB",
			);
			expect(codes(spam as Tx)).toContain("suspected_spam");
			expect(report.excluded).toContainEqual({
				txId: spam?.id,
				reason: "suspected_spam",
			});
		});
		it("spam contributes no holdings: report balances have no lookalike asset", () => {
			expect(report.balances.some((b) => b.asset.startsWith("ERC20:"))).toBe(
				false,
			);
		});
		it("the Base → Ethereum bridge is flagged complex_onchain and not a sale", () => {
			const legs = byHash(HASH.bridge);
			expect(legs.length).toBeGreaterThan(0);
			for (const t of legs) {
				expect(codes(t)).toContain("complex_onchain");
				expect(["deposit", "withdrawal"]).toContain(t.type);
			}
		});
		it("USDC and USDC.E stay distinct on Arbitrum", () => {
			const arb = ledger.filter((t) => t.source === "evm:42161");
			const assets = new Set(
				arb.flatMap((t) => [t.assetIn, t.assetOut]).filter(Boolean),
			);
			expect(assets.has("USDC")).toBe(true);
			expect(assets.has("USDC.E")).toBe(true);
		});
		it("Polygon: MATIC-era rows are POL and carry the rename warning", () => {
			const poly = ledger.filter((t) => t.source === "evm:137");
			for (const t of poly)
				for (const a of [t.assetIn, t.assetOut, t.feeAsset].filter(Boolean))
					expect(a).toBe("POL");
			const [matic] = byHash(HASH.maticIn);
			expect(matic?.reviewFlags.map((f) => f.message).join(" ")).toMatch(
				/MATIC.*POL|POL.*MATIC/,
			);
		});
		it("ETH on Base and Arbitrum shares the ETH asset id", () => {
			expect(
				byHash(HASH.baseWithdrawal).every(
					(t) => (t.assetIn ?? t.assetOut) === "ETH",
				),
			).toBe(true);
		});
	});

	describe("report", () => {
		it("excluded lists only spam here", () => {
			expect(report.excluded.length).toBeGreaterThan(0);
			for (const e of report.excluded) expect(e.reason).toBe("suspected_spam");
		});
		it("no negative holdings (missing_history) are left for any synced asset", () => {
			const negative = report.warnings.filter(
				(w) => w.code === "missing_history" && /Negative/.test(w.message),
			);
			expect(negative.map((w) => w.message)).toEqual([]);
		});
		it("sync incompleteness is surfaced as import_incomplete, not hidden", () => {
			expect(
				report.warnings.some(
					(w) => w.code === "import_incomplete" && /P2P/.test(w.message),
				),
			).toBe(true);
		});
	});
});
