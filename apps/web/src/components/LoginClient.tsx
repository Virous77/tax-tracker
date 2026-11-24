"use client";

import { AlertTriangle, Download, Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { api, getErrorMessage } from "@/lib/client/api";

function safeNextPath(raw: string | null): string {
	if (!raw?.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
		return "/";
	}
	try {
		const url = new URL(raw, "http://localhost");
		if (url.origin !== "http://localhost") return "/";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/";
	}
}

type DemoAccess = {
	password: string;
	samples: { name: string; label: string }[];
};

export function LoginClient({ demo }: { demo?: DemoAccess }) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const nextPath = safeNextPath(searchParams.get("next"));

	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copyStatus, setCopyStatus] = useState("");
	const passwordId = useId();

	async function copyPassword(passphrase: string) {
		try {
			await navigator.clipboard.writeText(passphrase);
			setCopyStatus("Copied");
		} catch {
			setCopyStatus("Could not copy. Select and copy the passphrase manually.");
		}
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!password) return;
		setSubmitting(true);
		setError(null);
		try {
			await api.login(password);
			router.replace(nextPath);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div
			className={`w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-6 shadow-sm ${demo ? "max-w-md" : "max-w-sm"}`}
		>
			<div className="mb-5 flex items-center gap-2.5">
				<span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-text)]">
					<Lock className="h-4 w-4" aria-hidden="true" />
				</span>
				<div>
					<h1 className="text-base font-semibold tracking-tight">
						Tax Tracker Unlock
					</h1>
					<p className="text-xs text-[var(--text-secondary)]">
						Enter the instance password set via{" "}
						<code className="font-mono-code">APP_PASSWORD</code>.
					</p>
				</div>
			</div>

			{demo ? (
				<div
					role="alert"
					className="mb-4 flex items-start gap-2.5 rounded-md border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-3 text-sm text-[var(--warning)]"
				>
					<AlertTriangle
						className="mt-0.5 h-4 w-4 shrink-0"
						aria-hidden="true"
					/>
					<div>
						<p className="font-semibold">Public Demo Warning</p>
						<p className="mt-1 text-xs leading-relaxed">
							This is a public demo instance. Do not upload real or sensitive
							financial or tax files. Self-host Tax Tracker locally for private
							data.
						</p>
					</div>
				</div>
			) : null}

			{demo?.password ? (
				<section className="mb-4 space-y-2 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
					<h2 className="text-sm font-semibold">Demo Access</h2>
					<div className="flex items-center gap-2">
						<code className="font-mono-code min-w-0 flex-1 [overflow-wrap:anywhere] rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs">
							{demo.password}
						</code>
						<button
							type="button"
							onClick={() => void copyPassword(demo.password)}
							className="shrink-0 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)]"
						>
							Copy
						</button>
					</div>
					<p role="status" className="text-xs text-[var(--text-secondary)]">
						{copyStatus}
					</p>
					<button
						type="button"
						onClick={() => setPassword(demo.password)}
						className="rounded px-2.5 py-1.5 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--accent-soft)]"
					>
						Fill demo password
					</button>
				</section>
			) : null}

			{error ? (
				<div className="mb-4">
					<ErrorBanner message={error} title="Login failed" />
				</div>
			) : null}

			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label
						htmlFor={passwordId}
						className="block text-xs font-medium text-[var(--text-secondary)]"
					>
						Password
					</label>
					<input
						id={passwordId}
						type="password"
						required
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-canvas)] px-3 py-2 text-sm"
					/>
				</div>

				<button
					type="submit"
					disabled={submitting || !password}
					className="w-full rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
				>
					{submitting ? "Signing in…" : "Unlock"}
				</button>
			</form>

			{demo ? (
				<section className="mt-5 space-y-2 border-t border-[var(--border)] pt-4">
					<h2 className="text-sm font-semibold">Download Sample Data Files</h2>
					<p className="text-xs leading-relaxed text-[var(--text-secondary)]">
						Upload these synthetic CSVs on the Import page after signing in,
						then compute reports for 2025–26.
					</p>
					<ul className="space-y-1">
						{demo.samples.map(({ name, label }) => (
							<li key={name}>
								<a
									href={`/api/demo/samples/${name}`}
									download={name}
									className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--accent-soft)]"
								>
									<Download
										className="h-3.5 w-3.5 shrink-0"
										aria-hidden="true"
									/>
									{label} CSV
								</a>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
