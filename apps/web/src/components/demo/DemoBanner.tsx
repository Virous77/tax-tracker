"use client";

import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { useDemo } from "@/components/demo/DemoProvider";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getErrorMessage } from "@/lib/client/api";

export function DemoBanner() {
	const { loaded, remove } = useDemo();
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!loaded) return null;

	async function handleRemove() {
		setBusy(true);
		setError(null);
		try {
			await remove();
			window.location.assign("/");
		} catch (err) {
			setError(getErrorMessage(err));
			setBusy(false);
			setConfirming(false);
		}
	}

	return (
		<>
			<div
				role="status"
				className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-2.5 text-sm sm:px-6"
			>
				<p className="flex items-center gap-2 text-[var(--text-primary)]">
					<FlaskConical
						className="h-4 w-4 shrink-0 text-[var(--warning)]"
						aria-hidden="true"
					/>
					<span>
						<strong className="font-semibold">Sample data loaded</strong> — not
						your real transactions.
					</span>
				</p>
				<button
					type="button"
					onClick={() => setConfirming(true)}
					className="rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
				>
					Remove sample data
				</button>
				{error ? (
					<p role="alert" className="w-full text-xs text-[var(--loss)]">
						{error}
					</p>
				) : null}
			</div>
			<ConfirmDialog
				open={confirming}
				title="Remove sample data?"
				description="This deletes the sample imports and their transactions. Your own imports and manual entries are not touched."
				confirmLabel="Remove sample data"
				destructive
				busy={busy}
				onConfirm={handleRemove}
				onCancel={() => setConfirming(false)}
			/>
		</>
	);
}
