"use client";

import { useEffect, useState } from "react";
import { useDemo } from "@/components/demo/DemoProvider";
import { TrySampleDataButton } from "@/components/demo/TrySampleDataButton";
import { api } from "@/lib/client/api";

export function SampleDataPrompt() {
	const { loaded } = useDemo();
	const [ledgerEmpty, setLedgerEmpty] = useState(false);

	useEffect(() => {
		let cancelled = false;
		api
			.listImports()
			.then((imports) => {
				if (!cancelled) setLedgerEmpty(imports.length === 0);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	if (loaded || !ledgerEmpty) return null;

	return (
		<section
			aria-labelledby="sample-data-title"
			className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-4"
		>
			<div className="min-w-0 max-w-xl">
				<h2 id="sample-data-title" className="text-sm font-semibold">
					New here?
				</h2>
				<p className="mt-0.5 text-xs text-[var(--text-secondary)]">
					Load synthetic sample data (Binance, CoinDCX and one EVM wallet, all
					fake) to see a finished report in one click. You can remove it at any
					time.
				</p>
			</div>
			<TrySampleDataButton />
		</section>
	);
}
