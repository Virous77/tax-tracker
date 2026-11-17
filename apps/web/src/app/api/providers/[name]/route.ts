import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(
	request: Request,
	context: { params: Promise<{ name: string }> },
) {
	return handle("putProvider", request, await context.params);
}
export async function DELETE(
	request: Request,
	context: { params: Promise<{ name: string }> },
) {
	return handle("deleteProvider", request, await context.params);
}
