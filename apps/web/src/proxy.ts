import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, validSession } from "./server/auth";
export function proxy(request: NextRequest) {
	const path = request.nextUrl.pathname;
	if (
		!process.env.APP_PASSWORD ||
		["/api/health", "/api/auth/login", "/api/auth/logout", "/login"].includes(
			path,
		) ||
		path.startsWith("/_next/") ||
		path === "/favicon.ico"
	)
		return NextResponse.next();
	if (validSession(request.cookies.get(SESSION_COOKIE)?.value))
		return NextResponse.next();
	if (path.startsWith("/api/"))
		return NextResponse.json(
			{ error: { code: "unauthorized", message: "Sign in to continue." } },
			{ status: 401, headers: { "Cache-Control": "no-store" } },
		);
	const headers = { "Cache-Control": "no-store" };
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
