import { Calculator, RefreshCw } from "lucide-react";

export function StaleReportBanner({
	computing,
	onRecompute,
}: {
	computing: boolean;
	onRecompute: () => void;
}) {
	return (
		<div
			role="status"
			className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-3 text-sm"
		>
			<div className="flex items-start gap-2.5">
				<RefreshCw
					className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
					aria-hidden="true"
				/>
				<p className="font-medium text-[var(--text-primary)]">
					Your data changed since this report was computed. The figures and
					items below are from the last compute.
				</p>
			</div>
			<button
				type="button"
				disabled={computing}
				onClick={onRecompute}
				className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
			>
				<Calculator className="h-3.5 w-3.5" aria-hidden="true" />
				{computing ? "Computing…" : "Recompute"}
			</button>
		</div>
	);
}
