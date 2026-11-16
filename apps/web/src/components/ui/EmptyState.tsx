import type { ReactNode } from "react";

export function EmptyState({
	icon,
	title,
	description,
	action,
}: {
	icon?: ReactNode;
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-12 text-center">
			{icon ? (
				<div className="mb-3 text-[var(--text-muted)]" aria-hidden="true">
					{icon}
				</div>
			) : null}
			<h2 className="text-base font-semibold text-[var(--text-primary)]">
				{title}
			</h2>
			{description ? (
				<p className="mt-1 max-w-md text-sm text-[var(--text-secondary)]">
					{description}
				</p>
			) : null}
			{action ? <div className="mt-4">{action}</div> : null}
		</div>
	);
}
