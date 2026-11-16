import { defineConfig } from "vitest/config";

// One shared server and database: files must not run concurrently.
export default defineConfig({
	test: {
		include: ["**/*.test.ts"],
		fileParallelism: false,
		sequence: { concurrent: false },
		testTimeout: 60_000,
		hookTimeout: 180_000,
	},
});
