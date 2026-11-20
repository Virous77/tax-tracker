import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { DemoProvider } from "@/components/demo/DemoProvider";
import "./globals.css";

export const metadata: Metadata = {
	title: "Tax Tracker — Indian Crypto & VDA Tax Helper",
	description:
		"Self-hosted Indian VDA (Schedule VDA, Section 194S/393 TDS) ledger and report helper.",
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('tax-tracker-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script>{THEME_INIT_SCRIPT}</script>
			</head>
			<body>
				<DemoProvider>
					<AppShell>{children}</AppShell>
				</DemoProvider>
			</body>
		</html>
	);
}
