"use client";

import { ShieldAlert } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { api, getErrorMessage } from "@/lib/client/api";

function trapTab(e: KeyboardEvent<HTMLDialogElement>) {
	if (e.key !== "Tab") return;
	const items = [
		...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])"),
	];
	const first = items[0];
	const last = items[items.length - 1];
	if (!first || !last) {
		e.preventDefault();
		return;
	}
	const active = document.activeElement;
	if (e.shiftKey && active === first) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && active === last) {
		e.preventDefault();
		first.focus();
	}
}

export function DisclaimerGate() {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const descId = useId();
	const [needsAcceptance, setNeedsAcceptance] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		api
			.getSettings()
			.then((settings) => {
				if (!cancelled)
					setNeedsAcceptance(settings.disclaimerAcceptedAt === null);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const el = dialogRef.current;
		if (needsAcceptance && el && !el.open) el.showModal();
	}, [needsAcceptance]);

	async function handleAccept() {
		setBusy(true);
		setError(null);
		try {
			await api.putSettings({ disclaimerAccepted: true });
			dialogRef.current?.close();
			setNeedsAcceptance(false);
		} catch (err) {
			setError(getErrorMessage(err));
			setBusy(false);
		}
	}

	if (!needsAcceptance) return null;

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby={titleId}
			aria-describedby={descId}
			onCancel={(e) => e.preventDefault()}
			onKeyDown={trapTab}
			className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-0 text-[var(--text-primary)] shadow-xl"
		>
			<div className="p-5 sm:p-6">
				<div className="flex items-center gap-2.5">
					<ShieldAlert
						className="h-5 w-5 shrink-0 text-[var(--warning)]"
						aria-hidden="true"
					/>
					<h2 id={titleId} className="text-lg font-semibold tracking-tight">
						Before you start
					</h2>
				</div>
				<div
					id={descId}
					className="mt-3 space-y-3 text-sm text-[var(--text-secondary)]"
				>
					<p>
						Tax Tracker is a free, open-source helper that turns your crypto
						exchange history (US stocks planned) into the rows the Indian
						income-tax return asks for (Schedule VDA and TDS).
					</p>
					<p className="rounded-md border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3 py-2.5 text-[var(--text-primary)]">
						<strong className="font-semibold">Not tax advice.</strong>{" "}
						Pre-release: the tax rules have not yet been reviewed by a Chartered
						Accountant — verify with a CA before filing.
					</p>
					<p>
						Your data stays on this computer. The app makes network calls only
						for features you enable.
					</p>
				</div>
				{error ? (
					<p role="alert" className="mt-3 text-sm text-[var(--loss)]">
						{error}
					</p>
				) : null}
				<div className="mt-5 flex justify-end">
					<button
						type="button"
						disabled={busy}
						onClick={handleAccept}
						className="rounded-md bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						{busy ? "Saving…" : "I understand"}
					</button>
				</div>
			</div>
		</dialog>
	);
}
