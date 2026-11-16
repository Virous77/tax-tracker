import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
	return handle("listImports", request);
}
export async function POST(request: Request) {
	return handle("createImport", request);
}
