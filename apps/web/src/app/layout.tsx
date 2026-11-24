import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { PwaProvider } from "@/components/pwa/PwaProvider";
import { rootMetadata, rootViewport } from "@/lib/seo";
import { isDemoModeEnabled } from "@/server/demo-mode";
import "./globals.css";

export const metadata: Metadata = rootMetadata();
export const viewport: Viewport = rootViewport();

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('tax-tracker-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default async function RootLayout({
	children,
}: {
	children: ReactNode;
}) {
	await connection();
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script>{THEME_INIT_SCRIPT}</script>
			</head>
			<body>
				<PwaProvider>
					<AppShell publicDemo={isDemoModeEnabled()}>{children}</AppShell>
				</PwaProvider>
			</body>
		</html>
	);
}
