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
	return NextResponse.redirect(new URL("/login", request.url));
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
