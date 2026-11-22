import type { MetadataRoute } from "next";
import { SITE_CONFIG } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
	return {
		id: "/",
		name: SITE_CONFIG.name,
		short_name: SITE_CONFIG.shortName,
		description: SITE_CONFIG.description,
		scope: "/",
		start_url: "/?source=pwa",
		display: "standalone",
		display_override: ["window-controls-overlay", "standalone"],
		orientation: "any",
		categories: ["finance", "productivity"],
		background_color: SITE_CONFIG.backgroundColor,
		theme_color: SITE_CONFIG.themeColor,
		icons: [
			{
				src: "/icon.svg",
				sizes: "any",
				type: "image/svg+xml",
			},
			{
				src: "/icons/icon-192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icons/icon-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icons/icon-512-maskable.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		],
		shortcuts: [
			{ name: "Overview", url: "/" },
			{ name: "Import Data", url: "/import" },
			{ name: "Tax Report", url: "/report" },
			{ name: "US Stocks", url: "/us-stocks" },
		],
	};
}
