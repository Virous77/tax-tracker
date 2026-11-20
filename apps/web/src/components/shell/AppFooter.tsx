"use client";

import { DISCLAIMER } from "@tax/core";
import { useEffect, useState } from "react";
import { type AppHealth, api } from "@/lib/client/api";

export function AppFooter({ className = "" }: { className?: string }) {
	const [health, setHealth] = useState<AppHealth | null>(null);

	useEffect(() => {
		let cancelled = false;
		api
			.health()
			.then((h) => {
				if (!cancelled) setHealth(h);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<footer
			className={`space-y-1 border-t border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-center text-xs text-[var(--text-muted)] ${className}`}
		>
			<p className="flex flex-wrap items-center justify-center gap-x-2">
				{health ? <span className="num">v{health.version}</span> : null}
				{health ? <span aria-hidden="true">·</span> : null}
				<span>AGPL-3.0</span>
				{health?.sourceUrl ? (
					<>
						<span aria-hidden="true">·</span>
						<a
							href={health.sourceUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="font-medium text-[var(--accent-text)] hover:underline"
						>
							Source code
						</a>
					</>
				) : null}
			</p>
			<p>{DISCLAIMER}</p>
		</footer>
	);
}
