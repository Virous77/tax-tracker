import type { ReactNode } from "react";

export function PageHeader({
	title,
	description,
	eyebrow,
	actions,
}: {
	title: string;
	description?: ReactNode;
	eyebrow?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0 space-y-1">
				{eyebrow}
				<h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
					{title}
				</h1>
				{description ? (
					<p className="max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
						{description}
					</p>
				) : null}
			</div>
			{actions ? (
				<div className="flex min-w-0 flex-wrap items-center gap-2 sm:max-w-[55%] sm:shrink-0 sm:justify-end">
					{actions}
				</div>
			) : null}
		</header>
	);
}
