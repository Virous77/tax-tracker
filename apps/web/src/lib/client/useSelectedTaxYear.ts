"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useDemo } from "@/components/demo/DemoProvider";
import { FALLBACK_TAX_YEARS } from "@/components/ui/TaxYearSelect";
import { type AppSettings, api, type TaxYearInfo } from "@/lib/client/api";

const PICKED_KEY = "tax-tracker-tax-year";

/** Review's "All years" choice, kept in the URL; never remembered as the picked year. */
export const ALL_YEARS = "all";

function readPicked(): string {
	try {
		return sessionStorage.getItem(PICKED_KEY) ?? "";
	} catch {
		return "";
	}
}

/**
 * The one place Overview, Report and Review read the tax year from: the URL, else the year the user
 * last picked this session, else the sample-data year, else the saved default. `taxYear` is
 * empty until every source has answered, so a page never flashes a year it then replaces.
 */
export function useSelectedTaxYear(
	path: "/" | "/report" | "/review" | "/us-stocks",
) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const urlTaxYear = searchParams.get("taxYear") ?? "";
	const { ready: demoReady, taxYear: demoTaxYear } = useDemo();

	const [taxYears, setTaxYears] = useState<TaxYearInfo[]>(FALLBACK_TAX_YEARS);
	const [settings, setSettings] = useState<AppSettings | null>(null);
	const [metaReady, setMetaReady] = useState(false);
	const [picked, setPicked] = useState("");

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			api.getTaxYears().catch(() => FALLBACK_TAX_YEARS),
			api.getSettings().catch(() => null),
		]).then(([years, saved]) => {
			if (cancelled) return;
			if (years.length > 0) setTaxYears(years);
			setSettings(saved);
			setPicked(readPicked());
			setMetaReady(true);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const fallbackYear = settings?.defaultTaxYear ?? taxYears[0]?.id ?? "";
	const taxYear =
		urlTaxYear ||
		(metaReady && demoReady ? picked || demoTaxYear || fallbackYear : "");

	const selectTaxYear = useCallback(
		(next: string) => {
			if (next !== ALL_YEARS) {
				setPicked(next);
				try {
					sessionStorage.setItem(PICKED_KEY, next);
				} catch {}
			}
			const params = new URLSearchParams(searchParams.toString());
			params.set("taxYear", next);
			router.replace(`${path}?${params.toString()}`);
		},
		[path, router, searchParams],
	);

	return { taxYear, taxYears, settings, selectTaxYear };
}
