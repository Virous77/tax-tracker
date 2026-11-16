import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
	page,
	pageSize,
	total,
	onPageChange,
}: {
	page: number;
	pageSize: number;
	total: number;
	onPageChange: (nextPage: number) => void;
}) {
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const end = Math.min(total, page * pageSize);

	return (
		<nav
			aria-label="Pagination"
			className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--text-secondary)]"
		>
			<p className="num">
				Showing {start}–{end} of {total}
			</p>
			<div className="flex items-center gap-2">
				<button
					type="button"
					disabled={page <= 1}
					onClick={() => onPageChange(page - 1)}
					className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45"
				>
					<ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
					Previous
				</button>
				<span className="num px-1 font-medium text-[var(--text-primary)]">
					Page {page} of {totalPages}
				</span>
				<button
					type="button"
					disabled={page >= totalPages}
					onClick={() => onPageChange(page + 1)}
					className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45"
				>
					Next
					<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			</div>
		</nav>
	);
}
