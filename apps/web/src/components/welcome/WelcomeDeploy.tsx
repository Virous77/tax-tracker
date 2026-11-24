"use client";

import { Check, Copy, Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { DEPLOY_OPTIONS } from "./welcome-data";

export function WelcomeDeploy() {
	const [copiedId, setCopiedId] = useState<string | null>(null);

	async function handleCopy(id: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedId(id);
			setTimeout(() => {
				setCopiedId((current) => (current === id ? null : current));
			}, 2000);
		} catch {
			// Clipboard API may be unavailable in restricted contexts; ignore silently.
		}
	}

	return (
		<section
			id="self-host"
			aria-labelledby="self-host-heading"
			className="scroll-mt-20 border-t border-[var(--border)] py-14"
		>
			<div className="mx-auto max-w-6xl space-y-8 px-4 sm:px-6 lg:px-8">
				<header className="max-w-2xl space-y-2">
					<p className="text-xs font-semibold tracking-wide text-[var(--accent-text)] uppercase">
						Self-host in 2 minutes
					</p>
					<h2
						id="self-host-heading"
						className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]"
					>
						Run locally with Docker, deploy on Railway, or use the CLI
					</h2>
					<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
						Start on your own laptop in one command, or deploy your own private
						password-protected instance on Railway with a persistent volume.
					</p>
				</header>

				<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
					{DEPLOY_OPTIONS.map((option) => {
						const isCopied = copiedId === option.id;
						return (
							<article
								key={option.id}
								className="flex min-w-0 flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 sm:p-6"
							>
								<div className="min-w-0 space-y-4">
									<div className="flex items-center justify-between gap-2">
										<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--bg-subtle)] text-[var(--accent-text)]">
											<Terminal className="h-4 w-4" aria-hidden="true" />
										</span>
										<Badge tone="neutral">{option.badge}</Badge>
									</div>
									<h3 className="text-base font-semibold text-[var(--text-primary)]">
										{option.title}
									</h3>
									<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
										{option.summary}
									</p>
									<div className="max-w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)]">
										<div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
											<span className="font-mono-code text-[11px] text-[var(--text-muted)]">
												shell
											</span>
											<button
												type="button"
												onClick={() =>
													void handleCopy(option.id, option.commands)
												}
												aria-label={`Copy ${option.title} commands`}
												className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
											>
												{isCopied ? (
													<>
														<Check
															className="h-3 w-3 text-[var(--positive)]"
															aria-hidden="true"
														/>
														<span>Copied</span>
													</>
												) : (
													<>
														<Copy className="h-3 w-3" aria-hidden="true" />
														<span>Copy</span>
													</>
												)}
											</button>
										</div>
										<pre className="font-mono-code max-w-full overflow-x-auto p-3 text-xs leading-5 text-[var(--text-primary)]">
											<code>{option.commands}</code>
										</pre>
									</div>
								</div>

								<div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-muted)]">
									<p className="leading-relaxed">{option.note}</p>
									{option.docHref && option.docLabel ? (
										<Link
											href={option.docHref}
											className="inline-block font-medium text-[var(--accent-text)] hover:underline"
										>
											{option.docLabel} →
										</Link>
									) : null}
								</div>
							</article>
						);
					})}
				</div>
			</div>
		</section>
	);
}
