"use client";

import { useEffect, useId, useRef } from "react";

export function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	destructive = false,
	busy = false,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	busy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const descId = useId();

	useEffect(() => {
		const el = dialogRef.current;
		if (!el) return;
		if (open && !el.open) {
			el.showModal();
		} else if (!open && el.open) {
			el.close();
		}
	}, [open]);

	if (!open) return null;

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby={titleId}
			aria-describedby={descId}
			onCancel={(e) => {
				e.preventDefault();
				if (!busy) onCancel();
			}}
			onClick={(e) => {
				if (e.target === dialogRef.current && !busy) onCancel();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape" && !busy) {
					e.preventDefault();
					onCancel();
				}
			}}
			className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-0 text-[var(--text-primary)] shadow-xl"
		>
			<div className="p-5">
				<h2 id={titleId} className="text-base font-semibold">
					{title}
				</h2>
				<p id={descId} className="mt-2 text-sm text-[var(--text-secondary)]">
					{description}
				</p>
				<div className="mt-5 flex justify-end gap-2">
					<button
						type="button"
						disabled={busy}
						onClick={onCancel}
						className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={onConfirm}
						className={`rounded px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
							destructive
								? "bg-[var(--loss)] hover:opacity-90"
								: "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
						}`}
					>
						{busy ? "Working…" : confirmLabel}
					</button>
				</div>
			</div>
		</dialog>
	);
}
