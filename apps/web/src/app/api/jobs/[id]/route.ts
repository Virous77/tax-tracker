import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	return handle("getJob", request, await context.params);
}
