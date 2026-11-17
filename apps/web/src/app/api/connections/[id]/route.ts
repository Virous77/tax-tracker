import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	return handle("patchConnection", request, await context.params);
}
export async function DELETE(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	return handle("deleteConnection", request, await context.params);
}
