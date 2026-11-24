import { type NextRequest, NextResponse } from "next/server";
import {
	isPasswordProtected,
	SESSION_COOKIE,
	validSession,
} from "./server/auth";
import { isDemoModeEnabled } from "./server/demo-mode";

const publicPaths = new Set([
	"/api/health",
	"/api/auth/login",
	"/api/auth/logout",
	"/login",
	"/favicon.ico",
	"/manifest.webmanifest",
	"/sw.js",
	"/icon.svg",
	"/apple-icon",
	"/offline",
	"/welcome",
]);

export function proxy(request: NextRequest) {
	const path = request.nextUrl.pathname;
	const headers = { "Cache-Control": "no-store" };
	if (path === "/api/demo/samples" || path.startsWith("/api/demo/samples/"))
		return isDemoModeEnabled()
			? NextResponse.next()
			: new Response(null, { status: 404, headers });
	if (
		!isPasswordProtected() ||
		publicPaths.has(path) ||
		path.startsWith("/_next/") ||
		path.startsWith("/icons/")
	)
		return NextResponse.next();
	if (validSession(request.cookies.get(SESSION_COOKIE)?.value))
		return NextResponse.next({ headers });
	if (path.startsWith("/api/"))
		return NextResponse.json(
			{ error: { code: "unauthorized", message: "Sign in to continue." } },
			{ status: 401, headers },
		);
	if (
		request.headers.has("next-router-prefetch") ||
		request.headers.has("next-router-segment-prefetch") ||
		request.headers.get("purpose") === "prefetch"
	)
		return new Response(null, { status: 204, headers });
	if (request.headers.has("rsc") || request.nextUrl.searchParams.has("_rsc"))
		return new Response(null, { status: 401, headers });
	const login = new URL("/login", request.url);
	login.searchParams.set("next", `${path}${request.nextUrl.search}`);
	return NextResponse.redirect(login, { headers });
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
