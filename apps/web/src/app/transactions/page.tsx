import { Suspense } from "react";
import { TransactionsClient } from "@/components/transactions/TransactionsClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("transactions");

export default function TransactionsPage() {
	return (
		<Suspense
			fallback={
				<div className="h-64 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			}
		>
			<TransactionsClient />
		</Suspense>
	);
}
