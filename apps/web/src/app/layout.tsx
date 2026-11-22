import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { PwaProvider } from "@/components/pwa/PwaProvider";
import { rootMetadata, rootViewport } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = rootMetadata();
export const viewport: Viewport = rootViewport();

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('tax-tracker-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script>{THEME_INIT_SCRIPT}</script>
			</head>
			<body>
				<PwaProvider>
					<AppShell>{children}</AppShell>
				</PwaProvider>
			</body>
		</html>
	);
}
