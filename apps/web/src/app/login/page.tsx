import { Suspense } from "react";
import { LoginClient } from "@/components/LoginClient";
import { pageMetadata } from "@/lib/seo";
import { demoPassword, isDemoModeEnabled } from "@/server/demo-mode";
import { DEMO_SAMPLES } from "@/server/demo-samples";

export const metadata = pageMetadata("login");
export const dynamic = "force-dynamic";

export default function LoginPage() {
	const demo = isDemoModeEnabled()
		? {
				password: demoPassword(),
				samples: Object.entries(DEMO_SAMPLES).map(([name, { label }]) => ({
					name,
					label,
				})),
			}
		: undefined;
	return (
		<Suspense
			fallback={
				<div className="h-48 w-full max-w-sm animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]" />
			}
		>
			<LoginClient demo={demo} />
		</Suspense>
	);
}
