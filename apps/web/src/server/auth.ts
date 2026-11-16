import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiError } from "./errors";
export const SESSION_COOKIE = "tax_tracker_session";
const sessionSeconds = 12 * 60 * 60;
function privateValue(name: string): string {
	const directory = resolve(
		/* turbopackIgnore: true */ process.env.DATA_DIR ?? "./data",
	);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = resolve(directory, name);
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
		try {
			writeFileSync(path, randomBytes(32).toString("hex"), {
				flag: "wx",
				mode: 0o600,
			});
		} catch (writeError) {
			if (
				!(
					writeError instanceof Error &&
					"code" in writeError &&
					writeError.code === "EEXIST"
				)
			)
				throw writeError;
		}
		return readFileSync(path, "utf8");
	}
}
export function invalidateSessions(): void {
	const directory = resolve(
		/* turbopackIgnore: true */ process.env.DATA_DIR ?? "./data",
	);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = resolve(
		directory,
		`.session-epoch-${randomBytes(16).toString("hex")}`,
	);
	writeFileSync(temporary, randomBytes(32).toString("hex"), {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(temporary, resolve(directory, ".session-epoch"));
}
function equal(left: string, right: string): boolean {
	return timingSafeEqual(
		createHash("sha256").update(left).digest(),
		createHash("sha256").update(right).digest(),
	);
}
function signature(value: string): string {
	return createHmac(
		"sha256",
		process.env.APP_SECRET || privateValue(".session-secret"),
	)
		.update(`${privateValue(".session-epoch")}.${value}`)
		.digest("base64url");
}
export function createSession(now = Date.now()): string {
	const body = `${Math.floor(now / 1000) + sessionSeconds}.${randomBytes(16).toString("hex")}`;
	return `${body}.${signature(body)}`;
}
export function validSession(
	token: string | undefined,
	now = Date.now(),
): boolean {
	if (!token || token.length > 300) return false;
	const parts = token.split(".");
	if (parts.length !== 3) return false;
	const [expiry = "", nonce = "", sig = ""] = parts;
	if (!/^\d+$/.test(expiry) || !/^[a-f0-9]{32}$/.test(nonce)) return false;
	const seconds = Math.floor(now / 1000);
	return (
		Number(expiry) > seconds &&
		Number(expiry) <= seconds + sessionSeconds &&
		equal(sig, signature(`${expiry}.${nonce}`))
	);
}
const attempts = new Map<string, { count: number; until: number }>();
export function login(password: string, identity = "local"): string {
	const now = Date.now();
	for (const [key, value] of attempts)
		if (value.until <= now) attempts.delete(key);
	const key = createHash("sha256").update(identity).digest("hex");
	const attempt = attempts.get(key) ?? {
		count: 0,
		until: now + 15 * 60 * 1000,
	};
	if (attempt.count >= 10)
		throw new ApiError(
			429,
			"rate_limited",
			"Too many login attempts. Try again in 15 minutes.",
		);
	attempt.count++;
	attempts.set(key, attempt);
	if (attempts.size > 10000)
		attempts.delete(attempts.keys().next().value ?? "");
	if (process.env.APP_PASSWORD && !equal(password, process.env.APP_PASSWORD))
		throw new ApiError(401, "unauthorized", "Incorrect password.");
	attempts.delete(key);
	return createSession();
}
export function sessionCookie(value: string, secure: boolean): string {
	return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value ? sessionSeconds : 0}${secure ? "; Secure" : ""}`;
}
