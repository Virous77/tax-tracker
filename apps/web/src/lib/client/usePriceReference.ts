"use client";

import { istDate, type LedgerTx } from "@tax/core";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import {
	type PriceReference,
	referenceFromLedger,
	referenceFromReport,
	referenceFromSale,
} from "@/lib/client/inr-cost";

const ASSET_TYPING_DELAY_MS = 400;
const REFERENCE_ROWS = 200;

async function taxYearAt(at: string | undefined): Promise<string | null> {
	const years = await api.getTaxYears().catch(() => []);
	let day: string | null = null;
	try {
		day = at ? istDate(at) : null;
	} catch {
		day = null;
	}
	const match = day
		? years.find((y) => day >= y.start && day <= y.end)
		: undefined;
	return (match ?? years[0])?.id ?? null;
}

async function lookUpReference(
	asset: string,
	at: string | undefined,
	excludeTxId: string | undefined,
): Promise<PriceReference | null> {
	const page = await api
		.listTransactions({
			asset,
			sort: "timestamp:desc",
			page: 1,
			pageSize: REFERENCE_ROWS,
		})
		.catch(() => null);
	const fromRows = page
		? referenceFromLedger(page.items, asset, excludeTxId)
		: null;
	if (fromRows) return fromRows;
	const taxYear = await taxYearAt(at);
	const report = taxYear
		? await api.getReportOrNull(taxYear).catch(() => null)
		: null;
	return report ? referenceFromReport(report, asset, excludeTxId) : null;
}

/**
 * A rough INR price for one unit of `asset`, to catch a total typed as a price or the reverse:
 * the sale's own price, else imported rows' INR values, else the computed report's values.
 */
export function usePriceReference(
	asset: string,
	options: {
		enabled: boolean;
		sale?: LedgerTx;
		excludeTxId?: string;
		/** ISO instant of the row, to pick the tax year's report. */
		at?: string;
	},
): PriceReference | null {
	const { enabled, sale, excludeTxId, at } = options;
	const [reference, setReference] = useState<PriceReference | null>(null);
	const normalised = asset.trim().toUpperCase();
	const fromSale = sale ? referenceFromSale(sale, normalised) : null;
	const hasSaleReference = fromSale !== null;

	useEffect(() => {
		setReference(null);
		if (!enabled || !normalised || hasSaleReference) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			lookUpReference(normalised, at, excludeTxId).then((found) => {
				if (!cancelled) setReference(found);
			});
		}, ASSET_TYPING_DELAY_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [enabled, normalised, hasSaleReference, excludeTxId, at]);

	return fromSale ?? reference;
}
