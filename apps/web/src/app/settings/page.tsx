import { SettingsClient } from "@/components/SettingsClient";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("settings");

// APP_PASSWORD is read when the page is requested, not when the image is built.
export const dynamic = "force-dynamic";

export default function SettingsPage() {
	return <SettingsClient passwordEnabled={Boolean(process.env.APP_PASSWORD)} />;
}
