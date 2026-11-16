import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, call, fail, ok } from "./lib";
import { restartStack } from "./stack";

const PASSWORD = "correct horse battery staple";
const UUID = "00000000-0000-4000-8000-000000000000";
const protectedRoutes: [string, string][] = Object.values(api.ApiContract)
	.filter(
		(e) =>
			!["/api/health", "/api/auth/login", "/api/auth/logout"].includes(e.path),
	)
	.map((e) => [
		e.method,
		e.path.replace(":id", UUID).replace(":taxYear", "2026-27"),
	]);

describe("without APP_PASSWORD everything is open", () => {
	it("settings, imports and transactions answer without a cookie", async () => {
		expect((await call("GET", "/api/settings")).status).toBe(200);
		expect((await call("GET", "/api/imports")).status).toBe(200);
		expect((await call("GET", "/api/transactions")).status).toBe(200);
	});
});

describe("with APP_PASSWORD", () => {
	let cookie = "";
	beforeAll(async () => {
		await restartStack({ APP_PASSWORD: PASSWORD });
	}, 180_000);
	afterAll(async () => {
		await restartStack({});
	}, 180_000);

	it("health stays public", async () => {
		ok(await call("GET", "/api/health"), 200, api.HealthResponseSchema);
	});

	it.each(protectedRoutes)(
		"%s %s → 401 without a cookie",
		async (method, path) => {
			const res = await call(
				method,
				path,
				method === "GET" || method === "DELETE" ? {} : { json: {} },
			);
			fail(res, 401, "unauthorized");
		},
	);

	it("an /api path outside the contract is also 401", async () => {
		expect((await call("GET", "/api/does-not-exist")).status).toBe(401);
	});

	it("a forged or malformed cookie → 401", async () => {
		for (const value of [
			"x",
			"9999999999.00000000000000000000000000000000.AAAA",
			`${Math.floor(Date.now() / 1000) + 3600}.${"a".repeat(32)}.forged`,
		])
			fail(
				await call("GET", "/api/settings", {
					headers: { cookie: `tax_tracker_session=${value}` },
				}),
				401,
			);
	});

	it("pages redirect to /login without a session", async () => {
		const res = await call("GET", "/");
		expect([302, 303, 307, 308]).toContain(res.status);
		expect(res.headers.get("location")).toMatch(/\/login$/);
	});

	it("empty password → 400", async () => {
		fail(
			await call("POST", "/api/auth/login", { json: { password: "" } }),
			400,
			"validation_error",
		);
	});

	it("wrong password → 401 and no cookie", async () => {
		const res = await call("POST", "/api/auth/login", {
			json: { password: "nope" },
		});
		fail(res, 401, "unauthorized");
		expect(res.headers.get("set-cookie")).toBeNull();
	});

	it("right password → {ok:true} and an HttpOnly, SameSite=Strict session cookie", async () => {
		const res = await call("POST", "/api/auth/login", {
			json: { password: PASSWORD },
		});
		ok(res, 200, api.LoginResponseSchema);
		const setCookie = res.headers.get("set-cookie") ?? "";
		expect(setCookie).toMatch(/^tax_tracker_session=[^;]+;/);
		expect(setCookie).toMatch(/;\s*HttpOnly/i);
		expect(setCookie).toMatch(/;\s*SameSite=Strict/i);
		expect(setCookie).toMatch(/;\s*Path=\//);
		expect(setCookie).toMatch(/Max-Age=43200/);
		expect(setCookie).not.toContain(PASSWORD);
		cookie = setCookie.split(";")[0];
	});

	it("the cookie opens the API", async () => {
		ok(
			await call("GET", "/api/settings", { headers: { cookie } }),
			200,
			api.SettingsResponseSchema,
		);
		ok(
			await call("GET", "/api/transactions", { headers: { cookie } }),
			200,
			api.ListTransactionsResponseSchema,
		);
	});

	it("cross-origin mutation with a valid cookie → 403", async () => {
		fail(
			await call("PUT", "/api/settings", {
				json: { surchargeRate: "0" },
				headers: { cookie, origin: "http://evil.example" },
			}),
			403,
			"forbidden",
		);
	});

	it("logout → 204 and a cookie that expires immediately", async () => {
		const res = await call("POST", "/api/auth/logout", { headers: { cookie } });
		expect(res.status).toBe(204);
		const setCookie = res.headers.get("set-cookie") ?? "";
		expect(setCookie).toMatch(/^tax_tracker_session=;/);
		expect(setCookie).toMatch(/Max-Age=0/);
	});

	it("brute force: after 10 failures the login is locked (429), even for the right password", async () => {
		const statuses: number[] = [];
		for (let i = 0; i < 12; i++)
			statuses.push(
				(
					await call("POST", "/api/auth/login", {
						json: { password: `wrong-${i}` },
					})
				).status,
			);
		expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(10);
		expect(statuses.at(-1)).toBe(429);
		fail(
			await call("POST", "/api/auth/login", { json: { password: PASSWORD } }),
			429,
			"rate_limited",
		);
	});
});
