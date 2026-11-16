import { Suspense } from "react";
import { ReviewClient } from "@/components/ReviewClient";

export default function ReviewPage() {
	return (
		<Suspense
			fallback={
				<div className="h-64 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			}
		>
			<ReviewClient />
		</Suspense>
	);
}
