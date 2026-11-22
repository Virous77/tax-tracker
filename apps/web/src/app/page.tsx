import { Suspense } from "react";
import { OverviewClient } from "@/components/OverviewClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("overview");

export default function OverviewPage() {
	return (
		<Suspense
			fallback={
				<div className="h-48 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			}
		>
			<OverviewClient />
		</Suspense>
	);
}
