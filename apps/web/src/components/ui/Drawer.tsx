"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

export function Drawer({
	open,
	onClose,
	title,
	subtitle,
	widthClass = "max-w-xl",
	children,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	subtitle?: string;
	widthClass?: string;
	children: ReactNode;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const openerRef = useRef<HTMLElement | null>(null);
	const wasOpenRef = useRef(false);
	const titleId = useId();

	useEffect(() => {
		const el = dialogRef.current;
		if (open) {
			if (!wasOpenRef.current) {
				const active = document.activeElement;
				openerRef.current =
					active instanceof HTMLElement && active !== document.body
						? active
						: null;
				wasOpenRef.current = true;
			}
			if (el && !el.open) {
				el.showModal();
			}
		} else {
			if (el?.open) {
				el.close();
			}
			if (wasOpenRef.current) {
				wasOpenRef.current = false;
				const opener = openerRef.current;
				openerRef.current = null;
				if (opener?.isConnected) {
					opener.focus();
				}
			}
		}
	}, [open]);

	if (!open) return null;

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby={titleId}
			onCancel={(e) => {
				e.preventDefault();
				onClose();
			}}
			onClick={(e) => {
				if (e.target === dialogRef.current) onClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					onClose();
				}
			}}
			className={`fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full ${widthClass} border-l border-[var(--border)] bg-[var(--bg-surface)] p-0 text-[var(--text-primary)] shadow-2xl`}
		>
			<div className="flex h-full flex-col">
				<div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
					<div className="min-w-0">
						<h2 id={titleId} className="text-base font-semibold tracking-tight">
							{title}
						</h2>
						{subtitle ? (
							<p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
								{subtitle}
							</p>
						) : null}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close drawer"
						className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				</div>
				<div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
			</div>
		</dialog>
	);
}
