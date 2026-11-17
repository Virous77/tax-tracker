import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
	...base,
	globalSetup: process.env.PHASE2_ONLY === "1" ? undefined : base.globalSetup,
	globalTeardown:
		process.env.PHASE2_ONLY === "1" ? undefined : base.globalTeardown,
	outputDir: "test-results/phase2",
	reporter: [
		["list"],
		["json", { outputFile: "test-results/phase2-results.json" }],
	],
	projects: [
		...(process.env.PHASE2_ONLY === "1"
			? []
			: (base.projects ?? []).map((project) => ({
					...project,
					testIgnore: [
						...(Array.isArray(project.testIgnore) ? project.testIgnore : []),
						/phase2-.*\.spec\.ts/,
					],
				}))),
		{
			name: "phase2",
			testMatch: /phase2-.*\.spec\.ts/,
			// reset() may wait for a paced Binance request to fail before cleaning up.
			timeout: 180_000,
			use: { baseURL: "http://localhost:3112" },
		},
	],
});
