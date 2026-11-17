import { resolve } from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
	output: "standalone",
	poweredByHeader: false,
	outputFileTracingRoot: resolve(process.cwd(), "../.."),
	serverExternalPackages: [
		"better-sqlite3",
		"@tax/db",
		"@tax/importers",
		"@tax/rates",
		"@tax/rules",
	],
	transpilePackages: ["@tax/core", "@tax/engine", "@tax/recipes"],
	outputFileTracingExcludes: {
		"/*": [
			"../../data/**/*",
			"data/**/*",
			"../../**/.env*",
			"../../**/*.db*",
			"../../**/.session-secret",
			"src/**/*",
			"../../packages/*/src/**/*",
			"../../packages/*/test/**/*",
			"../../apps/cli/**/*",
			"../../docs/**/*",
			"../../.git/**/*",
		],
	},
	outputFileTracingIncludes: {
		"/*": [
			"../../packages/db/migrations/**/*",
			"../../packages/importers/dist/pdf/**/*.js",
			"../../packages/importers/node_modules/pdfjs-dist/package.json",
			"../../packages/importers/node_modules/pdfjs-dist/legacy/build/pdf.mjs",
			"../../packages/importers/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
			"../../packages/rates/data/**/*.csv",
			"../../packages/rules/data/**/*.json",
			"../../packages/rules/dist/data/**/*.json",
		],
	},
	experimental: { proxyClientMaxBodySize: "26mb" },
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "Referrer-Policy", value: "no-referrer" },
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=()",
					},
					{
						key: "Content-Security-Policy",
						value:
							"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
					},
				],
			},
		];
	},
};
export default config;
