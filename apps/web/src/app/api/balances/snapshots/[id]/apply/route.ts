import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	return handle("applyBalanceSnapshot", request, await context.params);
}
