import type { ReactNode } from "react";

type BadgeTone = "neutral" | "accent" | "positive" | "warning" | "loss";

const TONE_STYLES: Record<BadgeTone, string> = {
	neutral:
		"bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border)]",
	accent:
		"bg-[var(--accent-soft)] text-[var(--accent-text)] border-transparent",
	positive:
		"bg-[var(--positive-soft)] text-[var(--positive)] border-transparent",
	warning: "bg-[var(--warning-soft)] text-[var(--warning)] border-transparent",
	loss: "bg-[var(--loss-soft)] text-[var(--loss)] border-transparent",
};

export function Badge({
	tone = "neutral",
	className = "",
	children,
}: {
	tone?: BadgeTone;
	className?: string;
	children: ReactNode;
}) {
	return (
		<span
			className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium leading-tight ${TONE_STYLES[tone]} ${className}`}
		>
			{children}
		</span>
	);
}
