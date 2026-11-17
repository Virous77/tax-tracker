"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { KeyCheck } from "@/lib/client/api";

export function KeyCheckBanner({
	result,
	error,
}: {
	result?: KeyCheck | null;
	error?: string | null;
}) {
	if (error) {
		return (
			<div
				role="alert"
				className="flex items-start gap-2 rounded-md border border-[var(--loss)]/40 bg-[var(--loss-soft)] px-3 py-2 text-xs text-[var(--loss)]"
			>
				<AlertTriangle
					className="mt-0.5 h-3.5 w-3.5 shrink-0"
					aria-hidden="true"
				/>
				<div>
					<p className="font-semibold">Key check failed</p>
					<p className="mt-0.5 text-[var(--text-primary)]">{error}</p>
				</div>
			</div>
		);
	}

	if (!result) return null;

	if (result.readOnly === false) {
		return (
			<div
				role="alert"
				className="flex items-start gap-2 rounded-md border border-[var(--loss)]/50 bg-[var(--loss-soft)] px-3 py-2.5 text-xs"
			>
				<AlertTriangle
					className="mt-0.5 h-4 w-4 shrink-0 text-[var(--loss)]"
					aria-hidden="true"
				/>
				<div className="space-y-1">
					<p className="font-semibold text-[var(--loss)]">
						This key can trade or withdraw. Replace it with a read-only key.
					</p>
					{result.message ? (
						<p className="text-[var(--text-primary)]">{result.message}</p>
					) : null}
					{result.permissions.length > 0 ? (
						<p className="text-[11px] text-[var(--text-secondary)]">
							Permissions: {result.permissions.join(", ")}
						</p>
					) : null}
				</div>
			</div>
		);
	}

	if (result.readOnly === true) {
		return (
			<div className="flex items-start gap-2 rounded-md border border-[var(--positive)]/40 bg-[var(--positive-soft)] px-3 py-2 text-xs">
				<CheckCircle2
					className="mt-0.5 h-4 w-4 shrink-0 text-[var(--positive)]"
					aria-hidden="true"
				/>
				<div className="space-y-0.5">
					<p className="font-semibold text-[var(--positive)]">
						Read-only key verified
					</p>
					{result.message ? (
						<p className="text-[var(--text-primary)]">{result.message}</p>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
			<Info
				className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]"
				aria-hidden="true"
			/>
			<div className="space-y-0.5">
				<p className="font-semibold text-[var(--text-primary)]">
					Key check note
				</p>
				<p className="text-[var(--text-secondary)]">
					{result.message ||
						"Permissions could not be verified as read-only by the exchange."}
				</p>
			</div>
		</div>
	);
}
