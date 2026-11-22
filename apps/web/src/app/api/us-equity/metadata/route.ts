import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
	return handle("getEquityMetadata", request);
}
export async function PUT(request: Request) {
	return handle("putEquityMetadata", request);
}
