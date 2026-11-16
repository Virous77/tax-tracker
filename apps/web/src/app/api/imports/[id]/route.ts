import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	return handle("getImport", request, await context.params);
}
export async function DELETE(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	return handle("deleteImport", request, await context.params);
}
