"use client";

import { FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDemo } from "@/components/demo/DemoProvider";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { getErrorMessage } from "@/lib/client/api";

export function TrySampleDataButton({
	variant = "secondary",
}: {
	variant?: "primary" | "secondary";
}) {
	const router = useRouter();
	const { loaded, load } = useDemo();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleClick() {
		setBusy(true);
		setError(null);
		try {
			const taxYear = await load();
			router.push(`/report?taxYear=${encodeURIComponent(taxYear)}`);
		} catch (err) {
			setError(getErrorMessage(err));
			setBusy(false);
		}
	}

	if (loaded) return null;

	return (
		<div className="space-y-3">
			<button
				type="button"
				disabled={busy}
				onClick={handleClick}
				className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
					variant === "primary"
						? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
						: "border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
				}`}
			>
				<FlaskConical className="h-4 w-4" aria-hidden="true" />
				{busy ? "Loading sample data…" : "Try with sample data"}
			</button>
			{error ? <ErrorBanner message={error} /> : null}
		</div>
	);
}
