import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { ROOT } from "./lib";

const PROJECT = process.env.COMPOSE_PROJECT ?? "taxapi";
const PORT = process.env.APP_PORT ?? "3101";

/** Recreates this suite's own compose project with a fresh data dir outside the Desktop folder. */
export async function restartStack(env: Record<string, string>) {
	const dataDir = mkdtempSync("/private/tmp/taxapi-");
	execFileSync(
		"docker",
		[
			"compose",
			"-p",
			PROJECT,
			"up",
			"-d",
			"--no-build",
			"--force-recreate",
			"app",
		],
		{
			cwd: ROOT,
			env: {
				...process.env,
				APP_PORT: PORT,
				DATA_HOST_DIR: dataDir,
				APP_PASSWORD: "",
				...env,
			},
			stdio: "pipe",
		},
	);
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://localhost:${PORT}/api/health`);
			if (res.ok) return dataDir;
		} catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error("app did not become healthy");
}
