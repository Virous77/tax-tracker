import { loadRules } from "@tax/rules";
import { WelcomeClient } from "@/components/welcome/WelcomeClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("welcome");

export default function WelcomePage() {
	return (
		<WelcomeClient
			years={[
				{
					vda: loadRules("india-vda", "2025-26"),
					equity: loadRules("india-us-equity", "2025-26"),
				},
				{
					vda: loadRules("india-vda", "2026-27"),
					equity: loadRules("india-us-equity", "2026-27"),
				},
			]}
		/>
	);
}
