import { Suspense } from "react";
import { LoginClient } from "@/components/LoginClient";

export default function LoginPage() {
	return (
		<Suspense
			fallback={
				<div className="h-48 w-full max-w-sm animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			}
		>
			<LoginClient />
		</Suspense>
	);
}
