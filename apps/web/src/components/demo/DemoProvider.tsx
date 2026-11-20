"use client";

import { usePathname } from "next/navigation";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { ApiError, api } from "@/lib/client/api";

type DemoState = {
	loaded: boolean;
	/** The newest tax year the sample rows fall in; the year to show while sample data is loaded. */
	taxYear: string | null;
	/** Loads the sample data, computes its report, and resolves to the tax year worth opening. */
	load: () => Promise<string>;
	remove: () => Promise<void>;
};

const DemoContext = createContext<DemoState | null>(null);

async function prepareReportYear(
	demoTaxYear: string | undefined,
): Promise<string> {
	if (demoTaxYear) {
		await api.computeReport(demoTaxYear).catch(() => null);
		return demoTaxYear;
	}
	const [settings, years] = await Promise.all([
		api.getSettings().catch(() => null),
		api.getTaxYears().catch(() => []),
	]);
	const preferred = settings?.defaultTaxYear ?? "2026-27";
	const candidates = [preferred, ...years.map((y) => y.id)].filter(
		(year, i, all) => all.indexOf(year) === i,
	);
	for (const year of candidates) {
		const report = await api.computeReport(year).catch(() => null);
		if (
			report &&
			(report.scheduleVdaRows.length > 0 || report.income.rows.length > 0)
		)
			return year;
	}
	return preferred;
}

export function DemoProvider({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const [loaded, setLoaded] = useState(false);
	const [taxYear, setTaxYear] = useState<string | null>(null);

	useEffect(() => {
		if (pathname === "/login") return;
		let cancelled = false;
		api
			.getDemo()
			.then((status) => {
				if (cancelled) return;
				setLoaded(status.loaded);
				setTaxYear(status.loaded ? (status.taxYears[0] ?? null) : null);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [pathname]);

	const load = useCallback(async () => {
		let taxYears: string[];
		try {
			taxYears = (await api.loadDemo()).taxYears;
		} catch (err) {
			if (!(err instanceof ApiError && err.status === 409)) throw err;
			taxYears = (await api.getDemo()).taxYears;
		}
		const year = await prepareReportYear(taxYears[0]);
		setLoaded(true);
		setTaxYear(taxYears[0] ?? null);
		return year;
	}, []);

	const remove = useCallback(async () => {
		await api.removeDemo();
		setLoaded(false);
		setTaxYear(null);
	}, []);

	const value = useMemo(
		() => ({ loaded, taxYear, load, remove }),
		[loaded, taxYear, load, remove],
	);
	return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoState {
	const ctx = useContext(DemoContext);
	if (!ctx) throw new Error("useDemo must be used inside DemoProvider");
	return ctx;
}
