import { DISCLAIMER } from "@tax/core";
import { WifiOff } from "lucide-react";
import { OfflineRetry } from "@/components/pwa/PwaProvider";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("offline");

export default function OfflinePage() {
	return (
		<div className="flex min-h-dvh flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
			<main className="flex flex-1 items-center justify-center p-4">
				<section className="w-full max-w-md space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-6 sm:p-8">
					<WifiOff
						className="h-6 w-6 text-[var(--warning)]"
						aria-hidden="true"
					/>
					<h1 className="text-2xl font-semibold tracking-tight">
						Tax Tracker is offline
					</h1>
					<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
						The Tax Tracker server is unreachable right now. Check your
						connection and try again.
					</p>
					<p className="text-sm leading-relaxed text-[var(--text-secondary)]">
						Tax data already saved in SQLite is still on the host running Tax
						Tracker.
					</p>
					<OfflineRetry />
				</section>
			</main>
			<footer className="border-t border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-center text-xs text-[var(--text-muted)]">
				{DISCLAIMER}
			</footer>
		</div>
	);
}
