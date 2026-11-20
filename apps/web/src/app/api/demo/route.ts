import { handle } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handle("getDemo", request);
}
export function POST(request: Request) {
	return handle("loadDemo", request);
}
export function DELETE(request: Request) {
	return handle("removeDemo", request);
}
