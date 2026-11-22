import { loadRules } from "@tax/rules";
import { DocsClient } from "@/components/docs/DocsClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("docs");

export default function DocsPage() {
	return (
		<DocsClient
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
