import { AlertCircle } from "lucide-react";

export function ErrorBanner({
	message,
	title = "Error",
	onRetry,
}: {
	message: string;
	title?: string;
	onRetry?: () => void;
}) {
	return (
		<div
			role="alert"
			className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--loss)]/40 bg-[var(--loss-soft)] px-4 py-3 text-sm text-[var(--loss)]"
		>
			<div className="flex items-start gap-2.5">
				<AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
				<div>
					<p className="font-semibold">{title}</p>
					<p className="mt-0.5 text-[var(--text-primary)]">{message}</p>
				</div>
			</div>
			{onRetry ? (
				<button
					type="button"
					onClick={onRetry}
					className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
				>
					Retry
				</button>
			) : null}
		</div>
	);
}
