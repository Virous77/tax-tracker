import { Suspense } from "react";
import { ImportClient } from "@/components/import/ImportClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("import");

export default function ImportPage() {
	return (
		<Suspense
			fallback={
				<div className="h-64 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			}
		>
			<ImportClient />
		</Suspense>
	);
}
