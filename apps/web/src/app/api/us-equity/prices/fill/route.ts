import { handle } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
	return handle("fillEquityPrices", request);
}
