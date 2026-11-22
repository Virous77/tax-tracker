import { Suspense } from "react";
import { UsStocksClient } from "@/components/us-stocks/UsStocksClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("usStocks");

export default function UsStocksPage() {
	return (
		<Suspense
			fallback={
				<div className="h-64 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			}
		>
			<UsStocksClient />
		</Suspense>
	);
}
