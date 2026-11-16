import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { GENERATED, REPO_ROOT, SCREENSHOTS, STACKS } from "./env";

// E2E_REUSE_STACK=1 skips (re)creating the containers, for fast local iteration.
export default async function globalSetup() {
	mkdirSync(SCREENSHOTS, { recursive: true });
	if (!existsSync(path.join(GENERATED, "huge.csv"))) {
		execFileSync("node", ["tests/data/generate.mjs"], {
			cwd: REPO_ROOT,
			stdio: "ignore",
		});
	}
	if (process.env.E2E_REUSE_STACK !== "1") startStacks();
	await Promise.all(STACKS.map((s) => waitForHealth(s.port)));
}

function startStacks() {
	for (const stack of STACKS) {
		compose(stack.project, ["down", "--remove-orphans"], {});
		const dataDir = mkdtempSync(`/private/tmp/${stack.project}-`);
		compose(stack.project, ["up", "-d", "--no-build"], {
			APP_PORT: String(stack.port),
			DATA_HOST_DIR: dataDir,
			APP_PASSWORD: stack.password,
			APP_SECRET: stack.password ? "e2e-session-secret-0123456789abcdef" : "",
		});
	}
}

export function compose(
	project: string,
	args: string[],
	env: Record<string, string>,
) {
	execFileSync("docker", ["compose", "-p", project, ...args], {
		cwd: REPO_ROOT,
		env: { ...process.env, ...env },
		stdio: "ignore",
	});
}

async function waitForHealth(port: number) {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://localhost:${port}/api/health`);
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`App on port ${port} did not become healthy`);
}
