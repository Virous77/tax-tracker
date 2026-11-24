import { SettingsClient } from "@/components/SettingsClient";
import { pageMetadata } from "@/lib/seo";
import { isPasswordProtected } from "@/server/auth";

export const metadata = pageMetadata("settings");

export const dynamic = "force-dynamic";

export default function SettingsPage() {
	return <SettingsClient passwordEnabled={isPasswordProtected()} />;
}
