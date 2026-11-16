"use client";

import { Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { api, getErrorMessage } from "@/lib/client/api";

function safeNextPath(raw: string | null): string {
	if (!raw?.startsWith("/") || raw.startsWith("//")) return "/";
	return raw;
}

export function LoginClient() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const nextPath = safeNextPath(searchParams.get("next"));

	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const passwordId = useId();

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
		<div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-6 shadow-sm">
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
		</div>
	);
}
