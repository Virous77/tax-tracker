import { defineConfig, devices } from "@playwright/test";
import {
	FRESH_URL,
	MAIN_URL,
	MOCK_LLM_PORT,
	PASSWORD_URL,
} from "./support/env";

export default defineConfig({
	testDir: ".",
	outputDir: "test-results",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
	globalSetup: "./support/global-setup.ts",
	globalTeardown: "./support/global-teardown.ts",
	use: {
		...devices["Desktop Chrome"],
		viewport: { width: 1440, height: 900 },
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		timezoneId: "Asia/Kolkata",
		locale: "en-IN",
	},
	webServer: {
		command: `node tools/mock-llm/server.mjs --port ${MOCK_LLM_PORT}`,
		cwd: "../..",
		url: `http://127.0.0.1:${MOCK_LLM_PORT}/v1/models`,
		reuseExistingServer: true,
		stdout: "ignore",
		stderr: "pipe",
	},
	projects: [
		{
			name: "fresh",
			testMatch: /empty-states\.spec\.ts/,
			use: { baseURL: FRESH_URL },
		},
		{
			name: "main",
			testMatch: /\.spec\.ts$/,
			testIgnore: [
				/empty-states\.spec\.ts/,
				/password\.spec\.ts/,
				/phase2-.*\.spec\.ts/,
			],
			use: { baseURL: MAIN_URL },
		},
		{
			name: "password",
			testMatch: /password\.spec\.ts/,
			use: { baseURL: PASSWORD_URL },
		},
	],
});
