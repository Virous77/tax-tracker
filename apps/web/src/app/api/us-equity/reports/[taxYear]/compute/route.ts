import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
	request: Request,
	context: { params: Promise<{ taxYear: string }> },
) {
	return handle("computeUsEquityReport", request, await context.params);
}
