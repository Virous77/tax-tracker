import { ImportsClient } from "@/components/ImportsClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("imports");

export default function ImportsPage() {
	return <ImportsClient />;
}
