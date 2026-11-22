import { Suspense } from "react";
import { ReportClient } from "@/components/report/ReportClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("report");

export default function ReportPage() {
	return (
		<Suspense
			fallback={
				<div className="h-64 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			}
		>
			<ReportClient />
		</Suspense>
	);
}
