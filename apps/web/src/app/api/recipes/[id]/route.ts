import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	return handle("deleteRecipe", request, await context.params);
}
