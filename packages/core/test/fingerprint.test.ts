import { describe, expect, it } from "vitest";
import {
	eventFingerprint,
	type LedgerTx,
	siblingChannel,
} from "../src/index.js";

const tx: LedgerTx = {
	id: "00000000-0000-4000-8000-000000000001",
	importId: null,
	source: "binance",
	sourceRef: "file-1",
	timestamp: "2026-05-01T00:00:00.123Z",
	type: "swap",
	assetIn: "ETH",
	amountIn: "1.000",
	assetOut: "USDT",
	amountOut: "2000.000",
	raw: {},
	reviewFlags: [],
};
describe("cross-channel fingerprints", () => {
	it("normalizes decimal amounts and UTC seconds across channels", () => {
		expect(eventFingerprint(tx)).toBe(
			eventFingerprint({
				...tx,
				source: "binance-api",
				sourceRef: "trade:ETHUSDT:1",
				timestamp: "2026-05-01T00:00:00.999Z",
				amountIn: "1e0",
				amountOut: "2000",
			}),
		);
	});
	it("keeps trade direction and venue separate", () => {
		expect(eventFingerprint(tx)).not.toBe(
			eventFingerprint({
				...tx,
				assetIn: "USDT",
				amountIn: "2000",
				assetOut: "ETH",
				amountOut: "1",
			}),
		);
		expect(eventFingerprint(tx)).not.toBe(
			eventFingerprint({ ...tx, source: "coindcx" }),
		);
	});
	it("uses normalized hash for moves, independent of timestamp", () => {
		const move = {
			...tx,
			type: "withdrawal" as const,
			assetIn: undefined,
			amountIn: undefined,
			txHash: "0xABCD",
		};
		expect(eventFingerprint(move)).toBe(
			eventFingerprint({
				...move,
				source: "binance-api",
				txHash: "abcd",
				timestamp: "2026-06-01T00:00:00Z",
			}),
		);
	});
	it("uses the UTC minute for moves without a hash", () => {
		const move = { ...tx, type: "deposit" as const };
		expect(eventFingerprint(move)).toBe(
			eventFingerprint({ ...move, timestamp: "2026-05-01T00:00:59Z" }),
		);
		expect(eventFingerprint(move)).not.toBe(
			eventFingerprint({ ...move, timestamp: "2026-05-01T00:01:00Z" }),
		);
	});
	it("declines incomplete or unsupported events and recognizes siblings", () => {
		expect(eventFingerprint({ ...tx, type: "income" })).toBeNull();
		expect(eventFingerprint({ ...tx, amountOut: undefined })).toBeNull();
		expect(siblingChannel("binance-api")).toBe("binance");
		expect(siblingChannel("coindcx")).toBe("coindcx-api");
		expect(siblingChannel("evm:1")).toBeNull();
	});
});
