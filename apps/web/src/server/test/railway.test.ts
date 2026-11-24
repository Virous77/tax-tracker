import { spawnSync } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "../../app/api/auth/login/route";
import { POST as logout } from "../../app/api/auth/logout/route";
import { closeDatabases } from "../context";

const repoRoot = new URL("../../../../../", import.meta.url);
const entrypoint = fileURLToPath(
	new URL("scripts/docker-entrypoint.mjs", repoRoot),
);

it("configures a Dockerfile build and one healthy SQLite instance", async () => {
	const config = await readFile(new URL("railway.toml", repoRoot), "utf8");
	const [build, deploy] = config.split("[deploy]");
	expect(build).toMatch(/^\[build\]$/m);
	expect(build).toMatch(/^builder = "DOCKERFILE"$/m);
	expect(build).toMatch(/^dockerfilePath = "Dockerfile"$/m);
	expect(deploy).toMatch(/^healthcheckPath = "\/api\/health"$/m);
	expect(deploy).toMatch(/^healthcheckTimeout = 120$/m);
	expect(deploy).toMatch(/^restartPolicyType = "ON_FAILURE"$/m);
	expect(deploy).toMatch(/^restartPolicyMaxRetries = 5$/m);
	expect(deploy).toMatch(/^requiredMountPath = "\/data"$/m);
	expect(deploy).toMatch(/^numReplicas = 1$/m);
});

it("keeps the Dockerfile compatible with Railway's pre-build validator", async () => {
	const dockerfile = await readFile(new URL("Dockerfile", repoRoot), "utf8");
	expect(dockerfile).not.toMatch(/^\s*VOLUME\b/im);
	expect(dockerfile).not.toMatch(/--mount=type=cache\b/i);
});

it("ships paste-ready variables with only placeholders for secrets", async () => {
	const template = await readFile(
		new URL(".env.railway.example", repoRoot),
		"utf8",
	);
	expect(parseEnv(template)).toEqual({
		APP_PASSWORD: "change-me-to-a-strong-passphrase",
		DEMO_MODE: "false",
		DEMO_PASSWORD: "",
		DATA_DIR: "/data",
		RAILWAY_RUN_UID: "0",
		RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "15",
		APP_SECRET: "",
		SOURCE_URL: "https://github.com/Virous77/tax-tracker",
		AI_BASE_URL: "",
		AI_MODEL: "",
		AI_API_KEY: "",
		SECRETS_PASSPHRASE: "",
	});
});

describe("Docker startup", () => {
	let directory: string;
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "tax-railway-startup-"));
		await chmod(directory, 0o755);
	});
	afterEach(() => rm(directory, { recursive: true, force: true }));

	it("passes Node's syntax check", () => {
		expect(spawnSync(process.execPath, ["--check", entrypoint]).status).toBe(0);
	});

	it("prints Railway volume permission guidance before starting Next.js", async () => {
		const dataDir = join(directory, "unwritable");
		await mkdir(dataDir, { mode: 0o500 });
		const result = spawnSync(process.execPath, [entrypoint], {
			cwd: directory,
			env: { NODE_ENV: "test", DATA_DIR: dataDir },
			encoding: "utf8",
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"Set RAILWAY_RUN_UID=0 in Railway Variables",
		);
	});

	it("passes the port and data directory through and warns about an empty password", async () => {
		const appDir = join(directory, "apps/web");
		const dataDir = join(await realpath(directory), "data");
		await mkdir(appDir, { recursive: true, mode: 0o755 });
		await writeFile(
			join(appDir, "server.js"),
			`console.log(JSON.stringify({ port: process.env.PORT, dataDir: process.env.DATA_DIR, aiBaseUrl: process.env.AI_BASE_URL }));
process.exitCode = 7;`,
		);
		const result = spawnSync(process.execPath, [entrypoint], {
			cwd: directory,
			env: {
				NODE_ENV: "test",
				DATA_DIR: "data",
				PORT: "8080",
				RAILWAY_ENVIRONMENT: "test",
				AI_BASE_URL: "",
			},
			encoding: "utf8",
		});
		expect(result.status).toBe(7);
		expect(JSON.parse(result.stdout)).toEqual({ port: "8080", dataDir });
		expect(result.stderr).toContain("WARNING: Set APP_PASSWORD");
	});
});

describe("session cookies", () => {
	let directory: string;
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "tax-railway-session-"));
		vi.stubEnv("DATA_DIR", directory);
		vi.stubEnv("APP_PASSWORD", "synthetic-passphrase");
		vi.stubEnv("APP_SECRET", "");
		vi.stubEnv("SECRETS_PASSPHRASE", "");
	});
	afterEach(async () => {
		await closeDatabases();
		vi.unstubAllEnvs();
		await rm(directory, { recursive: true, force: true });
	});

	it.each([
		["http://localhost:3000", undefined, undefined, false],
		["http://localhost:8080", " HTTPS , http", undefined, true],
		["http://localhost:8080", "http, https", undefined, false],
		["https://app.up.railway.app", undefined, undefined, true],
		["http://localhost:3000", undefined, "true", true],
		["https://app.up.railway.app", "https", "false", false],
	])(
		"uses the expected cookie security for %s with proto %s and override %s",
		async (url, proto, override, secure) => {
			vi.stubEnv("COOKIE_SECURE", override);
			const headers = new Headers({ "Content-Type": "application/json" });
			if (proto) headers.set("X-Forwarded-Proto", proto);
			const signedIn = await login(
				new Request(`${url}/api/auth/login`, {
					method: "POST",
					headers,
					body: JSON.stringify({ password: "synthetic-passphrase" }),
				}),
			);
			const signedOut = await logout(
				new Request(`${url}/api/auth/logout`, {
					method: "POST",
					headers,
				}),
			);
			expect(signedIn.status).toBe(200);
			expect(signedOut.status).toBe(204);
			expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
			for (const response of [signedIn, signedOut]) {
				expect(response.headers.get("set-cookie")?.includes("; Secure")).toBe(
					secure,
				);
			}
		},
	);
});
