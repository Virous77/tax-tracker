import { spawn } from "node:child_process";
import {
	accessSync,
	constants,
	lchownSync,
	lstatSync,
	mkdirSync,
} from "node:fs";
import { constants as osConstants } from "node:os";
import { join, resolve } from "node:path";

const dataDir = resolve(process.env.DATA_DIR || "/data");
try {
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	if (process.getuid?.() === 0) {
		const nodeId = 1000;
		if (!lstatSync(dataDir).isDirectory()) throw new Error();
		lchownSync(dataDir, nodeId, nodeId);
		// Restrict privileged ownership changes to the app's database and session files.
		for (const name of [
			"tax-tracker.db",
			"tax-tracker.db-wal",
			"tax-tracker.db-shm",
			"tax-tracker.db-journal",
			".session-secret",
			".session-epoch",
		]) {
			const path = join(dataDir, name);
			const file = lstatSync(path, { throwIfNoEntry: false });
			if (file?.isFile() && file.nlink === 1) lchownSync(path, nodeId, nodeId);
		}
		process.setgroups([]);
		process.setgid(nodeId);
		process.setuid(nodeId);
	}
	accessSync(dataDir, constants.R_OK | constants.W_OK | constants.X_OK);
} catch {
	console.error(
		"Tax Tracker cannot prepare a writable DATA_DIR. Set RAILWAY_RUN_UID=0 in Railway Variables so the container can write to the mounted /data volume, or adjust volume permissions.",
	);
	process.exit(1);
}

if (
	(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN) &&
	(!process.env.APP_PASSWORD?.trim() ||
		process.env.APP_PASSWORD === "change-me-to-a-strong-passphrase")
) {
	console.warn(
		"WARNING: Set APP_PASSWORD to a strong, unique passphrase in Railway Variables before enabling a public domain or uploading tax files.",
	);
}

const env = { ...process.env, DATA_DIR: dataDir };
// An empty optional URL from Railway's Raw Editor would fail Settings validation.
if (env.AI_BASE_URL === "") delete env.AI_BASE_URL;
const server = spawn(process.execPath, ["apps/web/server.js"], {
	env,
	stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"]) {
	process.on(signal, () => server.kill(signal));
}
server.once("error", (error) => {
	console.error(`Tax Tracker could not start the web server (${error.code}).`);
	process.exitCode = 1;
});
server.once("exit", (code, signal) => {
	process.exitCode = code ?? 128 + osConstants.signals[signal];
});
