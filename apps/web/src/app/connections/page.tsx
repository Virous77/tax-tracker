import { ConnectionsClient } from "@/components/connections/ConnectionsClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("connections");

export default function ConnectionsPage() {
	return <ConnectionsClient />;
}
