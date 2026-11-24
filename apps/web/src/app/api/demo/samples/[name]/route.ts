import { isDemoModeEnabled } from "@/server/demo-mode";
import { findDemoSample } from "@/server/demo-samples";

export const dynamic = "force-dynamic";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params;
	const sample = isDemoModeEnabled() ? findDemoSample(name) : undefined;
	const headers = { "Cache-Control": "no-store" };

	if (!sample) return new Response(null, { status: 404, headers });
	return new Response(sample.csv, {
		headers: {
			...headers,
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="${name}"`,
		},
	});
}
